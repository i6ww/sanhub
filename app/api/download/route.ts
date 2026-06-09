import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { fetchExternalBuffer } from '@/lib/safe-fetch';

export const dynamic = 'force-dynamic';

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

function sanitizeFilename(value: string | null): string {
  const fallback = `miaotu-${Date.now()}`;
  if (!value) return fallback;

  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || fallback;
}

function getContentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]+/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams, origin } = new URL(request.url);
    const url = searchParams.get('url');
    if (!url) {
      return NextResponse.json({ error: 'Missing url' }, { status: 400 });
    }

    const filename = sanitizeFilename(searchParams.get('filename'));
    const result = await fetchExternalBuffer(url, {
      origin,
      allowRelative: true,
      maxBytes: MAX_DOWNLOAD_BYTES,
      timeoutMs: 60_000,
    });

    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        'Content-Type': result.contentType || 'application/octet-stream',
        'Content-Length': String(result.buffer.length),
        'Content-Disposition': getContentDisposition(filename),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Download failed' },
      { status: 500 }
    );
  }
}
