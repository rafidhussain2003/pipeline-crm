"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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

// Workflow Automation module navigation (Phase 23). The whole module is an
// admin/manager tool (agents have no workflow permission), so — like Finance —
// the group is gated by role + feature and every item is visible to both.
const AUTOMATION_ITEMS: { href: string; label: string }[] = [
  { href: "/automation", label: "Dashboard" },
  { href: "/automation/workflows", label: "Workflows" },
  { href: "/automation/triggers", label: "Triggers" },
  { href: "/automation/actions", label: "Actions" },
  { href: "/automation/executions", label: "Execution History" },
  { href: "/automation/variables", label: "Variables" },
  { href: "/automation/templates", label: "Templates" },
  { href: "/automation/reports", label: "Reports" },
  { href: "/automation/settings", label: "Settings" },
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
//
// Order here is the order on screen, and it is deliberate: All Leads first
// because it is far and away the most-visited page. Website Forms and
// Conversions API used to be standalone links rendered above this list, which
// is why All Leads sat sixth; they are folded in as data so one array is the
// single source of truth for CRM nav order.
// Agent Portal: an agent's CRM navigation is exactly All Leads, Callbacks
// (both roleless below) and Profile (bottom section) — every settings/ops
// entry carries a roles gate that excludes "agent". Hiding is presentation
// only; the proxy redirects agents off these PAGES and the APIs enforce
// their own permissions, so a typed URL gets the same answer.
const navItems: { href: string; label: string; feature?: string; roles?: string[] }[] = [
  { href: "/leads", label: "All Leads" },
  // My Tasks (Follow-up & Pipeline) — every role's daily queue, agents
  // included; scope is decided server-side (personal for everyone, plus the
  // pipeline overview for supervisors).
  { href: "/tasks", label: "My Tasks" },
  // Callbacks (Phase 15) is every role's tool — an agent works their own list,
  // a manager/admin sees the whole company's. Scope is decided server-side, so
  // this needs no role gate.
  { href: "/callbacks", label: "Callbacks", feature: "callback_engine" },
  { href: "/settings/connector", label: "Lead Sources", feature: "meta_integration", roles: ["admin", "manager"] },
  { href: "/settings/website-forms", label: "Website Forms", feature: "website_forms", roles: ["admin"] },
  { href: "/settings/conversions", label: "Conversions API", feature: "meta_integration", roles: ["admin", "manager"] },
  { href: "/settings/delivery-log", label: "Delivery Log", roles: ["admin", "manager"] },
  { href: "/settings/pipeline", label: "Pipeline Settings", roles: ["admin", "manager"] },
  { href: "/settings/automation", label: "Automation", feature: "ai_assignment", roles: ["admin", "manager"] },
  { href: "/settings/audit-log", label: "Audit Log", roles: ["admin"] },
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

// Website Forms (admin-only) and Meta Conversions API (admin + manager) now
// live in navItems above, carrying their own `roles` gate, so CRM nav order is
// defined in exactly one place.

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

  // Mobile navigation. The sidebar is a fixed 240px column, which on a 375px
  // screen left ~135px for the entire app and pushed the content off-screen
  // horizontally. Below `lg` it now slides in as an overlay drawer instead —
  // same navigation, same items, only its presentation changes.
  const [mobileOpen, setMobileOpen] = useState(false);
  // Navigating must dismiss the drawer, or the destination opens behind it.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Escape closes the drawer, and the page behind it must not scroll while it
  // is open — without the lock, dragging the drawer scrolls the leads table
  // underneath and the user loses their place.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Rotating to landscape or widening the window past `lg` turns the drawer
    // back into the ordinary docked sidebar. Without this the drawer state
    // stayed "open" on desktop, leaving the backdrop over the UI and the page
    // permanently unscrollable. 64rem is Tailwind's `lg`.
    //
    // Driven off `resize`/`orientationchange` rather than the media query's
    // own `change` event: that event does not fire reliably for every kind of
    // viewport change (it never fired for the resizes used to test this), so
    // the query is polled on a signal that does.
    const wide = window.matchMedia("(min-width: 64rem)");
    const onViewportChange = () => { if (wide.matches) setMobileOpen(false); };
    onViewportChange();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);
  const inAutomation = pathname === "/automation" || pathname.startsWith("/automation/");
  const [automationOpen, setAutomationOpen] = useState(inAutomation);
  // Workflow Automation is an admin/manager tool (agents hold no workflow
  // permission), gated on role + the feature grant like Finance.
  const showAutomation = (role === "admin" || role === "manager") && !!features && features.workflow === true;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* Mobile top bar — the only way to reach navigation below `lg`. */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-30 h-14 bg-white border-b border-slate-200 flex items-center gap-3 px-4">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={mobileOpen}
          className="text-slate-700 rounded-md p-2 -ml-2 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <span aria-hidden="true" className="block text-lg leading-none">☰</span>
        </button>
        <span className="text-sm font-semibold text-slate-900 truncate">{companyName}</span>
      </div>

      {/* Backdrop — tapping outside closes the drawer. */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-slate-900/40" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}

      {/* Visibility is toggled with `display`, not a translate transform. The
          transform approach did not survive React's class swap here — the
          element kept its -100% translate and the drawer never appeared —
          whereas display is unambiguous and cannot get stuck mid-transition.
          `max-lg:hidden` (not `hidden` + `lg:flex`) because a bare `hidden`
          wins over `lg:flex` and would blank the sidebar on desktop. */}
      <aside
        // Any link tap dismisses the drawer. The pathname effect alone is not
        // enough: tapping the entry for the page you are already on does not
        // change the route, so the drawer would stay open over the content
        // with the page scroll still locked.
        onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setMobileOpen(false); }}
        className={`w-60 shrink-0 border-r border-slate-200 bg-white flex flex-col h-screen z-50 fixed inset-y-0 left-0 lg:sticky lg:top-0 ${
          mobileOpen ? "" : "max-lg:hidden"
        }`}
      >
      <div className="px-5 py-5 border-b border-slate-100 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-slate-900 tracking-tight">Pipeline</div>
          <div className="text-xs text-slate-500 mt-0.5 truncate">{companyName}</div>
        </div>
        <button
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation menu"
          className="lg:hidden text-slate-400 hover:text-slate-700 rounded-md p-1 -mr-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <span aria-hidden="true" className="block text-lg leading-none">×</span>
        </button>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems
          .filter((item) => has(item.feature) && (!item.roles || item.roles.includes(role)))
          .map((item) => {
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
        {showAttendance && (
          <div className="pt-1">
            <button
              onClick={() => setAttendanceOpen((v) => !v)}
              aria-expanded={attendanceOpen}
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
              aria-expanded={hrOpen}
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
              aria-expanded={payrollOpen}
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
              aria-expanded={financeOpen}
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
        {showAutomation && (
          <div className="pt-1">
            <button
              onClick={() => setAutomationOpen((v) => !v)}
              aria-expanded={automationOpen}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                inAutomation ? "text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <span>Automation</span>
              <span className="text-[10px] text-slate-400">{automationOpen ? "▾" : "▸"}</span>
            </button>
            {automationOpen && (
              <div className="mt-0.5 space-y-0.5">
                {AUTOMATION_ITEMS.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block pl-6 pr-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                        active ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
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
              href="/super-admin/companies"
              className={`block px-3 py-2 rounded-md text-sm font-medium ${
                pathname.startsWith("/super-admin/companies") ? "bg-purple-50 text-purple-700" : "text-purple-700 hover:bg-purple-50"
              }`}
            >
              Company Management
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
        {role !== "super_admin" && role !== "agent" && (
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
    </>
  );
}
