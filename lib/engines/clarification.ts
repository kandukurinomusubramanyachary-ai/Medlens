import type { ClarificationQuestion, MedicalRecord } from "../schema";
import { isAnswered, stableId } from "./insightUtils";
import { checkSafety } from "./safetyFilter";

export function generateClarifications(record: MedicalRecord): ClarificationQuestion[] {
  const candidates: ClarificationQuestion[] = [];
  const add = (factId: string, trigger: ClarificationQuestion["trigger"], variant: string, question: string, rationale: string) => {
    if (!checkSafety(question).safe) return;
    const id = stableId("question", factId, trigger, variant);
    const previous = record.clarifications.find((entry) => entry.id === id);
    candidates.push({ id, question, rationale, trigger, relatedFactId: factId, origin: "DETERMINISTIC", answer: previous?.answer ?? null });
  };
  for (const conflict of record.conflicts.filter((entry) => entry.status !== "RESOLVED").slice(0, 2)) {
    add(conflict.id, "CONFLICT", "clarify", `What information would clarify “${conflict.title.toLowerCase()}”?`,
      "The source records differ. A factual answer can support your review; only an explicit resolution closes the conflict.");
  }
  for (const medication of record.intake.medications.filter((item) => !item.rejected)) {
    if (!medication.dose && !isAnswered(record, medication.id, "MEDICATION_DOSE")) {
      add(medication.id, "MEDICATION_DOSE", "dose", `What dose and frequency are written on the prescription for ${medication.text}?`,
        "The medication entry does not include its prescribed dose. This question records information and does not recommend a dose.");
    }
  }
  for (const allergy of record.intake.allergies.filter((item) => !item.rejected)) {
    if (!/\b(?:no|none|nkda|rash|hives|swelling|itching|reaction\s*:|breath)/i.test(allergy.text)) {
      add(allergy.id, "ALLERGY_DETAIL", "reaction", `What reaction was recorded for ${allergy.text}?`, "The allergy entry does not describe the reaction.");
    }
  }
  for (const symptom of record.intake.symptoms.filter((item) => !item.rejected)) {
    const text = symptom.text.toLowerCase();
    const fatigue = /fatigue|weakness|tired/.test(text);
    const pain = /pain|ache/.test(text);
    const fever = /fever/.test(text);
    const respiratory = /cough|breathless|shortness of breath/.test(text);
    const weight = /weight/.test(text);
    const name = fatigue ? "the fatigue or weakness" : pain ? "the pain" : fever ? "the fever"
      : respiratory ? "the cough or breathlessness" : weight ? "the weight change" : "this symptom";
    if (!symptom.onset && !symptom.duration && !isAnswered(record, symptom.id, "SYMPTOM_ONSET")) {
      add(symptom.id, "SYMPTOM_ONSET", "onset", `When did ${name} begin?`, "The symptom entry does not state an onset or duration.");
    }
    if (fatigue) {
      if (!/constant|intermittent|comes? and goes?|occasion|daily/.test(text)) add(symptom.id, "SYMPTOM_PATTERN", "pattern",
        "Is the fatigue constant, or does it come and go?", "The symptom pattern was not described.");
      if (!/changed|unchanged|better|worse|increas|decreas/.test(text)) add(symptom.id, "SYMPTOM_PATTERN", "recent_change",
        "How has the fatigue changed in the last few weeks?", "Recent changes were not described in the intake.");
    } else if (pain) {
      if (!/chest|head|abdom|back|leg|arm|joint|neck|shoulder/.test(text)) add(symptom.id, "SYMPTOM_PATTERN", "site",
        "Where is the pain located?", "The location was not specified.");
      if (!symptom.severity) add(symptom.id, "SYMPTOM_PATTERN", "severity", "How would you describe the pain and when it occurs?", "Severity and pattern were not provided.");
    } else if (fever && !/\d+(?:\.\d+)?\s*°?\s*[cf]\b/.test(text)) {
      add(symptom.id, "SYMPTOM_PATTERN", "temperature", "Was a temperature measured, and what value and unit were recorded?", "A measured temperature was not included.");
    } else if (respiratory && !/night|exertion|stair|exercise|walk/.test(text)) {
      add(symptom.id, "SYMPTOM_PATTERN", "timing", "When does the cough or breathlessness occur, such as at night or during activity?", "The timing or activity pattern was not provided.");
    } else if (weight && !/\d+\s*(?:kg|lb|pound)/.test(text)) {
      add(symptom.id, "SYMPTOM_PATTERN", "amount", "What weight change was measured, and over what timeframe?", "The amount and timeframe were not provided.");
    }
  }
  for (const lab of record.labResults.filter((item) => !item.rejected && !item.unit)) {
    add(lab.id, "LAB_CONTEXT", "unit", `What unit is printed next to ${lab.canonicalName ?? lab.sourceName}?`, "The unit is missing from the extracted row.");
  }
  for (const document of record.documents) {
    if ((!document.reportDate || document.reportDateAmbiguous) && !isAnswered(record, document.id, "DATE_AMBIGUITY")) {
      add(document.id, "DATE_AMBIGUITY", "date", `What report date is printed on ${document.fileName ?? "this document"}?`,
        "The date is absent or ambiguous. Entering it does not replace the preserved source text.");
    }
  }
  const unique = [...new Map(candidates.map((question) => [question.id, question])).values()];
  const answered = record.clarifications.filter((question) => question.answer?.trim());
  const answeredIds = new Set(answered.map((question) => question.id));
  return [...unique.filter((question) => !answeredIds.has(question.id)).slice(0, 5), ...answered];
}
