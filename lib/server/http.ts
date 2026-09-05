import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ApiError, errors, toApiError } from './errors';
import { SESSION_TTL_SECONDS } from '../storage/repository';

const COOKIE = 'medlens_session';
type Bucket = { count: number; expires: number };
const shared = globalThis as typeof globalThis & { medlensLimits?: Map<string, Bucket> };
const limits = shared.medlensLimits ??= new Map<string, Bucket>();

function rateLimit(key: string, maximum: number) {
  const now = Date.now();
  for (const [id, value] of limits) if (value.expires <= now) limits.delete(id);
  const bucket = limits.get(key) ?? { count: 0, expires: now + 60_000 };
  if (bucket.count >= maximum || limits.size > 2048) throw new ApiError('RATE_LIMITED');
  bucket.count += 1;
  limits.set(key, bucket);
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (!origin || origin !== new URL(request.url).origin || site === 'cross-site') throw new ApiError('ORIGIN_REJECTED');
}

export async function readBoundedBody(request: Pick<Request, 'headers' | 'body'>, maximum: number): Promise<Uint8Array> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new ApiError('PAYLOAD_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new ApiError('PAYLOAD_TOO_LARGE'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError('UNSUPPORTED_INPUT');
  const bytes = await readBoundedBody(request, 64 * 1024);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ApiError('VALIDATION_FAILED'); }
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError('VALIDATION_FAILED');
  return result.data;
}

export function json(value: unknown, status = 200) { return Response.json(value, { status }); }

export async function handle(request: Request, operation: (owner: string) => Promise<Response> | Response): Promise<Response> {
  let session: string | undefined;
  try {
    const mutating = !['GET', 'HEAD'].includes(request.method);
    if (mutating) assertSameOrigin(request);
    const cookie = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    session = cookie && /^[a-f0-9]{64}$/.test(cookie) ? cookie : randomBytes(32).toString('hex');
    rateLimit('global', 600);
    rateLimit(session, mutating ? 45 : 180);
    if (!cookie && mutating) rateLimit('new-session', 90);
    const response = await operation(session);
    setHeaders(response, request, session);
    return response;
  } catch (error: unknown) {
    const safe = toApiError(error);
    const [status, message] = errors[safe.code];
    const response = json({ error: { code: safe.code, message, retryable: [409, 429, 500, 502, 503, 504].includes(status) } }, status);
    if (status === 429) response.headers.set('Retry-After', '60');
    setHeaders(response, request, session);
    return response;
  }
}

function setHeaders(response: Response, request: Request, session?: string) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Vary', 'Cookie');
  if (session) response.headers.set('Set-Cookie', `${COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`);
}
