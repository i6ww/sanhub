import { NextResponse } from 'next/server';
import { getSystemConfig } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const config = await getSystemConfig();
    const payment = config.payment;

    return NextResponse.json({
      success: true,
      data: {
        enabled: payment.enabled,
        pointsPerCny: payment.pointsPerCny,
        methods: payment.methods,
        amountOptions: payment.amountOptions,
        amountDiscounts: payment.amountDiscounts,
        minAmountCny: payment.easyPay.minAmountCny,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取支付配置失败' },
      { status: 500 }
    );
  }
}
