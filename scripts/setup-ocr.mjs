import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const modelDirectory = resolve('models');
const response = await fetch('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata', { signal: AbortSignal.timeout(60_000), redirect: 'error' });
if (!response.ok) throw new Error('The English OCR model could not be downloaded. Retry setup when the network is available.');
const reader = response.body.getReader();
const chunks = [];
let size = 0;
while (true) {
  const chunk = await reader.read();
  if (chunk.done) break;
  size += chunk.value.byteLength;
  if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('OCR model exceeded the expected download size.'); }
  chunks.push(chunk.value);
}
await mkdir(modelDirectory, { recursive: true });
await writeFile(resolve(modelDirectory, 'eng.traineddata'), Buffer.concat(chunks));
process.stdout.write('English OCR model downloaded. Set OCR_ENABLED=true and OCR_LANG_PATH=models in .env.local, then restart MedLens.\n');
