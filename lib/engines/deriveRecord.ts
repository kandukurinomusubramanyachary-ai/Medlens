import type { MedicalRecord } from "../schema";
import { calibrateConfidence } from "./confidence";
import { detectConflicts } from "./conflict";
import { detectMissingInfo } from "./missingInfo";
import { generateClarifications } from "./clarification";
import { compareReports } from "./comparison";
import { generateSummary } from "./summary";
import { computeStats } from "./stats";

export function deriveRecord(record: MedicalRecord): MedicalRecord {
  let next: MedicalRecord = { ...record, labResults: record.labResults.map(calibrateConfidence) };
  next = { ...next, conflicts: detectConflicts(next) };
  next = { ...next, missingInfo: detectMissingInfo(next) };
  next = { ...next, clarifications: generateClarifications(next) };
  next = { ...next, comparison: compareReports(next) };
  next = { ...next, summary: generateSummary(next) };
  return { ...next, stats: computeStats(next) };
}
