const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * RFC 4180 CSV escaping with spreadsheet formula-injection mitigation.
 */
export function csvEscape(value) {
  let text = value == null ? '' : String(value);
  if (FORMULA_PREFIX.test(text)) {
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
