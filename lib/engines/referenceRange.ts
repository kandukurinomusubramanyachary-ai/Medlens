import type { LabResult, RangeStatus } from "@/lib/schema";
import { convertUnit, normalizeUnit } from "@/lib/engines/normalization";

export interface ParsedRange { min: number | null; max: number | null; minInclusive: boolean; maxInclusive: boolean; unit: string | null; valid: boolean }
const numeric = "[+-]?(?:\\d+(?:[.,]\\d+)?|\\.\\d+)";
const invalidRange: ParsedRange = { min: null, max: null, minInclusive: true, maxInclusive: true, unit: null, valid: false };
export function parseReferenceRange(range: string | null): ParsedRange {
  if (!range) return { ...invalidRange };
  let input = range.trim().replace(/[−–—]/g, "-").replace(/\u00a0/g, " ").replace(/^\((.*)\)$/, "$1").replace(/^(?:ref(?:erence)?(?:\s+range)?|range)\s*[:=]\s*/i, "");
  // Multiple qualified ranges need human selection. Do not pick one using clinical knowledge.
  if ((input.match(/(?:female|male|child|adult|years?|yrs?)\b/gi)?.length ?? 0) > 1 || /;|\b(?:or)\b/i.test(input)) return { ...invalidRange };
  input = input.replace(/^(?:female|male|adult|child)(?:\s*\([^)]*\))?\s*:?\s*/i, "");
  const pair = input.match(new RegExp(`^(${numeric})\\s*(?:-|to)\\s*(${numeric})\\s*([^0-9]*)$`, "i"));
  if (pair) {
    const min = Number(pair[1].replace(",", ".")), max = Number(pair[2].replace(",", "."));
    return { min, max, minInclusive: true, maxInclusive: true, unit: pair[3].trim() || null, valid: Number.isFinite(min) && Number.isFinite(max) && min <= max };
  }
  const one = input.match(new RegExp(`^(<=|>=|<|>|≤|≥)\\s*(${numeric})\\s*(.*?)$`));
  if (one) {
    const value = Number(one[2].replace(",", "."));
    const lower = [">", ">=", "≥"].includes(one[1]);
    return { min: lower ? value : null, max: lower ? null : value, minInclusive: one[1] !== ">", maxInclusive: one[1] !== "<", unit: one[3].trim() || null, valid: Number.isFinite(value) && !/\d|[<>≤≥]/.test(one[3]) };
  }
  return { ...invalidRange };
}
export function applyReferenceRange(lab: LabResult): LabResult {
  const range = parseReferenceRange(lab.referenceRange);
  let status: RangeStatus = "NO_SOURCE_RANGE";
  let statusReason = "No reference range is provided by the source or a reviewer.";
  const referenceUnit = lab.referenceUnit ?? range.unit ?? lab.unit;
  if (lab.referenceRange && lab.referenceRangeSource) {
    status = "UNABLE_TO_DETERMININE";
    statusReason = "The printed reference range could not be read unambiguously.";
    if (range.valid) {
      if (lab.numericValue === null) statusReason = "The reported value is qualitative or an inequality; it is not an exact numeric measurement.";
      else if (!lab.unit || !referenceUnit) statusReason = "A measurement unit is missing; review the source before interpreting this range.";
      else {
        const comparable = convertUnit(lab.numericValue, lab.unit, referenceUnit, lab.canonicalId);
        if (comparable === null) statusReason = "The measurement and reference range use units that cannot be safely reconciled.";
        else {
          const below = range.min !== null && (comparable < range.min - 1e-9 || (!range.minInclusive && Math.abs(comparable - range.min) < 1e-9));
          const above = range.max !== null && (comparable > range.max + 1e-9 || (!range.maxInclusive && Math.abs(comparable - range.max) < 1e-9));
          status = below ? "BELOW" : above ? "ABOVE" : "WITHIN";
          statusReason = `${below ? "Below" : above ? "Above" : "Within"} the reference range ${lab.referenceRangeSource === "USER_PROVIDED" ? "entered by the reviewer" : "printed on the report"} (${lab.referenceRange}).`;
        }
      }
    }
  }
  return { ...lab, referenceMin: range.valid ? range.min : null, referenceMax: range.valid ? range.max : null, referenceUnit, canonicalUnit: normalizeUnit(lab.unit), status, statusReason };
}
