/**
 * Minimal RFC-4180 CSV parser — no dependencies.
 *
 * Handles quoted fields, embedded commas, embedded newlines (LF and CRLF),
 * and doubled quotes ("" → "). Lenient where the RFC is strict: a quote in
 * the middle of an unquoted field is treated as a literal character, and an
 * unterminated quoted field runs to end of input.
 */

/** Parse CSV text into rows of fields. A trailing newline does not produce an
 *  empty final row. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let fieldStarted = false;
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      i++;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      fieldStarted = false;
      i++;
      continue;
    }

    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fieldStarted = false;
      i++;
      continue;
    }

    field += ch;
    fieldStarted = true;
    i++;
  }

  // Final record when input does not end with a newline
  if (fieldStarted || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Parse CSV text using the header row as the source of truth: each record is
 *  keyed by column name, so callers locate columns by name, not position.
 *  Blank lines are skipped; short rows fill missing columns with "". */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0];
  const records: Array<Record<string, string>> = [];
  for (const row of rows.slice(1)) {
    if (row.length === 1 && row[0] === "") continue; // blank line
    const record: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      record[header[c]] = row[c] ?? "";
    }
    records.push(record);
  }
  return records;
}
