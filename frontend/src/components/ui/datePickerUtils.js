import {
  DateFormatter,
  endOfMonth,
  endOfWeek,
  endOfYear,
  getLocalTimeZone,
  parseDate,
  startOfMonth,
  startOfWeek,
  startOfYear,
  today,
} from '@internationalized/date';

export const DATE_LOCALE = 'en-GB';

const displayFormatter = new DateFormatter(DATE_LOCALE, { day: '2-digit', month: 'short', year: 'numeric' });
const monthFormatter = new DateFormatter(DATE_LOCALE, { month: 'long', year: 'numeric' });

/** 'YYYY-MM-DD' (the format every date filter and API in the app uses) to a CalendarDate. */
export function toCalendarDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

export function toDateString(date) {
  return date ? date.toString() : '';
}

export function todayDate() {
  return today(getLocalTimeZone());
}

export function displayDate(value) {
  const date = typeof value === 'string' ? toCalendarDate(value) : value;
  return date ? displayFormatter.format(date.toDate(getLocalTimeZone())) : '';
}

export function monthTitle(date) {
  return monthFormatter.format(date.toDate(getLocalTimeZone()));
}

export function rangePresets() {
  const now = todayDate();
  const lastWeek = now.subtract({ weeks: 1 });
  const lastMonth = now.subtract({ months: 1 });
  const lastYear = now.subtract({ years: 1 });
  return [
    { label: 'Today', start: now, end: now },
    { label: 'Yesterday', start: now.subtract({ days: 1 }), end: now.subtract({ days: 1 }) },
    { label: 'This week', start: startOfWeek(now, DATE_LOCALE), end: now },
    { label: 'Last week', start: startOfWeek(lastWeek, DATE_LOCALE), end: endOfWeek(lastWeek, DATE_LOCALE) },
    { label: 'Last 30 days', start: now.subtract({ days: 30 }), end: now },
    { label: 'This month', start: startOfMonth(now), end: now },
    { label: 'Last month', start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) },
    { label: 'This year', start: startOfYear(now), end: now },
    { label: 'Last year', start: startOfYear(lastYear), end: endOfYear(lastYear) },
  ];
}
