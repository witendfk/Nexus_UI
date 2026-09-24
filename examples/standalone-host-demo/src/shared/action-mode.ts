export type StandaloneHostActionMode = 'external' | 'local';

export function resolveStandaloneHostActionMode(
  value: string | undefined,
): StandaloneHostActionMode {
  if (value === undefined || value.trim() === '') return 'external';
  if (value === 'external' || value === 'local') return value;
  throw new Error('NEXUS_DEMO_ACTION_MODE 只支持 external 或 local');
}
