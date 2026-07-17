"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import PresenceHeartbeat from "./PresenceHeartbeat";

// Finance module navigation (Phase 19) — rendered only when the company's
// feature profile has "finance" AND the role can at least view it. A single
// collapsible group so ten entries don't drown the core CRM nav.
// HR module navigation (Phase 22). `managerOnly` items are hidden from
// employees — an employee's HR world is only their own profile.
const HR_ITEMS: { href: string; label: string; managerOnly?: boolean }[] = [
  { href: "/hr", label: "Dashboard", managerOnly: true },
  { href: "/hr/employees", label: "Employees", managerOnly: true },
  { href: "/hr/me", label: "My Profile" },
  { href: "/hr/departments", label: "Departments", managerOnly: true },
  { href: "/hr/designations", label: "Designations", managerOnly: true },
  { href: "/hr/employment-types", label: "Employment Types", managerOnly: true },
  { href: "/hr/documents", label: "Documents", managerOnly: true },
  { href: "/hr/org-chart", label: "Organization Chart", managerOnly: true },
  { href: "/hr/reports", label: "Reports", managerOnly: true },
  { href: "/hr/settings", label: "Settings", managerOnly: true },
];

// Payroll module navigation (Phase 21). `managerOnly` items are hidden from
// employees — an employee's payroll world is only their own payslips.
const PAYROLL_ITEMS: { href: string; label: string; managerOnly?: boolean }[] = [
  { href: "/payroll", label: "Dashboard", managerOnly: true },
  { href: "/payroll/employees", label: "Employees", managerOnly: true },
  { href: "/payroll/structures", label: "Salary Structures", managerOnly: true },
  { href: "/payroll/runs", label: "Payroll Runs", managerOnly: true },
  { href: "/payroll/payslips", label: "Payslips" },
  { href: "/payroll/incentives", label: "Incentives", managerOnly: true },
  { href: "/payroll/deductions", label: "Deductions", managerOnly: true },
  { href: "/payroll/overtime", label: "Overtime", managerOnly: true },
  { href: "/payroll/registers", label: "Salary Registers", managerOnly: true },
  { href: "/payroll/reports", label: "Reports", managerOnly: true },
  { href: "/payroll/settings", label: "Settings", managerOnly: true },
];

// Attendance module navigation (Phase 20). `managerOnly` items are hidden
// from agents — an agent's attendance world is Today, Leave and Holidays.
const ATTENDANCE_ITEMS: { href: string; label: string; managerOnly?: boolean }[] = [
  { href: "/attendance", label: "Dashboard", managerOnly: true },
  { href: "/attendance/today", label: "Today" },
  { href: "/attendance/employees", label: "Employees", managerOnly: true },
  { href: "/attendance/shifts", label: "Shifts", managerOnly: true },
  { href: "/attendance/logs", label: "Attendance Logs", managerOnly: true },
  { href: "/attendance/leave", label: "Leave Management" },
  { href: "/attendance/holidays", label: "Holidays" },
  { href: "/attendance/reports", label: "Reports", managerOnly: true },
  { href: "/attendance/settings", label: "Settings", managerOnly: true },
];

const FINANCE_ITEMS: { href: string; label: string }[] = [
  { href: "/finance", label: "Dashboard" },
  { href: "/finance/accounts", label: "Chart of Accounts" },
  { href: "/finance/revenue", label: "Revenue" },
  { href: "/finance/expenses", label: "Expenses" },
  { href: "/finance/journal", label: "Journal Entries" },
  { href: "/finance/ledger", label: "General Ledger" },
  { href: "/finance/cash", label: "Cash Accounts" },
  { href: "/finance/banks", label: "Bank Accounts" },
  { href: "/finance/years", label: "Financial Year" },
  { href: "/finance/settings", label: "Settings" },
];

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
  const inFinance = pathname === "/finance" || pathname.startsWith("/finance/");
  const [financeOpen, setFinanceOpen] = useState(inFinance);
  const inAttendance = pathname === "/attendance" || pathname.startsWith("/attendance/");
  const [attendanceOpen, setAttendanceOpen] = useState(inAttendance);
  // Attendance is for the whole company (agents check in too) — feature-gated
  // only; the item list narrows by role below.
  const showAttendance = !!features && features.attendance === true;
  const attendanceManager = role === "admin" || role === "manager";
  const inPayroll = pathname === "/payroll" || pathname.startsWith("/payroll/");
  const [payrollOpen, setPayrollOpen] = useState(inPayroll);
  // Payroll is company-wide too (every employee sees their payslips); the item
  // list narrows to Payslips-only for agents.
  const showPayroll = !!features && features.payroll === true;
  const payrollManager = role === "admin" || role === "manager";
  const inHr = pathname === "/hr" || pathname.startsWith("/hr/");
  const [hrOpen, setHrOpen] = useState(inHr);
  // HR is company-wide (every employee sees their own profile); the item list
  // narrows to My Profile only for agents.
  const showHr = !!features && features.hr === true;
  const hrManager = role === "admin" || role === "manager";
  // Finance is visible to roles with finance:view (admin + manager today) —
  // agents never see the module. super_admin (features = null) has no company
  // books, so the group requires an actual feature grant.
  const showFinance = (role === "admin" || role === "manager") && !!features && features.finance === true;

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
        {showAttendance && (
          <div className="pt-1">
            <button
              onClick={() => setAttendanceOpen((v) => !v)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                inAttendance ? "text-sky-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <span>Attendance</span>
              <span className="text-[10px] text-slate-400">{attendanceOpen ? "▾" : "▸"}</span>
            </button>
            {attendanceOpen && (
              <div className="mt-0.5 space-y-0.5">
                {ATTENDANCE_ITEMS.filter((item) => attendanceManager || !item.managerOnly).map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block pl-6 pr-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                        active ? "bg-sky-50 text-sky-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {showHr && (
          <div className="pt-1">
            <button
              onClick={() => setHrOpen((v) => !v)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                inHr ? "text-rose-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <span>HR</span>
              <span className="text-[10px] text-slate-400">{hrOpen ? "▾" : "▸"}</span>
            </button>
            {hrOpen && (
              <div className="mt-0.5 space-y-0.5">
                {HR_ITEMS.filter((item) => hrManager || !item.managerOnly).map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block pl-6 pr-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                        active ? "bg-rose-50 text-rose-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {showPayroll && (
          <div className="pt-1">
            <button
              onClick={() => setPayrollOpen((v) => !v)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                inPayroll ? "text-teal-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <span>Payroll</span>
              <span className="text-[10px] text-slate-400">{payrollOpen ? "▾" : "▸"}</span>
            </button>
            {payrollOpen && (
              <div className="mt-0.5 space-y-0.5">
                {PAYROLL_ITEMS.filter((item) => payrollManager || !item.managerOnly).map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block pl-6 pr-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                        active ? "bg-teal-50 text-teal-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {showFinance && (
          <div className="pt-1">
            <button
              onClick={() => setFinanceOpen((v) => !v)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                inFinance ? "text-emerald-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <span>Finance</span>
              <span className="text-[10px] text-slate-400">{financeOpen ? "▾" : "▸"}</span>
            </button>
            {financeOpen && (
              <div className="mt-0.5 space-y-0.5">
                {FINANCE_ITEMS.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block pl-6 pr-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                        active ? "bg-emerald-50 text-emerald-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
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
