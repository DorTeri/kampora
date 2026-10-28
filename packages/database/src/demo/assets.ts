import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AssetProvenance, AvailableAsset, MediaAsset } from '@kampora/shared';
import { generateDemoMusicWav } from './music';

/** Original illustrations created for Kampora's demo; free to use, no third-party rights. */
export const DEMO_ASSETS_DIR = path.resolve(__dirname, '../../demo-assets');

const DEMO_PROVENANCE: AssetProvenance = {
  source: 'DEMO',
  license: 'Kampora demo asset (original illustration, unrestricted internal use)',
  commercialUse: true,
};

export interface DemoAssetDefinition {
  key: string;
  file?: string;
  kind: 'image' | 'audio';
  mimeType: string;
  description: string;
  tags: string[];
  width?: number;
  height?: number;
  durationSec?: number;
  provenance: AssetProvenance;
}

export const DEMO_ASSET_DEFINITIONS: DemoAssetDefinition[] = [
  {
    key: 'hero-coffee',
    file: 'hero-coffee.svg',
    kind: 'image',
    mimeType: 'image/svg+xml',
    description: 'כוס לאטה על צלוחית, אור חם (איור דמו)',
    tags: ['hero', 'coffee', 'product'],
    width: 1080,
    height: 1920,
    provenance: DEMO_PROVENANCE,
  },
  {
    key: 'pastries',
    file: 'pastries.svg',
    kind: 'image',
    mimeType: 'image/svg+xml',
    description: 'קרואסונים ולחמניות על דלפק עץ (איור דמו)',
    tags: ['product', 'pastry'],
    width: 1080,
    height: 1920,
    provenance: DEMO_PROVENANCE,
  },
  {
    key: 'interior',
    file: 'interior.svg',
    kind: 'image',
    mimeType: 'image/svg+xml',
    description: 'פנים בית הקפה עם חלון ומנורות (איור דמו)',
    tags: ['store', 'interior'],
    width: 1080,
    height: 1920,
    provenance: DEMO_PROVENANCE,
  },
  {
    key: 'music-bed',
    kind: 'audio',
    mimeType: 'audio/wav',
    description: 'מוזיקת רקע סינתטית לדמו',
    tags: ['music'],
    durationSec: 30,
    provenance: {
      source: 'PROGRAMMATIC',
      license: 'Synthesized by Kampora (demo music bed)',
      commercialUse: true,
      notes: 'Placeholder until licensed music is integrated',
    },
  },
];

export async function loadDemoAssetBytes(def: DemoAssetDefinition): Promise<Buffer> {
  if (def.key === 'music-bed') return generateDemoMusicWav(def.durationSec);
  return readFile(path.join(DEMO_ASSETS_DIR, def.file!));
}

export function demoAvailableAssets(idFor: (key: string) => string): AvailableAsset[] {
  return DEMO_ASSET_DEFINITIONS.filter((d) => d.kind === 'image').map((d) => ({
    id: idFor(d.key),
    kind: 'image' as const,
    description: d.description,
    tags: d.tags,
    width: d.width,
    height: d.height,
    commercialUse: d.provenance.commercialUse,
  }));
}

export function demoMediaAssets(
  idFor: (key: string) => string,
  keyFor: (def: DemoAssetDefinition) => string,
): MediaAsset[] {
  return DEMO_ASSET_DEFINITIONS.map((d) => ({
    id: idFor(d.key),
    kind: d.kind,
    storageKey: keyFor(d),
    mimeType: d.mimeType,
    width: d.width,
    height: d.height,
    durationSec: d.durationSec,
    provenance: d.provenance,
  }));
}
