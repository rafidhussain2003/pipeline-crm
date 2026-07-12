"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import PresenceHeartbeat from "./PresenceHeartbeat";

const navItems = [
  { href: "/leads", label: "All Leads" },
  { href: "/settings/connector", label: "Lead Sources" },
  { href: "/settings/delivery-log", label: "Delivery Log" },
  { href: "/settings/pipeline", label: "Pipeline Settings" },
  { href: "/settings/automation", label: "Automation" },
  { href: "/settings/audit-log", label: "Audit Log" },
];

// Team dashboard is a supervisor tool (force assign/recycle, lock agents,
// live queue) — shown only to admins, following the same role-gating
// pattern already used below for the Super Admin link, rather than
// showing every agent a page whose actions they have no permission to use.
const SUPERVISOR_NAV_ITEM = { href: "/team", label: "Team" };

// Agents management requires "agents:manage" (admin or manager) — gated
// the same way as the Team/Super Admin links rather than added to the
// shared navItems list, which every role sees.
const AGENTS_NAV_ITEM = { href: "/settings/agents", label: "Agents" };

export default function Sidebar({ companyName, role }: { companyName: string; role: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-60 shrink-0 border-r border-slate-200 bg-white flex flex-col h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-slate-100">
        <div className="text-lg font-semibold text-slate-900 tracking-tight">Pipeline</div>
        <div className="text-xs text-slate-500 mt-0.5 truncate">{companyName}</div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {role === "admin" && (
          <Link
            href={SUPERVISOR_NAV_ITEM.href}
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              pathname === SUPERVISOR_NAV_ITEM.href ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            {SUPERVISOR_NAV_ITEM.label}
          </Link>
        )}
        {(role === "admin" || role === "manager") && (
          <Link
            href={AGENTS_NAV_ITEM.href}
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              pathname === AGENTS_NAV_ITEM.href ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            {AGENTS_NAV_ITEM.label}
          </Link>
        )}
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        {role === "super_admin" && (
          <Link
            href="/super-admin"
            className="block px-3 py-2 rounded-md text-sm font-medium text-purple-700 hover:bg-purple-50 mt-4 border-t border-slate-100 pt-4"
          >
            Super Admin
          </Link>
        )}
      </nav>
      {role !== "super_admin" && <PresenceHeartbeat />}
      <div className="px-3 py-4 border-t border-slate-100 space-y-1">
        {role !== "super_admin" && (
          <Link
            href="/subscription"
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              pathname === "/subscription" ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            Subscription
          </Link>
        )}
        <Link
          href="/profile"
          className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            pathname === "/profile" ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          Profile
        </Link>
        <button
          onClick={logout}
          className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
