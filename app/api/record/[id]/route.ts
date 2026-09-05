import { deleteRecord, fetchRecord, updateRecord } from '@/lib/server/controllers';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return fetchRecord(request, (await context.params).id); }
export async function PATCH(request: Request, context: Context) { return updateRecord(request, (await context.params).id); }
export async function DELETE(request: Request, context: Context) { return deleteRecord(request, (await context.params).id); }
