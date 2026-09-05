import { describe, expect, it } from 'vitest';
import { createRecord, extractReport, fetchRecord, updateRecord, refreshSummary, downloadRecord, deleteRecord, loadDemo } from '../lib/server/controllers';
import { medicalRecordSchema } from '../lib/schema';
import { z } from 'zod';

const origin = 'http://localhost:3000';
const responseSchema = z.object({ record: medicalRecordSchema });
function req(path: string, method = 'GET', body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { origin };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`${origin}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
function session(response: Response) { return response.headers.get('set-cookie')!.split(';')[0]; }
const report = `Example laboratory\nReport date: 12 Mar 2026\nHGB 10.2 g/dL (13-17)\nFerritin 42 ng/mL\nWBC 8.1 ×10⁹/L (4-11)`;
function upload(recordId: string, cookie: string, text = report, keepBoth = false) {
  const form = new FormData(); form.set('recordId', recordId); form.set('role', 'current'); form.set('text', text); if (keepBoth) form.set('keepBoth', 'true');
  return new Request(`${origin}/api/extract`, { method: 'POST', headers: { origin, cookie }, body: form });
}

describe('intake → extract → review → summary → export', () => {
  it('preserves originals, audit events and ownership throughout the actual pipeline', async () => {
    const created = await createRecord(req('/api/intake', 'POST', { nameOrIdentifier: 'Integration patient', age: 34, sex: 'FEMALE', symptoms: 'Fatigue', allergies: 'No known allergies' }));
    expect(created.status).toBe(201);
    const cookie = session(created);
    let record = responseSchema.parse(await created.json()).record;
    expect(record.patient.source.kind).toBe('PATIENT_PROVIDED');
    const extracted = await extractReport(upload(record.id, cookie));
    expect(extracted.status).toBe(200);
    record = responseSchema.parse(await extracted.json()).record;
    expect(record.labResults.length).toBeGreaterThanOrEqual(3);
    const originalLab = record.labResults.find(lab => lab.canonicalId === 'hemoglobin')!;
    expect(originalLab.value).toBe('10.2');
    expect(originalLab.status).toBe('BELOW');
    const ferritin = record.labResults.find(lab => lab.canonicalId === 'ferritin')!;
    expect(ferritin.status).toBe('NO_SOURCE_RANGE');
    expect(ferritin.referenceRange).toBeNull();
    expect(record.pipeline.filter(stage => stage.status === 'DONE').every(stage => stage.startedAt && stage.endedAt && stage.durationMs !== null)).toBe(true);
    const foreign = await fetchRecord(req(`/api/record/${record.id}`), record.id);
    expect(foreign.status).toBe(404);
    const patch = await updateRecord(req(`/api/record/${record.id}`, 'PATCH', { updates: [{ id: originalLab.id, field: 'value', value: '10.4', reason: 'Checked against printed source' }] }, cookie), record.id);
    expect(patch.status).toBe(200);
    record = responseSchema.parse(await patch.json()).record;
    let lab = record.labResults.find(item => item.id === originalLab.id)!;
    expect(lab.source.kind).toBe('USER_CORRECTED');
    expect(lab.source.evidence?.originalText).toContain('10.2');
    expect(lab.corrections[0]).toMatchObject({ from: '10.2', to: '10.4' });
    for (const action of ['verify', 'reject', 'restore', 'revert'] as const) {
      const result = await updateRecord(req(`/api/record/${record.id}`, 'PATCH', { verifications: [{ id: lab.id, action }] }, cookie), record.id);
      expect(result.status).toBe(200);
      record = responseSchema.parse(await result.json()).record;
    }
    lab = record.labResults.find(item => item.id === originalLab.id)!;
    expect(lab.value).toBe('10.2');
    expect(lab.corrections.some(item => item.field === 'verified')).toBe(true);
    expect(lab.corrections.some(item => item.field === 'rejected')).toBe(true);
    const summarized = await refreshSummary(req(`/api/record/${record.id}/summary`, 'POST', { regenerate: true }, cookie), record.id);
    expect(summarized.status).toBe(200);
    record = responseSchema.parse(await summarized.json()).record;
    expect(record.summary).toMatchObject({ generator: 'TEMPLATE', safetyChecked: true, regenerated: true });
    for (const format of ['json', 'csv', 'md']) {
      const exported = await downloadRecord(req(`/api/record/${record.id}/export?format=${format}`, 'GET', undefined, cookie), record.id);
      expect(exported.status).toBe(200);
      expect(exported.headers.get('content-disposition')).toContain('attachment');
      expect((await exported.text()).length).toBeGreaterThan(100);
    }
    const removed = await deleteRecord(req(`/api/record/${record.id}`, 'DELETE', undefined, cookie), record.id);
    expect(removed.status).toBe(200);
    expect((await fetchRecord(req(`/api/record/${record.id}`, 'GET', undefined, cookie), record.id)).status).toBe(404);
  });
  it('requires explicit duplicate override and rejects invalid correction fields atomically', async () => {
    const created = await createRecord(req('/api/intake', 'POST', { nameOrIdentifier: 'Duplicate test' }));
    const cookie = session(created);
    const record = responseSchema.parse(await created.json()).record;
    expect((await extractReport(upload(record.id, cookie))).status).toBe(200);
    const duplicate = await extractReport(upload(record.id, cookie));
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: { code: 'DUPLICATE_DOCUMENT' } });
    const override = await extractReport(upload(record.id, cookie, report, true));
    expect(override.status).toBe(200);
    const current = responseSchema.parse(await override.json()).record;
    expect(current.documents).toHaveLength(2);
    const unsafe = await updateRecord(req(`/api/record/${record.id}`, 'PATCH', { updates: [{ id: current.labResults[0].id, field: '__proto__', value: 'injected' }] }, cookie), record.id);
    expect(unsafe.status).toBe(400);
  });
  it('loads fictional demo through real engines with no provider call', async () => {
    const response = await loadDemo(req('/api/demo', 'POST'));
    expect(response.status).toBe(201);
    const record = responseSchema.parse(await response.json()).record;
    expect(record.isDemo).toBe(true);
    expect(record.documents).toHaveLength(3);
    expect(record.labResults.filter(lab => lab.source.sourceDocumentId === record.documents[0].id)).toHaveLength(19);
    expect(record.conflicts.some(conflict => conflict.ruleId === 'ALLERGY_DENIAL_VS_DOCUMENTED')).toBe(true);
    expect(record.comparison?.rows.some(row => !row.comparable)).toBe(true);
    expect(record.stats.verified).toBeGreaterThan(0);
  });
});
