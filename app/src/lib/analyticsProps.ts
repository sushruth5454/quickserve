/** Analytics prop sanitising (pure; unit-tested). See analytics.ts. */

export type Prop = string | number | boolean | null | undefined | Record<string, number>;

const SAFE_STRING = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Keeps only analytics-safe values; drops everything else (free text, nested objects, long strings). */
export function sanitizeProps(props: Record<string, Prop>): Record<string, string | number | boolean | Record<string, number>> {
  const out: Record<string, string | number | boolean | Record<string, number>> = {};
  for (const [k, v] of Object.entries(props).slice(0, 20)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && SAFE_STRING.test(v)) out[k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nums: Record<string, number> = {};
      for (const [nk, nv] of Object.entries(v).slice(0, 20)) {
        if (/^[a-z][a-z0-9_]{0,39}$/.test(nk) && typeof nv === 'number' && Number.isFinite(nv)) nums[nk] = Math.round(nv);
      }
      if (Object.keys(nums).length) out[k] = nums;
    }
  }
  return out;
}
