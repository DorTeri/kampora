import type { BusinessModel, DirectorTask, FactKey, MarketingObjective } from '@kampora/shared';
import { FACT_SPECS, factState, formatDay, isOffer, usable, usableText, type Memory } from './facts';
import { DEFAULT_OBJECTIVE, planConversion } from './strategy';

/**
 * The Missing Information Engine: what a task needs, compared with what the memory already holds. Only what the
 * task really needs is asked, at most two questions at a time; non-essential questions can be skipped once.
 */

export interface Requirement {
  key: FactKey;
  essential: boolean;
  /** The question, specific to this task when it differs from the generic one. */
  question: string;
  suggestions: string[];
  /** Why it is needed, said when the owner tries to skip an essential one. */
  why: string;
}

const req = (key: FactKey, essential: boolean, why: string, question?: string, suggestions?: string[]): Requirement => ({
  key,
  essential,
  question: question ?? FACT_SPECS[key].question,
  suggestions: suggestions ?? FACT_SPECS[key].suggestions ?? [],
  why,
});

/** The product the task is about: the owner's words in the task, else the main offering in memory. */
export function taskProduct(task: DirectorTask, memory: Memory, now: Date): string | undefined {
  return task.params.product ?? usableText(memory, 'offering.main', now);
}

export function taskObjective(task: DirectorTask, memory: Memory, now: Date): MarketingObjective | undefined {
  if (task.params.objective) return task.params.objective;
  if (task.kind === 'LAUNCH') return 'PRODUCT_LAUNCH';
  const goal = usable(memory, 'goal.primary', now) as MarketingObjective | undefined;
  if (goal) return goal;
  const model = usable(memory, 'business.model', now) as BusinessModel | undefined;
  return model ? DEFAULT_OBJECTIVE[model] : undefined;
}

/** A product mention like "ההמבורגר החדש" names a kind, not a product: the owner must say which one. */
export function isGenericProduct(product: string, memory: Memory, now: Date): boolean {
  const known = [...((usable(memory, 'offering.products', now) as string[] | undefined) ?? []), usableText(memory, 'offering.main', now) ?? ''];
  if (known.some((k) => k && (product.includes(k) || k.includes(product.replace(/^ה/, ''))))) return false;
  const words = product.replace(/^ה/, '').split(' ');
  return words.length <= 2 && /חדש|חדשה/.test(product);
}

/** Every unmet requirement of the task, most important first. */
export function requirementsFor(task: DirectorTask, memory: Memory, now: Date): Requirement[] {
  const out: Requirement[] = [];
  const state = (k: FactKey) => factState(memory[k], now);
  const missing = (k: FactKey) => !['USABLE', 'DECLINED'].includes(state(k));

  if (missing('business.name')) out.push(req('business.name', true, 'השם מופיע במודעה, ואני לא ממציא אותו.'));
  if (missing('business.model'))
    out.push(
      state('business.model') === 'PROPOSED'
        ? req('business.model', true, 'סוג העסק קובע לאן המודעה שולחת לקוחות.', `הבנתי שזה ${usableTextAny(memory, 'business.category') ?? 'העסק'}. נכון?`, ['כן', 'לא'])
        : req('business.model', true, 'סוג העסק קובע לאן המודעה שולחת לקוחות.'),
    );
  const model = usable(memory, 'business.model', now) as BusinessModel | undefined;
  if (model !== 'ECOMMERCE' && missing('location.city')) out.push(req('location.city', true, 'מודעה מקומית מוצגת רק לאנשים באזור שלך.'));

  const product = task.params.product;
  if (task.kind === 'LAUNCH' && product && isGenericProduct(product, memory, now))
    out.push(
      req(
        'offering.products',
        true,
        'אני לא ממציא שם או מרכיבים של מוצר.',
        `איך קוראים ל${product.replace(/^ה/, '')} ומה מיוחד בו?`,
        [],
      ),
    );
  else if (!product && missing('offering.main')) out.push(req('offering.main', true, 'צריך לדעת מה המודעה מוכרת.'));

  if (task.kind === 'PROMOTION') {
    const offerFact = memory['offer.current'];
    const s = state('offer.current');
    const offer = offerFact && isOffer(offerFact.value) ? offerFact.value : undefined;
    const why = 'מבצע במודעה חייב להיות מדויק: מחיר שגוי או מבצע שנגמר זו הטעיה של לקוחות.';
    if (!offer || s === 'REJECTED') out.push(req('offer.current', true, why, 'מה המבצע בדיוק? (למשל: "1+1 על כל הקפה")'));
    else if (s === 'EXPIRED')
      out.push(req('offer.current', true, why, `המבצע "${offer.text}" הסתיים ב-${formatDay(offer.validUntil!)}. יש מבצע חדש? מה הוא ועד מתי?`));
    else if (s === 'STALE') out.push(req('offer.current', true, why, `המבצע "${offer.text}" עדיין בתוקף? עד מתי?`));
    else {
      const needPrice = !offer.price && !/%|חינם|במתנה|₪/.test(offer.text);
      const needDate = !offer.validUntil && !offer.ongoing;
      if (needPrice && needDate) out.push(req('offer.current', true, why, `מה המחיר במבצע "${offer.text}", ועד מתי הוא בתוקף?`, ['עד סוף השבוע', 'עד סוף החודש', 'אין תאריך סיום']));
      else if (needPrice) out.push(req('offer.current', true, why, `מה המחיר במבצע "${offer.text}"?`));
      else if (needDate) out.push(req('offer.current', true, why, `עד מתי המבצע "${offer.text}" בתוקף?`, ['עד סוף השבוע', 'עד סוף החודש', 'אין תאריך סיום']));
    }
  }

  const objective = taskObjective(task, memory, now);
  if (model && objective) {
    const decision = planConversion(model, objective, memory, now);
    if (decision.needs) out.push(destinationRequirement(decision.needs, model));
  }

  if (missing('media.realPhotos'))
    out.push(
      req(
        'media.realPhotos',
        false,
        '',
        'יש לך תמונות אמיתיות של המוצר או של המקום? בלי תמונות אעבוד עם עיצוב טיפוגרפי או תמונות המחשה מסומנות, ולא אציג אותן כמוצר שלך.',
      ),
    );
  return out;
}

function usableTextAny(memory: Memory, key: FactKey): string | undefined {
  const v = memory[key]?.value;
  return typeof v === 'string' ? v : undefined;
}

/** The destination question explains why it is asked, and that no landing page is required. */
function destinationRequirement(key: FactKey, model: BusinessModel): Requirement {
  const why = 'המודעה צריכה לשלוח לקוחות למקום שקיים. אני לא ממציא קישורים.';
  switch (key) {
    case 'conversion.ordering':
      return req(key, true, why, 'איך לקוחות מזמינים היום? אם רוב ההזמנות מגיעות מוולט, למשל, המודעה תשלח ישר לשם. לא חייבים דף נחיתה.');
    case 'conversion.orderUrl':
      return req(key, true, why, 'מה הקישור לדף שלכם באפליקציית ההזמנות? אם אין קישור, אפשר לשלוח לטלפון או לניווט.');
    case 'location.address':
      return req(key, true, why, 'מה הכתובת? כך לקוחות ינווטו אליכם בלחיצה מהמודעה.', ['אין כתובת קבועה']);
    case 'location.serviceArea':
      return req(key, true, why, FACT_SPECS['location.serviceArea'].question, FACT_SPECS['location.serviceArea'].suggestions);
    case 'conversion.bookingUrl':
      return req(key, true, why, model === 'BEAUTY' ? 'איך קובעים תור? אם יש קישור לזימון תורים, שלחו אותו.' : FACT_SPECS[key].question, FACT_SPECS[key].suggestions);
    default:
      return req(key, true, why);
  }
}

export interface Question {
  keys: FactKey[];
  text: string;
  suggestions: string[];
  skippable: boolean;
}

/** The next question: up to two essential facts together, or one optional fact the owner has not skipped. */
export function nextQuestion(requirements: Requirement[], skipped: readonly FactKey[]): Question | null {
  const essential = requirements.filter((r) => r.essential);
  if (essential.length) {
    const first = essential[0]!;
    // Name and type read well together; a destination or an offer is asked on its own.
    const pairable: FactKey[] = ['business.name', 'business.model', 'location.city', 'offering.main'];
    const second = essential[1];
    const pair = second && pairable.includes(first.key) && pairable.includes(second.key) && !first.question.endsWith('נכון?');
    const asked = pair ? [first, second] : [first];
    return {
      keys: asked.map((r) => r.key),
      text: asked.map((r) => r.question).join(' '),
      suggestions: asked.length === 1 ? first.suggestions : [],
      skippable: false,
    };
  }
  const optional = requirements.find((r) => !skipped.includes(r.key));
  return optional ? { keys: [optional.key], text: optional.question, suggestions: [...optional.suggestions, 'דלג'], skippable: true } : null;
}
