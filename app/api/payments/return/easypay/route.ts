import { NextRequest, NextResponse } from 'next/server';
import { handleEasyPayCallback } from '@/lib/payment-handler';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const result = await handleEasyPayCallback(url.searchParams).catch((error) => {
    console.error('[EasyPay Return] error:', error);
    return { ok: false, message: 'payment error' };
  });
  const target = new URL('/settings', url.origin);
  target.searchParams.set('payment', result.ok ? 'success' : 'failed');

  if (result.message) {
    target.searchParams.set('message', result.message);
  }

  return NextResponse.redirect(target);
}
