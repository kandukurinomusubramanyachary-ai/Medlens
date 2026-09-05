import type { LabResult } from "../schema";

export function calibrateConfidence(lab: LabResult): LabResult {
  if (lab.source.kind === "USER_CORRECTED") return lab;
  const evidence = lab.source.evidence;
  const text = evidence?.originalText.replace(/\s+/g, " ").toLowerCase() ?? "";
  const valueMatches = lab.value !== null && text.includes(lab.value.toLowerCase());
  const unitMatches = lab.unit !== null && text.includes(lab.unit.toLowerCase());
  let confidence: LabResult["source"]["confidence"] = "UNCERTAIN";
  let confidenceReason = "The parameter could not be resolved to a known term; check the original report.";
  if (lab.rejected) {
    confidenceReason = "This extracted row was rejected and is excluded from derived findings.";
  } else if (lab.normalizationMethod === "UNRESOLVED") {
    confidenceReason = "The parameter could not be resolved to a known term; check the original report.";
  } else if (!evidence || !valueMatches) {
    confidenceReason = "The recorded value could not be corroborated in an exact source snippet.";
  } else if (lab.normalizationMethod === "FUZZY" || lab.normalizationMethod === "AI"
    || evidence.extractionMethod === "OCR" || evidence.extractionMethod === "AI"
    || lab.reportDateAmbiguous || !unitMatches) {
    confidence = "REVIEW_SUGGESTED";
    confidenceReason = lab.reportDateAmbiguous ? "The report date is ambiguous; confirm it against the source."
      : !unitMatches ? "The value is supported by the source, but its unit needs review."
      : "The value is supported by evidence, but its extraction or term matching needs review.";
  } else if (lab.normalizationMethod === "EXACT_ALIAS"
    && (evidence.extractionMethod === "REGEX" || evidence.extractionMethod === "TABLE")) {
    confidence = "HIGH";
    confidenceReason = "An exact term alias matched, and the value and unit appear in the source snippet.";
  }
  return { ...lab, source: { ...lab.source, confidence, confidenceReason } };
}
