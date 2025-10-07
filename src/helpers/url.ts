type ParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean | null | undefined>;

export function buildParams(map: Record<string, ParamValue>): string {
  const p = new URLSearchParams();

  Object.entries(map).forEach(([key, value]) => {
    if (value == null) return; // skip undefined/null
    const append = (v: string | number | boolean) => {
      if (typeof v === 'boolean') {
        p.append(key, v ? 'true' : 'false');
      } else {
        p.append(key, String(v));
      }
    };

    if (Array.isArray(value)) {
      value.forEach((v) => {
        if (v == null) return;
        append(v);
      });
    } else {
      append(value);
    }
  });

  return p.toString();
}

export const dgPath = (...segments: Array<string | number>) =>
  '/' + segments.map((s) => encodeURIComponent(String(s))).join('/');
