import type { MedicalRecord, MissingInfo } from "../schema";
import { acceptedLabs, isAnswered, stableId } from "./insightUtils";

export function missingInfoCandidates(record: MedicalRecord): MissingInfo[] {
  const items: MissingInfo[] = [];
  const add = (code: string, field: string, why: string, priority: number, factId: string | null) => {
    items.push({ id: stableId("missing", code, factId ?? "patient"), code, field, why, priority, factId });
  };
  for (const symptom of record.intake.symptoms.filter((item) => !item.rejected)) {
    if (!symptom.onset && !symptom.duration && !isAnswered(record, symptom.id, "SYMPTOM_ONSET")) {
      add("SYMPTOM_WITHOUT_ONSET", "Symptom onset", "An onset or duration was not provided for this reported symptom.", 1, symptom.id);
    }
  }
  for (const conflict of record.conflicts) {
    if (conflict.status !== "RESOLVED" && /ALLERGY/.test(conflict.ruleId)) {
      add("ALLERGY_CONFLICT_UNRESOLVED", "Allergy information", "The available allergy records differ and a resolution has not been recorded.", 1, conflict.id);
    }
  }
  for (const medication of record.intake.medications.filter((item) => !item.rejected)) {
    if (!medication.dose && !isAnswered(record, medication.id, "MEDICATION_DOSE")) {
      add("MEDICATION_WITHOUT_DOSE", "Medication dose", "A listed medication has no recorded dose; confirm what the prescription states.", 2, medication.id);
    }
  }
  const labs = acceptedLabs(record);
  for (const lab of labs) {
    if (!lab.unit && !isAnswered(record, lab.id, "LAB_CONTEXT")) {
      add("LAB_RESULT_WITHOUT_UNIT", `${lab.canonicalName ?? lab.sourceName}: unit`, "The unit was not provided, so numeric comparisons may be unavailable.", 1, lab.id);
    }
    if (!lab.referenceRange || !lab.referenceRangeSource) {
      add("LAB_WITHOUT_SOURCE_RANGE", `${lab.canonicalName ?? lab.sourceName}: printed range`, "No source reference range was supplied; this value cannot be classified against a printed range.", 2, lab.id);
    }
    if (!lab.canonicalId) add("UNNORMALIZED_PARAMETER", "Parameter name", "The original parameter name could not be confidently matched to the terminology dictionary.", 3, lab.id);
    if (lab.source.confidence !== "HIGH" && !lab.verified) add("LOW_CONFIDENCE_EXTRACTION", "Source verification", lab.source.confidenceReason, 3, lab.id);
  }
  for (const document of record.documents) {
    if ((!document.reportDate || document.reportDateAmbiguous) && !isAnswered(record, document.id, "DATE_AMBIGUITY")) {
      add("REPORT_DATE_UNCLEAR", "Report date", "The report date is absent or ambiguous, which limits chronological comparison.", 2, document.id);
    }
    if (!labs.some((lab) => lab.source.sourceDocumentId === document.id)) {
      add("NO_LAB_VALUES_FOUND_IN_DOCUMENT", "Laboratory values", "No accepted laboratory rows were found in this document. It may contain only narrative information.", 1, document.id);
    }
    if (document.extraction.status !== "OK") add("DOCUMENT_UNREADABLE_PARTIAL", "Document extraction", "The document could not be read completely. Review its extraction warnings and source text.", 1, document.id);
  }
  if (!record.patient.sex || record.patient.sex === "PREFER_NOT_TO_SAY") {
    add("PATIENT_SEX_UNKNOWN_FOR_CONTEXT", "Sex context", "Sex was not provided. Any printed sex-specific reference labels need human review.", 4, null);
  }
  return items.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export function detectMissingInfo(record: MedicalRecord): MissingInfo[] {
  return missingInfoCandidates(record).slice(0, 8);
}
