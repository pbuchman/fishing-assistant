interface ApiSuccessEnvelope<T> {
  ok: true;
  data: T;
}

interface ApiErrorEnvelope {
  ok: false;
  error?:
    | string
    | {
        message?: string;
      };
  message?: string;
}

type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

export interface ApiSseEvent {
  event: string;
  data: unknown;
}

export interface ApiAuthProvider {
  getAccessToken(): Promise<string>;
  refreshAccessToken(): Promise<string>;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

const friendlyRequestNetworkError = 'Connection interrupted. Check your network and try again.';

let apiAuthProvider: ApiAuthProvider | null = null;

export function setApiAuthProvider(provider: ApiAuthProvider | null): void {
  apiAuthProvider = provider;
}

export function clearApiAuthProvider(): void {
  apiAuthProvider = null;
}

function getEnvelopeError(envelope: ApiEnvelope<unknown>): string {
  if (envelope.ok) {
    return 'API request failed.';
  }

  if (typeof envelope.error === 'object' && typeof envelope.error.message === 'string') {
    return envelope.error.message;
  }

  if (typeof envelope.error === 'string') {
    return envelope.error;
  }

  return envelope.message ?? 'API request failed.';
}

async function parseApiEnvelope<T>(response: Response): Promise<ApiEnvelope<T> | null> {
  try {
    return (await response.json()) as ApiEnvelope<T>;
  } catch {
    return null;
  }
}

function shouldSetJsonContentType(body: BodyInit | null | undefined, headers: Headers): boolean {
  return (
    body !== undefined &&
    body !== null &&
    !(body instanceof FormData) &&
    !headers.has('Content-Type')
  );
}

function withRequestHeaders(init?: RequestInit, accept = 'application/json'): Headers {
  const headers = new Headers(init?.headers);
  headers.set('Accept', accept);

  if (shouldSetJsonContentType(init?.body, headers)) {
    headers.set('Content-Type', 'application/json');
  }

  return headers;
}

function friendlyNetworkError(error: unknown, phase: 'request' | 'stream'): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (
    error instanceof TypeError ||
    /failed to fetch|network error|load failed|fetch failed/i.test(message)
  ) {
    return new Error(
      phase === 'stream'
        ? 'Connection interrupted while reading the answer. Try again when the connection is stable.'
        : friendlyRequestNetworkError
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function isRecoverableGatewayStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function fallbackHttpErrorMessage(response: Response): string {
  if (isRecoverableGatewayStatus(response.status)) {
    return friendlyRequestNetworkError;
  }

  return `API request failed with status ${String(response.status)}.`;
}

function normalizeHttpErrorMessage(status: number, message: string): string {
  if (isRecoverableGatewayStatus(status) && /^api request failed\.?$/i.test(message.trim())) {
    return friendlyRequestNetworkError;
  }

  if (
    isRecoverableGatewayStatus(status) &&
    /api request failed with status 50[234]|bad gateway|gateway timeout/i.test(message)
  ) {
    return friendlyRequestNetworkError;
  }

  return message;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

async function getAuthHeaders(
  init: RequestInit | undefined,
  provider: ApiAuthProvider,
  tokenResolver: () => Promise<string>,
  accept = 'application/json'
): Promise<Headers> {
  const headers = withRequestHeaders(init, accept);
  const token = await tokenResolver();
  if (apiAuthProvider !== provider) {
    throw new ApiClientError('Authentication session changed.', 401);
  }
  headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function numericTimestampParts(
  value: Record<string, unknown>
): { seconds: number; nanos: number } | null {
  const seconds = value['_seconds'] ?? value['seconds'];
  const nanos = value['_nanoseconds'] ?? value['nanoseconds'] ?? 0;

  if (typeof seconds !== 'number' || typeof nanos !== 'number') {
    return null;
  }

  return { seconds, nanos };
}

export function normalizeApiTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (isRecord(value)) {
    const parts = numericTimestampParts(value);
    if (parts !== null) {
      return new Date(parts.seconds * 1000 + Math.floor(parts.nanos / 1_000_000)).toISOString();
    }
  }

  return '';
}

async function fetchWithAuth(
  url: string,
  init: RequestInit | undefined,
  accept: string,
  useRefreshToken: boolean,
  provider: ApiAuthProvider
): Promise<Response> {
  const headers = await getAuthHeaders(
    init,
    provider,
    () => (useRefreshToken ? provider.refreshAccessToken() : provider.getAccessToken()),
    accept
  );

  return await fetch(url, {
    ...init,
    headers,
  });
}

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const provider = apiAuthProvider;
  if (provider === null) {
    throw new ApiClientError('Authentication is required.', 401);
  }

  let response: Response;
  try {
    response = await fetchWithAuth(url, init, 'application/json', false, provider);
  } catch (error) {
    throw friendlyNetworkError(error, 'request');
  }
  let envelope = await parseApiEnvelope<T>(response);

  if (response.status === 401 && apiAuthProvider === provider) {
    try {
      response = await fetchWithAuth(url, init, 'application/json', true, provider);
    } catch (error) {
      throw friendlyNetworkError(error, 'request');
    }
    envelope = await parseApiEnvelope<T>(response);
  }

  if (envelope === null) {
    const message = response.ok
      ? 'API response was not valid JSON.'
      : fallbackHttpErrorMessage(response);
    throw new ApiClientError(message, response.status);
  }

  if (!response.ok || !envelope.ok) {
    throw new ApiClientError(
      normalizeHttpErrorMessage(response.status, getEnvelopeError(envelope)),
      response.status
    );
  }

  return envelope.data;
}

function parseSseBlock(block: string): ApiSseEvent | null {
  const lines = block.split(/\r?\n/);
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return { event, data: JSON.parse(dataLines.join('\n')) as unknown };
}

function emitBufferedSseEvents(buffer: string, onEvent: (event: ApiSseEvent) => void): string {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const nextBuffer = blocks.pop() ?? '';

  for (const block of blocks) {
    const event = parseSseBlock(block);
    if (event !== null) {
      onEvent(event);
    }
  }

  return nextBuffer;
}

export async function apiSseRequest(
  url: string,
  options: RequestInit & { onEvent: (event: ApiSseEvent) => void }
): Promise<void> {
  const provider = apiAuthProvider;
  if (provider === null) {
    throw new ApiClientError('Authentication is required.', 401);
  }

  let response: Response;
  try {
    response = await fetchWithAuth(url, options, 'text/event-stream', false, provider);
  } catch (error) {
    throw friendlyNetworkError(error, 'request');
  }

  if (response.status === 401 && apiAuthProvider === provider) {
    try {
      response = await fetchWithAuth(url, options, 'text/event-stream', true, provider);
    } catch (error) {
      throw friendlyNetworkError(error, 'request');
    }
  }

  if (!response.ok) {
    const envelope = await parseApiEnvelope<unknown>(response);
    const message =
      envelope === null ? fallbackHttpErrorMessage(response) : getEnvelopeError(envelope);
    throw new ApiClientError(normalizeHttpErrorMessage(response.status, message), response.status);
  }

  if (response.body === null) {
    throw new ApiClientError('SSE response did not include a body.', response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      throw friendlyNetworkError(error, 'stream');
    }
    if (chunk.done) {
      break;
    }

    try {
      buffer += decoder.decode(chunk.value, { stream: true });
    } catch (error) {
      throw friendlyNetworkError(error, 'stream');
    }
    buffer = emitBufferedSseEvents(buffer, options.onEvent);
  }

  try {
    buffer += decoder.decode();
  } catch (error) {
    throw friendlyNetworkError(error, 'stream');
  }
  if (buffer.trim().length > 0) {
    const event = parseSseBlock(buffer);
    if (event !== null) {
      options.onEvent(event);
    }
  }
}
