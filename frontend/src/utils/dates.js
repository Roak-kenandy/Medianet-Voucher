export function formatDateInput(date) {
  return date.toISOString().slice(0, 10);
}

export function formatShortDate(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getDefaultReportDateRange(days = 30) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  return {
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
  };
}
