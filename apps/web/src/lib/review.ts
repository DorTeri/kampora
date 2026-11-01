import type {
  CampaignGoal,
  CreativeDirection,
  CreativeDirectionSet,
  CreativeReview,
  RevisionRequest,
  StaticAdText,
} from '@kampora/shared';

/**
 * The Studio review page's data, whether it comes from the recorded demo (studio-demo.json, produced by the Q7
 * demo script) or from the API (GET /v1/projects/:id/directions).
 */

/** Demo mode: the web app runs without the Kampora backend (e.g. a Vercel preview). Nothing paid can run. */
export const DEMO_MODE =
  process.env.KAMPORA_DEMO_MODE === '1' || (process.env.VERCEL === '1' && !process.env.KAMPORA_API_URL);

export type DirectionCopy = Record<string, unknown> & { headline: string; cta: string };

export interface ReviewReference {
  id: string;
  title: string;
  brand: string;
  year: number | null;
  sourceUrl: string;
  industry: string;
  objective: string;
  score: number;
  reasons: string[];
  principle: string;
  moves: string[];
  analysisBasis: string;
  /** What was seen when the work itself was viewed (IMAGES_VIEWED only). */
  seen?: { whatWasSeen: string; confidence: string; composition: string; typography: string } | null;
  /** Where viewing the work corrected the earlier text-only analysis. */
  corrections?: { field: string; wasClaimed: string; actuallySeen: string }[];
}

/** How the moodboard shaped one direction (from traceReferenceInfluence). */
export interface ReviewTrace {
  key: string;
  method: string;
  moves: string[];
  moveSources: Record<string, string[]>;
  referenceOnlyMoves: string[];
  withoutReferenceMoves: Record<string, { change: string }[]>;
  withoutAnyReference: { method: string; moves: string[]; typeSystem: string; changed: string[] };
  originality: { maxOverlap: number; closestReference: string | null; referencesCombined: number; ownAssetsOnly: boolean };
  effects: { referenceId: string; brand: string; analysisBasis: string; moves: string[]; withoutReference: string[] }[];
}

export interface ReviewConcept {
  title: string;
  angle: string;
  hook?: string;
  hookTechnique?: string;
  headline?: string;
  mainMessage?: string;
  insight?: string;
  voiceover?: string;
  chosen: boolean;
}

export interface ReviewCase {
  id: string;
  business: { name: string; category: string; city?: string; tone: string; colors: Record<string, string> };
  brief: { goal: CampaignGoal; productName: string; offer?: string; keyMessage: string; audience: string; cta?: string };
  concepts: ReviewConcept[];
  moodboard: ReviewReference[];
  directions: (Pick<CreativeDirection, 'key' | 'name'> & {
    renders: Record<string, string>;
    /** The 4:5 render of this direction without its reference-only moves. */
    withoutReferences?: string | null;
    reviews: Record<string, CreativeReview>;
    pictureBrief: { guidance: string } | null;
  })[];
  copyRevision?: { q6: Partial<StaticAdText>; q7: Partial<StaticAdText>; why: string[] };
  trace?: ReviewTrace[];
  storyboard: { key: string; role: string; durationSec: number; voiceover: string; visual: string; onScreenText?: string }[];
  video: { file: string; seconds: number; titleFace: string; entrance: string; silent: boolean; endCard?: string } | null;
  q6: { render: string; adText: StaticAdText };
  pictures: string;
  review: {
    set: CreativeDirectionSet;
    copy: Record<string, DirectionCopy>;
    assetUrls: Record<string, string>;
  };
}

export interface ChangeOutcomeDto {
  parsed: { text: string; intents: { intent: string; matched: string }[]; conflicts: [string, string][] };
  direction: CreativeDirection;
  changes: RevisionRequest[];
  technical: Record<string, { verdict: 'PASS' | 'REVISE'; problems: string[] }>;
  summary: string;
  suggestions?: string[];
}

export const SAMPLE_REQUESTS = [
  'אני רוצה עיצוב יותר יוקרתי',
  'התמונה לא מתאימה למוצר',
  'תבליט יותר את המחיר',
  'הטיפוגרפיה פשוטה מדי',
  'נסה כיוון עיצובי אחר',
] as const;
