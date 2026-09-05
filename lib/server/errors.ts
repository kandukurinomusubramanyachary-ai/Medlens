export const errors = {
  FILE_UNSUPPORTED: [415, 'This file type is not supported. Choose PDF, PNG, JPEG, WebP, or plain text.'],
  FILE_TOO_LARGE: [413, 'This file is too large. Choose a file smaller than 10 MB.'],
  FILE_CORRUPT: [422, 'The file could not be read. Export a new copy or paste its text.'],
  FILE_EMPTY: [422, 'This file is empty. Choose another file or paste the report text.'],
  FILE_PASSWORD_PROTECTED: [422, 'This PDF is password protected. Upload an unlocked copy.'],
  FILE_TOO_MANY_PAGES: [422, 'This report exceeds 20 pages. Split it into smaller reports.'],
  OCR_UNAVAILABLE: [503, 'Image reading is unavailable on this server. Paste the report text or use a text-based PDF.'],
  OCR_FAILED: [422, 'The scan could not be read reliably. Try a clearer image or paste the text.'],
  EXTRACTION_NO_TEXT: [422, 'No readable text was found. Try another report or paste the text.'],
  EXTRACTION_PARTIAL: [200, 'Some information needs review. Inspect the source alongside the extracted facts.'],
  AI_NOT_CONFIGURED: [503, 'AI enrichment unavailable — API key not configured. Showing deterministic results.'],
  AI_TIMEOUT: [504, 'AI enrichment timed out. Deterministic results remain available; try again.'],
  AI_RATE_LIMITED: [429, 'AI enrichment is temporarily busy. Try again shortly.'],
  AI_MALFORMED_JSON: [422, 'AI enrichment could not be validated. Deterministic results remain available.'],
  AI_UNAVAILABLE: [502, 'AI enrichment is unavailable. Deterministic results remain available.'],
  NETWORK_FAILURE: [502, 'A service could not be reached. Try again shortly.'],
  VALIDATION_FAILED: [400, 'Some information is invalid. Check the form and try again.'],
  RECORD_NOT_FOUND: [404, 'This record is unavailable or this private session has expired. Create a new record.'],
  PAYLOAD_TOO_LARGE: [413, 'This request is too large. Reduce the text or file size and try again.'],
  UNSUPPORTED_INPUT: [400, 'Choose one report file or paste report text, then try again.'],
  NO_MATCHING_PARAMETERS: [422, 'No matching tests were found. Upload another previous report to compare.'],
  NO_REFERENCE_RANGE: [200, 'No reference range is printed in the source. Review the original report.'],
  INTERNAL_ERROR: [500, 'The request could not be completed. Existing saved information is unchanged; try again.'],
  ORIGIN_REJECTED: [403, 'This request could not be verified. Reopen MedLens and try again.'],
  RATE_LIMITED: [429, 'Too many requests. Wait one minute and try again.'],
  STORAGE_FULL: [503, 'Temporary storage is full. Export and delete older records, then try again.'],
  RECORD_BUSY: [409, 'This record is already being updated. Wait for processing to finish and try again.'],
  DUPLICATE_DOCUMENT: [409, 'This report is already in the record. Choose Keep both to add another copy.'],
} as const;

export type ErrorCode = keyof typeof errors;
export class ApiError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) { super(errors[code][1]); this.name = 'ApiError'; this.code = code; }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code in errors)
    return new ApiError(error.code as ErrorCode);
  return new ApiError('INTERNAL_ERROR');
}
