import type { ComparisonRow, LabResult, MedicalRecord } from "../schema";
import { convertUnit, normalizeUnit } from "../domain/units";
import { acceptedLabs, normalizedName } from "./insightUtils";

const unknownChange: NonNullable<ComparisonRow["change"]> = { absolute: null, percent: null, direction: "UNKNOWN" };
function side(lab: LabResult | undefined): ComparisonRow["current"] {
  return lab?.source.sourceDocumentId ? {
    value: lab.value ?? "Not provided", numeric: lab.numericValue,
    unit: lab.unit, date: lab.reportDate, documentId: lab.source.sourceDocumentId,
  } : null;
}

export function compareReports(record: MedicalRecord): MedicalRecord["comparison"] {
  const previousIds = new Set(record.documents.filter((doc) => doc.role === "PREVIOUS_REPORT").map((doc) => doc.id));
  const currentIds = new Set(record.documents.filter((doc) => doc.role !== "PREVIOUS_REPORT").map((doc) => doc.id));
  if (!previousIds.size) return { available: false, rows: [], reason: "Add a previous report to compare recorded values." };
  const labs = acceptedLabs(record);
  const knownNames = new Map(labs.filter((lab) => lab.canonicalId).map((lab) => [normalizedName(lab.sourceName), lab.canonicalId!]));
  const key = (lab: LabResult) => lab.canonicalId ?? knownNames.get(normalizedName(lab.sourceName)) ?? `source:${normalizedName(lab.sourceName)}`;
  const groups = new Map<string, { current: LabResult[]; previous: LabResult[] }>();
  for (const lab of labs) {
    const id = lab.source.sourceDocumentId;
    if (!id || (!currentIds.has(id) && !previousIds.has(id))) continue;
    const group = groups.get(key(lab)) ?? { current: [], previous: [] };
    (previousIds.has(id) ? group.previous : group.current).push(lab);
    groups.set(key(lab), group);
  }
  const rows: ComparisonRow[] = [];
  for (const [canonicalId, group] of groups) {
    const order = (a: LabResult, b: LabResult) => (b.reportDate ?? "").localeCompare(a.reportDate ?? "") || a.id.localeCompare(b.id);
    const current = group.current.sort(order)[0];
    const previous = group.previous.sort(order)[0];
    const representative = current ?? previous;
    if (!representative) continue;
    let reason: string | undefined;
    let converted: number | null = null;
    let unitReconciled = false;
    if (!current || !previous) reason = "This parameter appears in only one report.";
    else if (group.current.some((lab) => lab.source.sourceDocumentId === current.source.sourceDocumentId && lab.value !== current.value)
      || group.previous.some((lab) => lab.source.sourceDocumentId === previous.source.sourceDocumentId && lab.value !== previous.value)) {
      reason = "A report contains conflicting values for this parameter; clarify the source value first.";
    } else if (!current.unit || !previous.unit) reason = "A unit was not provided for one or both values.";
    else if (current.numericValue === null || previous.numericValue === null
      || /[<>≤≥]/.test(`${current.value}${previous.value}`)) reason = "One or both values are non-numeric or expressed as a limit.";
    else {
      converted = convertUnit(previous.numericValue, previous.unit, current.unit, current.canonicalId);
      unitReconciled = converted !== null;
      if (converted === null) reason = `Units differ and cannot be safely converted (${previous.unit} vs ${current.unit}).`;
    }
    const comparable = !reason && current?.numericValue !== null && converted !== null;
    const absolute = comparable ? current!.numericValue! - converted! : null;
    const change: ComparisonRow["change"] = absolute === null ? { ...unknownChange } : {
      absolute: Number(absolute.toPrecision(12)),
      percent: converted !== 0 ? Number((absolute / Math.abs(converted!) * 100).toPrecision(12)) : null,
      direction: Math.abs(absolute) < 1e-9 ? "FLAT" : absolute > 0 ? "UP" : "DOWN",
    };
    const datesKnown = current?.reportDate && previous?.reportDate && !current.reportDateAmbiguous && !previous.reportDateAmbiguous;
    rows.push({
      canonicalId, label: representative.canonicalName ?? representative.sourceName,
      current: side(current), previous: side(previous), comparable: !!comparable, unitReconciled,
      ...(reason ? { incomparableReason: reason } : {}), change,
      statusChange: current?.referenceRangeSource && previous?.referenceRangeSource
        && current.status !== "UNABLE_TO_DETERMININE" && previous.status !== "UNABLE_TO_DETERMININE"
        ? { from: previous.status, to: current.status } : null,
      provenance: { ...representative.source,
        confidence: comparable && datesKnown ? representative.source.confidence : "REVIEW_SUGGESTED",
        confidenceReason: reason ?? (!datesKnown ? "Date not stated clearly on one or both reports."
          : normalizeUnit(previous!.unit) !== normalizeUnit(current!.unit)
            ? `The previous value was converted to ${current!.unit} using a documented deterministic conversion.`
            : "Both recorded numeric values use the same unit."),
        sourceLabel: `Comparison: ${previous?.source.sourceLabel ?? "previous value unavailable"} / ${current?.source.sourceLabel ?? "current value unavailable"}`,
      },
    });
  }
  const matched = rows.some((row) => row.current && row.previous);
  return { available: matched, rows,
    ...(!matched ? { reason: "NO_MATCHING_PARAMETERS: No matching parameters were found across the reports." } : {}),
  };
}
