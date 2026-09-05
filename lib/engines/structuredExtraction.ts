import { randomUUID } from "node:crypto";
import type { ClinicalItem, LabResult, SourceDocument } from "@/lib/schema";
import { normalizeParameter, normalizeUnit } from "@/lib/engines/normalization";
import { applyReferenceRange } from "@/lib/engines/referenceRange";
import { parseNumeric } from "@/lib/utils/numbers";
import { parseSourceDate } from "@/lib/utils/dates";

export function containsInstruction(text: string): boolean {
  return /ignore\s+(?:all\s+)?(?:previous|prior|above|instructions)|you\s+are\s+now|\b(?:system|assistant|developer)\s*:|<\|(?:im_start|system)|(?:execute|run)\s+(?:this|the)\s+(?:command|script)|https?:\/\/.*(?:command|token|api.key)/i.test(text);
}
const valuePattern = /(?:^|[\s:|])((?:[<>≤≥]=?\s*)?[+-]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:e[+-]?\d+)?|non[- ]reactive|reactive|not detected|detected|negative|positive|trace)(?=\s|[%|()]|$)/gi;
const verifiable = () => ({ verified: false, verifiedAt: null, corrected: false, corrections: [], rejected: false });

function sourceEvidence(line: string, document: SourceDocument, fallbackLine: number) {
  const rawLines = document.extraction.rawText.split(/\r?\n/);
  const normalize = (value: string) => value.replace(/[\s|]+/g, " ").trim();
  const found = rawLines.findIndex((raw) => raw.includes(line) || normalize(raw) === normalize(line));
  return { documentId: document.id, originalText: found >= 0 ? rawLines[found] : line, locator: { line: found >= 0 ? found + 1 : fallbackLine }, extractionMethod: document.extraction.method === "OCR" ? "OCR" as const : "REGEX" as const };
}
function parseTail(tail: string): { unit: string | null; referenceRange: string | null; flag: string | null } {
  let rest = tail.trim().replace(/^\|\s*/, "");
  const flag = rest.match(/(?:^|\s|\|)(H|L|HIGH|LOW|\*)(?=\s|\||$)/i)?.[1] ?? null;
  if (flag) rest = rest.replace(/(?:^|\s|\|)(H|L|HIGH|LOW|\*)(?=\s|\||$)/i, " ");
  let referenceRange: string | null = null;
  const explicit = rest.match(/(?:[—–-]\s*)?(?:ref(?:erence)?(?:\s+range)?|range)\s*[:=]?\s*(.+)$/i);
  const parenthetic = rest.match(/\(\s*((?:[<>≤≥]|[+-]?\d)[^)]*)\)\s*$/);
  const bracket = rest.match(/\[\s*((?:[<>≤≥]|[+-]?\d)[^\]]*)\]\s*$/);
  const selected = explicit ?? parenthetic ?? bracket;
  if (selected && selected.index !== undefined) { referenceRange = selected[1].trim(); rest = rest.slice(0, selected.index).trim(); }
  else {
    const unbracketed = rest.match(/(?:^|[\s|])((?:[<>≤≥]=?\s*[+-]?[\d.]+|[+-]?[\d.]+\s*(?:[-–—]|\bto\b)\s*[+-]?[\d.]+)(?:\s+[a-zA-Zµμ%/]+)?)\s*$/);
    if (unbracketed && unbracketed.index !== undefined) { referenceRange = unbracketed[1]; rest = rest.slice(0, unbracketed.index).trim(); }
    else {
      const columns = rest.match(/(?:^|[\s|])([+-]?\d+(?:\.\d+)?)\s*[|\s]\s*([+-]?\d+(?:\.\d+)?)\s*$/);
      if (columns && columns.index !== undefined) { referenceRange = `${columns[1]} - ${columns[2]}`; rest = rest.slice(0, columns.index).trim(); }
    }
  }
  const unit = rest.replace(/^[|\s]+|[|\s]+$/g, "").trim() || null;
  if (unit && (unit.length > 35 || /[=:]|\b(?:report|patient|date)\b/i.test(unit))) return { unit: null, referenceRange, flag };
  return { unit, referenceRange, flag };
}

export function parseReport(text: string, document: SourceDocument, options: { normalize?: boolean } = {}): { labResults: LabResult[]; observations: ClinicalItem[] } {
  const labResults: LabResult[] = [], observations: ClinicalItem[] = [];
  const date = document.reportDate ? { date: document.reportDate, ambiguous: document.reportDateAmbiguous } : parseSourceDate(text);
  const lines = text.split(/\r?\n/);
  for (const [index, sourceLine] of lines.entries()) for (const piece of sourceLine.split(/\s+[·•]\s+/)) {
    const line = piece.trim();
    if (!line || line.length > 1000 || containsInstruction(line)) continue;
    const clinical = line.match(/^(symptoms?|conditions?|medical history|allerg(?:y|ies)|medications?|prescriptions?|observations?|notes?)\s*:\s*(.+)$/i);
    const bareAllergy = !clinical && /\b(?:allergy|allergic)\b/i.test(line) && line.length < 250;
    if (clinical || bareAllergy) {
      const label = clinical?.[1].toLowerCase() ?? "allergy";
      const type = label.startsWith("symptom") ? "SYMPTOM" : /condition|history/.test(label) ? "CONDITION" : label.startsWith("allerg") ? "ALLERGY" : /medication|prescription/.test(label) ? "MEDICATION" : "OBSERVATION";
      const body = clinical?.[2] ?? line;
      if (containsInstruction(body)) continue;
      observations.push({ id: randomUUID(), type, text: body, ...verifiable(),
        dose: type === "MEDICATION" ? body.match(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|mL|units?)\b/i)?.[0] ?? null : undefined,
        source: { kind: "DETERMINISTIC_EXTRACTION", sourceDocumentId: document.id, sourceLabel: document.fileName ?? "Pasted report", evidence: sourceEvidence(line, document, index + 1), confidence: document.extraction.method === "OCR" ? "REVIEW_SUGGESTED" : "HIGH", confidenceReason: "This statement is quoted directly from a labelled source line." },
      });
      continue;
    }
    if (/^(?:patient|name|age|sex|gender|date|report(?:ed)?\s*(?:date|id|no)|collected|collection|dob|page|sample\s*(?:id|no)|accession|reference|test\s+name|parameter\s+result)\b/i.test(line)) continue;
    let candidate: { name: string; value: string; tail: string; normalization: ReturnType<typeof normalizeParameter> } | null = null;
    for (const match of line.matchAll(valuePattern)) {
      const name = line.slice(0, match.index).replace(/[\s:|]+$/g, "").trim();
      if (!name || name.length > 120 || !/[a-z]/i.test(name)) continue;
      const normalization = normalizeParameter(name);
      const item = { name, value: match[1].trim(), tail: line.slice(match.index + match[0].length), normalization };
      if (normalization.canonicalId) { candidate = item; break; }
      candidate ??= item;
    }
    if (!candidate) continue;
    const parsed = parseTail(candidate.tail);
    if (!candidate.normalization.canonicalId && !parsed.unit && !parsed.referenceRange) continue;
    const numericValue = parseNumeric(candidate.value);
    const qualitative = /^(?:non[- ]reactive|reactive|not detected|detected|negative|positive|trace)$/i.test(candidate.value);
    const review = document.extraction.method === "OCR" || date.ambiguous || (!numericValue && !qualitative && numericValue !== 0) || !parsed.unit;
    const normalized = options.normalize !== false;
    const { confidence, confidenceReason, ...normalization } = candidate.normalization;
    const lab: LabResult = {
      id: randomUUID(), sourceName: candidate.name, ...(normalized ? normalization : { canonicalId: null, canonicalName: null, normalizationMethod: "UNRESOLVED" as const, specimen: normalization.specimen }),
      value: candidate.value, numericValue, unit: parsed.unit, canonicalUnit: normalizeUnit(parsed.unit), unitConversionApplied: false,
      referenceRange: parsed.referenceRange, referenceMin: null, referenceMax: null, referenceRangeSource: parsed.referenceRange ? "SOURCE_DOCUMENT" : null, referenceUnit: null,
      status: "NO_SOURCE_RANGE", statusReason: "Reference range analysis has not run.", reportDate: date.date, reportDateAmbiguous: date.ambiguous,
      observations: parsed.flag ? `Printed flag: ${parsed.flag}` : null, ...verifiable(),
      source: { kind: "DETERMINISTIC_EXTRACTION", sourceDocumentId: document.id, sourceLabel: document.fileName ?? "Pasted report", evidence: sourceEvidence(line, document, index + 1), confidence: confidence === "UNCERTAIN" ? confidence : review ? "REVIEW_SUGGESTED" : confidence, confidenceReason: review ? "Review the source: its date, measurement unit, numeric value, or OCR reading needs confirmation." : confidenceReason },
    };
    labResults.push(normalized ? applyReferenceRange(lab) : lab);
  }
  return { labResults, observations };
}
