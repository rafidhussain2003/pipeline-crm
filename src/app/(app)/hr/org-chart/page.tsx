"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/hr/shared";

type Node = { employeeId: string; userId: string; name: string; employeeCode: string; designation: string | null; reports: Node[] };

export default function OrgChartPage() {
  const [roots, setRoots] = useState<Node[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch("/api/hr/org-chart").then(async (r) => { if (r.ok) setRoots((await r.json()).roots || []); setLoaded(true); });
  }, []);

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader title="Organization Chart" subtitle="The reporting hierarchy, built from each employee's manager." />
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        {roots.map((n) => <TreeNode key={n.employeeId} node={n} depth={0} />)}
        {loaded && roots.length === 0 && <p className="text-sm text-slate-400">No employees to chart yet.</p>}
      </div>
    </div>
  );
}

function TreeNode({ node, depth }: { node: Node; depth: number }) {
  return (
    <div style={{ marginLeft: depth * 20 }} className={depth > 0 ? "border-l border-slate-200 pl-4 mt-1" : "mt-1"}>
      <div className="flex items-center gap-2 py-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
        <span className="text-sm font-medium text-slate-900">{node.name}</span>
        <span className="text-xs text-slate-400">{node.designation || node.employeeCode}</span>
        {node.reports.length > 0 && <span className="text-[10px] text-slate-400">· {node.reports.length} report(s)</span>}
      </div>
      {node.reports.map((c) => <TreeNode key={c.employeeId} node={c} depth={depth + 1} />)}
    </div>
  );
}
