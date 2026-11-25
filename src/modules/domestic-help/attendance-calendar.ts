import { addDays, ymd } from '../../common/utils/dates';

const defaultTimezone = 'Asia/Kolkata';

export function attendanceClock(configuredTimezone?: string) {
  const formatIn = (timeZone: string) => new Intl.DateTimeFormat('en-CA', {
    timeZone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  let timezone = configuredTimezone || defaultTimezone;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = formatIn(timezone);
  } catch {
    timezone = defaultTimezone;
    formatter = formatIn(timezone);
  }
  return {
    timezone,
    dateOf: (instant: Date) => {
      const parts = formatter.formatToParts(instant);
      const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)!.value;
      return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
    },
  };
}

export const shiftDate = (date: string, days: number) => ymd(addDays(new Date(date), days));

export function monthContaining(date: string) {
  const from = `${date.slice(0, 7)}-01`;
  const last = new Date(from);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return { from, to: ymd(last) };
}

// Legacy documents use UTC date keys, which can differ by one day from a gate timestamp's local date.
export const attendanceDateFilter = (from: string, to = from) => ({
  $gte: from === '0000-01-01' ? from : shiftDate(from, -1),
  $lte: to === '9999-12-31' ? to : shiftDate(to, 1),
});

export interface GateEntry {
  _id?: unknown;
  checkInAt?: Date;
  checkOutAt?: Date;
}

export function firstCheckIns(entries: GateEntry[], dateOf: (at: Date) => string, since?: Date) {
  const firstByDate = new Map<string, Date>();
  for (const { checkInAt } of entries) {
    if (!checkInAt || (since && checkInAt < since)) continue;
    const date = dateOf(checkInAt);
    const first = firstByDate.get(date);
    if (!first || checkInAt < first) firstByDate.set(date, checkInAt);
  }
  return firstByDate;
}

export function calendarDays(from: string, to: string, today: string, assignedFrom: string, firstByDate: Map<string, Date>) {
  const days = [];
  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    const first = firstByDate.get(date);
    if (date < assignedFrom || date > today) days.push({ date, status: 'NOT_APPLICABLE' as const });
    else if (first) days.push({ date, status: 'PRESENT' as const, firstCheckInAt: first.toISOString() });
    else days.push({ date, status: date === today ? 'PENDING' as const : 'ABSENT' as const });
    if (date === to) break;
  }
  return days;
}
