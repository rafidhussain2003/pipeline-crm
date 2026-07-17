"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import PresenceHeartbeat from "./PresenceHeartbeat";

// Phase 18: items tagged with a `feature` render only when the company's
// feature profile has that module enabled (see lib/features). Untagged items
// are core CRM. The server layout resolves the profile once and passes it in
// — a disabled module's navigation simply doesn't exist for that company.
const navItems: { href: string; label: string; feature?: string }[] = [
  { href: "/leads", label: "All Leads" },
  // Callbacks (Phase 15) is every role's tool — an agent works their own list,
  // a manager/admin sees the whole company's. Scope is decided server-side, so
  // this needs no role gate.
  { href: "/callbacks", label: "Callbacks", feature: "callback_engine" },
  { href: "/settings/connector", label: "Lead Sources", feature: "meta_integration" },
  { href: "/settings/delivery-log", label: "Delivery Log" },
  { href: "/settings/pipeline", label: "Pipeline Settings" },
  { href: "/settings/automation", label: "Automation", feature: "ai_assignment" },
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

// Website Forms (Phase 8) exposes the site's public/secret keys, the embed
// snippet, allowed domains, and the hosted-form builder — all admin-only, so
// it's gated like Agents rather than shown in the shared navItems list.
const WEBSITE_FORMS_NAV_ITEM = { href: "/settings/website-forms", label: "Website Forms" };

// Meta Conversions API (Phase 11) — pixel selection, event mapping, delivery
// log, diagnostics. Admin + manager only (agents cannot configure it).
const CONVERSIONS_NAV_ITEM = { href: "/settings/conversions", label: "Conversions API" };

export default function Sidebar({
  companyName,
  role,
  features,
}: {
  companyName: string;
  role: string;
  // Enabled-module map from the server layout; null = no company context
  // (super_admin), which shows everything — the owner is never feature-gated.
  features?: Record<string, boolean> | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const has = (feature?: string) => !feature || !features || features[feature] === true;

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
        {(role === "admin" || role === "manager") && has("operations_center") && (
          <Link
            href="/operations"
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              pathname === "/operations" ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            Operations
          </Link>
        )}
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
        {role === "admin" && has("website_forms") && (
          <Link
            href={WEBSITE_FORMS_NAV_ITEM.href}
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              pathname === WEBSITE_FORMS_NAV_ITEM.href ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            {WEBSITE_FORMS_NAV_ITEM.label}
          </Link>
        )}
        {(role === "admin" || role === "manager") && has("meta_integration") && (
          <Link
            href={CONVERSIONS_NAV_ITEM.href}
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              pathname === CONVERSIONS_NAV_ITEM.href ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            {CONVERSIONS_NAV_ITEM.label}
          </Link>
        )}
        {navItems.filter((item) => has(item.feature)).map((item) => {
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
          <>
            <Link
              href="/super-admin"
              className={`block px-3 py-2 rounded-md text-sm font-medium mt-4 border-t border-slate-100 pt-4 ${
                pathname === "/super-admin" ? "bg-purple-50 text-purple-700" : "text-purple-700 hover:bg-purple-50"
              }`}
            >
              Super Admin
            </Link>
            <Link
              href="/super-admin/feature-management"
              className={`block px-3 py-2 rounded-md text-sm font-medium ${
                pathname.startsWith("/super-admin/feature-management") ? "bg-purple-50 text-purple-700" : "text-purple-700 hover:bg-purple-50"
              }`}
            >
              Feature Management
            </Link>
            <Link
              href="/super-admin/mailbox"
              className={`block px-3 py-2 rounded-md text-sm font-medium ${
                pathname.startsWith("/super-admin/mailbox") ? "bg-purple-50 text-purple-700" : "text-purple-700 hover:bg-purple-50"
              }`}
            >
              Mailbox
            </Link>
            <Link
              href="/super-admin/diagnostics"
              className={`block px-3 py-2 rounded-md text-sm font-medium ${
                pathname.startsWith("/super-admin/diagnostics") ? "bg-purple-50 text-purple-700" : "text-purple-700 hover:bg-purple-50"
              }`}
            >
              Diagnostics
            </Link>
          </>
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
