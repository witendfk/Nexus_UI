/** Store budgets must be finite positive counts; invalid configuration never disables eviction. */
export function assertPositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正安全整数`);
  }
}
