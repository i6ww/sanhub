import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserConsumptionRecords, getUserPaymentOrders } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Please login first' }, { status: 401 });
    }

    const [paymentOrders, consumptionRecords] = await Promise.all([
      getUserPaymentOrders(session.user.id, 20),
      getUserConsumptionRecords(session.user.id, 30),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        paymentOrders,
        consumptionRecords,
      },
    });
  } catch (error) {
    console.error('Get user finance error:', error);
    return NextResponse.json({ error: 'Failed to load finance records' }, { status: 500 });
  }
}
