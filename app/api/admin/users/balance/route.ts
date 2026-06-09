import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createManualBalancePaymentOrder, updateUserBalance } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const { userId, delta } = await request.json();
    
    if (!userId || typeof delta !== 'number') {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    const newBalance = await updateUserBalance(userId, delta, 'clamp');
    if (delta > 0) {
      await createManualBalancePaymentOrder({
        userId,
        points: delta,
        operatorId: session.user.id,
        reason: 'admin balance delta',
      });
    }
    return NextResponse.json({ success: true, data: { balance: newBalance } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '更新余额失败' },
      { status: 500 }
    );
  }
}
