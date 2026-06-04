/* eslint-disable no-console */
import os from 'os';
import {
  claimGenerationJobs,
  completeGenerationJob,
  failGenerationJob,
  getSystemConfig,
  releaseGenerationJob,
  refundGenerationBalance,
  updateGeneration,
} from './db';
import { generateImage, type ImageGenerateRequest } from './image-generator';
import { saveMediaAsync } from './media-storage';
import type { Generation, GenerationJob } from '@/types';

export interface ImageGenerationJobPayload {
  request: ImageGenerateRequest;
  prechargedCost: number;
  generationParams: Generation['params'];
  publicBaseUrl?: string;
}

const POLL_INTERVAL_MS = 1_000;

type QueueRuntime = {
  started: boolean;
  workerId: string;
  active: number;
  activeByChannel: Map<string, number>;
};

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

export async function executeImageGenerationJobPayload(
  generationId: string,
  payload: ImageGenerationJobPayload
): Promise<void> {
  await updateGeneration(generationId, {
    status: 'processing',
    params: {
      ...payload.generationParams,
      progress: 10,
    },
  });

  const result = await generateImage(payload.request);

  await updateGeneration(generationId, {
    status: 'processing',
    params: {
      ...payload.generationParams,
      progress: 80,
    },
  });

  const savedUrl = await saveMediaAsync(generationId, result.url, {
    publicBaseUrl: payload.publicBaseUrl,
  });

  await updateGeneration(generationId, {
    status: 'completed',
    resultUrl: savedUrl,
    params: {
      ...payload.generationParams,
      progress: 100,
    },
  });
}

async function executeClaimedJob(state: QueueRuntime, job: GenerationJob) {
  incrementActive(state, job.channelId);

  try {
    const payload = asImageGenerationJobPayload(job.payload);
    console.log(`[GenerationQueue] Running job ${job.id} for generation ${job.generationId}`);
    await executeImageGenerationJobPayload(job.generationId, payload);
    await completeGenerationJob(job.id);
    console.log(`[GenerationQueue] Completed job ${job.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed';
    const shouldRetry = job.attempts < job.maxAttempts;

    console.error(`[GenerationQueue] Job ${job.id} failed:`, error);
    await failGenerationJob(job.id, message, shouldRetry);

    if (shouldRetry) {
      await updateGeneration(job.generationId, {
        status: 'pending',
        errorMessage: message,
        params: {
          ...((job.payload.generationParams || {}) as Generation['params']),
          progress: 0,
        },
      }).catch((updateError) => {
        console.error(`[GenerationQueue] Failed to reset generation ${job.generationId}:`, updateError);
      });
      return;
    }

    await updateGeneration(job.generationId, {
      status: 'failed',
      errorMessage: message,
    }).catch((updateError) => {
      console.error(`[GenerationQueue] Failed to mark generation ${job.generationId} failed:`, updateError);
    });

    const prechargedCost = Math.max(0, Number(job.payload.prechargedCost) || 0);
    await refundGenerationBalance(
      job.generationId,
      job.userId,
      prechargedCost
    ).catch((refundError) => {
      console.error(`[GenerationQueue] Refund failed for generation ${job.generationId}:`, refundError);
    });
  } finally {
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
  const candidates = await claimGenerationJobs(
    state.workerId,
    globalAvailable,
    lockTimeoutMs
  );

  for (const job of candidates) {
    if (state.active >= queueConfig.imageConcurrency) {
      await releaseGenerationJob(job.id, 'Concurrency slot unavailable');
      continue;
    }

    if (getActiveChannelCount(state, job.channelId) >= queueConfig.channelConcurrency) {
      await releaseGenerationJob(job.id, 'Channel concurrency slot unavailable');
      continue;
    }

    void executeClaimedJob(state, job);
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
