import { NextRequest, NextResponse } from 'next/server';
import { handleEasyPayCallback } from '@/lib/payment-handler';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const result = await handleEasyPayCallback(new URL(request.url).searchParams);
    if (!result.ok) {
      console.error('[EasyPay Notify] failed:', result.message, result.outTradeNo);
      return new NextResponse('fail', { status: 400 });
    }

    return new NextResponse('success');
  } catch (error) {
    console.error('[EasyPay Notify] error:', error);
    return new NextResponse('fail', { status: 500 });
  }
}
