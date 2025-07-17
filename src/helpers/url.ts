export function buildParams(
  map: Record<string, string | boolean | string[] | undefined | number>
): string {
  const p = new URLSearchParams();

  Object.entries(map).forEach(([key, value]) => {
    if (value == null) return; // skip undefined/null
    if (Array.isArray(value)) {
      // multiple values
      value.forEach((v) => p.append(key, v));
    } else if (typeof value === 'boolean') {
      if (value) p.append(key, 'true'); // only include true flags
    } else {
      if (typeof value === 'number') {
        p.append(key, String(value)); // convert number to string
      } else {
        p.append(key, value); // plain string
      }
    }
  });

  return p.toString();
}

export const dgPath = (...segments: Array<string | number>) =>
  '/' + segments.map((s) => encodeURIComponent(String(s))).join('/');
