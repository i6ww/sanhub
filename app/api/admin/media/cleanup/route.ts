import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getReferencedLocalMediaFilenames } from '@/lib/db';
import { cleanupLocalMediaFiles } from '@/lib/media-storage';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'admin') {
    return false;
  }
  return true;
}

async function inspectLocalMedia(deleteOrphans: boolean) {
  const referencedFiles = await getReferencedLocalMediaFilenames();
  return cleanupLocalMediaFiles(referencedFiles, { deleteOrphans });
}

export async function GET() {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const result = await inspectLocalMedia(false);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[Media Cleanup] Failed to inspect local media:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to inspect local media' },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const result = await inspectLocalMedia(true);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[Media Cleanup] Failed to clean local media:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to clean local media' },
      { status: 500 }
    );
  }
}
