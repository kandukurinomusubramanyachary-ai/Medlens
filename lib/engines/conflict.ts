import type { ClinicalItem, Conflict, LabResult, MedicalRecord, SourceDocument } from "../schema";
import { convertUnit, normalizeUnit } from "../domain/units";
import { acceptedLabs, clinicalItems, normalizedName, stableId } from "./insightUtils";

type Evidence = Conflict["evidence"][number];
const denial = /\b(?:no (?:known )?(?:drug )?allerg(?:y|ies)|nkda|denies allerg(?:y|ies))\b/i;
const allergyClasses = [
  ["penicillin", "amoxicillin", "ampicillin", "benzylpenicillin", "phenoxymethylpenicillin"],
  ["sulfonamide", "sulfa", "sulfamethoxazole"],
  ["cephalosporin", "cefalexin", "cephalexin", "ceftriaxone", "cefuroxime"],
  ["macrolide", "azithromycin", "clarithromycin", "erythromycin"],
];

function evidence(fact: ClinicalItem | LabResult): Evidence {
  return { factId: fact.id, documentId: fact.source.sourceDocumentId, label: fact.source.sourceLabel,
    quote: fact.source.evidence?.originalText ?? ("text" in fact ? fact.text : `${fact.sourceName} ${fact.value ?? ""} ${fact.unit ?? ""}`) };
}

function documentEvidence(document: SourceDocument, quote: string, suffix: string): Evidence {
  return { factId: stableId("document_fact", document.id, suffix), documentId: document.id,
    label: document.fileName ?? (document.role === "PREVIOUS_REPORT" ? "Previous report" : "Current report"), quote };
}

function sameDrugClass(allergy: string, medication: string): boolean {
  const tokens = (text: string): string[] => text.toLowerCase().match(/[a-z]+/g) ?? [];
  const allergies = tokens(allergy);
  const medicines = tokens(medication);
  return allergyClasses.some((group) => group.some((term) => allergies.includes(term))
    && group.some((term) => medicines.includes(term)))
    || allergies.some((term) => term.length > 3 && !["allergy", "allergies", "documented", "reaction", "reported"].includes(term) && medicines.includes(term));
}

export function detectConflicts(record: MedicalRecord): Conflict[] {
  const found = new Map<string, Conflict>();
  const add = (ruleId: string, severity: Conflict["severity"], title: string, description: string, items: Evidence[]) => {
    const id = stableId("conflict", ruleId, ...items.map((item) => item.factId).sort());
    const existing = record.conflicts.find((conflict) => conflict.id === id);
    found.set(id, { id, ruleId, severity, title, description, evidence: items,
      suggestedAction: "Requires clarification. Review the source details and record a resolution note.",
      status: existing?.status ?? "OPEN", resolutionNote: existing?.resolutionNote ?? null,
      resolvedAt: existing?.resolvedAt ?? null });
  };
  const clinical = clinicalItems(record);
  const allergies = clinical.filter((item) => item.type === "ALLERGY");
  const negativeAllergies = allergies.filter((item) => denial.test(item.text));
  const positiveAllergies: { text: string; evidence: Evidence }[] = allergies.filter((item) => !denial.test(item.text))
    .map((item) => ({ text: item.text, evidence: evidence(item) }));
  for (const document of record.documents) {
    for (const line of document.extraction.rawText.split(/\r?\n/)) {
      if (/\ballerg(?:y|ic|ies)\b/i.test(line) && !denial.test(line)
        && !positiveAllergies.some((item) => item.evidence.documentId === document.id && item.evidence.quote.includes(line.trim()))) {
        positiveAllergies.push({ text: line, evidence: documentEvidence(document, line, `allergy:${line.trim()}`) });
      }
    }
  }
  for (const negative of negativeAllergies) {
    for (const positive of positiveAllergies) {
      add("ALLERGY_DENIAL_VS_DOCUMENTED", "HIGH", "Allergy information differs",
        "The available records contain an allergy denial and a documented allergy. The current allergy information needs clarification.",
        [evidence(negative), positive.evidence]);
    }
  }
  for (const allergy of positiveAllergies) {
    for (const medication of record.intake.medications.filter((item) => !item.rejected)) {
      if (sameDrugClass(allergy.text, medication.text)) add("MEDICATION_ALLERGY_CONFLICT", "HIGH", "Medication and allergy records overlap",
        "A listed medication and a documented allergy name the same medicine or a related medicine class. Consider clarifying this with a healthcare professional.",
        [allergy.evidence, evidence(medication)]);
    }
  }
  const patientEvidence: Evidence = { factId: record.patient.id, documentId: null,
    label: record.patient.source.sourceLabel, quote: `Age: ${record.patient.age ?? "not provided"}; sex: ${record.patient.sex ?? "not provided"}` };
  for (const document of record.documents) {
    const text = document.extraction.rawText;
    const age = text.match(/\bage\s*[:=-]?\s*(\d{1,3})\s*(?:years?|yrs?|y\b)?/i);
    if (age && record.patient.age !== null && Number(age[1]) !== record.patient.age) {
      add("DEMOGRAPHIC_MISMATCH_AGE", "MEDIUM", "Recorded ages differ",
        "The age printed in a report differs from the intake age. Confirm that the report belongs to the intended person and when the age was recorded.",
        [patientEvidence, documentEvidence(document, age[0], "age")]);
    }
    const sex = text.match(/\b(?:sex|gender)\s*[:=-]?\s*(female|male|f|m)\b/i);
    const printedSex = sex && /^f/i.test(sex[1]) ? "FEMALE" : sex ? "MALE" : null;
    if (sex && ["FEMALE", "MALE"].includes(record.patient.sex ?? "") && printedSex !== record.patient.sex) {
      add("DEMOGRAPHIC_MISMATCH_SEX", "MEDIUM", "Recorded sex fields differ",
        "The sex printed in a report differs from the intake field. Confirm the source details.",
        [patientEvidence, documentEvidence(document, sex[0], "sex")]);
    }
  }
  const labs = acceptedLabs(record);
  const groups = new Map<string, LabResult[]>();
  for (const lab of labs) {
    const key = lab.canonicalId ?? normalizedName(lab.sourceName);
    groups.set(key, [...(groups.get(key) ?? []), lab]);
    const range = lab.referenceRange ?? "";
    const sexes = { male: /\bmale\b/i.test(range), female: /\bfemale\b/i.test(range) };
    const mismatch = record.patient.sex === "FEMALE" && sexes.male && !sexes.female
      || record.patient.sex === "MALE" && sexes.female && !sexes.male;
    if (mismatch) add("SEX_SPECIFIC_RANGE_MISMATCH", "LOW", "Printed range has a different sex label",
      "The source reference range is labelled for a different sex than the intake field. The printed range has been preserved without reinterpretation.", [patientEvidence, evidence(lab)]);
  }
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i]; const b = group[j];
      const sameDocument = !!a.source.sourceDocumentId && a.source.sourceDocumentId === b.source.sourceDocumentId;
      const numeric = a.numericValue !== null && b.numericValue !== null && !/[<>≤≥]/.test(`${a.value}${b.value}`);
      const converted = numeric ? convertUnit(b.numericValue!, b.unit, a.unit, a.canonicalId) : null;
      const differs = converted !== null ? Math.abs(a.numericValue! - converted) > 1e-9
        : normalizeUnit(a.unit) === normalizeUnit(b.unit) && a.value !== null && b.value !== null && a.value !== b.value;
      if (sameDocument) {
        add("DUPLICATE_PARAMETER_CONFLICT", "LOW", "Parameter listed more than once",
          "The same parameter appears more than once in one report. Confirm whether these are separate samples or duplicate entries.", [evidence(a), evidence(b)]);
        if (differs) add("CONTRADICTORY_VALUES_SAME_REPORT", "HIGH", "Different values in the same report",
          "One report lists different values for the same parameter in the same or safely reconciled units. Confirm the intended sample and value.", [evidence(a), evidence(b)]);
      } else if (converted !== null && a.numericValue !== null && a.reportDate && b.reportDate
        && !a.reportDateAmbiguous && !b.reportDateAmbiguous && a.canonicalId && a.canonicalId === b.canonicalId) {
        const previousIds = new Set(record.documents.filter((doc) => doc.role === "PREVIOUS_REPORT").map((doc) => doc.id));
        const aPrevious = previousIds.has(a.source.sourceDocumentId ?? "");
        const bPrevious = previousIds.has(b.source.sourceDocumentId ?? "");
        const baseline = aPrevious ? Math.abs(a.numericValue) : Math.abs(converted);
        if (aPrevious !== bPrevious && baseline > 0 && Math.abs(a.numericValue - converted) / baseline > 0.3) {
          add("LAB_VALUE_DISCREPANCY_ACROSS_REPORTS", "MEDIUM", "Recorded values differ by more than 30%",
            "The current and previous reports list values that differ by more than 30% after safe unit reconciliation. This describes the records only; confirm dates and sample context.", [evidence(a), evidence(b)]);
        }
      }
      const unitsDiffer = a.unit && b.unit && normalizeUnit(a.unit) !== normalizeUnit(b.unit) && converted === null;
      const rangesDiffer = sameDocument && a.referenceRange && b.referenceRange && a.referenceRange !== b.referenceRange;
      if (unitsDiffer || rangesDiffer) add("UNIT_OR_RANGE_CONFLICT_SAME_PARAMETER", "MEDIUM", "Units or printed ranges differ",
        "Entries for the same parameter have units that cannot be safely reconciled or differing reference ranges in one report. Review the original rows.", [evidence(a), evidence(b)]);
    }
  }
  const conditionNames = ["diabetes", "hypertension", "asthma", "hypothyroidism"];
  for (const condition of record.intake.conditions.filter((item) => !item.rejected)) {
    for (const name of conditionNames) {
      if (!new RegExp(`\\b(?:no|denies|without)\\s+(?:history of\\s+)?${name}\\b`, "i").test(condition.text)) continue;
      for (const document of record.documents) {
        const pattern = new RegExp(`^.*\\b(?:condition|diagnosis|history|medical history)\\s*:\\s*(?:[a-z -]+,\\s*)?${name}\\b.*$`, "im");
        const match = document.extraction.rawText.match(pattern);
        if (match) add("INTAKE_VS_REPORT_STATEMENT", "MEDIUM", "Condition statements differ",
          "An explicit condition statement in a report differs from the intake statement. The records need clarification; laboratory tests alone do not establish a condition.",
          [evidence(condition), documentEvidence(document, match[0], `condition:${name}`)]);
      }
    }
  }
  for (const previous of record.documents.filter((doc) => doc.role === "PREVIOUS_REPORT")) {
    for (const current of record.documents.filter((doc) => doc.role !== "PREVIOUS_REPORT")) {
      if (previous.reportDate && current.reportDate && !previous.reportDateAmbiguous && !current.reportDateAmbiguous
        && previous.reportDate > current.reportDate) add("DATE_ORDER_ANOMALY", "LOW", "Previous report is dated later",
        "The document labelled previous has a later printed date than the current document. Confirm the document roles and report dates.",
        [documentEvidence(previous, previous.reportDate, "date"), documentEvidence(current, current.reportDate, "date")]);
    }
  }
  for (const previous of record.conflicts) if (previous.status === "RESOLVED" && !found.has(previous.id)) found.set(previous.id, previous);
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return [...found.values()].sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
}
