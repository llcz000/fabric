const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(cookie\s*:\s*)[^;\r\n]*/gi, '$1[redacted]'],
  [/(set-cookie\s*:\s*)[^;\r\n]*/gi, '$1[redacted]'],
  [/((?:secret[_-]?(?:key|id)?|password|token)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]'],
  [/(bearer\s+)[^\s,;]+/gi, '$1[redacted]'],
  [/(authorization\s*:\s*)[^\s,;]+/gi, '$1[redacted]'],
  [/(sign(?:ature)?\s*=\s*)[^\s&,;]+/gi, '$1[redacted]'],
];

const SECRET_FIELD_NAMES = new Set([
  'authorization',
  'authorisation',
  'cookie',
  'set-cookie',
  'setcookie',
  'password',
  'secret',
  'secretkey',
  'secretid',
  'secret_key',
  'secret_id',
  'token',
  'bearer',
  'sign',
  'signature',
  'x-amz-signature',
  'credentials',
  'apikey',
  'api_key',
  'accesskey',
  'access_key',
  'x-amz-security-token',
]);

export function redactLogText(text: string): string {
  let redacted = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export function safeLogLine(entry: Record<string, unknown>): string {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (SECRET_FIELD_NAMES.has(key.toLowerCase())) continue;
    sanitized[key] = typeof value === 'string' ? redactLogText(value) : value;
  }
  return JSON.stringify(sanitized);
}
