export function formatDate(value: string | null, short = false): string {
  if (!value) return 'Date not stated';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date needs review';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}
export function initials(name: string): string { return name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
export function formatBytes(bytes: number): string { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
