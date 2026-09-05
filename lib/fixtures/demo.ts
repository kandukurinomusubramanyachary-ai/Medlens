import type { IntakeInput } from '../schema';

export const demoIntake: IntakeInput = {
  nameOrIdentifier: 'Asha Verma', age: 34, sex: 'FEMALE',
  symptoms: 'Fatigue for several weeks; Occasional breathlessness on stairs',
  conditions: 'None reported', allergies: 'No known allergies',
  medications: 'Metformin 500 mg; Levothyroxine; Amoxicillin',
  notes: 'Fictional demonstration record DEMO-0001. All documents and values were authored for evaluating this application.',
};

export const demoCurrentText = `FICTIONAL DEMONSTRATION REPORT — NOT A REAL PATIENT
MedLens Example Laboratory
Patient: Asha Verma
Age: 34
Sex: Female
Report date: 12 Mar 2026
Test                    Result       Unit         Reference range
HGB                     10.2         g/dL         (13–17)
HCT                     32           %            (38–46)
RBC                     4.1          ×10¹²/L       (4.5–5.5)
WBC                     8.1          ×10⁹/L        (4.0–11.0)
Platelets               265          ×10⁹/L        (150–410)
Neutrophils             62           %            (40–70)
Lymphocytes             30           %            (20–40)
ESR                     28           mm/hr        (0–20)
CRP                     6.2          mg/L         (<5)
Fasting glucose         118          mg/dL        (70–100)
HbA1c                   6.4          %            (4.0–5.6)
Creatinine              0.9          mg/dL        (0.6–1.1)
Urea                    32           mg/dL        (15–40)
ALT                     26           U/L          (7–56)
AST                     24           U/L          (10–40)
TSH                     5.9          µIU/mL       (0.4–4.0)
Vitamin D               18           ng/mL        (30–100)
Ferritin                42           ng/mL
Serum iron              55           µg/dL
Observation: Fatigue recorded in the patient history.
Ferritin and serum iron have no reference range printed on this fictional report.`;

export const demoPreviousText = `FICTIONAL DEMONSTRATION REPORT — NOT A REAL PATIENT
MedLens Example Laboratory
Patient: Asha Verma
Age: 52
Sex: Female
Report date: 02 Sep 2025
Hemoglobin              11.1         g/dL         (13–17)
WBC                     7.2          ×10⁹/L
TSH                     4.1          µIU/mL
Vitamin D               24           ng/mL
Ferritin                55           ng/mL
Creatinine              0.9          mg/dL        (0.6–1.1)
Serum iron              12           µmol/L
Allergy: Penicillin allergy
Observation: The age shown above differs from the patient intake. The source is preserved for review.`;

export const demoUndatedText = `FICTIONAL DEMONSTRATION SUPPLEMENT — NOT A REAL PATIENT
MedLens Example Laboratory
Patient: Asha Verma
Report date: Not provided
Observation: Occasional breathlessness is documented on this undated page.
Allergy: Penicillin allergy`;
