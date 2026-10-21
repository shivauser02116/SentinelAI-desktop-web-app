const inr = new Intl.NumberFormat('en-IN')

export function formatINR(n: number): string {
  return `₹${inr.format(n)}`
}

export function formatArgValue(key: string, v: string | number | string[]): string {
  if (typeof v === 'number') return key === 'amount' ? formatINR(v) : String(v)
  if (Array.isArray(v)) return `[${v.map((s) => `"${s}"`).join(', ')}]`
  return v
}
