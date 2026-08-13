function toDateKey(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

export function buildDailyTrend(rows, days = 30) {
  const map = new Map(
    rows.map((row) => [toDateKey(row.date), Number(row.count) || 0])
  );

  const result = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    result.push({ date: key, count: map.get(key) || 0 });
  }

  return result;
}

export function formatShortDate(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
