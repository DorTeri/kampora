import { describe, expect, it } from 'vitest';
import { AGENT_ROLES, LayoutFamilySchema, type AgentRole } from '@kampora/shared';
import {
  ART_DIRECTION_PLAYBOOK,
  CREATIVE_REFERENCES,
  CREATIVE_RUBRIC,
  CreativeReferenceSchema,
  HOOK_TECHNIQUES,
  INDUSTRY_PROFILES,
  LAYOUT_FAMILY_PROFILES,
  PLAYBOOKS,
  copywriterExpertise,
  expertiseVersion,
  hebrewCopyIssues,
  industryById,
  industryFor,
  retrieveReferences,
} from './index';

describe('playbooks', () => {
  it('are versioned and complete, and only reference criteria that exist in the rubric', () => {
    const criteria = new Set(CREATIVE_RUBRIC.criteria.map((c) => c.id));
    for (const p of PLAYBOOKS) {
      expect(p.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(p.responsibility.length).toBeGreaterThan(20);
      expect(p.methods.length).toBeGreaterThan(0);
      expect(p.failureModes.length).toBeGreaterThan(0);
      for (const c of p.evaluationCriteria) expect(criteria.has(c)).toBe(true);
    }
    expect(expertiseVersion(industryById('fitness'))).toContain('industry:fitness@1.0.0');
  });

  it('has a layout profile for every layout family the renderer supports', () => {
    expect(Object.keys(LAYOUT_FAMILY_PROFILES).sort()).toEqual([...LayoutFamilySchema.options].sort());
    expect(ART_DIRECTION_PLAYBOOK.decisionRules.length).toBeGreaterThan(4);
  });

  it('sends the Copywriter only the methods relevant to the goal, compactly', () => {
    const offer = copywriterExpertise({ goal: 'OFFER', industry: industryById('cafe-restaurant') });
    const leads = copywriterExpertise({ goal: 'LEADS', industry: industryById('fitness') });
    expect(offer).toContain('OFFER_FIRST');
    expect(offer).not.toContain('HOW_TO:');
    expect(leads).toContain('HOW_TO');
    expect(leads).not.toContain('OFFER_FIRST');
    // Industry knowledge is framed as hypotheses, and claims needing approval are named.
    expect(leads).toContain('hypotheses, never facts');
    expect(leads).toContain('ירידה במשקל');
    // Small enough to send on every call.
    expect(offer.length).toBeLessThan(6000);
    expect(Object.keys(HOOK_TECHNIQUES)).toHaveLength(8);
  });
});

describe('industry profiles', () => {
  it('match businesses by category and fall back to generic instead of guessing', () => {
    expect(industryFor({ category: 'בית קפה ומאפייה' }).profile.id).toBe('cafe-restaurant');
    expect(industryFor({ category: 'סטודיו פילאטיס' }).profile.id).toBe('fitness');
    expect(industryFor({ category: 'אינסטלטור' }).profile.id).toBe('local-services');
    expect(industryFor({ category: 'מותג נעליים – חנות אונליין' }).profile.id).toBe('ecommerce');
    expect(industryFor({ category: 'קוסמטיקאית' }).profile.id).toBe('beauty-wellness');
    const unknown = industryFor({ category: 'משרד עורכי דין' });
    expect(unknown.matched).toBe(false);
    expect(unknown.profile.id).toBe('generic');
  });

  it('contain no statistics presented as facts', () => {
    for (const p of INDUSTRY_PROFILES) {
      const text = JSON.stringify([p.motivations, p.approaches]);
      expect(text).not.toMatch(/\d+\s?%|research|studies show|מחקר/i);
      for (const c of p.claimsRequiringVerification) expect(() => new RegExp(c.pattern)).not.toThrow();
      for (const i of p.importantInfo) expect(() => new RegExp(i.detect)).not.toThrow();
    }
  });
});

describe('Hebrew advertising lint', () => {
  it('flags clichés, formal register, calques and exclamation runs; passes natural copy', () => {
    const codes = hebrewCopyIssues('חוויה בלתי נשכחת שהינה פשוט מושלם!!').map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['CLICHE', 'FORMAL', 'EXCLAMATION']));
    expect(hebrewCopyIssues('על מנת להזמין')[0]).toMatchObject({ code: 'FORMAL', suggestion: 'כדי' });
    expect(hebrewCopyIssues('בסופו של יום זה קפה')[0]?.code).toBe('TRANSLATIONESE');
    expect(hebrewCopyIssues('קפה + מאפה ב-29.90 ₪ בפלורנטין. בואו!')).toEqual([]);
    // "הינו" inside another word is not flagged.
    expect(hebrewCopyIssues('ההינומה')).toEqual([]);
  });
});

describe('creative references', () => {
  it('are valid, original and record rights', () => {
    for (const r of CREATIVE_REFERENCES) {
      expect(() => CreativeReferenceSchema.parse(r)).not.toThrow();
      expect(r.source.usageRights.length).toBeGreaterThan(5);
    }
  });

  it('retrieves only a few relevant references, never the whole library', () => {
    const cafe = retrieveReferences({ industryId: 'cafe-restaurant', goal: 'OFFER', format: 'STATIC' });
    expect(cafe.map((r) => r.id)).toContain('ref-combo-split');
    expect(cafe.length).toBeLessThanOrEqual(2);
    const leads = retrieveReferences({ industryId: 'fitness', goal: 'LEADS', format: 'STATIC' });
    expect(leads[0]!.id).toBe('ref-type-first-leads');
    expect(retrieveReferences({ industryId: 'x', goal: 'SALES', format: 'VIDEO' })).toEqual([]);
  });
});

describe('agent role contracts', () => {
  it('declare kind, model use and paid status for every role; the Director is planned, not built', () => {
    for (const [role, c] of Object.entries(AGENT_ROLES) as [AgentRole, (typeof AGENT_ROLES)[AgentRole]][]) {
      expect(c.input.length, role).toBeGreaterThan(0);
      expect(c.output.length, role).toBeGreaterThan(0);
    }
    expect(AGENT_ROLES.CAMPAIGN_DIRECTOR.status).toBe('PLANNED');
    expect(AGENT_ROLES.ART_DIRECTOR.llm).toBe('NONE');
    expect(AGENT_ROLES.CREATIVE_CRITIC.paid).toBe(false);
  });
});
