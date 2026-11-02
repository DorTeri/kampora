import { pictureBriefFromSpec } from '@kampora/production-engine';
import {
  CreativeDirectionSchema,
  type CompositionMethod,
  type CreativeDirection,
  type CreativeDirectionSet,
  type DesignMove,
  type RevisionRequest,
  type StaticAdFormat,
  type TypeSystemId,
} from '@kampora/shared';
import { APPROACH_EXCLUDED_MOVES, APPROACH_METHODS, MOVE_GROUPS, composeDirectionSpecs, inputForDirection, type DirectionInput } from './art-director-v2';
import { technicalChecks } from './critic/composition';

/**
 * Natural-language change requests from the owner ("אני רוצה עיצוב יותר יוקרתי") become validated design changes.
 * Recognition is deterministic (a Hebrew lexicon, not a model), so the same sentence always means the same change
 * and nothing outside the closed set of intents can happen. Every change goes through the same layout engine and
 * technical checks as the original direction. The approved words are never rewritten here: a request that needs
 * new copy or a new picture becomes a paid request waiting for approval.
 */
export const CHANGE_INTENTS = [
  'ANOTHER_DIRECTION',
  'MORE_PREMIUM',
  'BOLDER',
  'CALMER',
  'TYPOGRAPHY_TOO_SIMPLE',
  'EMPHASIZE_PRICE',
  'BIGGER_HEADLINE',
  'IMAGE_MISMATCH',
  'SHORTER_COPY',
] as const;
export type ChangeIntent = (typeof CHANGE_INTENTS)[number];

export const CHANGE_INTENT_LABELS: Record<ChangeIntent, string> = {
  ANOTHER_DIRECTION: 'כיוון עיצובי אחר',
  MORE_PREMIUM: 'יותר יוקרתי',
  BOLDER: 'יותר נועז',
  CALMER: 'יותר רגוע ונקי',
  TYPOGRAPHY_TOO_SIMPLE: 'טיפוגרפיה עם יותר אופי',
  EMPHASIZE_PRICE: 'להבליט את המחיר',
  BIGGER_HEADLINE: 'כותרת גדולה יותר',
  IMAGE_MISMATCH: 'התמונה לא מתאימה',
  SHORTER_COPY: 'פחות טקסט',
};

export interface RecognizedIntent {
  intent: ChangeIntent;
  /** The words in the request that triggered it. */
  matched: string;
}

export interface ParsedChangeRequest {
  text: string;
  intents: RecognizedIntent[];
  /** Pairs that contradict each other ("יותר רגוע" and "יותר נועז"): neither is applied. */
  conflicts: [ChangeIntent, ChangeIntent][];
}

/** Hebrew without niqqud, punctuation or doubled spaces; Latin lower-cased. */
export function normalizeHebrew(text: string): string {
  return text
    .replace(/[֑-ׇ]/g, '')
    .replace(/[״"'׳`.,!?;:()\-–—]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Prefixes a Hebrew word may carry (ה, ו, ב, ל, ש, מ, כ and their combinations).
const P = '(?:^|\\s)[והבלשמכ]{0,3}';
const w = (stems: string) => `${P}(?:${stems})`;

const PRICE = w('מחיר|מחירים|מבצע|הנחה|ההצעה|הצעה|דיל');
const EMPHASIZE = w('תבליט|להבליט|הבליט|תבליטו|תדגיש|להדגיש|הדגש|תדגישו|תגדיל|להגדיל|תגדילו|בולט|בולטת');
const IMAGE = w('תמונה|תמונת|צילום|צילומים|תמונות|פוטו|ויז׳ואל|ויזואל');
const TYPE = w('טיפוגרפיה|פונט|פונטים|גופן|גופנים|אותיות|כתב|טייפ');
const HEADLINE = w('כותרת|כותרות');

/** Each intent: patterns that must all appear (in any order) in at least one alternative. */
const LEXICON: Record<ChangeIntent, readonly (readonly string[])[]> = {
  ANOTHER_DIRECTION: [
    [w('כיוון|כוון|סגנון|קונספט|עיצוב|גישה'), w('אחר|אחרת|שונה|חדש|חדשה')],
    [w('נסה|תנסה|נסו|לנסות'), w('משהו') + '\\s+(?:אחר|שונה)'],
  ],
  MORE_PREMIUM: [[w('יוקרתי|יוקרתית|יוקרה|יוקרתיים|פרימיום|אלגנטי|אלגנטית|מעודן|מעודנת|יוקרתיות|premium|luxury|high end')]],
  BOLDER: [[w('נועז|נועזת|נועזים|צעקני|צעקנית|אנרגטי|אנרגטית|צבעוני|צבעונית|חי יותר|פופי|דרמטי|דרמטית|אגרסיבי')]],
  CALMER: [
    [w('רגוע|רגועה|שקט|שקטה|נקי|נקייה|מינימליסטי|מינימליסטית|מינימלי|אוורירי|אוורירית')],
    [w('עמוס|עמוסה|צפוף|צפופה|צעקני|צעקנית'), w('מדי|מידי|פחות|יותר מדי')],
    [w('פחות'), w('עמוס|עמוסה|צפוף|צעקני|צבעוני')],
  ],
  TYPOGRAPHY_TOO_SIMPLE: [
    [TYPE, w('פשוט|פשוטה|פשוטים|פשוטות|משעמם|משעממת|משעממים|בסיסי|בסיסית|רגיל|רגילה|גנרי|גנרית|שטוח|שטוחה|חסר|חסרת')],
    [TYPE, w('עם יותר|יותר') + '\\s+(?:אופי|עניין|מעניין|מעניינת|ייחודי|ייחודית)'],
  ],
  EMPHASIZE_PRICE: [
    [EMPHASIZE, PRICE],
    [PRICE, w('לא רואים|לא בולט|לא בולטת|קטן מדי|קטן|נבלע|נבלעת|חבוי')],
    [w('לא רואים'), PRICE],
  ],
  BIGGER_HEADLINE: [[HEADLINE, w('גדולה יותר|יותר גדולה|קטנה מדי|קטנה|לא בולטת|תגדיל|להגדיל|גדולה')]],
  IMAGE_MISMATCH: [
    [IMAGE, w('לא מתאימה|לא מתאים|לא מתאימות|לא קשורה|לא קשור|לא רלוונטית|לא רלוונטי|לא נכונה|לא טובה|מכוערת|לא משקפת|לא דומה|לא שלנו')],
    [IMAGE, w('אחרת|להחליף|תחליף|תחליפו|החלף|לשנות')],
    [w('להחליף|תחליף|תחליפו|החלף'), IMAGE],
  ],
  SHORTER_COPY: [
    [w('טקסט|כיתוב|מילים|מלל'), w('ארוך|ארוכה|יותר מדי|מדי|פחות|לקצר|קצר')],
    [w('לקצר|תקצר|תקצרו|קצר יותר')],
    [w('פחות'), w('טקסט|מילים|מלל|כיתוב')],
  ],
};

const CONFLICTS: [ChangeIntent, ChangeIntent][] = [
  ['BOLDER', 'CALMER'],
  ['BOLDER', 'MORE_PREMIUM'],
];

export function parseChangeRequest(text: string): ParsedChangeRequest {
  const norm = ` ${normalizeHebrew(text)} `;
  const intents: RecognizedIntent[] = [];
  for (const intent of CHANGE_INTENTS) {
    for (const alt of LEXICON[intent]) {
      const hits = alt.map((p) => norm.match(new RegExp(p))?.[0]?.trim());
      if (hits.every(Boolean)) {
        intents.push({ intent, matched: hits.join(' … ') });
        break;
      }
    }
  }
  const has = (i: ChangeIntent) => intents.some((x) => x.intent === i);
  // "תבליט את המחיר" uses an emphasis verb that also reads as "bolder": the price request is the specific one.
  let result = intents;
  if (has('EMPHASIZE_PRICE')) result = result.filter((x) => x.intent !== 'BOLDER' || !/בולט|תבליט|הבליט/.test(x.matched));
  const conflicts = CONFLICTS.filter(([a, b]) => result.some((x) => x.intent === a) && result.some((x) => x.intent === b));
  return { text, intents: result, conflicts };
}

export interface ChangeOutcome {
  parsed: ParsedChangeRequest;
  /** The revised direction (validated), or the original when nothing could be applied. */
  direction: CreativeDirection;
  /** What happened for each recognised intent, in the order applied. */
  changes: RevisionRequest[];
  /** Technical QA of the revised specs, per format. */
  technical: Record<string, { verdict: 'PASS' | 'REVISE'; problems: string[] }>;
  /** A short Hebrew summary for the owner. */
  summary: string;
  /** Suggestions when nothing was recognised. */
  suggestions?: string[];
}

interface Draft {
  method: CompositionMethod;
  moves: DesignMove[];
  typeSystem: TypeSystemId;
  emphasis: CreativeDirection['emphasis'];
  withoutPicture: boolean;
  name: string;
  idea: string;
}

const PALETTE_GROUP = MOVE_GROUPS[0]!;
const PICTURE_ONLY: readonly CompositionMethod[] = ['IMAGE_FIRST', 'LIFESTYLE', 'LAYERED', 'PRODUCT_LED'];

/** Moves that cost the most space, in the order they are given up when the approved copy does not fit. */
const HEAVY_MOVES: readonly DesignMove[] = ['STACKED_HEADLINE', 'OVERSIZED_HEADLINE', 'GENEROUS_NEGATIVE_SPACE', 'GEOMETRIC_SHAPES', 'OVERLAPPING_ELEMENTS'];

/** Adds moves (replacing others of the same exclusive group) and removes moves; never more than six. */
function editMoves(moves: readonly DesignMove[], add: readonly DesignMove[], remove: readonly DesignMove[], excluded: readonly DesignMove[]): DesignMove[] {
  let next = moves.filter((m) => !remove.includes(m));
  for (const m of add) {
    if (excluded.includes(m) || next.includes(m)) continue;
    const group = MOVE_GROUPS.find((g) => g.includes(m));
    if (group) next = next.filter((x) => !group.includes(x));
    next.push(m);
  }
  // Keep the newest decisions: drop the oldest of the moves that were not just asked for. MINIMAL_COPY stays: it is
  // what keeps a subheadline from repeating the price.
  while (next.length > 6) {
    const i = next.findIndex((m) => !add.includes(m) && m !== 'MINIMAL_COPY');
    if (i < 0) break;
    next.splice(i, 1);
  }
  return next;
}

function request(component: RevisionRequest['component'], criteria: string[], instruction: string, cost: RevisionRequest['cost'], status: RevisionRequest['status'], change?: string): RevisionRequest {
  return { component, criteria, instruction, cost, status, ...(change ? { change } : {}) };
}

/**
 * Applies a Hebrew change request to one direction of a set. Free changes (art direction and layout) are applied
 * and re-checked; changes that need new words or a new picture are recorded as paid requests awaiting approval.
 */
export function applyCreativeChange(setInput: DirectionInput, set: CreativeDirectionSet, key: CreativeDirection['key'], text: string): ChangeOutcome {
  const parsed = parseChangeRequest(text);
  const original = set.directions.find((d) => d.key === key);
  if (!original) throw new Error(`No direction ${key}`);
  // A direction is changed on its own picture, not the set's first one.
  const input = inputForDirection(setInput, original);
  const approach = original.approach;
  const excluded = APPROACH_EXCLUDED_MOVES[approach];
  const formats = Object.keys(original.specs) as StaticAdFormat[];
  const conflicted = new Set(parsed.conflicts.flat());
  const changes: RevisionRequest[] = [];
  const d: Draft = {
    method: original.method,
    moves: [...original.moves],
    typeSystem: original.typeSystem,
    emphasis: original.emphasis,
    withoutPicture: !input.picture,
    name: original.name,
    idea: original.idea,
  };
  const hasPicture = () => Boolean(input.picture) && !d.withoutPicture;

  for (const c of parsed.conflicts)
    changes.push(request('ART_DIRECTOR', [c[0], c[1]], `"${CHANGE_INTENT_LABELS[c[0]]}" ו"${CHANGE_INTENT_LABELS[c[1]]}" סותרים זה את זה`, 'FREE', 'NEEDS_OWNER'));

  for (const { intent } of parsed.intents) {
    if (conflicted.has(intent)) continue;
    switch (intent) {
      case 'ANOTHER_DIRECTION': {
        const used = new Set(set.directions.map((x) => x.method));
        const pool = APPROACH_METHODS[approach].filter((m) => !used.has(m) && (hasPicture() || !PICTURE_ONLY.includes(m)) && (m !== 'PRODUCT_LED' || ['VERIFIED_PRODUCT_PHOTO', 'REFERENCE_GUIDED_AI'].includes(input.picture?.authenticity ?? '')));
        if (!pool.length) {
          changes.push(request('ART_DIRECTOR', ['DIFFERENTIATION'], 'אין סידור נוסף בגישה הזו שלא נוסה כבר; אפשר לבחור אחד משני הכיוונים האחרים', 'FREE', 'NOT_POSSIBLE'));
          break;
        }
        const kept = d.moves.filter((m) => PALETTE_GROUP.includes(m) || ['CTA_AS_TEXT_LINE', 'CTA_BUTTON', 'LOGO_SMALL_CORNER', 'LOGO_AS_SIGNOFF', 'MINIMAL_COPY'].includes(m));
        const signature: Partial<Record<CompositionMethod, DesignMove[]>> = {
          SPLIT: ['SPLIT_PANEL'],
          ASYMMETRIC: ['ASYMMETRIC_GRID', 'OVERLAPPING_ELEMENTS'],
          EDITORIAL: ['SERIF_EDITORIAL', 'RULE_LINES', 'GENEROUS_NEGATIVE_SPACE'],
          LAYERED: ['LAYERED_TYPE_OVER_IMAGE'],
          LIFESTYLE: ['FULL_BLEED_IMAGE'],
          IMAGE_FIRST: ['FULL_BLEED_IMAGE', 'SINGLE_FOCAL_POINT'],
          BOLD_TYPE: ['OVERSIZED_HEADLINE', 'STACKED_HEADLINE'],
          PROMO_PRICE: ['PRICE_AS_GRAPHIC'],
          LOCAL_MODERN: ['FRAME_BORDER', 'LOGO_AS_SIGNOFF'],
        };
        const designInput: DirectionInput = d.withoutPicture ? { ...input, picture: undefined } : input;
        const ordered = [...pool.filter((m) => m !== 'SPLIT' || hasPicture()), ...pool.filter((m) => m === 'SPLIT' && !hasPicture())];
        const trial = (m: CompositionMethod) => editMoves(kept, signature[m] ?? [], [], excluded);
        // The first unused arrangement the approved copy fits into, at full type size.
        const method =
          ordered.find((m) => Object.values(composeDirectionSpecs(designInput, approach, m, trial(m), d.typeSystem, formats, d.emphasis)).every((s) => s.fit.status !== 'UNRESOLVED')) ?? ordered[0]!;
        const from = d.method;
        d.method = method;
        // A new arrangement keeps the brand's palette and type, but sheds the moves that belonged to the old one.
        d.moves = trial(method);
        if (method === 'PROMO_PRICE' && !input.copy.price) d.emphasis = 'HEADLINE';
        changes.push(request('ART_DIRECTOR', ['DIFFERENTIATION'], 'כיוון עיצובי אחר', 'FREE', 'APPLIED', `הסידור הוחלף מ-${from} ל-${method}; הצבעים, הגופן והטקסט נשמרו`));
        break;
      }
      case 'MORE_PREMIUM': {
        const before = d.typeSystem;
        d.moves = editMoves(
          d.moves,
          ['GENEROUS_NEGATIVE_SPACE', hasPicture() && !excluded.includes('DARK_MOODY') ? 'DARK_MOODY' : 'MUTED_NATURAL_PALETTE', 'CTA_AS_TEXT_LINE', ...(d.emphasis === 'PRICE' ? [] : (['PRICE_UNDERSTATED'] as DesignMove[]))],
          ['VIBRANT_COMPLEMENTARY', 'BADGE_STAMP', 'GEOMETRIC_SHAPES', 'BRAND_COLOR_FLOOD', 'STACKED_HEADLINE', 'HANDWRITTEN_ACCENT', 'ILLUSTRATIVE_ELEMENTS'],
          excluded.filter((m) => m !== 'GENEROUS_NEGATIVE_SPACE' && m !== 'MUTED_NATURAL_PALETTE'),
        );
        d.typeSystem = approach === 'BOLD_GRAPHIC' ? 'CONDENSED_IMPACT' : approach === 'EDITORIAL_TYPE' ? 'LUXURY_SERIF' : 'PRECISE_CLEAN';
        if (d.method === 'PROMO_PRICE' && d.emphasis !== 'PRICE') d.method = 'BOLD_TYPE';
        changes.push(request('ART_DIRECTOR', ['PROFESSIONAL_POLISH'], 'יותר יוקרתי', 'FREE', 'APPLIED', `יותר אוויר, פלטה שקטה, פעולה כשורת טקסט; הגופן ${before === d.typeSystem ? 'נשאר' : `הוחלף מ-${before} ל-${d.typeSystem}`}`));
        break;
      }
      case 'BOLDER': {
        const palette: DesignMove = excluded.includes('BRAND_COLOR_FLOOD') ? 'VIBRANT_COMPLEMENTARY' : 'BRAND_COLOR_FLOOD';
        d.moves = editMoves(d.moves, [palette, 'OVERSIZED_HEADLINE', 'CTA_BUTTON'], ['GENEROUS_NEGATIVE_SPACE', 'MUTED_NATURAL_PALETTE', 'PRICE_UNDERSTATED'], excluded.filter((m) => m !== 'OVERSIZED_HEADLINE'));
        if (approach === 'BOLD_GRAPHIC') d.typeSystem = d.typeSystem === 'CONDENSED_IMPACT' ? 'BOLD_DISPLAY' : 'CONDENSED_IMPACT';
        changes.push(request('ART_DIRECTOR', ['VISUAL_HIERARCHY'], 'יותר נועז', 'FREE', 'APPLIED', 'צבע מותג חזק יותר, כותרת גדולה יותר וכפתור פעולה'));
        break;
      }
      case 'CALMER': {
        d.moves = editMoves(d.moves, ['GENEROUS_NEGATIVE_SPACE', 'MUTED_NATURAL_PALETTE'], ['GEOMETRIC_SHAPES', 'BADGE_STAMP', 'VIBRANT_COMPLEMENTARY', 'OVERLAPPING_ELEMENTS', 'STACKED_HEADLINE', 'TEXTURE_GRAIN', 'BRAND_COLOR_FLOOD'], excluded.filter((m) => m !== 'GENEROUS_NEGATIVE_SPACE' && m !== 'MUTED_NATURAL_PALETTE'));
        changes.push(request('ART_DIRECTOR', ['LAYOUT_BALANCE'], 'יותר רגוע ונקי', 'FREE', 'APPLIED', 'הוסרו צורות ואלמנטים מתחרים, נוסף אוויר, פלטה שקטה יותר'));
        break;
      }
      case 'TYPOGRAPHY_TOO_SIMPLE': {
        const before = d.typeSystem;
        const options: Record<typeof approach, TypeSystemId[]> = {
          EDITORIAL_TYPE: ['EDITORIAL_SERIF', 'LUXURY_SERIF', 'CLASSIC_WARM'],
          BOLD_GRAPHIC: ['CONDENSED_IMPACT', 'BOLD_DISPLAY', 'CLASSIC_WARM'],
          IMAGE_LED: ['EDITORIAL_SERIF', 'CONDENSED_IMPACT', 'CLASSIC_WARM'],
        };
        const others = new Set(set.directions.filter((x) => x.key !== key).map((x) => x.typeSystem));
        d.typeSystem = options[approach].find((t) => t !== before && !others.has(t)) ?? options[approach].find((t) => t !== before)!;
        const add: DesignMove[] = approach === 'EDITORIAL_TYPE' ? ['SERIF_EDITORIAL', 'RULE_LINES'] : approach === 'BOLD_GRAPHIC' ? ['STACKED_HEADLINE', 'OVERSIZED_HEADLINE'] : ['OVERSIZED_HEADLINE'];
        d.moves = editMoves(d.moves, add, [], excluded);
        changes.push(request('ART_DIRECTOR', ['TYPOGRAPHY'], 'טיפוגרפיה עם יותר אופי', 'FREE', 'APPLIED', `הגופן הוחלף מ-${before} ל-${d.typeSystem}, עם ${add.join(', ')}`));
        break;
      }
      case 'EMPHASIZE_PRICE': {
        if (!input.copy.price) {
          changes.push(request('OWNER', ['OFFER_COMMUNICATION'], 'אין מחיר מאושר בבריף; Kampora לא ממציאה מחיר', 'FREE', 'NEEDS_OWNER'));
          break;
        }
        d.emphasis = 'PRICE';
        // Two heroes is no hero: moves that make the headline the image step back so the price can lead.
        const yielded = d.moves.filter((m) => m === 'OVERSIZED_HEADLINE' || m === 'TYPE_AS_IMAGE');
        d.moves = editMoves(d.moves, ['PRICE_AS_GRAPHIC'], ['PRICE_UNDERSTATED', 'BADGE_STAMP', ...yielded], excluded.filter((m) => m !== 'PRICE_AS_GRAPHIC'));
        changes.push(request('ART_DIRECTOR', ['OFFER_COMMUNICATION'], 'להבליט את המחיר', 'FREE', 'APPLIED', `המחיר ${input.copy.price.price} הפך למוקד: ספרה גדולה בגופן התצוגה${yielded.length ? ', והכותרת קטנה מהמחיר' : ''}. המחיר עצמו לא השתנה`));
        break;
      }
      case 'BIGGER_HEADLINE': {
        d.moves = editMoves(d.moves, ['OVERSIZED_HEADLINE'], [], excluded.filter((m) => m !== 'OVERSIZED_HEADLINE'));
        if (d.emphasis !== 'PRICE') d.emphasis = 'HEADLINE';
        changes.push(request('LAYOUT_ENGINE', ['VISUAL_HIERARCHY'], 'כותרת גדולה יותר', 'FREE', 'APPLIED', 'הכותרת מקבלת גודל תצוגה גדול יותר; אם לא נכנסת, המערכת תציע קיצור ולא תכווץ'));
        break;
      }
      case 'IMAGE_MISMATCH': {
        if (!input.picture) {
          changes.push(request('OWNER', ['IMAGE_RELEVANCE'], 'אין כרגע תמונה בעיצוב; אפשר להעלות תמונה אמיתית של העסק', 'FREE', 'NEEDS_OWNER'));
          break;
        }
        const brief = pictureBriefFromSpec(original.specs['9:16'] ?? Object.values(original.specs)[0]!);
        changes.push(request('VISUAL_PLANNER', ['IMAGE_RELEVANCE'], `תמונה חדשה שמראה את המוצר עצמו${brief ? `; ${brief.guidance}` : ''}. עדיף צילום אמיתי של העסק`, 'PAID', 'PENDING_APPROVAL'));
        // Meanwhile the direction works without the picture, so the owner is not stuck with an image they rejected.
        d.withoutPicture = true;
        d.moves = d.moves.filter((m) => !['FULL_BLEED_IMAGE', 'LAYERED_TYPE_OVER_IMAGE', 'CUTOUT_PRODUCT_ON_COLOR', 'DETAIL_MACRO_CROP', 'HIGH_CONTRAST_DUOTONE', 'IMAGE_INSET_FRAME', 'PEOPLE_AS_HERO', 'PRODUCT_AS_HERO'].includes(m));
        if ([...PICTURE_ONLY, 'SPLIT'].includes(d.method)) {
          const taken = new Set(set.directions.filter((x) => x.key !== key).map((x) => x.method));
          d.method = taken.has('ASYMMETRIC') ? 'BOLD_TYPE' : 'ASYMMETRIC';
          d.name = 'צורה וצבע מובילים';
          d.idea = 'עד שתגיע תמונה מתאימה: שדות צבע וצורות מחליפים את התמונה, והכותרת יושבת בשדה הרגוע.';
        }
        if (d.emphasis === 'IMAGE') d.emphasis = 'HEADLINE';
        changes.push(request('ART_DIRECTOR', ['IMAGE_RELEVANCE'], 'בינתיים: עיצוב בלי התמונה שנפסלה', 'FREE', 'APPLIED', `התמונה הוסרה מהכיוון הזה עד לאישור תמונה חדשה; הסידור ${d.method}`));
        break;
      }
      case 'SHORTER_COPY': {
        changes.push(request('COPYWRITER', ['READABILITY'], 'קיצור הטקסט. הנוסח המאושר לא משתנה בלי אישור', 'PAID', 'PENDING_APPROVAL'));
        // The free part: the composition stops repeating what the price already says.
        if (!d.moves.includes('MINIMAL_COPY')) {
          d.moves = editMoves(d.moves, ['MINIMAL_COPY'], [], []);
          changes.push(request('LAYOUT_ENGINE', ['READABILITY'], 'פחות טקסט בעיצוב', 'FREE', 'APPLIED', 'כותרת המשנה מושמטת רק כשהיא חוזרת על המחיר; שום מילה לא נכתבה מחדש'));
        }
        break;
      }
    }
  }

  const technical: ChangeOutcome['technical'] = {};
  let direction = original;
  let specs: ReturnType<typeof composeDirectionSpecs> | undefined;
  if (changes.some((c) => c.status === 'APPLIED')) {
    const designInput: DirectionInput = d.withoutPicture ? { ...input, picture: undefined } : input;
    const compose = () => composeDirectionSpecs(designInput, approach, d.method, d.moves, d.typeSystem, formats, d.emphasis);
    const unresolved = (x: ReturnType<typeof compose>) => Object.values(x).some((s) => s.fit.status === 'UNRESOLVED');
    specs = compose();
    // The copy must fit without shrinking the type: shed the heaviest moves first, one at a time.
    for (const heavy of HEAVY_MOVES) {
      if (!unresolved(specs)) break;
      if (!d.moves.includes(heavy)) continue;
      d.moves = d.moves.filter((m) => m !== heavy);
      specs = compose();
      changes.push(request('LAYOUT_ENGINE', ['TYPOGRAPHY'], `הוסר ${heavy} כדי שהטקסט ייכנס`, 'FREE', 'APPLIED', `${heavy} הוסר: הטקסט המאושר לא נכנס איתו, ו-Kampora לא מכווצת כותרות`));
    }
    if (unresolved(specs)) {
      // Another arrangement of the same approach, before giving up: a different composition beats shrinking type.
      const taken = new Set(set.directions.filter((x) => x.key !== key).map((x) => x.method));
      const realProduct = ['VERIFIED_PRODUCT_PHOTO', 'REFERENCE_GUIDED_AI'].includes(input.picture?.authenticity ?? '');
      for (const m of APPROACH_METHODS[approach]) {
        if (m === d.method || taken.has(m) || (!hasPicture() && PICTURE_ONLY.includes(m)) || (m === 'PRODUCT_LED' && !realProduct)) continue;
        const trial = composeDirectionSpecs(designInput, approach, m, d.moves, d.typeSystem, formats, d.emphasis);
        if (unresolved(trial)) continue;
        changes.push(request('LAYOUT_ENGINE', ['TYPOGRAPHY'], `הסידור הוחלף ל-${m} כדי שהטקסט ייכנס`, 'FREE', 'APPLIED', `הסידור הוחלף מ-${d.method} ל-${m}: הטקסט המאושר נכנס בו בגודל המלא`));
        d.method = m;
        specs = trial;
        break;
      }
    }
    // A change must not bring back a price said twice: the composition stops repeating it (no word changes).
    if (!unresolved(specs) && !d.moves.includes('MINIMAL_COPY') && Object.values(specs).some((sp) => technicalChecks(sp).some((r) => r.criterion === 'OFFER_COMMUNICATION' && r.severity === 'MAJOR'))) {
      d.moves = [...d.moves, 'MINIMAL_COPY'];
      specs = compose();
      changes.push(request('LAYOUT_ENGINE', ['OFFER_COMMUNICATION'], 'המחיר לא נאמר פעמיים', 'FREE', 'APPLIED', 'כותרת המשנה שחוזרת על המחיר מושמטת; שום מילה לא נכתבה מחדש'));
    }
    if (unresolved(specs)) {
      for (const c of changes) if (c.status === 'APPLIED') Object.assign(c, { status: 'NOT_POSSIBLE', change: undefined });
      changes.push(request('COPYWRITER', ['TYPOGRAPHY'], 'הטקסט המאושר לא נכנס בעיצוב המבוקש; צריך נוסח קצר יותר או כיוון אחר', 'PAID', 'PENDING_APPROVAL'));
    }
  }
  const applied = changes.filter((c) => c.status === 'APPLIED');
  if (applied.length && specs) {
    const note = { topic: 'owner change', decision: applied.map((c) => c.change).join('; '), because: `בקשת הבעלים: "${text.trim()}"` };
    direction = CreativeDirectionSchema.parse({
      ...original,
      name: d.name,
      idea: d.idea,
      method: d.method,
      moves: d.moves,
      typeSystem: d.typeSystem,
      emphasis: d.emphasis,
      rationale: [...original.rationale, note],
      specs: Object.fromEntries(Object.entries(specs).map(([f, s]) => [f, { ...s, rationale: { decisions: [note, ...s.rationale.decisions], references: original.references } }])),
      copyRequests: Object.values(specs).flatMap((s) => s.fit.suggestions).filter((r, j, all) => all.findIndex((x) => x.role === r.role) === j),
    });
  }
  for (const [f, s] of Object.entries(direction.specs)) {
    const problems = technicalChecks(s).filter((r) => r.severity === 'MAJOR' || r.severity === 'CRITICAL');
    technical[f] = { verdict: problems.length || s.fit.status === 'UNRESOLVED' ? 'REVISE' : 'PASS', problems: [...problems.map((p) => `${p.criterion}: ${p.explanation}`), ...(s.fit.status === 'UNRESOLVED' ? ['הטקסט לא נכנס בסידור הזה'] : [])] };
  }

  const pending = changes.filter((c) => c.status === 'PENDING_APPROVAL');
  const needsOwner = changes.filter((c) => c.status === 'NEEDS_OWNER' || c.status === 'NOT_POSSIBLE');
  const summary = !parsed.intents.length
    ? 'לא זיהיתי שינוי עיצובי בבקשה. אפשר לנסח למשל: "יותר יוקרתי", "תבליט את המחיר", "הטיפוגרפיה פשוטה מדי", "נסה כיוון אחר".'
    : [
        applied.length ? `בוצע: ${applied.map((c) => c.instruction).join(', ')}.` : '',
        pending.length ? `ממתין לאישור (בתשלום): ${pending.map((c) => c.instruction).join('; ')}.` : '',
        needsOwner.length ? `דורש החלטה שלך: ${needsOwner.map((c) => c.instruction).join('; ')}.` : '',
      ]
        .filter(Boolean)
        .join(' ');
  return {
    parsed,
    direction,
    changes,
    technical,
    summary,
    ...(parsed.intents.length ? {} : { suggestions: CHANGE_INTENTS.map((i) => CHANGE_INTENT_LABELS[i]) }),
  };
}
