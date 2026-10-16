/** Validate configuration before an empty tree can short-circuit rendering. */
export function validateRenderLimits(options: { maxNodes?: number; maxDepth?: number }): void {
  for (const key of ['maxNodes', 'maxDepth'] as const) {
    const value = options[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`${key} 必须是正安全整数`);
    }
  }
}
