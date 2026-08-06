// Sales Ledger — product classification.
//
// The `product` column is free text ("ATT Fiber 1 GIG", "DISH", "Dish Top 200
// Plus", "DirecTv Stream Choice", "Frontier 1Gig"). To let the sheet be
// filtered and summed by product FAMILY, each free-text value is mapped to a
// provider/brand CATEGORY by keyword. First category whose any keyword is a
// case-insensitive substring wins (so ORDER matters — put the more specific
// brand first, e.g. DirecTV before AT&T so "DirecTv" isn't caught by "att").
// Anything unmatched (or blank) → "other".
export type ProductCategory = { key: string; label: string; keywords: string[] };

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  { key: "dish", label: "Dish", keywords: ["dish"] },
  { key: "directv", label: "DirecTV", keywords: ["directv", "direct tv", "direc tv", "direc"] },
  { key: "att", label: "AT&T", keywords: ["at&t", "at & t", "att"] },
  { key: "frontier", label: "Frontier", keywords: ["frontier"] },
  { key: "xfinity", label: "Xfinity", keywords: ["xfinity", "comcast"] },
  { key: "optimum", label: "Optimum", keywords: ["optimum", "altice"] },
  { key: "spectrum", label: "Spectrum", keywords: ["spectrum", "charter"] },
  { key: "cox", label: "Cox", keywords: ["cox"] },
  { key: "verizon", label: "Verizon", keywords: ["verizon", "fios"] },
  { key: "tmobile", label: "T-Mobile", keywords: ["t-mobile", "tmobile", "t mobile"] },
  { key: "windstream", label: "Windstream", keywords: ["windstream", "kinetic"] },
  { key: "centurylink", label: "CenturyLink", keywords: ["centurylink", "century link", "brightspeed", "quantum"] },
  { key: "viasat", label: "Viasat", keywords: ["viasat"] },
  { key: "hughesnet", label: "HughesNet", keywords: ["hughes"] },
  { key: "earthlink", label: "EarthLink", keywords: ["earthlink"] },
  { key: "metronet", label: "Metronet", keywords: ["metronet"] },
];

export const OTHER_CATEGORY = { key: "other", label: "Other" } as const;

// The category key for a free-text product value.
export function classifyProduct(product: string | null | undefined): string {
  const p = (product || "").toLowerCase();
  if (!p.trim()) return OTHER_CATEGORY.key;
  for (const c of PRODUCT_CATEGORIES) {
    if (c.keywords.some((k) => p.includes(k))) return c.key;
  }
  return OTHER_CATEGORY.key;
}

export function productCategoryLabel(key: string): string {
  if (key === OTHER_CATEGORY.key) return OTHER_CATEGORY.label;
  return PRODUCT_CATEGORIES.find((c) => c.key === key)?.label ?? OTHER_CATEGORY.label;
}
