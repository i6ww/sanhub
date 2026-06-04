import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createPaymentOrder, getSystemConfig } from '@/lib/db';
import { buildEasyPaySubmitUrl } from '@/lib/easypay';
import { checkRateLimit, RateLimitConfig } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function requestOrigin(request: NextRequest): string {
  const configuredHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '');
  return configuredHost ? `${protocol}://${configuredHost}` : new URL(request.url).origin;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function resolveNotifyUrl(callbackUrl: string, baseUrl: string): string {
  const trimmed = callbackUrl.trim();
  if (!trimmed) {
    return `${baseUrl}/api/payments/notify/easypay`;
  }

  try {
    const parsed = new URL(trimmed);
    if (!parsed.pathname || parsed.pathname === '/') {
      return `${normalizeBaseUrl(parsed.origin)}/api/payments/notify/easypay`;
    }
    return trimmed;
  } catch {
    return `${baseUrl}/api/payments/notify/easypay`;
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimit = checkRateLimit(request, RateLimitConfig.API, 'payment-create');
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: rateLimit.headers }
      );
    }

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const body = await request.json();
    const amountCny = Number(body.amountCny);
    const paymentType = typeof body.paymentType === 'string' ? body.paymentType.trim() : '';
    const config = await getSystemConfig();
    const payment = config.payment;

    if (!payment.enabled) {
      return NextResponse.json({ error: '支付功能未启用' }, { status: 403 });
    }

    if (!payment.easyPay.baseUrl || !payment.easyPay.merchantId || !payment.easyPay.apiKey) {
      return NextResponse.json({ error: '易支付配置不完整' }, { status: 400 });
    }

    const method = payment.methods.find((item) => item.type === paymentType);
    if (!method) {
      return NextResponse.json({ error: '支付方式不可用' }, { status: 400 });
    }

    if (!Number.isFinite(amountCny) || amountCny < payment.easyPay.minAmountCny) {
      return NextResponse.json(
        { error: `充值金额不能低于 ${payment.easyPay.minAmountCny} 元` },
        { status: 400 }
      );
    }

    const discount = Number(payment.amountDiscounts[String(amountCny)] || 1);
    const safeDiscount = Number.isFinite(discount) && discount > 0 ? discount : 1;
    const amountCents = Math.round(amountCny * 100);
    const paidAmountCents = Math.max(1, Math.round(amountCents * safeDiscount));
    const points = Math.round(amountCny * payment.pointsPerCny);
    const order = await createPaymentOrder({
      userId: session.user.id,
      paymentType,
      amountCents,
      paidAmountCents,
      points,
    });
    const baseUrl = normalizeBaseUrl(payment.serverBaseUrl || requestOrigin(request));
    const notifyUrl = resolveNotifyUrl(payment.callbackUrl, baseUrl);
    const returnUrl = `${baseUrl}/api/payments/return/easypay`;
    const paymentUrl = buildEasyPaySubmitUrl({
      config: payment,
      order,
      siteName: config.siteConfig.siteName,
      notifyUrl,
      returnUrl,
    });

    return NextResponse.json({
      success: true,
      data: {
        paymentUrl,
        outTradeNo: order.outTradeNo,
        amountCny,
        paidAmountCny: paidAmountCents / 100,
        points,
      },
    });
  } catch (error) {
    console.error('Create payment error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建支付订单失败' },
      { status: 500 }
    );
  }
}
