import { it, expect } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { extractDocumentText } from '../lib/engines/textExtraction';

it('manually validates the installed local English OCR model', async () => {
  process.env.OCR_ENABLED = 'true';
  process.env.OCR_LANG_PATH = 'models';
  const canvas = createCanvas(1800, 450);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, 1800, 450);
  context.fillStyle = 'black'; context.font = '40px Arial';
  context.fillText('FICTIONAL LABORATORY REPORT', 50, 90);
  context.fillText('Hemoglobin 10.2 g/dL (13-17)', 50, 180);
  context.fillText('Ferritin 42 ng/mL', 50, 270);
  const result = await extractDocumentText({ bytes: canvas.toBuffer('image/png'), mimeType: 'image/png', fileName: 'fictional-scan.png' });
  expect(result.method).toBe('OCR');
  expect(result.rawText).toContain('Hemoglobin');
  expect(result.rawText).toContain('10.2');
}, 60_000);
