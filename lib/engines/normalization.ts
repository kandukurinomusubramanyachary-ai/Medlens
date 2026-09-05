import { LAB_CONCEPTS } from "@/lib/domain/aliases";
import type { Confidence, LabResult } from "@/lib/schema";

export function normalizeTerm(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
const aliases = new Map(LAB_CONCEPTS.flatMap((concept) => concept.aliases.map((alias) => [normalizeTerm(alias), concept] as const)));
function similarity(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}
export function normalizeParameter(sourceName: string): Pick<LabResult, "canonicalId" | "canonicalName" | "normalizationMethod" | "specimen"> & { confidence: Confidence; confidenceReason: string } {
  const specimen = sourceName.match(/\b(serum|plasma|whole blood|urine)\b/i)?.[1].toLowerCase() ?? null;
  const term = normalizeTerm(sourceName);
  // Urine is a distinct measurement context and must never be silently removed.
  const stripped = term.replace(/\b(serum|plasma|whole blood)\b/g, "").replace(/\s+/g, " ").trim();
  const exact = aliases.get(term) ?? aliases.get(stripped);
  if (exact) return { canonicalId: exact.id, canonicalName: exact.name, normalizationMethod: "EXACT_ALIAS", specimen, confidence: "HIGH", confidenceReason: "The printed parameter matches the terminology dictionary." };
  let best: (typeof LAB_CONCEPTS)[number] | null = null;
  let score = 0.88;
  let tied = false;
  if (stripped.length >= 5) for (const [alias, concept] of aliases) {
    if (alias.length < 5 || alias.includes("urine") !== stripped.includes("urine")) continue;
    const candidate = similarity(stripped, alias);
    if (candidate > score || (candidate === score && !best)) { best = concept; score = candidate; tied = false; }
    else if (candidate === score && best?.id !== concept.id) tied = true;
  }
  if (best && !tied) return { canonicalId: best.id, canonicalName: best.name, normalizationMethod: "FUZZY", specimen, confidence: "REVIEW_SUGGESTED", confidenceReason: `The printed term resembles ${best.name}; confirm the name against the source.` };
  return { canonicalId: null, canonicalName: null, normalizationMethod: "UNRESOLVED", specimen, confidence: "UNCERTAIN", confidenceReason: "The printed parameter has no unambiguous dictionary match." };
}
export function normalizeLabResult(lab: LabResult): LabResult {
  if (lab.normalizationMethod === "USER") return lab;
  const { confidence, confidenceReason, ...normalization } = normalizeParameter(lab.sourceName);
  return { ...lab, ...normalization, canonicalUnit: normalizeUnit(lab.unit), source: { ...lab.source, confidence: lab.source.confidence === "UNCERTAIN" ? "UNCERTAIN" : confidence === "HIGH" ? lab.source.confidence : confidence, confidenceReason: confidence === "HIGH" ? lab.source.confidenceReason : confidenceReason } };
}
export function normalizeUnit(unit: string | null | undefined): string | null {
  if (!unit?.trim()) return null;
  const text = unit.trim().replace(/[μµ]/g, "u").replace(/[×✕]/g, "x").replace(/⁹/g, "9").replace(/¹²/g, "12").replace(/\^/g, "").replace(/\s/g, "").toLowerCase();
  const mapping: Record<string, string> = { "10^9/l": "x109/l", "109/l": "x109/l", "x109/l": "x109/l", "103/ul": "x109/l", "10*9/l": "x109/l", "10^12/l": "x1012/l", "1012/l": "x1012/l", "x1012/l": "x1012/l", "10*12/l": "x1012/l", "cells/ul": "/ul", "cells/cumm": "/ul", "/mm3": "/ul", "million/ul": "/millionul", "10^6/ul": "/millionul", "106/ul": "/millionul", "m/ul": "/millionul", "percent": "%" };
  return mapping[text] ?? text;
}
/** Explicit, bidirectional conversion allowlist; molecular factors are analyte-specific. */
export function convertUnit(value: number, from: string | null, to: string | null, canonicalId: string | null = null): number | null {
  const source = normalizeUnit(from), target = normalizeUnit(to);
  if (!Number.isFinite(value) || !source || !target) return null;
  if (source === target) return value;
  const edges: [string, string, number][] = [["g/dl", "g/l", 10], ["mg/dl", "g/l", 0.01], ["x109/l", "/ul", 1000], ["x1012/l", "/millionul", 1], ["%", "fraction", 0.01], ["mg/l", "ug/ml", 1], ["iu/ml", "u/ml", 1], ["pg/ml", "ng/l", 1]];
  if (canonicalId === "creatinine") edges.push(["umol/l", "mg/dl", 1 / 88.4]);
  if (["glucose", "glucose_fasting", "glucose_random", "urine_glucose"].includes(canonicalId ?? "")) edges.push(["mg/dl", "mmol/l", 1 / 18.0182]);
  if (["ldl", "hdl", "vldl", "total_cholesterol"].includes(canonicalId ?? "")) edges.push(["mg/dl", "mmol/l", 1 / 38.67]);
  if (canonicalId === "triglycerides") edges.push(["mg/dl", "mmol/l", 1 / 88.57]);
  if (canonicalId === "vitamin_d") edges.push(["nmol/l", "ng/ml", 1 / 2.496]);
  for (const [a, b, factor] of edges) {
    if (source === a && target === b) return value * factor;
    if (source === b && target === a) return value / factor;
  }
  return null;
}
