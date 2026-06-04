import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSystemConfig, updateSystemConfig } from '@/lib/db';
import { syncUnusedInviteCodeBonuses } from '@/lib/db-codes';
import type { EmailVerificationConfig, ImageBucketConfig, ImageStorageConfig, PaymentConfig, PaymentMethodConfig } from '@/types';

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function normalizeBucket(
  value: unknown,
  index: number
): ImageBucketConfig | null {
  if (!value || typeof value !== 'object') return null;

  const bucket = value as Record<string, unknown>;
  const nextBucket: ImageBucketConfig = {
    id:
      typeof bucket.id === 'string' && bucket.id.trim()
        ? bucket.id.trim()
        : `bucket-${index + 1}`,
    name:
      typeof bucket.name === 'string' && bucket.name.trim()
        ? bucket.name.trim()
        : `Bucket ${index + 1}`,
    provider:
      bucket.provider === 's3-compatible' ? 's3-compatible' : 'picui',
    baseUrl: typeof bucket.baseUrl === 'string' ? bucket.baseUrl.trim() : '',
    apiKey: typeof bucket.apiKey === 'string' ? bucket.apiKey.trim() : '',
    secretKey:
      typeof bucket.secretKey === 'string' ? bucket.secretKey.trim() : undefined,
    bucketName:
      typeof bucket.bucketName === 'string' ? bucket.bucketName.trim() : undefined,
    region:
      typeof bucket.region === 'string' ? bucket.region.trim() : undefined,
    publicBaseUrl:
      typeof bucket.publicBaseUrl === 'string'
        ? bucket.publicBaseUrl.trim()
        : undefined,
    pathPrefix:
      typeof bucket.pathPrefix === 'string' ? bucket.pathPrefix.trim() : undefined,
    forcePathStyle: bucket.forcePathStyle !== false,
    enabled: bucket.enabled !== false,
  };

  const isBlankBucket =
    !nextBucket.baseUrl &&
    !nextBucket.apiKey &&
    !nextBucket.secretKey &&
    !nextBucket.bucketName &&
    !nextBucket.publicBaseUrl &&
    !nextBucket.pathPrefix;

  return isBlankBucket ? null : nextBucket;
}

function normalizeImageStorage(
  value: unknown,
  current: ImageStorageConfig
): ImageStorageConfig {
  if (!value || typeof value !== 'object') {
    return current;
  }

  const raw = value as Record<string, unknown>;
  const buckets = Array.isArray(raw.buckets)
    ? raw.buckets
        .map((bucket, index) => normalizeBucket(bucket, index))
        .filter((bucket): bucket is ImageBucketConfig => Boolean(bucket))
    : current.buckets;

  for (const bucket of buckets) {
    if (!bucket.enabled) continue;

    if (bucket.provider === 'picui') {
      if (!bucket.baseUrl || !bucket.apiKey) {
        throw new Error(`桶 ${bucket.name} 缺少 PicUI 地址或 API Key`);
      }
      continue;
    }

    if (!bucket.baseUrl || !bucket.apiKey || !bucket.secretKey || !bucket.bucketName) {
      throw new Error(`桶 ${bucket.name} 缺少 S3 兼容存储的必要配置`);
    }
  }

  const enabledBucketIds = new Set(
    buckets.filter((bucket) => bucket.enabled).map((bucket) => bucket.id)
  );
  let defaultBucketId =
    typeof raw.defaultBucketId === 'string' ? raw.defaultBucketId.trim() : '';

  if (defaultBucketId && !enabledBucketIds.has(defaultBucketId)) {
    throw new Error('默认桶必须指向启用中的桶');
  }

  if (!defaultBucketId) {
    defaultBucketId = buckets.find((bucket) => bucket.enabled)?.id || '';
  }

  return {
    defaultBucketId,
    buckets,
  };
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeEmailVerification(
  value: unknown,
  current: EmailVerificationConfig
): EmailVerificationConfig {
  if (!value || typeof value !== 'object') {
    return current;
  }

  const raw = value as Record<string, unknown>;
  const rawSmtp =
    raw.smtp && typeof raw.smtp === 'object'
      ? (raw.smtp as Record<string, unknown>)
      : {};

  return {
    enabled:
      typeof raw.enabled === 'boolean' ? raw.enabled : current.enabled,
    domainWhitelistEnabled:
      typeof raw.domainWhitelistEnabled === 'boolean'
        ? raw.domainWhitelistEnabled
        : current.domainWhitelistEnabled,
    allowedDomains: normalizeString(raw.allowedDomains, current.allowedDomains),
    aliasRestrictionEnabled:
      typeof raw.aliasRestrictionEnabled === 'boolean'
        ? raw.aliasRestrictionEnabled
        : current.aliasRestrictionEnabled,
    codeExpiresMinutes: normalizePositiveInt(
      raw.codeExpiresMinutes,
      current.codeExpiresMinutes
    ),
    smtp: {
      host: normalizeString(rawSmtp.host, current.smtp.host),
      port: normalizePositiveInt(rawSmtp.port, current.smtp.port),
      username: normalizeString(rawSmtp.username, current.smtp.username),
      password:
        typeof rawSmtp.password === 'string'
          ? rawSmtp.password
          : current.smtp.password,
      fromEmail: normalizeString(rawSmtp.fromEmail, current.smtp.fromEmail),
      secure:
        typeof rawSmtp.secure === 'boolean'
          ? rawSmtp.secure
          : current.smtp.secure,
      authLogin:
        typeof rawSmtp.authLogin === 'boolean'
          ? rawSmtp.authLogin
          : current.smtp.authLogin,
    },
  };
}

function parseJsonConfig<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error('JSON 配置格式不正确');
  }
}

function normalizePaymentConfig(
  value: unknown,
  current: PaymentConfig
): PaymentConfig {
  if (!value || typeof value !== 'object') {
    return current;
  }

  const raw = value as Record<string, unknown>;
  const rawEasyPay =
    raw.easyPay && typeof raw.easyPay === 'object'
      ? (raw.easyPay as Record<string, unknown>)
      : {};

  const methods = Array.isArray(raw.methods)
    ? raw.methods
    : parseJsonConfig<PaymentMethodConfig[] | null>(raw.methodsJson, null);
  const amountOptions = Array.isArray(raw.amountOptions)
    ? raw.amountOptions
    : parseJsonConfig<number[] | null>(raw.amountOptionsJson, null);
  const amountDiscounts =
    raw.amountDiscounts && typeof raw.amountDiscounts === 'object'
      ? (raw.amountDiscounts as Record<string, number>)
      : parseJsonConfig<Record<string, number> | null>(
          raw.amountDiscountsJson,
          null
        );

  return {
    enabled:
      typeof raw.enabled === 'boolean' ? raw.enabled : current.enabled,
    serverBaseUrl: normalizeString(raw.serverBaseUrl, current.serverBaseUrl),
    callbackUrl: normalizeString(raw.callbackUrl, current.callbackUrl),
    pointsPerCny: normalizePositiveInt(
      raw.pointsPerCny,
      current.pointsPerCny
    ),
    methods: (methods || current.methods)
      .map((method) => ({
        color: normalizeString(method?.color, 'rgba(var(--semi-blue-5), 1)'),
        name: normalizeString(method?.name, ''),
        type: normalizeString(method?.type, ''),
      }))
      .filter((method) => method.name && method.type),
    amountOptions: (amountOptions || current.amountOptions)
      .map((amount) => Number(amount))
      .filter((amount) => Number.isFinite(amount) && amount > 0),
    amountDiscounts: amountDiscounts || current.amountDiscounts,
    easyPay: {
      baseUrl: normalizeString(rawEasyPay.baseUrl, current.easyPay.baseUrl),
      merchantId: normalizeString(
        rawEasyPay.merchantId,
        current.easyPay.merchantId
      ),
      apiKey:
        typeof rawEasyPay.apiKey === 'string'
          ? rawEasyPay.apiKey.trim()
          : current.easyPay.apiKey,
      minAmountCny: normalizePositiveInt(
        rawEasyPay.minAmountCny,
        current.easyPay.minAmountCny
      ),
    },
  };
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const config = await getSystemConfig();
    return NextResponse.json({ success: true, data: config });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取配置失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const updates = await request.json();

    // 如果后台地址发生变化，则清空旧的 admin token，强制下一次重新登录
    const current = await getSystemConfig();
    const nextUpdates: any = { ...updates };
    if (
      typeof updates.soraBackendUrl === 'string' &&
      updates.soraBackendUrl.trim() &&
      updates.soraBackendUrl.trim() !== (current.soraBackendUrl || '').trim()
    ) {
      nextUpdates.soraBackendToken = '';
    }

    if (updates.rateLimit && typeof updates.rateLimit === 'object') {
      const rateLimit = updates.rateLimit as Record<string, unknown>;
      nextUpdates.rateLimit = {
        imageMaxRequests: normalizePositiveInt(rateLimit.imageMaxRequests, current.rateLimit.imageMaxRequests),
        imageWindowSeconds: normalizePositiveInt(rateLimit.imageWindowSeconds, current.rateLimit.imageWindowSeconds),
        videoMaxRequests: normalizePositiveInt(rateLimit.videoMaxRequests, current.rateLimit.videoMaxRequests),
        videoWindowSeconds: normalizePositiveInt(rateLimit.videoWindowSeconds, current.rateLimit.videoWindowSeconds),
      };
    }

    if (updates.featureFlags && typeof updates.featureFlags === 'object') {
      const featureFlags = updates.featureFlags as Record<string, unknown>;
      nextUpdates.featureFlags = {
        squareEnabled:
          typeof featureFlags.squareEnabled === 'boolean'
            ? featureFlags.squareEnabled
            : current.featureFlags.squareEnabled,
        gachaEnabled:
          typeof featureFlags.gachaEnabled === 'boolean'
            ? featureFlags.gachaEnabled
            : current.featureFlags.gachaEnabled,
        characterCardEnabled:
          typeof featureFlags.characterCardEnabled === 'boolean'
            ? featureFlags.characterCardEnabled
            : current.featureFlags.characterCardEnabled,
      };
    }

    if (updates.inviteSettings && typeof updates.inviteSettings === 'object') {
      const inviteSettings = updates.inviteSettings as Record<string, unknown>;
      nextUpdates.inviteSettings = {
        enabled:
          typeof inviteSettings.enabled === 'boolean'
            ? inviteSettings.enabled
            : current.inviteSettings.enabled,
        rewardEnabled:
          typeof inviteSettings.rewardEnabled === 'boolean'
            ? inviteSettings.rewardEnabled
            : current.inviteSettings.rewardEnabled,
        inviteeBonusPoints: normalizeNonNegativeInt(
          inviteSettings.inviteeBonusPoints,
          current.inviteSettings.inviteeBonusPoints
        ),
        inviterBonusPoints: normalizeNonNegativeInt(
          inviteSettings.inviterBonusPoints,
          current.inviteSettings.inviterBonusPoints
        ),
      };
    }

    if (updates.imageStorage !== undefined) {
      nextUpdates.imageStorage = normalizeImageStorage(
        updates.imageStorage,
        current.imageStorage
      );
    }

    if (updates.emailVerification !== undefined) {
      nextUpdates.emailVerification = normalizeEmailVerification(
        updates.emailVerification,
        current.emailVerification
      );
    }

    if (updates.payment !== undefined) {
      nextUpdates.payment = normalizePaymentConfig(
        updates.payment,
        current.payment
      );
    }

    const config = await updateSystemConfig(nextUpdates);

    if (nextUpdates.inviteSettings) {
      const inviteSettings = config.inviteSettings;
      const inviteeBonusPoints = inviteSettings.rewardEnabled
        ? inviteSettings.inviteeBonusPoints
        : 0;
      const inviterBonusPoints = inviteSettings.rewardEnabled
        ? inviteSettings.inviterBonusPoints
        : 0;
      await syncUnusedInviteCodeBonuses(inviteeBonusPoints, inviterBonusPoints);
    }

    return NextResponse.json({ success: true, data: config });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '更新配置失败' },
      { status: 500 }
    );
  }
}
