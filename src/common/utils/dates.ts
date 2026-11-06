export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60000);
export const addHours = (d: Date, h: number) => addMinutes(d, h * 60);
export const addDays = (d: Date, n: number) => addMinutes(d, n * 1440);
export const ymd = (d: Date = new Date()) => d.toISOString().slice(0, 10);
export const period = (d: Date = new Date()) => d.toISOString().slice(0, 7);
export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const hhmmOf = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
export const weekdayOf = (dateStr: string) => ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(`${dateStr}T00:00:00.000Z`).getUTCDay()];
export const endOfDay = (s: string) => (s.length <= 10 ? new Date(`${s}T23:59:59.999Z`) : new Date(s));
