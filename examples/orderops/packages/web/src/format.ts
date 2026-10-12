/** 金额展示：contracts 约定整数最小货币单位，按两位小数呈现（当前业务币种均为两位精度）。 */
export function formatAmount(amountMinor: number, currency: string): string {
  if (!Number.isFinite(amountMinor)) return `${currency} —`;
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}
