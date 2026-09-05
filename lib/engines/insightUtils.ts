import type { ClinicalItem, LabResult, MedicalRecord } from "../schema";

export function stableId(prefix: string, ...parts: string[]): string {
  let hash = 2166136261;
  for (const char of parts.join("|")) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

export function clinicalItems(record: MedicalRecord): ClinicalItem[] {
  return [
    ...record.intake.symptoms, ...record.intake.conditions, ...record.intake.allergies,
    ...record.intake.medications, ...record.observations,
  ].filter((item) => !item.rejected);
}

export function acceptedLabs(record: MedicalRecord): LabResult[] {
  return record.labResults.filter((lab) => !lab.rejected);
}

export function meaningfulAnswer(answer: string | null): boolean {
  return !!answer?.trim() && !/^(?:unknown|not sure|unsure|n\/?a|don'?t know|do not know|not provided)\.?$/i.test(answer.trim());
}

export function isAnswered(record: MedicalRecord, factId: string, trigger: string): boolean {
  return record.clarifications.some((question) => question.relatedFactId === factId
    && question.trigger === trigger && meaningfulAnswer(question.answer));
}

export function normalizedName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
