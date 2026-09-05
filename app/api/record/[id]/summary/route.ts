import { refreshSummary } from '@/lib/server/controllers';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return refreshSummary(request, (await context.params).id); }
