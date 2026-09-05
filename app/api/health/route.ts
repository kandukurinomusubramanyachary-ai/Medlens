import { aiConfigured } from '@/lib/ai/provider';
import { ocrAvailable } from '@/lib/engines/textExtraction';
import { handle, json } from '@/lib/server/http';
export const runtime = 'nodejs';
export function GET(request: Request) {
  return handle(request, async () => json({ ok: true, aiConfigured: aiConfigured(), ocrAvailable: await ocrAvailable(), version: '1.0.0', storage: 'ephemeral-session-memory', sessionTtlSeconds: 3600, maxFileBytes: 10 * 1024 * 1024, maxPages: 20 }));
}
