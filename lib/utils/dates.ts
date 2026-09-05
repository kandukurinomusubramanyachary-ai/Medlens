export interface ParsedDate { date: string | null; ambiguous: boolean }
function checkedDate(year: number, month: number, day: number, now: Date): ParsedDate {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = year >= 1900 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date.getTime() <= now.getTime();
  return { date: valid ? date.toISOString().slice(0, 10) : null, ambiguous: !valid };
}
/** Never resolves a day/month ambiguity by assuming the user's locale. */
export function parseSourceDate(text: string, now = new Date()): ParsedDate {
  const labelled = [...text.matchAll(/(?:report(?:ed)?\s*date|date\s*of\s*(?:report|collection)|collected(?:\s*on)?|collection\s*date|dated?|date\s*:)\s*[:\-]?\s*([^\n\r]{5,45})/gi)].map((match) => match[1]);
  const candidates = labelled.length ? labelled : [text];
  const dates = new Set<string>();
  let ambiguous = false;
  for (const candidate of candidates) {
    const iso = candidate.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
    const named = candidate.match(/\b(\d{1,2})\s*[- ]\s*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*[- ,]\s*(\d{4})\b/i);
    const reversed = candidate.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i);
    const numeric = candidate.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/);
    let parsed: ParsedDate | null = null;
    if (iso) parsed = checkedDate(+iso[1], +iso[2], +iso[3], now);
    else if (named || reversed) {
      const match = named ?? reversed!;
      const monthName = named ? match[2] : match[1];
      const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(monthName.slice(0, 3).toLowerCase()) + 1;
      parsed = checkedDate(+match[3], month, +(named ? match[1] : match[2]), now);
    } else if (numeric) {
      const a = +numeric[1], b = +numeric[2];
      if (a <= 12 && b <= 12 && a !== b) parsed = { date: null, ambiguous: true };
      else parsed = checkedDate(+numeric[3], a > 12 ? b : a, a > 12 ? a : b, now);
    }
    if (parsed?.date) dates.add(parsed.date);
    if (parsed?.ambiguous) ambiguous = true;
  }
  return { date: dates.size === 1 && !ambiguous ? [...dates][0] : null, ambiguous: ambiguous || dates.size !== 1 };
}
