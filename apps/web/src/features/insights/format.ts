export function formatNumber(n: number, locale?: string): string {
  return new Intl.NumberFormat(locale).format(n)
}

/** null = 尚无估算数据；0 = 有调用但费用为 0 */
export function formatCost(usd: number | null, noneLabel: string): string {
  if (usd == null) return noneLabel
  if (usd === 0) return "$0.00"
  if (usd < 0.0001) return "< $0.0001"
  return `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`
}

export const CHART_PALETTE = [
  "hsl(217, 91%, 60%)",
  "hsl(160, 84%, 39%)",
  "hsl(38, 92%, 50%)",
  "hsl(280, 80%, 60%)",
  "hsl(350, 89%, 60%)",
  "hsl(190, 90%, 45%)",
] as const

export const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Go: "#00ADD8",
  Rust: "#dea584",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  Ruby: "#701516",
  PHP: "#4F5D95",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  Vue: "#41b883",
  Svelte: "#ff3e00",
}
