import { NextRequest, NextResponse } from 'next/server';
import { readReferenceAsset } from '@/lib/reference-assets';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const asset = await readReferenceAsset(filename);

  if (!asset) {
    return new NextResponse('Not Found', { status: 404 });
  }

  return new NextResponse(new Uint8Array(asset.buffer), {
    headers: {
      'Content-Type': asset.mimeType,
      'Content-Length': String(asset.buffer.length),
      'Cache-Control': 'public, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
