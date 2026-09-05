import { downloadRecord } from '@/lib/server/controllers';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return downloadRecord(request, (await context.params).id); }
