import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractDocumentText } from '../lib/engines/textExtraction';
import { evidenceBackedLabs } from '../lib/ai/provider';
import { parseModelJson } from '../lib/ai/json';
import type { SourceDocument } from '../lib/schema';

function pdf(text: string) {
  const content = `BT /F1 12 Tf 50 750 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const [index, object] of objects.entries()) { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = body.length;
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(body);
}

afterEach(() => vi.unstubAllEnvs());

describe('real file extraction', () => {
  it('reads an actual PDF text layer with the installed parser', async () => {
    const result = await extractDocumentText({ bytes: pdf('Hemoglobin 10.2 g/dL Reference range 13-17'), fileName: 'report.pdf', mimeType: 'application/pdf' });
    expect(result.method).toBe('PDF_TEXT');
    expect(result.pageCount).toBe(1);
    expect(result.rawText).toContain('Hemoglobin 10.2');
  });
  it('returns correct safe codes for corrupt, empty and unsupported files', async () => {
    await expect(extractDocumentText({ bytes: new TextEncoder().encode('%PDF-invalid'), fileName: 'report.pdf', mimeType: 'application/pdf' })).rejects.toMatchObject({ code: 'FILE_CORRUPT' });
    await expect(extractDocumentText({ bytes: new Uint8Array(), fileName: 'report.txt', mimeType: 'text/plain' })).rejects.toMatchObject({ code: 'FILE_EMPTY' });
    await expect(extractDocumentText({ bytes: new TextEncoder().encode('abc'), fileName: 'report.exe', mimeType: 'application/octet-stream' })).rejects.toMatchObject({ code: 'FILE_UNSUPPORTED' });
  });
  it('reports unavailable OCR honestly for a valid image when disabled', async () => {
    vi.stubEnv('OCR_ENABLED', 'false');
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=', 'base64');
    await expect(extractDocumentText({ bytes, fileName: 'scan.png', mimeType: 'image/png' })).rejects.toMatchObject({ code: 'OCR_UNAVAILABLE' });
  });
});

describe('AI output is evidence constrained', () => {
  const line = 'Ferritin 42 ng/mL';
  const source: SourceDocument = { id: 'document-evidence', role: 'CURRENT_REPORT', kind: 'TEXT', fileName: 'report.txt', sizeBytes: 16, pageCount: 1, uploadedAt: '2026-03-12T00:00:00Z', extraction: { method: 'PLAIN_TEXT', status: 'OK', rawText: line, cleanedText: line, warnings: [] }, reportDate: '2026-03-12', reportDateAmbiguous: false, issuer: null };
  it('accepts evidence-backed data and rejects an invented range individually', () => {
    const result = evidenceBackedLabs({ labResults: [
      { sourceName: 'Ferritin', value: '42', unit: 'ng/mL', referenceRange: null, originalText: line },
      { sourceName: 'Ferritin', value: '42', unit: 'ng/mL', referenceRange: '20-200', originalText: line },
      { sourceName: 'Ferritin', value: 42, originalText: line },
    ] }, source, []);
    expect(result.labs).toHaveLength(1);
    expect(result.rejected).toBe(2);
    expect(result.labs[0].referenceRange).toBeNull();
    expect(result.labs[0].source.kind).toBe('AI_EXTRACTED');
    expect(evidenceBackedLabs({ labResults: [{ sourceName: 'Ferritin', value: '42', unit: 'ng/mL', referenceRange: null, originalText: line }] }, source, result.labs).labs).toHaveLength(0);
  });
  it('repairs fenced and prose-wrapped JSON, rejects truncation and never evaluates code', () => {
    expect(parseModelJson('```json\n{"labResults":[]}\n```')).toEqual({ labResults: [] });
    expect(parseModelJson('Here is JSON: {"labResults":[],}')).toEqual({ labResults: [] });
    expect(parseModelJson('{"labResults":[')).toBeNull();
    expect(parseModelJson('process.exit(1)')).toBeNull();
  });
});
