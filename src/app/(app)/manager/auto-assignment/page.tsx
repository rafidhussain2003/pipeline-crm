"use client";

import AgentTierAssignments from "@/components/team/AgentTierAssignments";

// Manager Console — Auto Assignment. Operational controls only: the agent
// roster with live online status + today's workload, tier assignment, and
// per-agent auto-assignment participation. The Lead Distribution Manager
// canNOT touch the assignment algorithm, automation rules, routing logic or
// company-wide automation settings — those stay on the admin-only Automation
// settings page. AgentTierAssignments enforces edit rights via the tier API
// (admins + this role), and every mutation is re-checked on the server.
export default function ManagerAutoAssignmentPage() {
  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Auto Assignment</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Manage your agents&apos; tiers and who takes part in automatic assignment. Higher tiers receive proportionally
          more leads; pausing an agent keeps leads from routing to them automatically until you resume.
        </p>
      </div>
      <AgentTierAssignments />
    </div>
  );
}
