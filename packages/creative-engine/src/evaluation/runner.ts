import { CRITIC_POLICY, expertiseVersion, industryFor } from '@kampora/agent-expertise';
import { DEFAULT_PRICE_CATALOG, PriceCatalog } from '@kampora/cost-engine';
import type { LlmProvider } from '@kampora/media-providers';
import {
  buildStaticAd,
  buildVideoProject,
  describeTimeline,
  offerSubjects,
  planProduction,
  sceneComposition,
  splitPrice,
} from '@kampora/production-engine';
import {
  STATIC_AD_FORMATS,
  mediaAuthenticity,
  stripNiqqud,
  type AvailableAsset,
  type LayoutFamily,
  type MediaAsset,
  type ReviewHistory,
  type StaticAd,
  type StaticAdFormat,
} from '@kampora/shared';
import { directArt } from '../art-director';
import { critiqueConceptSet } from '../critic/concepts';
import { reviewOnce, reviewStaticAd } from '../critic/revisions';
import { critiqueVideo } from '../critic/video';
import type { UsageRecorder } from '../step-runner';
import { generateCampaignBrief, generateConcepts, generateStoryboard } from '../steps';
import { EVAL_SCENARIOS, type EvalScenario } from './scenarios';

const FORMATS = Object.keys(STATIC_AD_FORMATS) as StaticAdFormat[];

/** What one review found, in a form that can be compared between runs. */
export interface ReviewSummary {
  verdict: string;
  rounds: number;
  stoppedBecause: ReviewHistory['stoppedBecause'];
  /** Criteria with a MAJOR or CRITICAL problem in the final round. */
  serious: string[];
  minor: string[];
  appliedFixes: number;
  pendingApproval: number;
}

export interface ScenarioResult {
  id: string;
  label: string;
  /** Deterministic expectations from the scenario: pass or fail, with the observed value. */
  checks: Array<{ id: string; pass: boolean; observed: string }>;
  artDirection: { layoutFamily: LayoutFamily; primaryFocal: string; hierarchy: string[] };
  /** Layout family per format after the Critic's free fixes. */
  formats: Record<StaticAdFormat, LayoutFamily | 'TEMPLATE'>;
  reviews: {
    concepts: ReviewSummary;
    staticAds: Record<StaticAdFormat, ReviewSummary>;
    /** With each scene's camera move (or visual type), as the timeline was built. */
    video: (ReviewSummary & { scenes: string[] }) | { error: string };
  };
  /** Model cost of the run. With the mock provider this is SIMULATED, not money spent. */
  costUsd: number;
  chargeTypes: string[];
}

export interface EvaluationRun {
  /** Everything that can change the result: compare runs only when they differ in what you meant to change. */
  versions: { expertise: string; criticPolicy: string; provider: string };
  scenarios: ScenarioResult[];
  aggregate: {
    checksPassed: number;
    checksTotal: number;
    distinctLayoutFamilies: number;
    seriousProblems: number;
    appliedFixes: number;
    pendingApproval: number;
    costUsd: number;
  };
  /** Always stated: the run measures rules, not whether the ads persuade. */
  note: string;
}

const summarize = (h: ReviewHistory): ReviewSummary => {
  const last = h.rounds.at(-1)!;
  const sev = (s: string[]) =>
    last.report.results.filter((r) => s.includes(r.severity)).map((r) => r.criterion);
  return {
    verdict: last.report.verdict,
    rounds: h.rounds.length,
    stoppedBecause: h.stoppedBecause,
    serious: [...new Set(sev(['MAJOR', 'CRITICAL']))].sort(),
    minor: [...new Set(sev(['MINOR']))].sort(),
    appliedFixes: h.rounds.flatMap((r) => r.revisions).filter((r) => r.status === 'APPLIED').length,
    pendingApproval: last.revisions.filter((r) => r.status === 'PENDING_APPROVAL').length,
  };
};

/** Hebrew plural/feminine endings, so "מאפה" matches "מאפים". */
const stem = (w: string) => w.replace(/(ים|ות|ה|ת)$/, '');

const toMedia = (s: EvalScenario, assets: readonly AvailableAsset[]): MediaAsset[] =>
  assets.map((a) => ({
    id: a.id,
    kind: a.kind === 'logo' ? 'image' : a.kind,
    storageKey: `eval/${s.id}/${a.id}.jpg`,
    mimeType: a.mimeType ?? 'image/jpeg',
    width: a.width,
    height: a.height,
    provenance: {
      source: a.source ?? 'CUSTOMER_UPLOAD',
      license: 'Evaluation fixture (metadata only)',
      commercialUse: a.commercialUse,
    },
  }));

/** Runs one scenario through the real pipeline (brief → concepts → storyboard → art direction → ads → video). */
export async function evaluateScenario(s: EvalScenario, provider: LlmProvider): Promise<ScenarioResult> {
  const usage: Array<{ costUsd: number; chargeType: string }> = [];
  const recorder: UsageRecorder = {
    record: async (e) => {
      if (e.usage) usage.push({ costUsd: e.usage.costUsd ?? 0, chargeType: e.usage.chargeType });
    },
  };
  const ctx = { provider, recorder };
  const industry = industryFor(s.business).profile;
  const brief = await generateCampaignBrief(
    {
      business: s.business,
      request: s.request,
      defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 },
    },
    ctx,
  );
  const { conceptSet, claimFlags } = await generateConcepts(
    { business: s.business, brief, assets: s.assets },
    ctx,
  );
  const concept = conceptSet.concepts.find((c) => c.key === conceptSet.recommendedKey)!;
  const { storyboard } = await generateStoryboard(
    { business: s.business, brief, concept, assets: s.assets },
    ctx,
  );
  const planWith = (assets: readonly AvailableAsset[], approvedImages?: Record<string, string>) =>
    planProduction({
      storyboard,
      assets,
      budgetUsd: 5,
      perGenerationMaxUsd: 1,
      qualityTier: 'standard',
      catalog: new PriceCatalog(DEFAULT_PRICE_CATALOG),
      approvedImages,
    });
  // Scenes that need a generated picture get the mock image provider's stand-in (metadata only, no cost), as
  // if the owner had approved it: the same path the studio takes with IMAGE_PROVIDER=mock.
  const needs = planWith(s.assets).scenes.filter(
    (p) => p.strategy === 'AI_IMAGE_MOTION' && !p.assetIds.length,
  );
  const mockImages: AvailableAsset[] = needs.map((p) => ({
    id: `mock-ai-${p.sceneKey}`,
    kind: 'image',
    description: storyboard.scenes.find((x) => x.key === p.sceneKey)?.visual ?? p.sceneKey,
    tags: [],
    width: 1024,
    height: 1536,
    mimeType: 'image/png',
    source: 'AI_GENERATED',
    commercialUse: true,
  }));
  const approvedImages = Object.fromEntries(needs.map((p) => [p.sceneKey, `mock-ai-${p.sceneKey}`]));
  const assets = [...s.assets, ...mockImages];
  const plan = planWith(assets, approvedImages);
  const media = toMedia(s, assets);

  // The picture the ad would show: the scenario's first picture, as the planned product/hook scene shows it.
  const lead = s.assets[0];
  const scene =
    storyboard.scenes.find((x) => x.role === 'PRODUCT') ?? storyboard.scenes.find((x) => x.role === 'HOOK');
  const composition = scene ? sceneComposition(scene, s.business.products).type : undefined;
  const offerScene = storyboard.scenes.find((x) => x.role === 'OFFER');
  const art = directArt({
    goal: brief.goal,
    tone: s.business.tone,
    industryId: industry.id,
    // As in the studio: a price (or percentage) the offer scene puts on screen.
    hasPrice: Boolean(offerScene?.onScreenText && splitPrice(stripNiqqud(offerScene.onScreenText))),
    hasOffer: Boolean(brief.offer),
    concept: {
      angle: concept.angle,
      hookTechnique: concept.copy?.hookTechnique,
      headline: concept.copy?.headline,
    },
    brandColors: s.business.brandColors,
    picture: lead
      ? {
          composition,
          authenticity: mediaAuthenticity({
            source: lead.source ?? 'CUSTOMER_UPLOAD',
            mimeType: lead.mimeType,
            tags: lead.tags,
            description: lead.description,
          }),
        }
      : undefined,
  });
  const alternatives = [...art.alternatives].sort((a, b) => b.score - a.score).map((a) => a.layoutFamily);

  const staticAds = {} as Record<StaticAdFormat, ReviewSummary>;
  const formats = {} as ScenarioResult['formats'];
  for (const format of FORMATS) {
    const built: StaticAd = buildStaticAd({
      id: `${s.id}:${format}`,
      format,
      business: s.business,
      brief,
      storyboard,
      plan,
      assets: media,
      approvedImages,
      copy: concept.copy
        ? { headline: concept.copy.headline, subheadline: concept.copy.subheadline }
        : undefined,
      design: art.formats[format],
    });
    const { ad, history } = reviewStaticAd(built, {
      plan: art,
      pictureComposition: built.background.assetId ? composition : undefined,
      offer: brief.offer,
      business: s.business,
      industry,
      alternatives,
    });
    staticAds[format] = summarize(history);
    formats[format] = ad.design?.layoutFamily ?? 'TEMPLATE';
  }

  let video: ScenarioResult['reviews']['video'];
  try {
    const timeline = buildVideoProject({
      projectId: s.id,
      title: s.label,
      business: s.business,
      brief,
      storyboard,
      plan,
      assets: media,
      motion: art.motion,
    });
    video = {
      ...summarize(reviewOnce({ type: 'VIDEO', ref: s.id }, critiqueVideo(timeline))),
      scenes: describeTimeline(timeline).scenes.map((x) => `${x.sceneKey}:${x.motion ?? x.visual}`),
    };
  } catch (error) {
    // Scenes that need a generated picture cannot be built without one: reported, not hidden.
    video = { error: error instanceof Error ? error.message : String(error) };
  }

  const subjects = offerSubjects(brief, s.business.products);
  const checks: ScenarioResult['checks'] = [
    { id: 'industry', pass: industry.id === s.expect.industryId, observed: industry.id },
    { id: 'focal', pass: s.expect.focal.includes(art.primaryFocal as never), observed: art.primaryFocal },
    ...(s.expect.offerSubjects
      ? [
          {
            id: 'offerSubjects',
            pass: s.expect.offerSubjects.every((w) =>
              subjects.some((x) => x.includes(w) || x.split(/\s+/).some((y) => stem(y) === stem(w))),
            ),
            observed: subjects.join(', '),
          },
        ]
      : []),
    ...FORMATS.map((f) => ({
      id: `staticAd:${f}:noSerious`,
      pass: staticAds[f].serious.length === 0,
      observed: staticAds[f].serious.join(', ') || 'none',
    })),
  ];

  return {
    id: s.id,
    label: s.label,
    checks,
    artDirection: {
      layoutFamily: art.layoutFamily,
      primaryFocal: art.primaryFocal,
      hierarchy: art.hierarchy,
    },
    formats,
    reviews: {
      concepts: summarize(
        reviewOnce(
          { type: 'CONCEPT_SET', ref: s.id },
          critiqueConceptSet(conceptSet, { business: s.business, brief, industry, claimFlags }),
        ),
      ),
      staticAds,
      video,
    },
    costUsd: Math.round(usage.reduce((a, u) => a + u.costUsd, 0) * 10000) / 10000,
    chargeTypes: [...new Set(usage.map((u) => u.chargeType))],
  };
}

/**
 * Runs the fixed evaluation set. Deterministic with the mock provider (no cost, same output every run), so a
 * change in expertise, layout or critic rules shows up as a diff against the stored baseline.
 */
export async function runEvaluation(
  provider: LlmProvider,
  scenarios: readonly EvalScenario[] = EVAL_SCENARIOS,
): Promise<EvaluationRun> {
  const results: ScenarioResult[] = [];
  for (const s of scenarios) results.push(await evaluateScenario(s, provider));
  const all = results.flatMap((r) => [
    r.reviews.concepts,
    ...Object.values(r.reviews.staticAds),
    ...('error' in r.reviews.video ? [] : [r.reviews.video]),
  ]);
  const checks = results.flatMap((r) => r.checks);
  return {
    versions: {
      expertise: expertiseVersion(),
      criticPolicy: `critic-policy@${CRITIC_POLICY.version}`,
      provider: `${provider.id}${provider.paid ? '' : ' (free)'}`,
    },
    scenarios: results,
    aggregate: {
      checksPassed: checks.filter((c) => c.pass).length,
      checksTotal: checks.length,
      distinctLayoutFamilies: new Set(results.map((r) => r.artDirection.layoutFamily)).size,
      seriousProblems: all.reduce((a, s) => a + s.serious.length, 0),
      appliedFixes: all.reduce((a, s) => a + s.appliedFixes, 0),
      pendingApproval: all.reduce((a, s) => a + s.pendingApproval, 0),
      costUsd: Math.round(results.reduce((a, r) => a + r.costUsd, 0) * 10000) / 10000,
    },
    note: 'Measured checks only. A clean run means no rule was broken, not that the ads persuade: people judge that.',
  };
}

/** The part of a run that is reviewed and stored as the regression baseline. */
export interface CompactRun {
  versions: EvaluationRun['versions'];
  aggregate: EvaluationRun['aggregate'];
  scenarios: Array<{
    id: string;
    layoutFamily: LayoutFamily;
    primaryFocal: string;
    formats: ScenarioResult['formats'];
    /** Serious criteria per review (concepts, static:<format>, video). */
    serious: Record<string, string[]>;
    video: string[];
  }>;
}

export function compactRun(run: EvaluationRun): CompactRun {
  return {
    versions: run.versions,
    aggregate: run.aggregate,
    scenarios: run.scenarios.map((s) => ({
      id: s.id,
      layoutFamily: s.artDirection.layoutFamily,
      primaryFocal: s.artDirection.primaryFocal,
      formats: s.formats,
      serious: {
        concepts: s.reviews.concepts.serious,
        ...Object.fromEntries(
          Object.entries(s.reviews.staticAds).map(([f, r]) => [`static:${f}`, r.serious]),
        ),
        video: 'error' in s.reviews.video ? ['BUILD_FAILED'] : s.reviews.video.serious,
      },
      video: 'error' in s.reviews.video ? [s.reviews.video.error] : s.reviews.video.scenes,
    })),
  };
}
