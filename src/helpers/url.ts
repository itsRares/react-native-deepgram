export function buildParams(map: Record<string, string | boolean | undefined>) {
  const p = new URLSearchParams();
  Object.entries(map).forEach(([k, v]) => v != null && p.append(k, String(v)));
  return p.toString();
}
