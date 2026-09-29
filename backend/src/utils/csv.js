const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * RFC 4180 CSV escaping with spreadsheet formula-injection mitigation.
 * Plain numbers (including negatives such as -5) are left untouched so they stay numeric.
 */
export function csvEscape(value) {
  let text = value == null ? '' : String(value);
  if (FORMULA_PREFIX.test(text) && !PLAIN_NUMBER.test(text)) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvRow(cells) {
  return cells.map(csvEscape).join(',');
}
