import type { DateRange, DateRangeKey } from "./types";

// NOTE on timezones: `leads.created_at` is stored as a timezone-naive
// Postgres `timestamp` (documented limitation, see the schema audit) and
// this resolves "today"/"this week" against the server process's local
// time (UTC on Render), not any individual company's timezone. For a
// single-region deployment this is consistent, just not per-tenant-precise
// — acceptable for a first analytics pass, worth revisiting if companies
// in very different timezones start comparing "today's leads" numbers.
export function resolveDateRange(range: DateRangeKey, fromParam?: string | null, toParam?: string | null): DateRange {
  const now = new Date();

  if (range === "custom") {
    if (!fromParam || !toParam) {
      throw new Error("Custom range requires both 'from' and 'to' query params (ISO date strings)");
    }
    const from = new Date(fromParam);
    const to = new Date(toParam);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new Error("'from' and 'to' must be valid ISO date strings");
    }
    if (from > to) {
      throw new Error("'from' must be before 'to'");
    }
    return { from, to };
  }

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (range) {
    case "today":
      return { from: startOfToday, to: now };
    case "yesterday": {
      const startOfYesterday = new Date(startOfToday);
      startOfYesterday.setDate(startOfYesterday.getDate() - 1);
      return { from: startOfYesterday, to: startOfToday };
    }
    case "week": {
      const startOfWeek = new Date(startOfToday);
      startOfWeek.setDate(startOfWeek.getDate() - 7);
      return { from: startOfWeek, to: now };
    }
    case "month": {
      const startOfMonth = new Date(startOfToday);
      startOfMonth.setDate(startOfMonth.getDate() - 30);
      return { from: startOfMonth, to: now };
    }
    default: {
      const exhaustiveCheck: never = range;
      throw new Error(`Unknown date range: ${exhaustiveCheck}`);
    }
  }
}

export function parseDateRangeKey(value: string | null): DateRangeKey {
  const valid: DateRangeKey[] = ["today", "yesterday", "week", "month", "custom"];
  if (value && (valid as string[]).includes(value)) return value as DateRangeKey;
  return "week"; // sensible default for a dashboard widget with no range selected yet
}
