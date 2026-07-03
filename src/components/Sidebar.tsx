"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const navItems = [
  { href: "/leads", label: "All Leads" },
  { href: "/settings/connector", label: "Connect Facebook" },
  { href: "/settings/agents", label: "Agents & Tiers" },
  { href: "/settings/pipeline", label: "Pipeline Settings" },
  { href: "/settings/automation", label: "Automation" },
  { href: "/settings/audit-log", label: "Audit Log" },
];

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
      <div className="px-3 py-4 border-t border-slate-100">
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
