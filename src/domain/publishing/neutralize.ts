export function neutralizeCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
