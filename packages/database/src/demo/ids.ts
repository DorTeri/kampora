/** Fixed IDs make the demo seed idempotent: re-running it updates instead of duplicating. */
export const DEMO_IDS = {
  org: '00000000-0000-4000-8000-000000000001',
  user: '00000000-0000-4000-8000-000000000002',
  business: '00000000-0000-4000-8000-000000000010',
  brandProfile: '00000000-0000-4000-8000-000000000011',
} as const;

const ASSET_IDS: Record<string, string> = {
  'hero-coffee': '00000000-0000-4000-8000-000000000101',
  pastries: '00000000-0000-4000-8000-000000000102',
  interior: '00000000-0000-4000-8000-000000000103',
  'music-bed': '00000000-0000-4000-8000-000000000104',
};

export function demoAssetId(key: string): string {
  const id = ASSET_IDS[key];
  if (!id) throw new Error(`Unknown demo asset ${key}`);
  return id;
}

export const DEMO_USER_EMAIL = 'demo@kampora.dev';

/**
 * A separate synthetic organization for automated scenarios and integration tests, so test conversations and
 * businesses never land in the demo organization (or next to real business records).
 */
export const FIXTURES_IDS = {
  org: '00000000-0000-4000-8000-000000000201',
  user: '00000000-0000-4000-8000-000000000202',
} as const;
export const FIXTURES_USER_EMAIL = 'fixtures@kampora.dev';
