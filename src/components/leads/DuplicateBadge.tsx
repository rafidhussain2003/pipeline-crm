// The badge shown next to a lead that matched an existing lead's phone/email
// (leads.isDuplicate). What it SAYS depends on who is looking:
//
//   - admin  → "POSSIBLE DUPLICATE" (amber) — the admin needs the truth to
//              merge/clean up.
//   - anyone else (agents, managers, distributors…) → "HOT LEAD" (green) — a
//              customer who fills the form a second time usually converts, so
//              agents should treat it as a warm opportunity, not a dupe to skip.
//
// One component so the list, the Lead Workspace and the Manager Console never
// drift apart on this rule.
export function DuplicateBadge({ role, className = "" }: { role: string | null | undefined; className?: string }) {
  const isAdmin = role === "admin";
  return (
    <span
      title={isAdmin ? "Phone or email matches another lead in your company" : "Returning customer — filled a form more than once"}
      className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${
        isAdmin ? "text-amber-700 bg-amber-50" : "text-emerald-700 bg-emerald-50"
      } ${className}`}
    >
      {isAdmin ? "POSSIBLE DUPLICATE" : "HOT LEAD"}
    </span>
  );
}
