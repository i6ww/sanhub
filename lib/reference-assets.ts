/* eslint-disable no-console */
import { promises as fsp } from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = process.env.DATA_DIR || './data';
const REFERENCE_ASSET_DIR = path.join(DATA_DIR, 'reference-assets');
const REFERENCE_ASSET_MAX_AGE_MS = Math.max(
  60_000,
  Number(process.env.REFERENCE_ASSET_MAX_AGE_MS) || 24 * 60 * 60 * 1000
);

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match || !match[1].startsWith('image/')) return null;
  return { mimeType: match[1].toLowerCase(), base64: match[2] };
}

function getExtension(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'jpg';
}

function getPublicBaseUrl(publicBaseUrl?: string): string {
  return (
    publicBaseUrl ||
    process.env.SANHUB_PUBLIC_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    ''
  ).replace(/\/$/, '');
}

async function cleanupOldReferenceAssets(): Promise<void> {
  const now = Date.now();
  let entries: string[];
  try {
    entries = await fsp.readdir(REFERENCE_ASSET_DIR);
  } catch {
    return;
  }

  await Promise.allSettled(
    entries.map(async (entry) => {
      const filepath = path.join(REFERENCE_ASSET_DIR, path.basename(entry));
      const stat = await fsp.stat(filepath).catch(() => null);
      if (stat && now - stat.mtimeMs > REFERENCE_ASSET_MAX_AGE_MS) {
        await fsp.unlink(filepath);
      }
    })
  );
}

export async function saveReferenceAsset(
  imageData: string,
  publicBaseUrl?: string
): Promise<string> {
  if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
    return imageData;
  }

  const parsed = parseDataUrl(imageData);
  if (!parsed) {
    return imageData;
  }

  const baseUrl = getPublicBaseUrl(publicBaseUrl);
  if (!baseUrl) {
    console.warn('[ReferenceAssets] Missing public base URL, falling back to inline image data');
    return imageData;
  }

  await fsp.mkdir(REFERENCE_ASSET_DIR, { recursive: true });
  void cleanupOldReferenceAssets();

  const ext = getExtension(parsed.mimeType);
  const filename = `${Date.now()}-${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const filepath = path.join(REFERENCE_ASSET_DIR, filename);
  await fsp.writeFile(filepath, Buffer.from(parsed.base64, 'base64'));

  return `${baseUrl}/api/reference-assets/${filename}`;
}

export async function readReferenceAsset(
  filename: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const safeName = path.basename(filename);
  if (safeName !== filename || !/^[A-Za-z0-9._-]+$/.test(safeName)) {
    return null;
  }

  const ext = path.extname(safeName).slice(1).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) {
    return null;
  }

  try {
    const buffer = await fsp.readFile(path.join(REFERENCE_ASSET_DIR, safeName));
    return { buffer, mimeType };
  } catch {
    return null;
  }
}
