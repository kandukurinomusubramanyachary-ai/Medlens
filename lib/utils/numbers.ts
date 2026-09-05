/** Censored values (<, >) remain strings: a threshold is not an exact measurement. */
export function parseNumeric(value: string | null | undefined): number | null {
  if (!value) return null;
  let normalized = value.trim().replace(/\u2212/g, "-");
  if (/^[+-]?\d+,\d{1,2}$/.test(normalized)) normalized = normalized.replace(",", ".");
  else if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(normalized)) normalized = normalized.replaceAll(",", "");
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}
export function nearlyEqual(a: number, b: number): boolean { return Math.abs(a - b) < 1e-9; }
