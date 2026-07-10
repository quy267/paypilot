function escapeCsvField(value: string | number | null): string {
  if (value === null) return "";

  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Serialize a header row and data rows using RFC-4180 field escaping. */
export function toCsv(
  headers: string[],
  rows: (string | number | null)[][]
): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvField).join(","))
    .join("\r\n");
}
