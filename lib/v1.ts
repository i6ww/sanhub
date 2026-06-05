import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export type OpenAiErrorType = 'invalid_request_error' | 'server_error' | 'authentication_error';

export function extractBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function isAuthorized(token: string | null): boolean {
  const required = process.env.V1_API_KEY || process.env.API_KEY;
  if (!required || !token) return false;
  return token === required;
}

export function buildErrorResponse(message: string, status: number, type: OpenAiErrorType = 'invalid_request_error') {
  return NextResponse.json(
    {
      error: {
        message,
        type,
      },
    },
    { status }
  );
}

export function parseDataUrl(input: string): { mimeType: string; data: string } | null {
  const match = input.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

export function buildDataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

export function stripDataUrl(input: string): { mimeType: string; data: string } {
  const parsed = parseDataUrl(input);
  if (parsed) return parsed;
  return { mimeType: 'application/octet-stream', data: input };
}
