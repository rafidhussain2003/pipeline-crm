import { WON_DISPOSITION } from "@/lib/analytics/kpis";

// Dispositions that mean "this lead is done" — an agent's open workload
// shouldn't include leads they've already closed out, the recycle cron
// should never touch a closed lead, and the queue sweep should never re-queue
// one. Exported from here (rather than the old assignment.ts) so every part
// of the engine and its callers share exactly one definition of "closed".
export const TERMINAL_DISPOSITIONS = [WON_DISPOSITION, "Not Interested"];
