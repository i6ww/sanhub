import { NextRequest, NextResponse } from 'next/server';
import { handleEasyPayCallback } from '@/lib/payment-handler';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function parseNotifyParams(request: NextRequest): Promise<URLSearchParams> {
  const params = new URL(request.url).searchParams;
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const payload = await request.json().catch(() => null);
    if (payload && typeof payload === 'object') {
      Object.entries(payload as Record<string, unknown>).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.set(key, String(value));
        }
      });
    }
    return params;
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const formData = await request.formData().catch(() => null);
    if (formData) {
      formData.forEach((value, key) => {
        if (typeof value === 'string') {
          params.set(key, value);
        }
      });
    }
  }

  if (request.bodyUsed) {
    return params;
  }

  const rawBody = await request.text().catch(() => '');
  if (rawBody) {
    new URLSearchParams(rawBody).forEach((value, key) => {
      params.set(key, value);
    });
  }

  return params;
}

async function handleNotify(searchParams: URLSearchParams) {
  try {
    const result = await handleEasyPayCallback(searchParams);
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

export async function GET(request: NextRequest) {
  return handleNotify(new URL(request.url).searchParams);
}

export async function POST(request: NextRequest) {
  return handleNotify(await parseNotifyParams(request));
}
