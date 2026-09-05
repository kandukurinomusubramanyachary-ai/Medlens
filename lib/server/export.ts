import type { MedicalRecord } from '../schema';

export type ExportFormat = 'json' | 'csv' | 'md';
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
const markdown = (value: string | null) => (value ?? 'Not provided').replace(/[\\`*_[\]<>|]/g, '\\$&').replace(/\r?\n/g, ' ');

export function exportRecord(record: MedicalRecord, format: ExportFormat): { content: string; contentType: string; fileName: string } {
  const fileName = `medlens-record-${record.id}.${format}`;
  if (format === 'json') return { content: JSON.stringify(record, null, 2), contentType: 'application/json; charset=utf-8', fileName };
  if (format === 'csv') {
    const rows: unknown[][] = [['Test', 'Original term', 'Value', 'Unit', 'Printed reference range', 'Range source', 'Status', 'Report date', 'Source', 'Document ID', 'Confidence', 'Verified', 'Rejected', 'Evidence']];
    for (const lab of record.labResults) rows.push([lab.canonicalName, lab.sourceName, lab.value, lab.unit, lab.referenceRange, lab.referenceRangeSource, lab.status, lab.reportDate, lab.source.sourceLabel, lab.source.sourceDocumentId, lab.source.confidence, lab.verified, lab.rejected, lab.source.evidence?.originalText]);
    return { content: `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`, contentType: 'text/csv; charset=utf-8', fileName };
  }
  const lines = [`# MedLens structured record`, '', `Patient: ${markdown(record.patient.nameOrIdentifier)}`, `Created: ${record.createdAt}`, '', ...(record.isDemo ? ['**Fictional demonstration data.**', ''] : []),
    'This record organizes the supplied information. This summary is not a diagnosis.', '', '## Laboratory results', '', '| Test | Value | Source range | Date | Verification | Source |', '| --- | --- | --- | --- | --- | --- |'];
  for (const lab of record.labResults) lines.push(`| ${markdown(lab.canonicalName ?? lab.sourceName)} | ${markdown(lab.value)} ${markdown(lab.unit)} | ${markdown(lab.referenceRange)} | ${markdown(lab.reportDate)} | ${lab.rejected ? 'Rejected extraction' : lab.verified ? 'Verified' : 'Unverified'} | ${markdown(lab.source.sourceLabel)} |`);
  lines.push('', '## Source evidence', '');
  for (const lab of record.labResults) lines.push(`- **${markdown(lab.sourceName)}:** ${markdown(lab.source.evidence?.originalText ?? null)} [${markdown(lab.source.sourceDocumentId)}]`);
  lines.push('', '## Patient-friendly summary', '', markdown(record.summary?.text ?? null), '', '## Conflicting information', '');
  for (const conflict of record.conflicts) lines.push(`- ${markdown(conflict.title)} — ${conflict.status}. ${markdown(conflict.description)}${conflict.resolutionNote ? ` Resolution: ${markdown(conflict.resolutionNote)}` : ''}`);
  lines.push('', '## Audit trail', '');
  for (const fact of [...record.labResults, ...record.observations, ...record.intake.symptoms, ...record.intake.conditions, ...record.intake.allergies, ...record.intake.medications]) {
    for (const correction of fact.corrections) lines.push(`- ${markdown('sourceName' in fact ? fact.sourceName : fact.text)} — ${markdown(correction.field)}: ${markdown(String(correction.from))} → ${markdown(String(correction.to))} at ${correction.at}. ${markdown(correction.reason ?? '')}`);
  }
  return { content: lines.join('\n'), contentType: 'text/markdown; charset=utf-8', fileName };
}
