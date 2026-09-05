export function parseModelJson(input: string): unknown {
  if (input.length > 250_000) return null;
  const stripped = input.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = stripped.indexOf('{'), end = stripped.lastIndexOf('}');
  const candidates = [stripped, start >= 0 && end > start ? stripped.slice(start, end + 1) : ''];
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* Try a narrowly scoped trailing-comma repair. */ }
    try { return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1')); } catch { /* Invalid data is rejected, never evaluated. */ }
  }
  return null;
}
