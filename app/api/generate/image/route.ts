/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { resolveImageTarget, type ImageGenerateRequest } from '@/lib/image-generator';
import {
  createGenerationJob,
  getGenerationByClientRequestId,
  getImageModelWithChannel,
  getSystemConfig,
  getUserById,
  refundGenerationBalance,
  saveGeneration,
  updateGeneration,
  updateUserBalance,
} from '@/lib/db';
import {
  executeImageGenerationJobPayload,
  startGenerationQueueWorker,
  type ImageGenerationJobPayload,
} from '@/lib/generation-queue';
import { checkRateLimit } from '@/lib/rate-limit';
import { fetchReferenceImage } from '@/lib/reference-image';
import { assertPromptsAllowed, isPromptBlockedError } from '@/lib/prompt-blocklist';
import { resolveImageSize } from '@/lib/v1-images';
import {
  inferImageSizeLabel as inferNormalizedImageSizeLabel,
  normalizeAspectRatio,
} from '@/lib/image-sizing';
import type { ChannelType, Generation, GenerationType } from '@/types';

export const maxDuration = 600;
export const dynamic = 'force-dynamic';

const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 6;
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const imageTaskCreationPromises = new Map<string, Promise<Generation>>();
const IMAGE_TYPE_BY_CHANNEL: Record<ChannelType, GenerationType> = {
  apexerapi: 'gemini-image',
  'openai-compatible': 'gemini-image',
  'openai-chat': 'gemini-image',
  gemini: 'gemini-image',
  modelscope: 'zimage-image',
  gitee: 'gitee-image',
  sora: 'sora-image',
  flow2api: 'gemini-image',
  grok2api: 'gemini-image',
};

class RouteResponseError extends Error {
  constructor(public response: NextResponse) {
    super('Route response');
  }
}

function buildTaskResponse(generation: Generation, message: string) {
  return NextResponse.json({
    success: true,
    data: {
      id: generation.id,
      status: generation.status,
      type: generation.type,
      message,
    },
  });
}

function throwRouteResponse(response: NextResponse): never {
  throw new RouteResponseError(response);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function getGoogleImageConfig(body: Record<string, unknown>): Record<string, unknown> {
  const extraBody = body.extra_body;
  if (!extraBody || typeof extraBody !== 'object') return {};

  const google = (extraBody as Record<string, unknown>).google;
  if (!google || typeof google !== 'object') return {};

  const imageConfig = (google as Record<string, unknown>).image_config;
  return imageConfig && typeof imageConfig === 'object'
    ? (imageConfig as Record<string, unknown>)
    : {};
}

function isInlineImageInput(value: unknown): value is { mimeType: string; data: string } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.data === 'string' && typeof record.mimeType === 'string';
}

async function runDirectGenerationTask(
  generationId: string,
  userId: string,
  payload: ImageGenerationJobPayload
) {
  try {
    await executeImageGenerationJobPayload(generationId, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed';
    await updateGeneration(generationId, {
      status: 'failed',
      errorMessage: message,
    });
    await refundGenerationBalance(generationId, userId, payload.prechargedCost).catch((refundError) => {
      console.error(`[API] Refund failed for direct generation ${generationId}:`, refundError);
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    startGenerationQueueWorker();

    const systemConfig = await getSystemConfig();
    const imageMaxRequests = Math.max(1, Number(systemConfig.rateLimit?.imageMaxRequests) || 30);
    const imageWindowSeconds = Math.max(1, Number(systemConfig.rateLimit?.imageWindowSeconds) || 60);
    const rateLimit = checkRateLimit(
      request,
      { maxRequests: imageMaxRequests, windowSeconds: imageWindowSeconds },
      'generate-image'
    );

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: rateLimit.headers }
      );
    }

    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Please sign in first' }, { status: 401 });
    }

    const body = await request.json();
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const googleImageConfig = getGoogleImageConfig(payload);
    const modelId = firstString(payload.modelId, payload.model_id);
    const prompt = firstString(payload.prompt) || '';
    const size = firstString(payload.size, googleImageConfig.size);
    const quality = firstString(payload.quality, googleImageConfig.quality);
    const images = payload.images;
    const referenceImages = payload.referenceImages || payload.reference_images;
    const referenceImageUrl = firstString(payload.referenceImageUrl, payload.reference_image_url);
    const aspectRatio = normalizeAspectRatio(
      firstString(
        payload.aspectRatio,
        payload.aspect_ratio,
        googleImageConfig.aspectRatio,
        googleImageConfig.aspect_ratio
      )
    );
    const imageSize = firstString(
      payload.imageSize,
      payload.image_size,
      googleImageConfig.imageSize,
      googleImageConfig.image_size
    );
    const clientRequestId = firstString(payload.clientRequestId, payload.client_request_id) || '';
    const batchId = firstString(payload.batchId, payload.batch_id);
    const batchName = firstString(payload.batchName, payload.batch_name);
    const batchIndex = Number(payload.batchIndex ?? payload.batch_index);
    const batchSize = Number(payload.batchSize ?? payload.batch_size);
    const resolvedInputSize = resolveImageSize(size);
    const effectiveAspectRatio = aspectRatio || resolvedInputSize.aspectRatio;
    const effectiveImageSize =
      inferNormalizedImageSizeLabel(imageSize) ||
      imageSize ||
      inferNormalizedImageSizeLabel(size);
    const effectiveSize = resolvedInputSize.size || size;

    if (clientRequestId && !CLIENT_REQUEST_ID_PATTERN.test(clientRequestId)) {
      return NextResponse.json({ error: 'Invalid client request id' }, { status: 400 });
    }

    await assertPromptsAllowed([prompt]);

    if (!modelId) {
      return NextResponse.json({ error: 'Missing model id' }, { status: 400 });
    }

    const modelConfig = await getImageModelWithChannel(modelId);
    if (!modelConfig) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    const { model, channel } = modelConfig;
    if (!model.enabled) {
      return NextResponse.json({ error: 'Model is disabled' }, { status: 400 });
    }

    const resolvedTarget = resolveImageTarget(
      model.apiModel,
      model.resolutions,
      effectiveAspectRatio,
      effectiveImageSize
    );

    const user = await getUserById(session.user.id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }
    if (user.disabled) {
      return NextResponse.json({ error: 'Account is disabled' }, { status: 403 });
    }

    const creationKey = clientRequestId ? `${user.id}:${clientRequestId}` : '';
    const pendingCreation = creationKey ? imageTaskCreationPromises.get(creationKey) : undefined;
    if (pendingCreation) {
      try {
        const generation = await pendingCreation;
        return buildTaskResponse(generation, 'Task already exists; reused current task');
      } catch (error) {
        if (error instanceof RouteResponseError) return error.response;
        throw error;
      }
    }

    if (clientRequestId) {
      const existingGeneration = await getGenerationByClientRequestId(user.id, clientRequestId);
      if (existingGeneration) {
        return buildTaskResponse(existingGeneration, 'Task already exists; reused current task');
      }
    }

    const pendingCreationAfterLookup = creationKey
      ? imageTaskCreationPromises.get(creationKey)
      : undefined;
    if (pendingCreationAfterLookup) {
      try {
        const generation = await pendingCreationAfterLookup;
        return buildTaskResponse(generation, 'Task already exists; reused current task');
      } catch (error) {
        if (error instanceof RouteResponseError) return error.response;
        throw error;
      }
    }

    const createTask = async (): Promise<Generation> => {
      if (user.balance < model.costPerGeneration) {
        throwRouteResponse(
          NextResponse.json(
            { error: `Insufficient balance; at least ${model.costPerGeneration} points required` },
            { status: 402 }
          )
        );
      }

      const origin = new URL(request.url).origin;
      const imageList: Array<{ mimeType: string; data: string }> = [];

      if (Array.isArray(images)) {
        imageList.push(...images.filter(isInlineImageInput));
      }

      if (referenceImageUrl) {
        const referenceImage = await fetchReferenceImage(referenceImageUrl, {
          origin,
          userId: session.user.id,
          userRole: session.user.role,
          maxBytes: MAX_REFERENCE_IMAGE_BYTES,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        imageList.push({
          mimeType: referenceImage.mimeType,
          data: referenceImage.dataUrl,
        });
      }

      if (Array.isArray(referenceImages)) {
        for (const img of referenceImages) {
          if (typeof img !== 'string') continue;

          if (img.startsWith('data:')) {
            const match = img.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              imageList.push({ mimeType: match[1], data: img });
            }
            continue;
          }

          const referenceImage = await fetchReferenceImage(img, {
            origin,
            userId: session.user.id,
            userRole: session.user.role,
            maxBytes: MAX_REFERENCE_IMAGE_BYTES,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });
          imageList.push({
            mimeType: referenceImage.mimeType,
            data: referenceImage.dataUrl,
          });
        }
      }

      if (imageList.length > MAX_REFERENCE_IMAGES) {
        throwRouteResponse(
          NextResponse.json(
            { error: `A maximum of ${MAX_REFERENCE_IMAGES} reference images is supported` },
            { status: 400 }
          )
        );
      }

      if (model.requiresReferenceImage && imageList.length === 0) {
        throwRouteResponse(
          NextResponse.json({ error: 'This model requires a reference image' }, { status: 400 })
        );
      }

      if (!model.allowEmptyPrompt && !prompt && imageList.length === 0) {
        throwRouteResponse(
          NextResponse.json(
            { error: 'Please enter a prompt or upload a reference image' },
            { status: 400 }
          )
        );
      }

      const generateRequest: ImageGenerateRequest = {
        modelId,
        prompt: prompt || '',
        size: resolvedTarget.size || effectiveSize,
        aspectRatio: effectiveAspectRatio,
        imageSize: effectiveImageSize,
        quality,
        images: imageList.length > 0 ? imageList : undefined,
      };

      try {
        await updateUserBalance(user.id, -model.costPerGeneration, 'strict');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Insufficient balance';
        if (message.includes('Insufficient balance')) {
          throwRouteResponse(
            NextResponse.json(
              { error: `Insufficient balance; at least ${model.costPerGeneration} points required` },
              { status: 402 }
            )
          );
        }
        throw error;
      }

      const generationParams: Generation['params'] = {
        model: model.apiModel,
        modelId,
        aspectRatio: effectiveAspectRatio,
        imageSize: effectiveImageSize,
        size: resolvedTarget.size || effectiveSize,
        quality,
        imageCount: imageList.length,
        progress: 0,
        clientRequestId: clientRequestId || undefined,
        batchId,
        batchName,
        batchIndex: Number.isFinite(batchIndex) ? batchIndex : undefined,
        batchSize: Number.isFinite(batchSize) ? batchSize : undefined,
      };

      let generation: Generation;
      try {
        generation = await saveGeneration({
          userId: user.id,
          type: IMAGE_TYPE_BY_CHANNEL[channel.type] || 'gemini-image',
          prompt: prompt || '',
          params: generationParams,
          resultUrl: '',
          cost: model.costPerGeneration,
          status: 'pending',
          balancePrecharged: true,
          balanceRefunded: false,
        });
      } catch (error) {
        await updateUserBalance(user.id, model.costPerGeneration, 'strict').catch((refundError) => {
          console.error('[API] Precharge rollback failed:', refundError);
        });
        throw error;
      }

      const queuedRequest: ImageGenerateRequest = {
        ...generateRequest,
        idempotencyKey: `sanhub-image-${clientRequestId || generation.id}`,
      };
      const queuePayload: ImageGenerationJobPayload = {
        request: queuedRequest,
        prechargedCost: model.costPerGeneration,
        generationParams,
        publicBaseUrl: origin,
      };

      if (systemConfig.generationQueue.enabled) {
        try {
          await createGenerationJob({
            generationId: generation.id,
            userId: user.id,
            type: 'image',
            channelId: channel.id,
            modelId,
            payload: queuePayload as unknown as Record<string, unknown>,
            maxAttempts: systemConfig.generationQueue.maxAttempts,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to enqueue generation task';
          await updateGeneration(generation.id, {
            status: 'failed',
            errorMessage: message,
          }).catch(() => {});
          await refundGenerationBalance(generation.id, user.id, model.costPerGeneration).catch((refundError) => {
            console.error('[API] Enqueue rollback refund failed:', refundError);
          });
          throw error;
        }
      } else {
        void runDirectGenerationTask(generation.id, user.id, queuePayload);
      }

      console.log('[API] Image generation task created', {
        id: generation.id,
        modelId,
        model: model.apiModel,
        resolvedModel: resolvedTarget.model,
        resolvedSize: resolvedTarget.size,
        queued: systemConfig.generationQueue.enabled,
      });

      return generation;
    };

    const creationPromise = createTask();
    if (creationKey) {
      imageTaskCreationPromises.set(creationKey, creationPromise);
    }

    try {
      const generation = await creationPromise;
      return buildTaskResponse(generation, 'Task created and queued for background processing');
    } catch (error) {
      if (error instanceof RouteResponseError) return error.response;
      throw error;
    } finally {
      if (creationKey && imageTaskCreationPromises.get(creationKey) === creationPromise) {
        imageTaskCreationPromises.delete(creationKey);
      }
    }
  } catch (error) {
    console.error('[API] Image generation error:', error);

    if (isPromptBlockedError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Prompt blocked by safety policy' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Generation failed' },
      { status: 500 }
    );
  }
}
