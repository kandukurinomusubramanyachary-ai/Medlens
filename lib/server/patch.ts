import { z } from 'zod';
import { type ClinicalItem, type LabResult, type MedicalRecord, labResultSchema, clinicalItemSchema } from '../schema';
import { deriveRecord } from '../engines/deriveRecord';
import { normalizeLabResult } from '../engines/normalization';
import { applyReferenceRange } from '../engines/referenceRange';
import { validateLabResults } from '../engines/validation';
import { ApiError } from './errors';

const labFields = ['value', 'unit', 'referenceRange', 'sourceName', 'reportDate', 'observations'] as const;
const clinicalFields = ['text', 'onset', 'duration', 'severity', 'dose', 'frequency', 'route'] as const;
const fieldSchema = z.enum([...labFields, ...clinicalFields]);
const id = z.string().min(1).max(150);
export const patchSchema = z.object({
  updates: z.array(z.object({ id, field: fieldSchema, value: z.string().trim().max(1200).nullable(), reason: z.string().trim().max(500).optional() }).strict()).max(100).default([]),
  verifications: z.array(z.object({ id, action: z.enum(['verify', 'unverify', 'reject', 'restore', 'revert']) }).strict()).max(100).default([]),
  resolutions: z.array(z.object({ id, status: z.enum(['ACKNOWLEDGED', 'RESOLVED']), note: z.string().trim().min(1).max(1000) }).strict()).max(40).default([]),
  clarificationAnswers: z.array(z.object({ id, answer: z.string().trim().min(1).max(1200) }).strict()).max(20).default([]),
}).strict().refine(value => value.updates.length + value.verifications.length + value.resolutions.length + value.clarificationAnswers.length > 0);
export type RecordPatch = z.infer<typeof patchSchema>;
type Fact = LabResult | ClinicalItem;
type Field = z.infer<typeof fieldSchema>;

function getFact(record: MedicalRecord, id: string): Fact {
  const found = [...record.labResults, ...record.observations, ...record.intake.symptoms, ...record.intake.conditions, ...record.intake.allergies, ...record.intake.medications].find(item => item.id === id);
  if (!found) throw new ApiError('VALIDATION_FAILED');
  return found;
}
function isLab(fact: Fact): fact is LabResult { return 'sourceName' in fact; }
function readField(fact: Fact, field: Field): string | null {
  if (isLab(fact) && (labFields as readonly string[]).includes(field)) return fact[field as typeof labFields[number]];
  if (!isLab(fact) && (clinicalFields as readonly string[]).includes(field)) return fact[field as typeof clinicalFields[number]] ?? null;
  throw new ApiError('VALIDATION_FAILED');
}

function correct(fact: Fact, field: Field, value: string | null, reason?: string) {
  const previous = readField(fact, field);
  if ((field === 'sourceName' || field === 'text') && !value) throw new ApiError('VALIDATION_FAILED');
  if (field === 'reportDate' && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value || value < '1900-01-01' || value > new Date().toISOString().slice(0, 10))) throw new ApiError('VALIDATION_FAILED');
  fact.corrections.push({ field, from: previous, to: value, at: new Date().toISOString(), ...(reason ? { reason } : {}) });
  Object.assign(fact, { [field]: value });
  fact.corrected = true;
  fact.verified = false;
  fact.verifiedAt = null;
  fact.source = { ...fact.source, kind: 'USER_CORRECTED', confidence: 'HIGH', confidenceReason: 'Corrected directly by the user; the original evidence is preserved.' };
  if (isLab(fact)) {
    if (field === 'referenceRange') fact.referenceRangeSource = value ? 'USER_PROVIDED' : null;
    if (field === 'reportDate') fact.reportDateAmbiguous = false;
    if (field === 'value') fact.numericValue = value && /^[+-]?\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
  }
}

export function patchRecord(original: MedicalRecord, patch: RecordPatch): { record: MedicalRecord; changed: string[] } {
  const record = structuredClone(original);
  const changed = new Set<string>();
  for (const update of patch.updates) {
    correct(getFact(record, update.id), update.field, update.value, update.reason);
    changed.add(update.id);
  }
  for (const verification of patch.verifications) {
    const fact = getFact(record, verification.id);
    if (verification.action === 'revert') {
      const correction = [...fact.corrections].reverse().find(entry => fieldSchema.safeParse(entry.field).success);
      if (!correction || (correction.from !== null && typeof correction.from !== 'string')) throw new ApiError('VALIDATION_FAILED');
      correct(fact, fieldSchema.parse(correction.field), correction.from, `Reverted correction from ${correction.at}`);
    } else {
      const now = new Date().toISOString();
      const rejectionAction = verification.action === 'reject' || verification.action === 'restore';
      if (rejectionAction) {
        fact.corrections.push({ field: 'rejected', from: fact.rejected, to: verification.action === 'reject', at: now, reason: verification.action === 'reject' ? 'Extraction rejected by user; source retained.' : 'Extraction restored by user.' });
        fact.rejected = verification.action === 'reject';
        fact.verified = false;
        fact.verifiedAt = null;
      } else {
        if (fact.rejected && verification.action === 'verify') throw new ApiError('VALIDATION_FAILED');
        const verified = verification.action === 'verify';
        fact.corrections.push({ field: 'verified', from: fact.verified, to: verified, at: now, reason: verified ? 'Confirmed by user.' : 'User removed confirmation.' });
        fact.verified = verified;
        fact.verifiedAt = verified ? now : null;
      }
    }
    changed.add(fact.id);
  }
  for (const resolution of patch.resolutions) {
    const conflict = record.conflicts.find(item => item.id === resolution.id);
    if (!conflict) throw new ApiError('VALIDATION_FAILED');
    conflict.status = resolution.status;
    conflict.resolutionNote = resolution.note;
    conflict.resolvedAt = resolution.status === 'RESOLVED' ? new Date().toISOString() : null;
    changed.add(conflict.id);
  }
  for (const entry of patch.clarificationAnswers) {
    const question = record.clarifications.find(item => item.id === entry.id);
    if (!question) throw new ApiError('VALIDATION_FAILED');
    question.answer = entry.answer;
    if (question.relatedFactId && ['SYMPTOM_ONSET', 'MEDICATION_DOSE'].includes(question.trigger)) {
      const fact = getFact(record, question.relatedFactId);
      if (!isLab(fact)) correct(fact, question.trigger === 'SYMPTOM_ONSET' ? 'onset' : 'dose', entry.answer, 'Entered as a clarification answer.');
    }
    changed.add(question.id);
  }
  record.labResults = record.labResults.map(lab => {
    if (!changed.has(lab.id)) return lab;
    const normalized = normalizeLabResult(lab);
    const validated = validateLabResults([normalized]).labResults[0];
    const checked = labResultSchema.safeParse(applyReferenceRange(validated));
    if (!checked.success) throw new ApiError('VALIDATION_FAILED');
    return checked.data;
  });
  for (const fact of [...record.observations, ...record.intake.symptoms, ...record.intake.conditions, ...record.intake.allergies, ...record.intake.medications]) {
    if (!clinicalItemSchema.safeParse(fact).success) throw new ApiError('VALIDATION_FAILED');
  }
  record.updatedAt = new Date().toISOString();
  return { record: deriveRecord(record), changed: [...changed] };
}
