// The Ziplod brand mark — a geometric "Z" (two bars + a diagonal) on a dark
// rounded square. One source of truth for the logo, sized by className
// (e.g. "w-6 h-6"); the SVG carries its own corner rounding, so callers don't
// add rounded-*. Colors are fixed (the mark is always dark square / white Z,
// independent of theme). Matches src/app/icon.svg (favicon).
export function ZiplodMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={className} role="img" aria-label="Ziplod">
      <rect width="1024" height="1024" rx="232" fill="#0F172A" />
      <rect x="316" y="304" width="392" height="98" fill="#FFFFFF" />
      <rect x="316" y="622" width="392" height="98" fill="#FFFFFF" />
      <polygon points="708,402 558,402 316,622 466,622" fill="#FFFFFF" />
    </svg>
  );
}
