/* eslint-disable no-console */
import os from 'os';
import {
  claimGenerationJobs,
  completeGenerationJob,
  failGenerationJob,
  getSystemConfig,
  releaseGenerationJob,
  renewGenerationJobLock,
  refundGenerationBalance,
  sweepExpiredGenerationJobs,
  updateGeneration,
  updateGenerationIfLockedByJob,
} from './db';
import { generateImage, type ImageGenerateRequest } from './image-generator';
import { saveMediaWithMetrics } from './media-storage';
import type { Generation, GenerationJob } from '@/types';

export interface ImageGenerationJobPayload {
  request: ImageGenerateRequest;
  prechargedCost: number;
  generationParams: Generation['params'];
  publicBaseUrl?: string;
}

const POLL_INTERVAL_MS = 1_000;
const LOCK_RENEWAL_MAX_INTERVAL_MS = 60_000;
const LOCK_RENEWAL_MIN_INTERVAL_MS = 15_000;

type GenerationJobExecutionContext = {
  jobId: string;
  workerId: string;
  channelId?: string;
  modelId?: string;
  queuedAt?: number;
  attempt?: number;
  maxAttempts?: number;
};

type GenerationExecutionMetrics = {
  startedAt: number;
  queueWaitMs: number;
  upstreamDurationMs: number;
  mediaDownloadDurationMs: number;
  mediaUploadDurationMs: number;
  mediaStorageDurationMs: number;
  databaseUpdateDurationMs: number;
};

type QueueRuntime = {
  started: boolean;
  workerId: string;
  active: number;
  activeByChannel: Map<string, number>;
};

class GenerationJobLockLostError extends Error {
  constructor(jobId: string) {
    super(`Generation job lock lost: ${jobId}`);
    this.name = 'GenerationJobLockLostError';
  }
}

const globalForQueue = globalThis as typeof globalThis & {
  __sanhubGenerationQueue?: QueueRuntime;
};

function runtime(): QueueRuntime {
  if (!globalForQueue.__sanhubGenerationQueue) {
    globalForQueue.__sanhubGenerationQueue = {
      started: false,
      workerId: `${os.hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
      active: 0,
      activeByChannel: new Map<string, number>(),
    };
  }

  return globalForQueue.__sanhubGenerationQueue;
}

function asImageGenerationJobPayload(payload: Record<string, unknown>): ImageGenerationJobPayload {
  const request = payload.request as ImageGenerateRequest | undefined;
  if (!request || typeof request !== 'object' || typeof request.modelId !== 'string') {
    throw new Error('Invalid generation job payload');
  }

  return {
    request,
    prechargedCost: Math.max(0, Number(payload.prechargedCost) || 0),
    generationParams: (payload.generationParams || {}) as Generation['params'],
    publicBaseUrl:
      typeof payload.publicBaseUrl === 'string' ? payload.publicBaseUrl : undefined,
  };
}

function getActiveChannelCount(state: QueueRuntime, channelId: string): number {
  return state.activeByChannel.get(channelId) || 0;
}

function incrementActive(state: QueueRuntime, channelId: string) {
  state.active += 1;
  state.activeByChannel.set(channelId, getActiveChannelCount(state, channelId) + 1);
}

function decrementActive(state: QueueRuntime, channelId: string) {
  state.active = Math.max(0, state.active - 1);
  const nextChannelCount = Math.max(0, getActiveChannelCount(state, channelId) - 1);
  if (nextChannelCount > 0) {
    state.activeByChannel.set(channelId, nextChannelCount);
  } else {
    state.activeByChannel.delete(channelId);
  }
}

function isGenerationJobLockLostError(error: unknown): boolean {
  return error instanceof GenerationJobLockLostError;
}

function lockRenewalInterval(lockTimeoutMs: number): number {
  const candidate = Math.floor(Math.max(30_000, lockTimeoutMs) / 3);
  return Math.max(
    LOCK_RENEWAL_MIN_INTERVAL_MS,
    Math.min(LOCK_RENEWAL_MAX_INTERVAL_MS, candidate)
  );
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

function createExecutionMetrics(context?: GenerationJobExecutionContext): GenerationExecutionMetrics {
  const startedAt = Date.now();
  return {
    startedAt,
    queueWaitMs: context?.queuedAt ? Math.max(0, startedAt - context.queuedAt) : 0,
    upstreamDurationMs: 0,
    mediaDownloadDurationMs: 0,
    mediaUploadDurationMs: 0,
    mediaStorageDurationMs: 0,
    databaseUpdateDurationMs: 0,
  };
}

async function measureDatabaseUpdate<T>(
  metrics: GenerationExecutionMetrics,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    metrics.databaseUpdateDurationMs += elapsedMs(startedAt);
  }
}

function logGenerationMetrics(
  event: 'completed' | 'failed',
  generationId: string,
  payload: ImageGenerationJobPayload,
  metrics: GenerationExecutionMetrics,
  context?: GenerationJobExecutionContext,
  extra: Record<string, unknown> = {}
): void {
  console.log('[GenerationMetrics]', JSON.stringify({
    event,
    generationId,
    jobId: context?.jobId,
    workerId: context?.workerId,
    channelId: context?.channelId,
    modelId: context?.modelId || payload.request.modelId,
    attempt: context?.attempt,
    maxAttempts: context?.maxAttempts,
    queueWaitMs: metrics.queueWaitMs,
    upstreamDurationMs: metrics.upstreamDurationMs,
    mediaDownloadDurationMs: metrics.mediaDownloadDurationMs,
    mediaUploadDurationMs: metrics.mediaUploadDurationMs,
    mediaStorageDurationMs: metrics.mediaStorageDurationMs,
    databaseUpdateDurationMs: metrics.databaseUpdateDurationMs,
    totalDurationMs: elapsedMs(metrics.startedAt),
    ...extra,
  }));
}

async function updateGenerationForExecution(
  generationId: string,
  updates: Partial<Pick<Generation, 'status' | 'resultUrl' | 'errorMessage' | 'params'>>,
  context?: GenerationJobExecutionContext
): Promise<void> {
  if (!context) {
    await updateGeneration(generationId, updates);
    return;
  }

  const updated = await updateGenerationIfLockedByJob(
    generationId,
    context.jobId,
    context.workerId,
    updates
  );
  if (!updated) {
    throw new GenerationJobLockLostError(context.jobId);
  }
}

function isRetryableGenerationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();

  const permanentPatterns = [
    'insufficient balance',
    'balance',
    'missing model',
    'model not found',
    'model is disabled',
    'invalid generation job payload',
    'invalid',
    'bad request',
    'prompt blocked',
    'safety policy',
    'requires a reference image',
    'please enter a prompt',
    'unauthorized',
    'forbidden',
    '401',
    '403',
    '404',
  ];

  if (permanentPatterns.some((pattern) => normalized.includes(pattern))) {
    return false;
  }

  const retryablePatterns = [
    'timeout',
    'timed out',
    'network',
    'fetch',
    'socket',
    'econnreset',
    'econnrefused',
    'etimedout',
    'rate limit',
    'too many requests',
    'busy',
    'overloaded',
    'temporarily unavailable',
    'service unavailable',
    'upstream',
    'gateway',
    '429',
    '500',
    '502',
    '503',
    '504',
  ];

  return retryablePatterns.some((pattern) => normalized.includes(pattern));
}

export async function executeImageGenerationJobPayload(
  generationId: string,
  payload: ImageGenerationJobPayload,
  context?: GenerationJobExecutionContext
): Promise<void> {
  const metrics = createExecutionMetrics(context);

  try {
    await measureDatabaseUpdate(metrics, () =>
      updateGenerationForExecution(generationId, {
        status: 'processing',
        params: {
          ...payload.generationParams,
          progress: 10,
        },
      }, context)
    );

    const upstreamStartedAt = Date.now();
    const result = await generateImage(payload.request);
    metrics.upstreamDurationMs = elapsedMs(upstreamStartedAt);

    await measureDatabaseUpdate(metrics, () =>
      updateGenerationForExecution(generationId, {
        status: 'processing',
        params: {
          ...payload.generationParams,
          progress: 80,
        },
      }, context)
    );

    const savedMedia = await saveMediaWithMetrics(generationId, result.url, {
      publicBaseUrl: payload.publicBaseUrl,
    });
    metrics.mediaDownloadDurationMs = savedMedia.metrics.mediaDownloadDurationMs;
    metrics.mediaUploadDurationMs = savedMedia.metrics.mediaUploadDurationMs;
    metrics.mediaStorageDurationMs = savedMedia.metrics.totalDurationMs;

    if (context) {
      const completed = await measureDatabaseUpdate(metrics, () =>
        completeGenerationJob(context.jobId, context.workerId, generationId, {
          resultUrl: savedMedia.url,
          params: {
            ...payload.generationParams,
            progress: 100,
          },
        })
      );
      if (!completed) {
        throw new GenerationJobLockLostError(context.jobId);
      }
      logGenerationMetrics('completed', generationId, payload, metrics, context, {
        mediaInputKind: savedMedia.metrics.inputKind,
        mediaOutputKind: savedMedia.metrics.outputKind,
      });
      return;
    }

    await measureDatabaseUpdate(metrics, () =>
      updateGeneration(generationId, {
        status: 'completed',
        resultUrl: savedMedia.url,
        errorMessage: '',
        params: {
          ...payload.generationParams,
          progress: 100,
        },
      })
    );

    logGenerationMetrics('completed', generationId, payload, metrics, context, {
      mediaInputKind: savedMedia.metrics.inputKind,
      mediaOutputKind: savedMedia.metrics.outputKind,
    });
  } catch (error) {
    logGenerationMetrics('failed', generationId, payload, metrics, context, {
      errorMessage: error instanceof Error ? error.message : 'Generation failed',
    });
    throw error;
  }
}

async function finalizeExpiredJob(job: GenerationJob) {
  const message = job.errorMessage || 'Generation job expired after reaching max attempts';
  console.warn(`[GenerationQueue] Expired job ${job.id} for generation ${job.generationId}: ${message}`);

  await updateGeneration(job.generationId, {
    status: 'failed',
    errorMessage: message,
  }).catch((updateError) => {
    console.error(`[GenerationQueue] Failed to mark expired generation ${job.generationId} failed:`, updateError);
  });

  const prechargedCost = Math.max(0, Number(job.payload.prechargedCost) || 0);
  await refundGenerationBalance(
    job.generationId,
    job.userId,
    prechargedCost
  ).catch((refundError) => {
    console.error(`[GenerationQueue] Refund failed for expired generation ${job.generationId}:`, refundError);
  });
}

async function executeClaimedJob(state: QueueRuntime, job: GenerationJob, lockTimeoutMs: number) {
  incrementActive(state, job.channelId);
  let lockOwned = true;
  const heartbeat = setInterval(() => {
    renewGenerationJobLock(job.id, state.workerId, lockTimeoutMs)
      .then((renewed) => {
        if (!renewed) {
          lockOwned = false;
          console.warn(`[GenerationQueue] Lost lock for job ${job.id}`);
        }
      })
      .catch((error) => {
        lockOwned = false;
        console.error(`[GenerationQueue] Failed to renew lock for job ${job.id}:`, error);
      });
  }, lockRenewalInterval(lockTimeoutMs));

  if (typeof heartbeat === 'object' && 'unref' in heartbeat && typeof heartbeat.unref === 'function') {
    heartbeat.unref();
  }

  try {
    const payload = asImageGenerationJobPayload(job.payload);
    console.log(`[GenerationQueue] Running job ${job.id} for generation ${job.generationId}`);
    await executeImageGenerationJobPayload(job.generationId, payload, {
      jobId: job.id,
      workerId: state.workerId,
      channelId: job.channelId,
      modelId: job.modelId,
      queuedAt: job.createdAt,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
    });
    console.log(`[GenerationQueue] Completed job ${job.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed';
    if (!lockOwned || isGenerationJobLockLostError(error)) {
      console.warn(`[GenerationQueue] Skipping finalization for job ${job.id} because the lock is no longer owned`);
      return;
    }

    const shouldRetry = job.attempts < job.maxAttempts && isRetryableGenerationError(error);

    console.error(`[GenerationQueue] Job ${job.id} failed:`, error);

    if (shouldRetry) {
      try {
        const released = await failGenerationJob(
          job.id,
          state.workerId,
          job.generationId,
          message,
          true,
          {
            params: {
              ...((job.payload.generationParams || {}) as Generation['params']),
              progress: 0,
            },
          }
        );
        if (!released) {
          throw new GenerationJobLockLostError(job.id);
        }
      } catch (finalizeError) {
        if (isGenerationJobLockLostError(finalizeError)) {
          console.warn(`[GenerationQueue] Retry finalization skipped for job ${job.id} because the lock is no longer owned`);
          return;
        }
        console.error(`[GenerationQueue] Failed to retry job ${job.id}:`, finalizeError);
      }
      return;
    }

    try {
      const failed = await failGenerationJob(
        job.id,
        state.workerId,
        job.generationId,
        message,
        false
      );
      if (!failed) {
        throw new GenerationJobLockLostError(job.id);
      }
    } catch (finalizeError) {
      if (isGenerationJobLockLostError(finalizeError)) {
        console.warn(`[GenerationQueue] Failure finalization skipped for job ${job.id} because the lock is no longer owned`);
        return;
      }
      console.error(`[GenerationQueue] Failed to mark job ${job.id} failed:`, finalizeError);
      return;
    }

    const prechargedCost = Math.max(0, Number(job.payload.prechargedCost) || 0);
    await refundGenerationBalance(
      job.generationId,
      job.userId,
      prechargedCost
    ).catch((refundError) => {
      console.error(`[GenerationQueue] Refund failed for generation ${job.generationId}:`, refundError);
    });
  } finally {
    clearInterval(heartbeat);
    decrementActive(state, job.channelId);
  }
}

async function tick(state: QueueRuntime) {
  const config = await getSystemConfig();
  const queueConfig = config.generationQueue;
  if (!queueConfig.enabled) return;

  const globalAvailable = Math.max(0, queueConfig.imageConcurrency - state.active);
  if (globalAvailable <= 0) return;

  const lockTimeoutMs = queueConfig.lockTimeoutSeconds * 1_000;
  const expiredJobs = await sweepExpiredGenerationJobs(Math.max(1, globalAvailable));
  for (const job of expiredJobs) {
    void finalizeExpiredJob(job);
  }

  const candidates = await claimGenerationJobs(
    state.workerId,
    globalAvailable,
    lockTimeoutMs
  );

  for (const job of candidates) {
    if (state.active >= queueConfig.imageConcurrency) {
      await releaseGenerationJob(job.id, state.workerId, 'Concurrency slot unavailable');
      continue;
    }

    if (getActiveChannelCount(state, job.channelId) >= queueConfig.channelConcurrency) {
      await releaseGenerationJob(job.id, state.workerId, 'Channel concurrency slot unavailable');
      continue;
    }

    void executeClaimedJob(state, job, lockTimeoutMs);
  }
}

export function startGenerationQueueWorker() {
  const state = runtime();
  if (state.started) return;

  state.started = true;
  console.log(`[GenerationQueue] Worker started: ${state.workerId}`);

  setInterval(() => {
    tick(state).catch((error) => {
      console.error('[GenerationQueue] Worker tick failed:', error);
    });
  }, POLL_INTERVAL_MS);

  void tick(state);
}
