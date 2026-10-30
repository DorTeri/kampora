import {
  ProfessionalCreativeBriefSchema,
  mediaAuthenticity,
  type AvailableAsset,
  type BriefList,
  type BriefText,
  type BusinessProfile,
  type CampaignBrief,
  type CampaignGoal,
  type FieldSource,
  type InfoProvenance,
  type MissingInfoQuestion,
  type ProfessionalCreativeBrief,
  type ToneOfVoice,
} from '@kampora/shared';
import {
  expertiseVersion,
  industryFor,
  retrieveReferences,
  type IndustryProfile,
} from '@kampora/agent-expertise';

const GOAL_OBJECTIVE: Record<CampaignGoal, string> = {
  OFFER: 'להביא לקוחות לנצל את המבצע',
  SALES: 'להגדיל מכירות',
  LEADS: 'לקבל פניות מלקוחות חדשים',
  PRODUCT_PROMO: 'לעורר רצון לנסות את המוצר',
  AWARENESS: 'שיותר אנשים באזור יכירו את העסק',
};

const TONE_PERSONALITY: Record<ToneOfVoice, string> = {
  friendly: 'ידידותי ונגיש',
  premium: 'איכותי ומאופק',
  energetic: 'אנרגטי ונועז',
  professional: 'מקצועי ואמין',
  warm: 'חם ואישי',
  playful: 'שובב וקליל',
};

const TONE_TYPOGRAPHY: Record<ToneOfVoice, string> = {
  friendly: 'כותרות עבות וברורות, מעט טקסט',
  premium: 'משקל קל יותר, הרבה אוויר, היררכיה עדינה',
  energetic: 'כותרות גדולות וכבדות, ניגודיות חזקה',
  professional: 'נקי ומסודר, יישור לקו הקריאה',
  warm: 'עגול ורך, כותרות בינוניות',
  playful: 'כותרות גדולות, קצב חופשי',
};

/** Business memory provenance → brief provenance. Unconfirmed inferences are never treated as facts. */
function fromFieldSource(source: FieldSource | undefined): InfoProvenance {
  if (source === 'INFERRED_UNCONFIRMED') return 'AI_INFERRED';
  if (source === 'INFERRED_CONFIRMED') return 'VERIFIED';
  return 'CUSTOMER_PROVIDED';
}

const text = (value: string | null | undefined, provenance: InfoProvenance, source?: string): BriefText =>
  value && value.trim()
    ? { value: value.trim(), provenance, source }
    : { value: null, provenance: 'MISSING', source };
const list = (value: readonly string[], provenance: InfoProvenance, source?: string): BriefList =>
  value.length ? { value: [...value], provenance, source } : { value: null, provenance: 'MISSING', source };

export interface ProfessionalBriefInput {
  business: BusinessProfile;
  brief: CampaignBrief;
  /** The business's media (with provenance); counts real photos vs AI images. */
  assets?: readonly AvailableAsset[];
  /** Owner notes given with the request. */
  notes?: string;
}

/**
 * Business Intelligence: the professional creative brief, built deterministically from the business memory, the
 * owner's request and the industry profile. Every field says where it came from; anything unknown is MISSING and
 * becomes a question — but a fact already in the business memory is never asked for again.
 */
export function buildProfessionalBrief(input: ProfessionalBriefInput): ProfessionalCreativeBrief {
  const { business: b, brief } = input;
  const src = b.fieldSources;
  const { profile: industry, matched } = industryFor(b);
  const questions: MissingInfoQuestion[] = [];
  const ask = (q: MissingInfoQuestion) => {
    if (!questions.some((x) => x.field === q.field)) questions.push(q);
  };
  const offerGoal = brief.goal === 'OFFER' || brief.goal === 'SALES';

  // Media: only the business's own photos represent the real product or place.
  const media = (input.assets ?? [])
    .filter((a) => a.kind === 'image' && a.commercialUse)
    .map((a) => ({
      assetId: a.id,
      authenticity: mediaAuthenticity({
        source: a.source ?? 'CUSTOMER_UPLOAD',
        mimeType: a.mimeType ?? 'image/jpeg',
        tags: a.tags,
        description: a.description,
      }),
      description: a.description,
    }));
  const productPhotos = media.filter((m) => m.authenticity === 'VERIFIED_PRODUCT_PHOTO').length;
  const businessPhotos = media.filter((m) => m.authenticity === 'VERIFIED_BUSINESS_PHOTO').length;
  const aiImages = media.filter(
    (m) => m.authenticity === 'SYNTHETIC_AI' || m.authenticity === 'REFERENCE_GUIDED_AI',
  ).length;

  // Everything the business already told us: industry questions are only asked when the answer is not here.
  const memory = [
    b.description,
    b.address ?? '',
    b.city ?? '',
    ...b.approvedClaims,
    ...b.guidelines,
    ...b.products.map((p) => `${p.name} ${p.description}`),
    brief.offer ?? '',
    input.notes ?? '',
    ...brief.constraints,
  ].join(' \n ');

  for (const info of industry.importantInfo) {
    if (info.goals && !info.goals.includes(brief.goal)) continue;
    if (new RegExp(info.detect, 'i').test(memory)) continue;
    ask({
      field: `industry.${info.id}`,
      question: info.question,
      reason: `${info.label} – מידע שלקוחות של ${industry.label} מחפשים לפני שהם מחליטים.`,
      priority: 'RECOMMENDED',
      answer: 'TEXT',
    });
  }

  const offer = text(brief.offer, 'CUSTOMER_PROVIDED', 'request.offer');
  if (offerGoal && !brief.offer)
    ask({
      field: 'campaign.offer',
      question: 'מה בדיוק ההצעה – מה כוללת וכמה עולה?',
      reason: 'בקמפיין מבצע המחיר והתנאים הם המסר המרכזי, ואסור לנו לנחש אותם.',
      priority: 'REQUIRED',
      answer: 'TEXT',
    });
  // "עד סוף החודש", "בתוקף עד…", or a full date; a price such as 29.90 is not a date.
  const durationMatch =
    brief.offer?.match(/(?:עד|בתוקף)\s+[^,]+/) ?? brief.offer?.match(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/);
  const duration = durationMatch
    ? text(durationMatch[0], 'CUSTOMER_PROVIDED', 'request.offer')
    : text(null, 'MISSING');
  if (offerGoal && brief.offer && !durationMatch)
    ask({
      field: 'campaign.duration',
      question: 'עד מתי המבצע בתוקף?',
      reason: 'בלי תאריך סיום לא נכתוב דחיפות ("רק השבוע"), כי זו הבטחה שלא אושרה.',
      priority: 'RECOMMENDED',
      answer: 'TEXT',
    });

  if (!b.approvedClaims.length)
    ask({
      field: 'business.approvedClaims',
      question: 'מה מייחד אתכם? כתבו משפט או שניים שמותר לנו לומר בפרסום.',
      reason: 'בלי טענות מאושרות נכתוב רק עובדות על המוצר והמחיר, בלי הבטחות.',
      priority: 'RECOMMENDED',
      answer: 'TEXT',
    });
  if (productPhotos === 0 && brief.goal !== 'AWARENESS')
    ask({
      field: 'business.media',
      question: `יש לכם צילומים אמיתיים של ${brief.productName}? העלו 2–3 תמונות.`,
      reason: 'בלי צילום אמיתי התמונות יהיו המחשה כללית ב-AI, ולא נציג אותן כמוצר שלכם.',
      priority: 'RECOMMENDED',
      answer: 'MEDIA',
    });
  for (const [field, label] of [
    ['description', 'תיאור העסק'],
    ['targetAudience', 'קהל היעד'],
  ] as const) {
    if (src[field] === 'INFERRED_UNCONFIRMED')
      ask({
        field: `business.${field}`,
        question: `${label} שמצאנו: "${b[field]}". זה נכון?`,
        reason: 'מידע שהסקנו בעצמנו לא מוצג כעובדה עד שתאשרו אותו.',
        priority: 'RECOMMENDED',
        answer: 'CONFIRM',
        proposedValue: b[field],
      });
  }

  const claimsProvenance: InfoProvenance = 'VERIFIED';
  const industrySource = `industry:${industry.id}@${industry.version}`;
  const refs = retrieveReferences({ industryId: industry.id, goal: brief.goal, format: 'STATIC', limit: 3 });
  const keyIsClaim = b.approvedClaims.includes(brief.keyMessage);

  const result: ProfessionalCreativeBrief = {
    version: 1,
    expertiseVersion: expertiseVersion(industry),
    industry: { id: industry.id, label: industry.label, matched },
    business: {
      identity: text(
        `${b.name} – ${b.category}${b.city ? `, ${b.city}` : ''}`,
        fromFieldSource(src.name ?? src.category),
        'business',
      ),
      products: list(
        b.products.map((p) => (p.price ? `${p.name} – ${p.price.amount} ₪` : p.name)),
        fromFieldSource(src.products),
        'business.products',
      ),
      brandDetails: list(
        [
          `טון: ${TONE_PERSONALITY[b.tone]}`,
          `צבעי מותג: ${b.brandColors.primary}, ${b.brandColors.accent}`,
          ...(b.logoAssetId ? ['יש לוגו'] : []),
        ],
        fromFieldSource(src.brandColors ?? src.tone),
        'business.brand',
      ),
      approvedClaims: list(b.approvedClaims, claimsProvenance, 'business.approvedClaims'),
      productConstraints: {
        value: [...b.guidelines],
        provenance: fromFieldSource(src.guidelines),
        source: 'business.guidelines',
      },
      positioning: text(b.description, fromFieldSource(src.description), 'business.description'),
      media: {
        verifiedProductPhotos: productPhotos,
        verifiedBusinessPhotos: businessPhotos,
        aiImages,
        items: media.slice(0, 24),
      },
    },
    campaign: {
      goal: brief.goal,
      objective: text(
        `${GOAL_OBJECTIVE[brief.goal]}: ${brief.productName}`,
        'CUSTOMER_PROVIDED',
        'request.goal',
      ),
      audience: text(brief.audience, fromFieldSource(src.targetAudience), 'business.targetAudience'),
      desiredAction: text(brief.cta, 'AI_INFERRED', 'goal default CTA'),
      offer,
      duration,
      distribution: {
        value: ['Reels 9:16', 'פיד 1:1', 'פיד 4:5', 'סטורי 9:16'],
        provenance: 'AI_INFERRED',
        source: 'Kampora default placements',
      },
      budgetUsd: brief.productionBudgetUsd,
    },
    strategy: {
      customerProblem: text(
        input.notes ? null : `השערה: ${industry.motivations[0]}`,
        'AI_INFERRED',
        industrySource,
      ),
      coreInsight: input.notes
        ? text(input.notes, 'CUSTOMER_PROVIDED', 'request.notes')
        : text(`השערה לבדיקה: ${industry.motivations.slice(0, 2).join(', ')}`, 'AI_INFERRED', industrySource),
      valueProposition: b.approvedClaims[0]
        ? text(b.approvedClaims[0], 'VERIFIED', 'business.approvedClaims')
        : text(b.description, fromFieldSource(src.description), 'business.description'),
      primaryMessage: text(
        brief.keyMessage,
        keyIsClaim ? 'VERIFIED' : fromFieldSource(src.description),
        keyIsClaim ? 'business.approvedClaims' : 'business.description',
      ),
      emotionalDirection: text(industry.emotionalDirection, 'AI_INFERRED', industrySource),
      reasonsToBelieve: list(b.approvedClaims, claimsProvenance, 'business.approvedClaims'),
      tone: text(TONE_PERSONALITY[b.tone], fromFieldSource(src.tone), 'business.tone'),
      restrictions: {
        value: [
          ...brief.constraints,
          ...industry.claimsRequiringVerification
            .filter((c) => !b.approvedClaims.some((claim) => new RegExp(c.pattern).test(claim)))
            .map((c) => `לא לטעון "${c.label}" בלי אישור העסק`),
        ],
        provenance: 'VERIFIED',
        source: `brief.constraints + ${industrySource}`,
      },
    },
    visual: {
      brandPersonality: text(TONE_PERSONALITY[b.tone], 'AI_INFERRED', 'business.tone'),
      visualStyle: { value: industry.visual.style, provenance: 'AI_INFERRED', source: industrySource },
      typography: text(TONE_TYPOGRAPHY[b.tone], 'AI_INFERRED', 'business.tone'),
      colorDirection: list(
        [b.brandColors.primary, b.brandColors.secondary, b.brandColors.accent, b.brandColors.background],
        fromFieldSource(src.brandColors),
        'business.brandColors',
      ),
      photographyDirection: text(industry.visual.use.join(', '), 'AI_INFERRED', industrySource),
      references: list(
        refs.map((r) => r.id),
        'AI_INFERRED',
        'reference library',
      ),
      productRepresentation: productPhotos
        ? text('צילומי המוצר שלכם ישמשו בכל מקום שהמוצר האמיתי חייב להופיע', 'VERIFIED', 'business.media')
        : text('אין צילומי מוצר: תמונות AI יסומנו כהמחשה כללית ולא כמוצר שלכם', 'VERIFIED', 'business.media'),
    },
    questions,
    readiness: {
      ready: !questions.some((q) => q.priority === 'REQUIRED'),
      missingRequired: questions.filter((q) => q.priority === 'REQUIRED').map((q) => q.field),
    },
  };
  return ProfessionalCreativeBriefSchema.parse(result);
}

export type { IndustryProfile };
