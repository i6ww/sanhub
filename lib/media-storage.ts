/* eslint-disable no-console */
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import {
  resolveDefaultImageBucket,
  uploadBufferToImageBucket,
  uploadToPicUI,
} from './picui';
import { fetchWithRetry } from './http-retry';

// ========================================
// Media file storage
// Stores base64 media as files to keep database rows small.
// ========================================

const DATA_DIR = process.env.DATA_DIR || './data';
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const MAX_REMOTE_MEDIA_BYTES = Math.max(
  1,
  Number(process.env.MEDIA_REMOTE_CACHE_MAX_BYTES) || 512 * 1024 * 1024
);
const USE_FILE_STORAGE = process.env.MEDIA_FILE_STORAGE !== 'false';

type SaveMediaOptions = {
  publicBaseUrl?: string;
  filename?: string;
};

export type LocalMediaCleanupResult = {
  mediaDir: string;
  referencedFiles: number;
  totalFiles: number;
  orphanFiles: number;
  totalBytes: number;
  orphanBytes: number;
  deletedFiles: number;
  deletedBytes: number;
  failed: Array<{ fileName: string; error: string }>;
};

// Ensure the media directory exists.
async function ensureMediaDir(): Promise<void> {
  await fsp.mkdir(MEDIA_DIR, { recursive: true });
}

// Extract mime type and payload from a base64 data URL.
function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
}

// Resolve a file extension from a mime type.
function getExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
  };
  return map[mimeType] || 'bin';
}

function isRemoteUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

export function getLocalMediaFilename(identifier: string): string | null {
  const trimmed = identifier.trim();
  if (!trimmed.startsWith('file:')) return null;

  const rawFilename = trimmed.slice(5).trim();
  if (!rawFilename) return null;

  const normalized = rawFilename.replace(/\\/g, '/').split('/').pop() || '';
  return normalized || null;
}

function filenameFromUrl(id: string, mediaUrl: string, mimeType: string): string {
  try {
    const parsed = new URL(mediaUrl);
    const basename = path.basename(parsed.pathname);
    if (basename && basename !== '/' && /\.[a-z0-9]{2,5}$/i.test(basename)) {
      return `${id}-${basename}`;
    }
  } catch {
    // ignore
  }
  return `${id}.${getExtension(mimeType)}`;
}

async function downloadRemoteMedia(mediaUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetchWithRetry(fetch, mediaUrl, () => ({
    method: 'GET',
    headers: {
      Accept: 'image/*,video/*,*/*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  }), {
    attempts: 4,
    baseDelayMs: 500,
    maxDelayMs: 6000,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`remote media download failed (${response.status})${details ? `: ${details.slice(0, 200)}` : ''}`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_REMOTE_MEDIA_BYTES) {
    throw new Error(`remote media exceeds cache limit: ${contentLength} bytes`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > MAX_REMOTE_MEDIA_BYTES) {
    throw new Error(`remote media exceeds cache limit: ${buffer.length} bytes`);
  }

  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  return { buffer, mimeType };
}

/**
 * Save a base64 data URL as a local media file.
 * @param id Unique identifier, usually a generation ID.
 * @param dataUrl Base64 data URL.
 * @returns File identifier suitable for database storage.
 */
export async function saveMediaToFile(id: string, dataUrl: string): Promise<string> {
  // Non-data URLs are already compact external identifiers.
  if (!dataUrl.startsWith('data:')) {
    return dataUrl;
  }

  // Local file storage is enabled by default.
  if (!USE_FILE_STORAGE) {
    throw new Error('Local media storage is disabled');
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new Error('Invalid data URL format');
  }

  try {
    await ensureMediaDir();

    const ext = getExtension(parsed.mimeType);
    const filename = `${id}.${ext}`;
    const filepath = path.join(MEDIA_DIR, filename);

    // Decode the payload before writing it to the persistent media volume.
    const buffer = Buffer.from(parsed.data, 'base64');
    await fsp.writeFile(filepath, buffer);

    console.log(`[MediaStorage] Saved: ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);

    // The file: prefix is resolved by the media API.
    return `file:${filename}`;
  } catch (error) {
    console.error('[MediaStorage] Failed to save file:', error);
    // Keep failures explicit so callers do not persist the original data URL.
    throw error;
  }
}

/**
 * Save generated media, preferring the configured image bucket.
 * @param id Unique identifier, usually a generation ID.
 * @param dataUrl Remote URL, base64 data URL, or another media identifier.
 * @returns Remote URL, local file identifier, or compact external identifier.
 */
export async function saveMediaAsync(
  id: string,
  dataUrl: string,
  options: SaveMediaOptions = {}
): Promise<string> {
  const configuredBucket = await resolveDefaultImageBucket();

  if (isRemoteUrl(dataUrl)) {
    if (!configuredBucket) {
      return dataUrl;
    }

    try {
      const remote = await downloadRemoteMedia(dataUrl);
      const filename = options.filename || filenameFromUrl(id, dataUrl, remote.mimeType);
      const uploadedUrl = await uploadBufferToImageBucket(
        remote.buffer,
        remote.mimeType,
        filename,
        { publicBaseUrl: options.publicBaseUrl }
      );
      if (uploadedUrl) {
        console.log(`[MediaStorage] Cached remote media to bucket: ${uploadedUrl}`);
        return uploadedUrl;
      }
    } catch (error) {
      console.warn('[MediaStorage] Remote media cache failed, keeping original URL:', error);
    }

    return dataUrl;
  }

  // Compact non-data identifiers can be stored directly.
  if (!dataUrl.startsWith('data:')) {
    return dataUrl;
  }

  // Prefer the configured remote image bucket for base64 payloads.
  if (configuredBucket) {
    try {
      const parsed = parseDataUrl(dataUrl);
      const filename = options.filename || `${id}.${getExtension(parsed?.mimeType || 'image/jpeg')}`;
      const picuiUrl = await uploadToPicUI(dataUrl, filename, { publicBaseUrl: options.publicBaseUrl });
      if (picuiUrl) {
        console.log(`[MediaStorage] Uploaded to remote bucket: ${picuiUrl}`);
        return picuiUrl;
      }
    } catch (error) {
      console.warn('[MediaStorage] Remote upload failed, falling back to local file storage:', error);
    }

    // Do not persist large base64 payloads when remote upload is unavailable.
    return await saveMediaToFile(id, dataUrl);
  }

  return await saveMediaToFile(id, dataUrl);
}

export async function cleanupLocalMediaFiles(
  referencedFiles: Set<string>,
  options: { deleteOrphans?: boolean } = {}
): Promise<LocalMediaCleanupResult> {
  await ensureMediaDir();

  const entries = await fsp.readdir(MEDIA_DIR, { withFileTypes: true });
  const result: LocalMediaCleanupResult = {
    mediaDir: MEDIA_DIR,
    referencedFiles: referencedFiles.size,
    totalFiles: 0,
    orphanFiles: 0,
    totalBytes: 0,
    orphanBytes: 0,
    deletedFiles: 0,
    deletedBytes: 0,
    failed: [],
  };

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const fileName = entry.name;
    const filePath = path.join(MEDIA_DIR, fileName);
    let size = 0;

    try {
      const stat = await fsp.stat(filePath);
      size = stat.size;
    } catch (error) {
      result.failed.push({
        fileName,
        error: error instanceof Error ? error.message : 'Failed to stat file',
      });
      continue;
    }

    result.totalFiles += 1;
    result.totalBytes += size;

    if (referencedFiles.has(fileName)) {
      continue;
    }

    result.orphanFiles += 1;
    result.orphanBytes += size;

    if (!options.deleteOrphans) {
      continue;
    }

    try {
      await fsp.unlink(filePath);
      result.deletedFiles += 1;
      result.deletedBytes += size;
    } catch (error) {
      result.failed.push({
        fileName,
        error: error instanceof Error ? error.message : 'Failed to delete file',
      });
    }
  }

  return result;
}

/**
 * Read a local media file.
 * @param identifier File identifier, such as file:xxx.png, or a full path.
 * @returns Media bytes and mime type, or null when unavailable.
 */
export async function readMediaFile(
  identifier: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    let filename: string;

    if (identifier.startsWith('file:')) {
      filename = identifier.slice(5);
    } else {
      // Accept legacy full paths or other file-like identifiers.
      filename = path.basename(identifier);
    }

    const filepath = path.join(MEDIA_DIR, filename);

    const buffer = await fsp.readFile(filepath);
    const ext = path.extname(filename).slice(1).toLowerCase();

    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      webm: 'video/webm',
    };

    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    return { buffer, mimeType };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.error('[MediaStorage] Failed to read file:', error);
    return null;
  }
}

/**
 * Delete a local media file.
 * @param identifier File identifier.
 */
export function deleteMediaFile(identifier: string): boolean {
  try {
    if (!identifier.startsWith('file:')) {
      return false;
    }

    const filename = identifier.slice(5);
    const filepath = path.join(MEDIA_DIR, filename);

    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      console.log(`[MediaStorage] Deleted: ${filename}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error('[MediaStorage] Failed to delete file:', error);
    return false;
  }
}

/**
 * Check whether an identifier points to a local file.
 */
export function isLocalFile(identifier: string): boolean {
  return identifier.startsWith('file:');
}
