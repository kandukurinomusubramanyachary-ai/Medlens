import type { PipelineStage } from '../schema';
import { toApiError } from '../server/errors';

export async function stage<T>(stages: PipelineStage[], id: string, label: string, operation: () => T | Promise<T>, detail?: string): Promise<T> {
  const started = performance.now();
  const entry: PipelineStage = { id, label, status: 'RUNNING', detail: detail ?? null, startedAt: new Date().toISOString(), endedAt: null, durationMs: null, errorCode: null };
  stages.push(entry);
  try { const result = await operation(); entry.status = 'DONE'; return result; }
  catch (error: unknown) { const safe = toApiError(error); entry.status = 'FAILED'; entry.errorCode = safe.code; entry.detail = safe.message; throw error; }
  finally { entry.endedAt = new Date().toISOString(); entry.durationMs = Math.round((performance.now() - started) * 100) / 100; }
}

export function skipStage(stages: PipelineStage[], id: string, label: string, detail: string) {
  stages.push({ id, label, status: 'SKIPPED', detail, startedAt: null, endedAt: null, durationMs: null, errorCode: null });
}
