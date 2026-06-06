import { NextRequest, NextResponse } from 'next/server';
import { getSystemConfig } from '@/lib/db';
import { handleEasyPayCallback } from '@/lib/payment-handler';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const config = await getSystemConfig().catch(() => null);
  const redirectOrigin =
    config?.payment.serverBaseUrl
      ? normalizeBaseUrl(config.payment.serverBaseUrl)
      : url.origin;
  const result = await handleEasyPayCallback(url.searchParams).catch((error) => {
    console.error('[EasyPay Return] error:', error);
    return { ok: false, message: 'payment error' };
  });
  const target = new URL('/recharge', redirectOrigin);
  target.searchParams.set('payment', result.ok ? 'success' : 'failed');

  if (result.message) {
    target.searchParams.set('message', result.message);
  }

  return NextResponse.redirect(target);
}
