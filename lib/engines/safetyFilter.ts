const forbidden: readonly RegExp[] = [
  /\byou (?:have|are suffering from)\b/i,
  /\bthis (?:means you have|confirms|rules out)\b/i,
  /\byou should (?:take|start|stop|increase|decrease)\b/i,
  /(?:^|[.!?]\s+)(?:please\s+)?(?:start|stop|increase|decrease)\s+[^.!?\n]+/im,
  /\bdiagnosis\s*:/i,
  /\b(?:disease detected|dangerous|critical illness|life[- ]threatening)\b/i,
  /\b(?:risk|wellness|health) score\s*(?:is|of|:)?\s*\d/i,
  /\b(?:normal|abnormal)\b/i,
  /\b(?:ignore (?:all |the )?(?:previous|prior) instructions|you are now|system\s*:|assistant\s*:)/i,
  /<\|(?:system|assistant|im_start|im_end)[^>]*\|>/i,
  /\b(?:worsening|improving|concerning)\b/i,
];

export interface SafetyResult { safe: boolean; violations: string[] }

export function checkSafety(text: string): SafetyResult {
  const violations = forbidden.flatMap((pattern) => {
    const match = text.match(pattern);
    return match ? [match[0]] : [];
  });
  return { safe: violations.length === 0, violations: [...new Set(violations)] };
}

export const safetyFilter = checkSafety;

export function safeGeneratedText(text: string): string | null {
  return checkSafety(text).safe ? text : null;
}
