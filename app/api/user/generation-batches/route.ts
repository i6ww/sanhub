import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserGenerationBatches } from '@/lib/db';
import { checkRateLimit, RateLimitConfig } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const rateLimit = checkRateLimit(request, RateLimitConfig.API, 'generation-batches');
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: rateLimit.headers }
      );
    }

    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Please sign in first' }, { status: 401 });
    }

    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || 10, 1), 50);
    const batches = await getUserGenerationBatches(session.user.id, limit);

    return NextResponse.json(
      { success: true, data: batches },
      {
        headers: {
          ...rateLimit.headers,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error('[API] Get generation batches error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load batches' },
      { status: 500 }
    );
  }
}
