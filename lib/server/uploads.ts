import { z } from 'zod';
import { ApiError } from './errors';
import { readBoundedBody } from './http';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 150 * 1024;
export type ReportInput = { recordId: string; role: 'current' | 'previous'; keepBoth: boolean; fileName: string | null; mimeType: string; bytes: Uint8Array; text?: string };
const fields = z.object({ recordId: z.string().uuid(), role: z.enum(['current', 'previous']), keepBoth: z.enum(['true', 'false']).default('false') }).strict();
const allowed = new Map([
  ['application/pdf', ['pdf']], ['image/png', ['png']], ['image/jpeg', ['jpg', 'jpeg']], ['image/webp', ['webp']], ['text/plain', ['txt']],
]);

export function validateFile(bytes: Uint8Array, mimeType: string, name: string): void {
  if (!bytes.length) throw new ApiError('FILE_EMPTY');
  if (bytes.length > MAX_FILE_BYTES) throw new ApiError('FILE_TOO_LARGE');
  const suffix = name.split('.').pop()?.toLowerCase() ?? '';
  if (!allowed.get(mimeType)?.includes(suffix)) throw new ApiError('FILE_UNSUPPORTED');
  const first = Buffer.from(bytes.subarray(0, 16));
  const valid = mimeType === 'application/pdf' ? first.subarray(0, 5).toString() === '%PDF-'
    : mimeType === 'image/png' ? first.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === 'image/jpeg' ? first[0] === 255 && first[1] === 216 && first[2] === 255
    : mimeType === 'image/webp' ? first.subarray(0, 4).toString() === 'RIFF' && first.subarray(8, 12).toString() === 'WEBP'
    : !bytes.includes(0);
  if (!valid) throw new ApiError('FILE_CORRUPT');
  if (mimeType === 'text/plain') {
    if (bytes.length > MAX_TEXT_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE');
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new ApiError('FILE_CORRUPT'); }
  }
}

export async function readUpload(request: Request): Promise<ReportInput> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data;')) throw new ApiError('UNSUPPORTED_INPUT');
  const body = await readBoundedBody(request, MAX_FILE_BYTES + 64 * 1024);
  let form: FormData;
  try { form = await new Response(Buffer.from(body), { headers: { 'content-type': contentType } }).formData(); }
  catch { throw new ApiError('VALIDATION_FAILED'); }
  const names = ['recordId', 'role', 'keepBoth', 'file', 'text'];
  for (const name of form.keys()) if (!names.includes(name) || form.getAll(name).length > 1) throw new ApiError('VALIDATION_FAILED');
  const parsed = fields.safeParse({ recordId: form.get('recordId'), role: form.get('role'), keepBoth: form.get('keepBoth') ?? 'false' });
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED');
  const file = form.get('file');
  const text = form.get('text');
  if ((file && text) || (!file && (typeof text !== 'string' || !text.trim()))) throw new ApiError('UNSUPPORTED_INPUT');
  const base = { recordId: parsed.data.recordId, role: parsed.data.role, keepBoth: parsed.data.keepBoth === 'true' };
  if (file instanceof File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = file.type.toLowerCase();
    const fileName = file.name.replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop()?.slice(0, 150) || 'report';
    validateFile(bytes, mimeType, fileName);
    return { ...base, bytes, mimeType, fileName };
  }
  if (typeof text !== 'string') throw new ApiError('UNSUPPORTED_INPUT');
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_TEXT_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE');
  return { ...base, bytes, mimeType: 'text/plain', fileName: null, text };
}
