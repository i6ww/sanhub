import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getStatsOverview } from '@/lib/db-codes';
import type { PaymentOrderStatus } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user.role !== 'admin' && session.user.role !== 'moderator')) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(Number(searchParams.get('days')) || 30, 7), 90);
    const paymentPage = Math.max(Number(searchParams.get('paymentPage')) || 1, 1);
    const paymentLimit = Math.min(Math.max(Number(searchParams.get('paymentLimit')) || 20, 1), 100);
    const paymentOffset = (paymentPage - 1) * paymentLimit;
    const rawPaymentStatus = searchParams.get('paymentStatus') || 'all';
    const paymentStatus = ['all', 'pending', 'succeeded', 'failed'].includes(rawPaymentStatus)
      ? (rawPaymentStatus as PaymentOrderStatus | 'all')
      : 'all';
    const paymentSearch = (searchParams.get('paymentSearch') || '').trim();
    const paymentStartTime = Number(searchParams.get('paymentStartTime')) || undefined;
    const paymentEndTime = Number(searchParams.get('paymentEndTime')) || undefined;

    const stats = await getStatsOverview(days, {
      limit: paymentLimit,
      offset: paymentOffset,
      search: paymentSearch || undefined,
      status: paymentStatus,
      startTime: paymentStartTime,
      endTime: paymentEndTime,
    });
    return NextResponse.json({ success: true, data: stats });
  } catch (error) {
    console.error('Get stats error:', error);
    return NextResponse.json({ error: '获取统计失败' }, { status: 500 });
  }
}
