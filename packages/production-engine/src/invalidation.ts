import { canonicalJson, sha256 } from '@kampora/cost-engine';
import type { Storyboard, StoryboardScene } from '@kampora/shared';

/** Independent layers of a scene. A change in one layer must not invalidate assets of another. */
export type SceneLayer = 'visual' | 'voice' | 'text' | 'timing';

export type SceneLayerHashes = Record<SceneLayer, string>;

export function sceneLayerHashes(scene: StoryboardScene): SceneLayerHashes {
  const h = (v: unknown) => sha256(canonicalJson(v)).slice(0, 16);
  return {
    visual: h({
      visual: scene.visual,
      visualKind: scene.visualKind,
      requiredAssets: scene.requiredAssets,
      motion: scene.motion,
      quality: scene.quality,
    }),
    voice: h({ voiceover: scene.voiceover }),
    text: h({ onScreenText: scene.onScreenText ?? null }),
    timing: h({ durationSec: scene.durationSec, order: scene.order }),
  };
}

/** Single hash for the whole scene (stored on the scenes table). */
export function sceneContentHash(scene: StoryboardScene): string {
  return sha256(canonicalJson(sceneLayerHashes(scene)));
}

export interface StoryboardDiff {
  added: string[];
  removed: string[];
  changed: Array<{ key: string; layers: SceneLayer[] }>;
  unchanged: string[];
}

/** Which scenes, and which layers of them, a revision actually touched. Everything else is reused. */
export function diffStoryboards(previous: Storyboard, next: Storyboard): StoryboardDiff {
  const prev = new Map(previous.scenes.map((s) => [s.key, sceneLayerHashes(s)]));
  const diff: StoryboardDiff = { added: [], removed: [], changed: [], unchanged: [] };
  for (const scene of next.scenes) {
    const before = prev.get(scene.key);
    if (!before) {
      diff.added.push(scene.key);
      continue;
    }
    const after = sceneLayerHashes(scene);
    const layers = (Object.keys(after) as SceneLayer[]).filter((l) => after[l] !== before[l]);
    if (layers.length) diff.changed.push({ key: scene.key, layers });
    else diff.unchanged.push(scene.key);
    prev.delete(scene.key);
  }
  diff.removed = [...prev.keys()];
  return diff;
}
