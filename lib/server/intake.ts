import type { ClinicalItem, IntakeInput, MedicalRecord, Provenance } from '../schema';
import { deriveRecord } from '../engines/deriveRecord';
import { newId } from '../storage/repository';

function source(): Provenance {
  return { kind: 'PATIENT_PROVIDED', sourceDocumentId: null, sourceLabel: 'Intake form', confidence: 'HIGH', confidenceReason: 'Entered directly by the user; not independently confirmed.', evidence: null };
}

function items(text: string, type: ClinicalItem['type']): ClinicalItem[] {
  return text.split(/[;\n]+/).map(value => value.trim()).filter(Boolean).slice(0, 40).map(value => ({
    id: newId(), type, text: value, source: source(), verified: false, verifiedAt: null, corrected: false, corrections: [], rejected: false,
    ...(type === 'MEDICATION' ? { dose: value.match(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|mL|units?)\b/i)?.[0] ?? null } : {}),
  }));
}

export function createIntake(input: IntakeInput): MedicalRecord {
  const now = new Date().toISOString();
  return deriveRecord({
    id: newId(), patient: { id: newId(), nameOrIdentifier: input.nameOrIdentifier, age: input.age, sex: input.sex, notes: input.notes || null, createdAt: now, source: source() },
    intake: { symptoms: items(input.symptoms, 'SYMPTOM'), conditions: items(input.conditions, 'CONDITION'), allergies: items(input.allergies, 'ALLERGY'), medications: items(input.medications, 'MEDICATION'), notes: input.notes || null },
    documents: [], labResults: [], observations: [], conflicts: [], missingInfo: [], clarifications: [], comparison: null, summary: null, pipeline: [], isDemo: false,
    stats: { documentsProcessed: 0, valuesExtracted: 0, labResults: 0, needsReview: 0, conflicts: 0, openConflicts: 0, clarifications: 0, verified: 0, verifiedPercent: 0, missingInfo: 0, outOfRange: 0, comparisonRows: 0 },
    createdAt: now, updatedAt: now,
  });
}
