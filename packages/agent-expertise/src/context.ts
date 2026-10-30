import type { CampaignGoal } from '@kampora/shared';
import { ART_DIRECTION_PLAYBOOK } from './art-direction';
import { COPYWRITING_PLAYBOOK, HOOK_TECHNIQUES } from './copywriting';
import { CREATIVE_REFERENCES, REFERENCE_LIBRARY_VERSION, retrieveReferences } from './creative-references';
import { CREATIVE_RUBRIC } from './evaluation-rubrics';
import { HEBREW_ADVERTISING_PLAYBOOK, HEBREW_CLICHES } from './hebrew-advertising';
import type { IndustryProfile } from './industry-profiles';
import { playbookTag, type Method } from './playbook';
import { CREATIVE_STRATEGY_PLAYBOOK, VIDEO_DIRECTION_PLAYBOOK } from './strategy-and-video';

/** Every versioned piece of expertise, in one tag recorded on generated work (e.g. on the brief). */
export function expertiseVersion(industry?: Pick<IndustryProfile, 'id' | 'version'>): string {
  return [
    playbookTag(COPYWRITING_PLAYBOOK),
    playbookTag(HEBREW_ADVERTISING_PLAYBOOK),
    playbookTag(CREATIVE_STRATEGY_PLAYBOOK),
    playbookTag(ART_DIRECTION_PLAYBOOK),
    playbookTag(VIDEO_DIRECTION_PLAYBOOK),
    `${CREATIVE_RUBRIC.id}@${CREATIVE_RUBRIC.version}`,
    `references@${REFERENCE_LIBRARY_VERSION}`,
    ...(industry ? [`industry:${industry.id}@${industry.version}`] : []),
  ].join(' ');
}

const relevant = (methods: readonly Method[], goal: CampaignGoal) =>
  methods.filter((m) => !m.goals || m.goals.includes(goal));

const method = (m: Method) => `- ${m.name}: ${m.how}${m.avoid ? ` Avoid: ${m.avoid}` : ''}`;

/**
 * The Copywriter's expertise as a compact prompt block: only the methods relevant to this goal, the industry's
 * motivations (as hypotheses) and claims to verify, and at most two references. Keeps tokens low and repeatable.
 */
export function copywriterExpertise(input: { goal: CampaignGoal; industry: IndustryProfile }): string {
  const { goal, industry } = input;
  const refs = retrieveReferences({ industryId: industry.id, goal, format: 'VIDEO' });
  return [
    `Expertise (${playbookTag(COPYWRITING_PLAYBOOK)}, ${playbookTag(CREATIVE_STRATEGY_PLAYBOOK)}, industry:${industry.id}@${industry.version}).`,
    `Role: ${COPYWRITING_PLAYBOOK.responsibility}`,
    'Hook techniques (each concept uses a different one; report it as hookTechnique):',
    ...relevant(Object.values(HOOK_TECHNIQUES), goal).map(
      (m) => `- ${m.id}: ${m.how}${m.avoid ? ` Avoid: ${m.avoid}` : ''}`,
    ),
    'Methods:',
    ...relevant(COPYWRITING_PLAYBOOK.methods, goal).map(method),
    ...relevant(CREATIVE_STRATEGY_PLAYBOOK.methods, goal).map(method),
    'Decision rules:',
    ...COPYWRITING_PLAYBOOK.decisionRules.map((r) => `- ${r}`),
    `Industry (${industry.label}). Common motivations to consider — hypotheses, never facts to state: ${industry.motivations.join('; ')}.`,
    `Approaches that often fit: ${industry.approaches.map((a) => `${a.name} (${a.how})`).join('; ')}.`,
    industry.claimsRequiringVerification.length
      ? `Never state unless it is an approved claim: ${industry.claimsRequiringVerification.map((c) => c.label).join(', ')}.`
      : '',
    refs.length
      ? `Reference principles: ${refs.map((r) => `${r.title}: ${r.copywritingApproach} (${r.whyItWorks})`).join(' | ')}`
      : '',
    `Hebrew: ${HEBREW_ADVERTISING_PLAYBOOK.methods.map((m) => m.how).join(' ')} Never use: ${HEBREW_CLICHES.slice(0, 10).join(', ')}.`,
    'Failure modes to avoid: ' + COPYWRITING_PLAYBOOK.failureModes.join(' '),
  ]
    .filter(Boolean)
    .join('\n');
}

/** Short summaries for the Studio ("which expertise was used"). */
export const PLAYBOOKS = [
  COPYWRITING_PLAYBOOK,
  HEBREW_ADVERTISING_PLAYBOOK,
  CREATIVE_STRATEGY_PLAYBOOK,
  ART_DIRECTION_PLAYBOOK,
  VIDEO_DIRECTION_PLAYBOOK,
];

export { CREATIVE_REFERENCES };
