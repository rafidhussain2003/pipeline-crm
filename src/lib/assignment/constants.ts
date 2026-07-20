// Dispositions that mean "this lead is done" — an agent's open workload
// shouldn't include leads they've already closed out, the recycle cron
// should never touch a closed lead, and the queue sweep should never re-queue
// one. The list itself now lives in the disposition taxonomy (won + lost
// labels, legacy included); re-exported from here so every part of the
// engine and its callers keep their existing import path.
export { TERMINAL_DISPOSITIONS } from "@/lib/dispositions/taxonomy";
