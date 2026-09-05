import { createHash } from 'node:crypto';
import { medicalRecordSchema, type MedicalRecord, type PipelineStage, type SourceDocument } from '../schema';
import { extractDocumentText, cleanText } from '../engines/textExtraction';
import { parseReport } from '../engines/structuredExtraction';
import { parseSourceDate } from '../utils/dates';
import { validateLabResults } from '../engines/validation';
import { normalizeLabResult } from '../engines/normalization';
import { applyReferenceRange } from '../engines/referenceRange';
import { detectConflicts } from '../engines/conflict';
import { detectMissingInfo } from '../engines/missingInfo';
import { generateClarifications } from '../engines/clarification';
import { compareReports } from '../engines/comparison';
import { generateSummary } from '../engines/summary';
import { computeStats } from '../engines/stats';
import { calibrateConfidence } from '../engines/confidence';
import { enrichReport } from '../ai/provider';
import { ApiError, toApiError } from '../server/errors';
import { newId } from '../storage/repository';
import type { ReportInput } from '../server/uploads';
import { skipStage, stage } from './stages';

export class ProcessingError extends ApiError {
  readonly record: MedicalRecord;
  constructor(error: unknown, record: MedicalRecord) { super(toApiError(error).code); this.record = record; }
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

export async function processReport(original: MedicalRecord, input: ReportInput, options: { disableAI?: boolean } = {}): Promise<MedicalRecord> {
  const record = structuredClone(original);
  const stages: PipelineStage[] = [];
  record.pipeline = stages;
  try {
    await stage(stages, 'READING_DOCUMENT', 'Reading document', () => {
      if (record.documents.length >= 12) throw new ApiError('STORAGE_FULL');
      if (!input.bytes.length) throw new ApiError('FILE_EMPTY');
    }, input.fileName ?? 'Pasted report text');
    const textResult = await stage(stages, 'EXTRACTING_TEXT', 'Extracting text', () => input.text !== undefined
      ? { rawText: input.text, cleanedText: input.text, pageCount: 1, method: 'PLAIN_TEXT' as const, status: 'OK' as const, warnings: [] as string[] }
      : extractDocumentText({ bytes: input.bytes, mimeType: input.mimeType, fileName: input.fileName ?? 'report.txt' }));
    stages[stages.length - 1].detail = textResult.method === 'OCR' ? 'Optical character recognition' : textResult.method === 'PDF_TEXT' ? 'Embedded PDF text layer' : 'Pasted or uploaded plain text';
    if (!textResult.rawText.trim()) throw new ApiError('EXTRACTION_NO_TEXT');
    if (Buffer.byteLength(textResult.rawText) > 180 * 1024) throw new ApiError('PAYLOAD_TOO_LARGE');
    const cleanedText = await stage(stages, 'CLEANING_TEXT', 'Cleaning text', () => cleanText(textResult.rawText));
    if (!input.keepBoth && record.documents.some(document => digest(document.extraction.cleanedText) === digest(cleanedText))) throw new ApiError('DUPLICATE_DOCUMENT');
    const date = parseSourceDate(textResult.rawText);
    const document: SourceDocument = {
      id: newId(), role: input.role === 'previous' ? 'PREVIOUS_REPORT' : 'CURRENT_REPORT', kind: input.mimeType === 'application/pdf' ? 'PDF' : input.mimeType.startsWith('image/') ? 'IMAGE' : 'TEXT',
      fileName: input.fileName, sizeBytes: input.bytes.byteLength, pageCount: textResult.pageCount, uploadedAt: new Date().toISOString(),
      extraction: { ...textResult, cleanedText }, reportDate: date.date, reportDateAmbiguous: date.ambiguous, issuer: null,
    };
    const extracted = await stage(stages, 'EXTRACTING_MEDICAL_INFORMATION', 'Extracting medical information', () => parseReport(cleanedText, document, { normalize: false }));
    if (!options.disableAI) {
      const enriched = await stage(stages, 'AI_ENRICHMENT', 'Checking optional AI enrichment', () => enrichReport(cleanedText, document, extracted.labResults));
      extracted.labResults = enriched.labResults;
      document.extraction.warnings.push(...enriched.warnings);
      if (!enriched.usedAI) { const entry = stages[stages.length - 1]; entry.status = 'SKIPPED'; entry.detail = enriched.warnings.join(' ') || 'Deterministic extraction was sufficient; no AI request was made.'; }
    } else skipStage(stages, 'AI_ENRICHMENT', 'AI enrichment', 'Fictional demo uses deterministic extraction only; no AI request was made.');
    const validated = await stage(stages, 'VALIDATING_VALUES', 'Validating values', () => validateLabResults(extracted.labResults));
    document.extraction.warnings.push(...validated.warnings);
    let labs = await stage(stages, 'NORMALIZING_TERMINOLOGY', 'Normalizing terminology', () => validated.labResults.map(normalizeLabResult));
    labs = await stage(stages, 'CHECKING_REFERENCE_RANGES', 'Checking reference ranges', () => labs.map(applyReferenceRange).map(calibrateConfidence));
    if (!labs.length && !extracted.observations.length) document.extraction.warnings.push('No recognized laboratory rows or clinical statements were found. Review the retained source text.');
    record.documents.push(document);
    record.labResults.push(...labs);
    record.observations.push(...extracted.observations);
    record.conflicts = await stage(stages, 'DETECTING_CONFLICTS', 'Detecting conflicts', () => detectConflicts(record));
    record.missingInfo = await stage(stages, 'FINDING_MISSING_INFORMATION', 'Finding missing information', () => detectMissingInfo(record));
    record.clarifications = await stage(stages, 'PREPARING_CLARIFICATIONS', 'Preparing clarifications', () => generateClarifications(record));
    if (record.documents.some(entry => entry.role === 'PREVIOUS_REPORT')) record.comparison = await stage(stages, 'COMPARING_WITH_PREVIOUS_REPORT', 'Comparing with previous report', () => compareReports(record));
    else { record.comparison = compareReports(record); skipStage(stages, 'COMPARING_WITH_PREVIOUS_REPORT', 'Comparing with previous report', 'No previous report has been uploaded.'); }
    await stage(stages, 'BUILDING_PATIENT_RECORD', 'Building patient record', () => { record.stats = computeStats(record); medicalRecordSchema.parse(record); });
    record.summary = await stage(stages, 'GENERATING_SUMMARY', 'Generating summary', () => generateSummary(record));
    record.updatedAt = new Date().toISOString();
    return medicalRecordSchema.parse(record);
  } catch (error: unknown) {
    // Earlier documents and their facts remain intact when a new report fails.
    const preserved = structuredClone(original);
    preserved.pipeline = stages;
    preserved.updatedAt = new Date().toISOString();
    throw new ProcessingError(error, preserved);
  }
}
