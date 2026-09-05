import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ApiError } from '../server/errors';
import { validateFile } from '../server/uploads';

export interface TextExtractionResult {
  rawText: string; cleanedText: string; pageCount: number;
  method: 'PDF_TEXT' | 'OCR' | 'PLAIN_TEXT'; status: 'OK' | 'PARTIAL'; warnings: string[];
}
const MAX_PAGES = 20;
const MAX_CHARACTERS = 160_000;
let activeExtractions = 0;

export function cleanText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .split('\n').map(line => line.replace(/\t/g, '  ').replace(/ +$/g, '')).filter(line => !/^\s*(?:page\s+\d+\s*(?:of\s+\d+)?|--\s*\d+\s*of\s*\d+\s*--)\s*$/i.test(line)).join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

export async function ocrAvailable(): Promise<boolean> {
  if (process.env.OCR_ENABLED !== 'true') return false;
  try { await access(join(resolve(process.env.OCR_LANG_PATH || 'models'), 'eng.traineddata')); return true; }
  catch { return false; }
}

function checkImageDimensions(bytes: Uint8Array, mimeType: string) {
  const buffer = Buffer.from(bytes);
  let width = 0, height = 0;
  if (mimeType === 'image/png' && buffer.length >= 24) { width = buffer.readUInt32BE(16); height = buffer.readUInt32BE(20); }
  else if (mimeType === 'image/jpeg') {
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 255) { offset++; continue; }
      const marker = buffer[offset + 1];
      if (marker === 216 || marker === 217 || marker === 0) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > buffer.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) { height = buffer.readUInt16BE(offset + 5); width = buffer.readUInt16BE(offset + 7); break; }
      offset += length + 2;
    }
  } else if (mimeType === 'image/webp' && buffer.length >= 30) {
    const type = buffer.subarray(12, 16).toString();
    if (type === 'VP8X') { width = buffer.readUIntLE(24, 3) + 1; height = buffer.readUIntLE(27, 3) + 1; }
    else if (type === 'VP8 ') { width = buffer.readUInt16LE(26) & 16383; height = buffer.readUInt16LE(28) & 16383; }
    else if (type === 'VP8L') { const data = buffer.readUInt32LE(21); width = (data & 16383) + 1; height = ((data >>> 14) & 16383) + 1; }
  }
  if (!width || !height) throw new ApiError('FILE_CORRUPT');
  if (width > 12000 || height > 12000 || width * height > 24_000_000) throw new ApiError('FILE_TOO_LARGE');
}

async function recognize(images: Uint8Array[]): Promise<{ text: string; warnings: string[] }> {
  if (!(await ocrAvailable())) throw new ApiError('OCR_UNAVAILABLE');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, { langPath: resolve(process.env.OCR_LANG_PATH || 'models'), gzip: false, cacheMethod: 'none', logger: () => undefined, errorHandler: () => undefined });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    const texts: string[] = [], warnings = new Set<string>();
    await worker.setParameters({ preserve_interword_spaces: '1' });
    for (const bytes of images) {
      const { data } = await worker.recognize(Buffer.from(bytes), {}, { text: true });
      texts.push(data.text);
      if (data.confidence < 70) warnings.add('LOW_TEXT_CONFIDENCE');
      if (!data.text.trim()) warnings.add('BLANK_PAGE');
      if (texts.join('\n').length > MAX_CHARACTERS) throw new ApiError('PAYLOAD_TOO_LARGE');
    }
    return { text: texts.join('\n\n'), warnings: [...warnings] };
  };
  try {
    return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ApiError('OCR_FAILED')), 35_000); })]);
  } catch (error: unknown) { if (error instanceof ApiError) throw error; throw new ApiError('OCR_FAILED'); }
  finally { clearTimeout(timer); await worker.terminate(); }
}

export async function extractDocumentText(input: { bytes: Uint8Array; mimeType: string; fileName: string }): Promise<TextExtractionResult> {
  validateFile(input.bytes, input.mimeType, input.fileName);
  if (input.mimeType === 'text/plain') {
    const rawText = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
    if (!rawText.trim()) throw new ApiError('EXTRACTION_NO_TEXT');
    return { rawText, cleanedText: cleanText(rawText), pageCount: 1, method: 'PLAIN_TEXT', status: 'OK', warnings: [] };
  }
  if (activeExtractions >= 2) throw new ApiError('RATE_LIMITED');
  activeExtractions++;
  try {
    if (input.mimeType.startsWith('image/')) {
      checkImageDimensions(input.bytes, input.mimeType);
      const ocr = await recognize([input.bytes]);
      if (!ocr.text.trim()) throw new ApiError('EXTRACTION_NO_TEXT');
      return { rawText: ocr.text, cleanedText: cleanText(ocr.text), pageCount: 1, method: 'OCR', status: ocr.warnings.length ? 'PARTIAL' : 'OK', warnings: ocr.warnings };
    }
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: input.bytes.slice(), verbosity: 0, isEvalSupported: false, maxImageSize: 24_000_000, useSystemFonts: false });
    try {
      const info = await parser.getInfo();
      if (info.total > MAX_PAGES) throw new ApiError('FILE_TOO_MANY_PAGES');
      if (!info.total) throw new ApiError('FILE_EMPTY');
      const result = await parser.getText();
      if (result.text.length > MAX_CHARACTERS) throw new ApiError('PAYLOAD_TOO_LARGE');
      const scant = result.pages.filter(page => page.text.replace(/\s/g, '').length < 20);
      if (scant.length) {
        if (!(await ocrAvailable())) {
          if (scant.length === info.total) throw new ApiError('OCR_UNAVAILABLE');
          return { rawText: result.text, cleanedText: cleanText(result.text), pageCount: info.total, method: 'PDF_TEXT', status: 'PARTIAL', warnings: ['PARTIAL_PAGE_EXTRACTION', 'OCR_UNAVAILABLE'] };
        }
        const pageInfo = await parser.getInfo({ parsePageInfo: true });
        if (pageInfo.pages.some(page => page.width <= 0 || page.height <= 0 || 1600 * 1600 * page.height / page.width > 24_000_000)) throw new ApiError('FILE_TOO_LARGE');
        const screenshots = await parser.getScreenshot({ desiredWidth: 1600, imageDataUrl: false });
        const ocr = await recognize(screenshots.pages.map(page => page.data));
        if (!ocr.text.trim()) throw new ApiError('EXTRACTION_NO_TEXT');
        return { rawText: ocr.text, cleanedText: cleanText(ocr.text), pageCount: info.total, method: 'OCR', status: ocr.warnings.length ? 'PARTIAL' : 'OK', warnings: ocr.warnings };
      }
      return { rawText: result.text, cleanedText: cleanText(result.text), pageCount: info.total, method: 'PDF_TEXT', status: 'OK', warnings: [] };
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && /password/i.test(error.name)) throw new ApiError('FILE_PASSWORD_PROTECTED');
      throw new ApiError('FILE_CORRUPT');
    } finally { await parser.destroy(); }
  } finally { activeExtractions--; }
}
