import { z } from 'zod';
import { intakeInputSchema } from '../schema';
import { repository } from '../storage/repository';
import { createIntake } from './intake';
import { handle, json, readJson } from './http';
import { readUpload } from './uploads';
import { processReport, ProcessingError } from '../pipeline/orchestrator';
import { patchRecord, patchSchema } from './patch';
import { generateSummary } from '../engines/summary';
import { deriveRecord } from '../engines/deriveRecord';
import { exportRecord } from './export';
import { ApiError } from './errors';
import { demoCurrentText, demoIntake, demoPreviousText, demoUndatedText } from '../fixtures/demo';

export const createRecord = (request: Request) => handle(request, async owner => {
  const input = await readJson(request, intakeInputSchema);
  const record = repository.create(owner, createIntake(input));
  return json({ recordId: record.id, record }, 201);
});

export const extractReport = (request: Request) => handle(request, async owner => {
  const input = await readUpload(request);
  let failure: ProcessingError | null = null;
  const record = await repository.mutate(owner, input.recordId, async original => {
    try { return await processReport(original, input); }
    catch (error: unknown) {
      if (!(error instanceof ProcessingError)) throw error;
      failure = error;
      return error.record;
    }
  });
  if (failure) throw failure;
  const document = record.documents[record.documents.length - 1];
  return json({ record, document, labResults: record.labResults.filter(lab => lab.source.sourceDocumentId === document.id), observations: record.observations.filter(item => item.source.sourceDocumentId === document.id), pipeline: record.pipeline, warnings: document.extraction.warnings });
});

export const fetchRecord = (request: Request, id: string) => handle(request, owner => json({ record: repository.get(owner, id) }));
export const deleteRecord = (request: Request, id: string) => handle(request, owner => { repository.delete(owner, id); return json({ deleted: true }); });
export const listRecords = (request: Request) => handle(request, owner => json({ records: repository.list(owner).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(record => ({ id: record.id, patientName: record.patient.nameOrIdentifier, createdAt: record.createdAt, updatedAt: record.updatedAt, stats: record.stats, isDemo: record.isDemo })) }));

export const updateRecord = (request: Request, id: string) => handle(request, async owner => {
  const patch = await readJson(request, patchSchema);
  let changed: string[] = [];
  const record = await repository.mutate(owner, id, original => { const result = patchRecord(original, patch); changed = result.changed; return result.record; });
  return json({ record, changed });
});

export const refreshSummary = (request: Request, id: string) => handle(request, async owner => {
  const input = await readJson(request, z.object({ regenerate: z.boolean().default(false) }).strict());
  const record = await repository.mutate(owner, id, original => ({ ...original, updatedAt: new Date().toISOString(), summary: { ...generateSummary(original), regenerated: input.regenerate } }));
  return json({ record, summary: record.summary });
});

export const downloadRecord = (request: Request, id: string) => handle(request, owner => {
  const format = z.enum(['json', 'csv', 'md']).safeParse(new URL(request.url).searchParams.get('format') ?? 'json');
  if (!format.success) throw new ApiError('VALIDATION_FAILED');
  const exported = exportRecord(repository.get(owner, id), format.data);
  return new Response(exported.content, { headers: { 'Content-Type': exported.contentType, 'Content-Disposition': `attachment; filename="${exported.fileName}"` } });
});

export const loadDemo = (request: Request) => handle(request, async owner => {
  let record = createIntake(demoIntake);
  record.isDemo = true;
  for (const [text, role, fileName] of [
    [demoCurrentText, 'current', 'Fictional-current-report-2026-03-12.txt'],
    [demoPreviousText, 'previous', 'Fictional-previous-report-2025-09-02.txt'],
    [demoUndatedText, 'previous', 'Fictional-undated-supplement.txt'],
  ] as const) record = await processReport(record, { recordId: record.id, role, fileName, mimeType: 'text/plain', text, bytes: new TextEncoder().encode(text), keepBoth: false }, { disableAI: true });
  const lab = record.labResults.find(item => item.canonicalId === 'creatinine');
  if (lab) {
    lab.verified = true;
    lab.verifiedAt = new Date().toISOString();
    lab.corrections.push({ field: 'verified', from: false, to: true, at: lab.verifiedAt, reason: 'Demonstration verification recorded for fictional data.' });
  }
  record = repository.create(owner, deriveRecord(record));
  return json({ recordId: record.id, record }, 201);
});
