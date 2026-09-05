import { medicalRecordSchema, type MedicalRecord } from '@/lib/schema';

export class RequestError extends Error {
  constructor(message: string, public code: string) { super(message); }
}
export async function request<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...options, credentials: 'same-origin', cache: 'no-store' }); }
  catch { throw new RequestError('The connection was interrupted. Your existing record is unchanged. Please try again.', 'NETWORK_FAILURE'); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? body.error : null;
    const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : 'This action could not be completed. Please try again.';
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'REQUEST_FAILED';
    throw new RequestError(message, code);
  }
  return body as T;
}
export function jsonOptions(body: unknown, method = 'POST'): RequestInit { return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
export async function requestRecord(url: string, options?: RequestInit): Promise<MedicalRecord> {
  const data = await request<{ record: unknown }>(url, options);
  const result = medicalRecordSchema.safeParse(data.record);
  if (!result.success) throw new RequestError('The record response could not be validated. Reload to try again.', 'VALIDATION_FAILED');
  return result.data;
}
export type PatchRecord = (body: unknown, message?: string) => Promise<boolean>;
