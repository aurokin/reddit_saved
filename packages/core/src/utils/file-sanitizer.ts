/** Characters not allowed in filenames across Windows/macOS/Linux */
const UNSAFE_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
/** Leading/trailing dots and spaces cause issues on some platforms */
const TRIM_PATTERN = /^[\s.]+|[\s.]+$/g;
/** Windows reserved device names (case-insensitive, with or without extension) */
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

/** Sanitize a string for use as a filename. Enforces byte-length limit for filesystem safety. */
export function sanitizeFilename(name: string, maxBytes = 200): string {
  let safe = name
    .replace(UNSAFE_CHARS, "_")
    .replace(TRIM_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();

  safe = truncateToByteLength(safe, maxBytes).replace(TRIM_PATTERN, "");

  // Prefix Windows reserved device names to avoid I/O issues
  if (WINDOWS_RESERVED.test(safe)) safe = `_${safe}`;

  return safe || "untitled";
}

/** Truncate a string to fit within maxBytes when UTF-8 encoded.
 * Back-scans from the cut point to find a clean UTF-8 code point boundary. */
function truncateToByteLength(str: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  if (bytes.length <= maxBytes) return str;

  // Walk back from the cut to skip any UTF-8 continuation bytes (0x80–0xBF)
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;

  return new TextDecoder().decode(bytes.slice(0, end)).trim();
}
