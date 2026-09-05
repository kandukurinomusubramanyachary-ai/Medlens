import type { MedicalRecord, RecordStats } from "../schema";
import { acceptedLabs, clinicalItems } from "./insightUtils";

export function computeStats(record: MedicalRecord): RecordStats {
  const labs = acceptedLabs(record);
  const clinical = clinicalItems(record);
  const facts = [...labs, ...clinical];
  const verified = facts.filter((fact) => fact.verified).length;
  return {
    documentsProcessed: record.documents.filter((document) => document.extraction.status !== "FAILED").length,
    valuesExtracted: labs.length + record.observations.filter((item) => !item.rejected).length,
    labResults: labs.length,
    needsReview: facts.filter((fact) => !fact.verified).length,
    conflicts: record.conflicts.length,
    openConflicts: record.conflicts.filter((conflict) => conflict.status !== "RESOLVED").length,
    clarifications: record.clarifications.filter((question) => !question.answer?.trim()).length,
    verified,
    verifiedPercent: facts.length ? Math.round(verified / facts.length * 100) : 0,
    missingInfo: record.missingInfo.length,
    outOfRange: labs.filter((lab) => lab.status === "ABOVE" || lab.status === "BELOW").length,
    comparisonRows: record.comparison?.rows.length ?? 0,
  };
}
