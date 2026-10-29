import type { CreativeConcept, Storyboard } from '@kampora/shared';

/**
 * Deterministic creative checks. They catch structural problems (a slow hook, two messages, a visually flat
 * sequence), never taste: whether an ad is good is decided by people. Errors make the model try again;
 * warnings are shown to the owner.
 */
export interface CreativeIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  sceneKey?: string;
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const PRICE_RE = /(?:₪\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?₪)/g;
const LABEL_RE = /^(?:דיבור|מסך|קריינות|כותרת|hook|cta)\s*:/i;

export function conceptQa(concept: CreativeConcept): CreativeIssue[] {
  const issues: CreativeIssue[] = [];
  const hookWords = words(concept.hook);
  if (hookWords > 10) {
    issues.push({
      severity: 'error',
      code: 'HOOK_TOO_LONG',
      message: `The hook of "${concept.title}" has ${hookWords} words; it must land in ~2 seconds (max 10 words).`,
    });
  }
  if (LABEL_RE.test(concept.hook) || LABEL_RE.test(concept.voiceover)) {
    issues.push({
      severity: 'error',
      code: 'LABEL_IN_COPY',
      message: `Remove labels/prefixes from "${concept.title}".`,
    });
  }
  const prices = new Set((concept.voiceover.match(PRICE_RE) ?? []).map((p) => p.replace(/\s/g, '')));
  if (prices.size > 1) {
    issues.push({
      severity: 'error',
      code: 'MULTIPLE_MESSAGES',
      message: `"${concept.title}" mentions ${prices.size} different prices; one ad carries one message.`,
    });
  }
  if (!concept.strategy) {
    issues.push({ severity: 'warning', code: 'NO_STRATEGY', message: 'This concept has no strategy block.' });
  }
  return issues;
}

export function storyboardQa(storyboard: Storyboard): CreativeIssue[] {
  const issues: CreativeIssue[] = [];
  const scenes = [...storyboard.scenes].sort((a, b) => a.order - b.order);
  const first = scenes[0];
  if (first && first.durationSec > 4.5) {
    issues.push({
      severity: 'warning',
      code: 'SLOW_HOOK',
      sceneKey: first.key,
      message: 'The opening scene is longer than 4.5 s; the hook should land within the first 2–3 seconds.',
    });
  }
  const offers = scenes.filter((s) => s.role === 'OFFER');
  if (offers.length > 1) {
    issues.push({
      severity: 'error',
      code: 'MULTIPLE_OFFERS',
      message: `${offers.length} OFFER scenes: one ad carries one offer.`,
    });
  }
  for (const [i, s] of scenes.entries()) {
    if (s.onScreenText && words(s.onScreenText) > 7) {
      issues.push({
        severity: 'error',
        code: 'TEXT_TOO_LONG',
        sceneKey: s.key,
        message: `On-screen text of scene "${s.key}" has ${words(s.onScreenText)} words (max 7).`,
      });
    }
    const composition = s.direction?.composition?.type;
    if (
      s.direction &&
      (s.direction.shot === 'detail' || s.direction.shot === 'extreme-close-up') &&
      (composition === 'ASSORTMENT' || composition === 'ENVIRONMENT' || composition === 'LIFESTYLE')
    ) {
      // Not an error: the visual planner resolves it (the composition wins), but the owner should see why.
      issues.push({
        severity: 'warning',
        code: 'SHOT_CONTRADICTS_COMPOSITION',
        sceneKey: s.key,
        message: `Scene "${s.key}" must show ${composition.toLowerCase()} but asks for a ${s.direction.shot} shot; the picture will be framed wider.`,
      });
    }
    const prev = scenes[i - 1];
    if (prev && s.direction && prev.direction) {
      if (
        s.direction.shot === prev.direction.shot &&
        s.motion.preset === prev.motion.preset &&
        s.visualKind !== 'GRAPHIC'
      ) {
        issues.push({
          severity: 'error',
          code: 'NO_VISUAL_VARIETY',
          sceneKey: s.key,
          message: `Scenes "${prev.key}" and "${s.key}" use the same framing (${s.direction.shot}) and motion (${s.motion.preset}); vary one of them.`,
        });
      }
    }
  }
  const presets = scenes.map((s) => s.motion.preset);
  for (let i = 2; i < presets.length; i++) {
    if (presets[i] === presets[i - 1] && presets[i] === presets[i - 2]) {
      issues.push({
        severity: 'warning',
        code: 'REPEATED_MOTION',
        sceneKey: scenes[i]!.key,
        message: `Three scenes in a row use "${presets[i]}".`,
      });
    }
  }
  const last = scenes.at(-1);
  if (last?.role === 'CTA' && !last.onScreenText) {
    issues.push({
      severity: 'warning',
      code: 'CTA_WITHOUT_TEXT',
      sceneKey: last.key,
      message: 'The CTA scene has no on-screen text; viewers watching muted will miss it.',
    });
  }
  return issues;
}

export const qaErrors = (issues: CreativeIssue[]) =>
  issues.filter((i) => i.severity === 'error').map((i) => i.message);
