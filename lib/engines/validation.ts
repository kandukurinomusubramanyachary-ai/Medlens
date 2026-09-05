import type { LabResult } from "@/lib/schema";
import { parseNumeric } from "@/lib/utils/numbers";
import { parseReferenceRange } from "@/lib/engines/referenceRange";

export function validateLabResults(input: LabResult[]): { labResults: LabResult[]; warnings: string[] } {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const labResults = input.map((lab) => {
    const issues: string[] = [];
    const numericValue = parseNumeric(lab.value);
    if (lab.numericValue !== numericValue) issues.push("The numeric field was reconciled with the printed value.");
    if (numericValue !== null && (numericValue < 0 || Math.abs(numericValue) > 1e9)) issues.push("The numeric magnitude requires confirmation against the source.");
    if (lab.referenceRange && !lab.unit) issues.push("A reference range is present but the measurement unit is missing.");
    if (lab.referenceRange && !parseReferenceRange(lab.referenceRange).valid) issues.push("The source range is reversed, qualified, or could not be parsed.");
    if (lab.referenceRange && !lab.value) issues.push("A source range is present but the result value is missing.");
    const key = `${lab.source.sourceDocumentId}:${lab.canonicalId ?? lab.sourceName.toLowerCase()}`;
    if (seen.has(key)) warnings.push("DUPLICATE_PARAMETER_CONFLICT");
    seen.add(key);
    if (issues.length) warnings.push(...issues);
    return { ...lab, numericValue, source: issues.length ? { ...lab.source, confidence: "REVIEW_SUGGESTED" as const, confidenceReason: issues.join(" ") } : lab.source };
  });
  return { labResults, warnings: [...new Set(warnings)] };
}
