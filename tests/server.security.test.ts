import { describe, expect, it } from 'vitest';
import { assertSameOrigin, handle, json, readBoundedBody } from '../lib/server/http';
import { ApiError } from '../lib/server/errors';
import { readUpload, validateFile, MAX_FILE_BYTES } from '../lib/server/uploads';
import { csvCell, exportRecord } from '../lib/server/export';
import { createIntake } from '../lib/server/intake';
import { InMemoryRecordRepository } from '../lib/storage/repository';
import { intakeInputSchema } from '../lib/schema';

const intake = () => createIntake(intakeInputSchema.parse({ nameOrIdentifier: 'Security test record' }));
const origin = 'http://localhost:3000';

describe('same-origin requests and private sessions', () => {
  it('rejects missing, foreign, opaque, and cross-site origins on writes', () => {
    const candidates: Record<string, string>[] = [{}, { origin: 'https://other.example' }, { origin: 'null' }, { origin, 'sec-fetch-site': 'cross-site' }];
    for (const headers of candidates)
      expect(() => assertSameOrigin(new Request(`${origin}/api/intake`, { method: 'POST', headers }))).toThrow(ApiError);
    expect(() => assertSameOrigin(new Request(`${origin}/api/intake`, { method: 'POST', headers: { origin } }))).not.toThrow();
  });
  it('returns safe errors and cryptographic HttpOnly secure session cookies', async () => {
    const response = await handle(new Request('https://example.test/api/records'), () => json({ ok: true }));
    expect(response.headers.get('set-cookie')).toMatch(/^medlens_session=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=3600; Secure$/);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const error = await handle(new Request(`${origin}/api/records`), () => { throw new Error('private file C:\\secret with patient data'); });
    expect(error.status).toBe(500);
    expect(JSON.stringify(await error.json())).not.toContain('secret');
  });
  it('prevents one session from reading, updating, deleting, or listing another session record', () => {
    const store = new InMemoryRecordRepository();
    const record = store.create('owner-A', intake());
    expect(store.list('owner-B')).toEqual([]);
    expect(() => store.get('owner-B', record.id)).toThrow('unavailable');
    expect(() => store.update('owner-B', record)).toThrow('unavailable');
    expect(() => store.delete('owner-B', record.id)).toThrow('unavailable');
    const copy = store.get('owner-A', record.id);
    copy.patient.nameOrIdentifier = 'Mutated copy';
    expect(store.get('owner-A', record.id).patient.nameOrIdentifier).toBe('Security test record');
  });
  it('serializes updates without silently overwriting concurrent changes', async () => {
    const store = new InMemoryRecordRepository();
    const record = store.create('owner', intake());
    let release: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const update = store.mutate('owner', record.id, async original => { await waiting; return original; });
    await expect(store.mutate('owner', record.id, original => original)).rejects.toMatchObject({ code: 'RECORD_BUSY' });
    release?.();
    await expect(update).resolves.toMatchObject({ id: record.id });
  });
});

describe('bounded uploads', () => {
  it('enforces limits even when content-length is missing or dishonest', async () => {
    await expect(readBoundedBody(new Request(`${origin}/api/extract`, { method: 'POST', body: 'abcdefghijkl' }), 8)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(readBoundedBody(new Request(`${origin}/api/extract`, { method: 'POST', body: 'abcdefghijkl', headers: { 'content-length': '3' } }), 8)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
  it('rejects MIME spoofing, mismatched extension, binary text, empty and oversized files', () => {
    expect(() => validateFile(new TextEncoder().encode('hello'), 'application/pdf', 'report.pdf')).toThrow('could not be read');
    expect(() => validateFile(new TextEncoder().encode('%PDF-1.7'), 'application/pdf', 'report.exe')).toThrow('not supported');
    expect(() => validateFile(new Uint8Array([1, 0, 3]), 'text/plain', 'report.txt')).toThrow('could not be read');
    expect(() => validateFile(new Uint8Array(), 'text/plain', 'report.txt')).toThrow('empty');
    expect(() => validateFile(new Uint8Array(MAX_FILE_BYTES + 1), 'application/pdf', 'report.pdf')).toThrow('too large');
  });
  it('rejects unsupported fields and duplicate multipart fields', async () => {
    const form = new FormData();
    form.set('recordId', crypto.randomUUID()); form.set('role', 'current'); form.set('text', 'HGB 10.2 g/dL (13-17)'); form.append('role', 'previous');
    await expect(readUpload(new Request(`${origin}/api/extract`, { method: 'POST', body: form }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('export safety', () => {
  it('neutralizes spreadsheet formulas including whitespace-prefixed injection', () => {
    for (const value of ['=HYPERLINK("https://example.test")', '+1+1', '-2+3', '@SUM(A1)', '\t=1+1']) expect(csvCell(value)).toMatch(/^"'/);
    expect(csvCell('10.2')).toBe('"10.2"');
    expect(csvCell('a"b,c')).toBe('"a""b,c"');
  });
  it('makes Markdown medical text inert and produces valid full JSON exports', () => {
    const record = intake();
    record.patient.nameOrIdentifier = '<script>alert(1)</script>';
    const md = exportRecord(record, 'md');
    expect(md.content).not.toContain('<script>');
    expect(JSON.parse(exportRecord(record, 'json').content).id).toBe(record.id);
  });
});
