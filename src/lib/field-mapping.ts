export function resolvePath(obj: unknown, path: string): string | undefined {
  if (!path) return undefined;
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current == null ? undefined : String(current);
}

export type FieldMapping = { name?: string; phone?: string; email?: string };

export function mapPayloadToLead(payload: unknown, mapping: FieldMapping) {
  return {
    name: mapping.name ? resolvePath(payload, mapping.name) : undefined,
    phone: mapping.phone ? resolvePath(payload, mapping.phone) : undefined,
    email: mapping.email ? resolvePath(payload, mapping.email) : undefined,
  };
}
