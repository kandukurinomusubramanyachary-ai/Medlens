import { z } from "zod";

export const confidenceSchema = z.enum(["HIGH", "REVIEW_SUGGESTED", "UNCERTAIN"]);
export const provenanceKindSchema = z.enum(["PATIENT_PROVIDED", "CURRENT_REPORT", "PREVIOUS_REPORT", "AI_EXTRACTED", "AI_GENERATED", "USER_CORRECTED", "DETERMINISTIC_EXTRACTION", "NORMALIZED"]);
export const evidenceSchema = z.object({
  documentId: z.string(), originalText: z.string(),
  locator: z.object({ page: z.number().int().positive().optional(), line: z.number().int().positive().optional(), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional() }).optional(),
  extractionMethod: z.enum(["REGEX", "TABLE", "OCR", "AI", "USER"]),
});
export const provenanceSchema = z.object({
  kind: provenanceKindSchema, sourceDocumentId: z.string().nullable(), sourceLabel: z.string(),
  evidence: evidenceSchema.nullable().optional(), confidence: confidenceSchema, confidenceReason: z.string(),
});
export const correctionSchema = z.object({ field: z.string(), from: z.unknown(), to: z.unknown(), at: z.string(), reason: z.string().optional() });
export const verifiableSchema = z.object({ verified: z.boolean().default(false), verifiedAt: z.string().nullable().default(null), corrected: z.boolean().default(false), corrections: z.array(correctionSchema).default([]) });
export const rangeStatusSchema = z.enum(["BELOW", "WITHIN", "ABOVE", "UNABLE_TO_DETERMININE", "NO_SOURCE_RANGE"]);
export const labResultSchema = verifiableSchema.extend({
  id: z.string(), canonicalId: z.string().nullable(), canonicalName: z.string().nullable(), sourceName: z.string().min(1).max(120),
  normalizationMethod: z.enum(["EXACT_ALIAS", "FUZZY", "AI", "UNRESOLVED", "USER"]),
  value: z.string().nullable(), numericValue: z.number().finite().nullable(), unit: z.string().nullable(), canonicalUnit: z.string().nullable(), unitConversionApplied: z.boolean(),
  referenceRange: z.string().nullable(), referenceMin: z.number().finite().nullable(), referenceMax: z.number().finite().nullable(),
  referenceRangeSource: z.enum(["SOURCE_DOCUMENT", "USER_PROVIDED"]).nullable(), referenceUnit: z.string().nullable(),
  status: rangeStatusSchema, statusReason: z.string(), reportDate: z.string().nullable(), reportDateAmbiguous: z.boolean(), observations: z.string().nullable(),
  specimen: z.string().nullable().default(null), rejected: z.boolean().default(false), source: provenanceSchema,
});
export const clinicalItemSchema = verifiableSchema.extend({
  rejected: z.boolean().default(false),
  id: z.string(), type: z.enum(["SYMPTOM", "CONDITION", "ALLERGY", "MEDICATION", "OBSERVATION"]), text: z.string(),
  onset: z.string().nullable().optional(), duration: z.string().nullable().optional(), severity: z.string().nullable().optional(), dose: z.string().nullable().optional(), frequency: z.string().nullable().optional(), route: z.string().nullable().optional(), source: provenanceSchema,
});
export const patientSchema = z.object({
  id: z.string(), nameOrIdentifier: z.string(), age: z.number().int().min(0).max(130).nullable(),
  sex: z.enum(["FEMALE", "MALE", "OTHER", "PREFER_NOT_TO_SAY"]).nullable(), notes: z.string().nullable(), createdAt: z.string(), source: provenanceSchema,
});
export const sourceDocumentSchema = z.object({
  id: z.string(), role: z.enum(["CURRENT_REPORT", "PREVIOUS_REPORT", "PASTED_TEXT"]), kind: z.enum(["PDF", "IMAGE", "TEXT"]),
  fileName: z.string().nullable(), sizeBytes: z.number().nonnegative(), pageCount: z.number().int().nonnegative().nullable(), uploadedAt: z.string(),
  extraction: z.object({ method: z.enum(["PDF_TEXT", "OCR", "PLAIN_TEXT", "AI"]), status: z.enum(["OK", "PARTIAL", "FAILED"]), rawText: z.string(), cleanedText: z.string(), warnings: z.array(z.string()) }),
  reportDate: z.string().nullable(), reportDateAmbiguous: z.boolean(), issuer: z.string().nullable(),
});
export const conflictSchema = z.object({
  id: z.string(), ruleId: z.string(), severity: z.enum(["HIGH", "MEDIUM", "LOW"]), title: z.string(), description: z.string(), suggestedAction: z.string(),
  evidence: z.array(z.object({ factId: z.string(), documentId: z.string().nullable(), label: z.string(), quote: z.string() })),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]), resolutionNote: z.string().nullable(), resolvedAt: z.string().nullable(),
});
export const missingInfoSchema = z.object({ id: z.string(), code: z.string(), field: z.string(), why: z.string(), priority: z.number(), factId: z.string().nullable() });
export const clarificationQuestionSchema = z.object({
  id: z.string(), question: z.string(), rationale: z.string(), trigger: z.enum(["SYMPTOM_ONSET", "SYMPTOM_PATTERN", "MEDICATION_DOSE", "ALLERGY_DETAIL", "LAB_CONTEXT", "DATE_AMBIGUITY", "CONFLICT", "AI_GENERATED"]),
  relatedFactId: z.string().nullable(), origin: z.enum(["DETERMINISTIC", "AI"]), answer: z.string().nullable(),
});
const comparisonValueSchema = z.object({ value: z.string(), numeric: z.number().nullable(), unit: z.string().nullable(), date: z.string().nullable(), documentId: z.string() });
export const comparisonRowSchema = z.object({
  canonicalId: z.string(), label: z.string(), previous: comparisonValueSchema.nullable(), current: comparisonValueSchema.nullable(), unitReconciled: z.boolean(), comparable: z.boolean(), incomparableReason: z.string().optional(),
  change: z.object({ absolute: z.number().nullable(), percent: z.number().nullable(), direction: z.enum(["UP", "DOWN", "FLAT", "UNKNOWN"]) }).nullable(),
  statusChange: z.object({ from: rangeStatusSchema, to: rangeStatusSchema }).nullable(), provenance: provenanceSchema,
});
export const pipelineStageSchema = z.object({
  id: z.string(), label: z.string(), status: z.enum(["PENDING", "RUNNING", "DONE", "SKIPPED", "FAILED"]), detail: z.string().nullable(), startedAt: z.string().nullable(), endedAt: z.string().nullable(), durationMs: z.number().nonnegative().nullable(), errorCode: z.string().nullable(),
});
export const recordStatsSchema = z.object({
  documentsProcessed: z.number(), valuesExtracted: z.number(), labResults: z.number(), needsReview: z.number(), conflicts: z.number(), openConflicts: z.number(), clarifications: z.number(), verified: z.number(), verifiedPercent: z.number(), missingInfo: z.number(), outOfRange: z.number(), comparisonRows: z.number(),
});
export const medicalRecordSchema = z.object({
  id: z.string(), patient: patientSchema,
  intake: z.object({ symptoms: z.array(clinicalItemSchema), conditions: z.array(clinicalItemSchema), allergies: z.array(clinicalItemSchema), medications: z.array(clinicalItemSchema), notes: z.string().nullable() }),
  documents: z.array(sourceDocumentSchema), labResults: z.array(labResultSchema), observations: z.array(clinicalItemSchema), conflicts: z.array(conflictSchema), missingInfo: z.array(missingInfoSchema), clarifications: z.array(clarificationQuestionSchema),
  comparison: z.object({ available: z.boolean(), rows: z.array(comparisonRowSchema), reason: z.string().optional() }).nullable(),
  summary: z.object({ text: z.string(), bullets: z.array(z.string()), generator: z.enum(["AI", "TEMPLATE"]), safetyChecked: z.boolean(), regenerated: z.boolean() }).nullable(),
  pipeline: z.array(pipelineStageSchema), stats: recordStatsSchema, createdAt: z.string(), updatedAt: z.string(), isDemo: z.boolean().default(false),
});
const intakeText = z.string().trim().max(5000).default("");
export const intakeInputSchema = z.object({
  nameOrIdentifier: z.string().trim().min(1, "Enter a name or patient identifier.").max(120),
  age: z.number().int().min(0).max(130).nullable().default(null),
  sex: z.enum(["FEMALE", "MALE", "OTHER", "PREFER_NOT_TO_SAY"]).nullable().default(null),
  symptoms: intakeText, conditions: intakeText, allergies: intakeText, medications: intakeText, notes: intakeText,
}).strict();

export type Confidence = z.infer<typeof confidenceSchema>;
export type ProvenanceKind = z.infer<typeof provenanceKindSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
export type Correction = z.infer<typeof correctionSchema>;
export type Verifiable = z.infer<typeof verifiableSchema>;
export type RangeStatus = z.infer<typeof rangeStatusSchema>;
export type LabResult = z.infer<typeof labResultSchema>;
export type ClinicalItem = z.infer<typeof clinicalItemSchema>;
export type Patient = z.infer<typeof patientSchema>;
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export type Conflict = z.infer<typeof conflictSchema>;
export type MissingInfo = z.infer<typeof missingInfoSchema>;
export type ClarificationQuestion = z.infer<typeof clarificationQuestionSchema>;
export type ComparisonRow = z.infer<typeof comparisonRowSchema>;
export type PipelineStage = z.infer<typeof pipelineStageSchema>;
export type RecordStats = z.infer<typeof recordStatsSchema>;
export type MedicalRecord = z.infer<typeof medicalRecordSchema>;
export type IntakeInput = z.infer<typeof intakeInputSchema>;
