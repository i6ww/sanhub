type JsonRecord = Record<string, unknown>;

export function resolveChatCompletionsUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim();
  if (!trimmed) {
    throw new Error('Chat API URL is empty');
  }

  const url = new URL(trimmed);
  const pathname = url.pathname.replace(/\/+$/, '');

  if (pathname.endsWith('/chat/completions')) {
    return url.toString();
  }

  if (pathname.endsWith('/v1')) {
    url.pathname = `${pathname}/chat/completions`;
    return url.toString();
  }

  url.pathname = `${pathname}/v1/chat/completions`;
  return url.toString();
}

function truncateBody(body: string): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 240)}...`;
}

function getErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;

  const record = data as JsonRecord;
  const error = record.error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as JsonRecord).message;
    if (typeof message === 'string') return message;
  }

  const message = record.message;
  return typeof message === 'string' ? message : null;
}

export async function readChatCompletionJson(response: Response): Promise<JsonRecord> {
  const text = await response.text();
  let data: unknown = null;

  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      const preview = truncateBody(text);
      throw new Error(
        `Chat API returned non-JSON response (${response.status}): ${preview || 'empty body'}`
      );
    }
  }

  if (!response.ok) {
    const upstreamMessage = getErrorMessage(data);
    throw new Error(upstreamMessage || `Chat API request failed: ${response.status}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Chat API returned an empty response');
  }

  return data as JsonRecord;
}

export function extractChatCompletionContent(data: JsonRecord): string {
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return '';
  }

  const first = choices[0];
  if (!first || typeof first !== 'object') {
    return '';
  }

  const choice = first as JsonRecord;
  const message = choice.message;
  if (message && typeof message === 'object') {
    const content = (message as JsonRecord).content;
    if (typeof content === 'string') return content;
  }

  const text = choice.text;
  return typeof text === 'string' ? text : '';
}
