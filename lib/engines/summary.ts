import type { MedicalRecord } from "../schema";
import { acceptedLabs } from "./insightUtils";
import { checkSafety } from "./safetyFilter";

const opening = "This summary describes only the information available in the records you provided.";
const closing = "This summary is not a diagnosis. Consider clarifying these points with a healthcare professional.";

export function generateSummary(record: MedicalRecord): NonNullable<MedicalRecord["summary"]> {
  const bullets: string[] = [];
  const labs = acceptedLabs(record);
  const sorted = [...labs].sort((a, b) => {
    const priority = (status: string) => ["ABOVE", "BELOW"].includes(status) ? 0 : status === "NO_SOURCE_RANGE" ? 1 : 2;
    return priority(a.status) - priority(b.status);
  });
  for (const lab of sorted.slice(0, 8)) {
    let bullet = `Your report lists ${lab.canonicalName ?? lab.sourceName}: ${lab.value ?? "value not provided"}${lab.unit ? ` ${lab.unit}` : " (unit not provided)"}.`;
    if (lab.status === "ABOVE" || lab.status === "BELOW") {
      const owner = lab.referenceRangeSource === "USER_PROVIDED" ? "provided during review" : "printed on the report";
      bullet += ` This value is ${lab.status.toLowerCase()} the reference range ${owner} (${lab.referenceRange}).`;
    } else if (lab.status === "NO_SOURCE_RANGE") bullet += " No source reference range was provided, so this value cannot be interpreted against a source range.";
    else if (lab.status === "UNABLE_TO_DETERMININE") bullet += " The available value, unit, or range needs clarification before range comparison.";
    else bullet += " This value is within the reference range provided with this record.";
    bullet += ` (Source: ${lab.source.sourceLabel}${lab.reportDate ? `, ${lab.reportDate}` : "; date not stated"}.)`;
    if (checkSafety(bullet).safe) bullets.push(bullet);
  }
  if (!labs.length) bullets.push("No accepted laboratory values are available in this record. (Source: extracted record.)");
  const symptoms = record.intake.symptoms.filter((item) => !item.rejected).length;
  if (symptoms) bullets.push(`The intake records ${symptoms} reported symptom${symptoms === 1 ? "" : "s"}. (Source: patient intake.)`);
  const conflicts = record.conflicts.filter((conflict) => conflict.status !== "RESOLVED");
  if (conflicts.length) bullets.push(`The available records contain ${conflicts.length} unresolved information conflict${conflicts.length === 1 ? "" : "s"}. Review the linked source evidence. (Source: compared record entries.)`);
  if (record.documents.some((document) => !document.reportDate || document.reportDateAmbiguous)) {
    bullets.push("A report date was not provided clearly. (Source: uploaded documents.)");
  }
  const text = [opening, ...bullets.map((bullet) => `• ${bullet}`), closing].join("\n\n");
  const safe = checkSafety(text).safe;
  return { text: safe ? text : `${opening}\n\nThe source entries require review before a summary can include their text.\n\n${closing}`,
    bullets: safe ? bullets : [], generator: "TEMPLATE", safetyChecked: true, regenerated: false };
}
