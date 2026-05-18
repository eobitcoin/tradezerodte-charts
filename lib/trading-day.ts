import { formatInTimeZone } from "date-fns-tz";

const NY_TZ = "America/New_York";

export function nyTradingDay(date: Date = new Date()): string {
  return formatInTimeZone(date, NY_TZ, "yyyy-MM-dd");
}

export function nyMonthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export function todayMonth(): string {
  return formatInTimeZone(new Date(), NY_TZ, "yyyy-MM");
}
