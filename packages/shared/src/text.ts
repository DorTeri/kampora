/** Hebrew points and cantillation marks (niqqud + te'amim), excluding maqaf and sof pasuq. */
const NIQQUD_RE = /[֑-ׇֽֿׁׂׅׄ]/g;

/** Removes niqqud so subtitles stay readable even when the speech input used diacritics. */
export function stripNiqqud(text: string): string {
  return text.replace(NIQQUD_RE, '');
}

export function hasNiqqud(text: string): boolean {
  return /[֑-ׇֽֿׁׂׅׄ]/.test(text);
}

export interface CaptionChunk {
  text: string;
  /** Inclusive start frame relative to the scene. */
  startFrame: number;
  /** Exclusive end frame relative to the scene. */
  endFrame: number;
}

/**
 * Splits a caption into short, readable chunks (max N words, sentence-aware). Keeps "29.90 ₪" together,
 * drops standalone dashes and avoids a dangling single word.
 */
export function splitCaptionChunks(text: string, maxWordsPerChunk = 4): string[] {
  const clean = stripNiqqud(text).replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  // Glue "29.90 ₪" / "₪ 29.90" so the price never splits across chunks.
  const words = clean
    .replace(/(\d)\s+₪/g, '$1\u00A0₪')
    .replace(/₪\s+(\d)/g, '₪\u00A0$1')
    // Keep a bundle like "קפה + מאפה" together as well.
    .replace(/(\S)\s+\+\s+(\S)/g, '$1\u00A0+\u00A0$2')
    .split(' ');

  const chunks: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    // A standalone dash ends the chunk rather than opening the next one.
    if (/^[-–—]$/.test(word)) {
      if (current.length) chunks.push(current.join(' '));
      current = [];
      continue;
    }
    current.push(word);
    const endsSentence = /[.!?,:]$/.test(word);
    if (current.length >= maxWordsPerChunk || (endsSentence && current.length >= 2)) {
      chunks.push(current.join(' '));
      current = [];
    }
  }
  if (current.length) {
    // Avoid a dangling single word: merge it into the previous chunk when short.
    if (
      current.length === 1 &&
      chunks.length &&
      chunks[chunks.length - 1]!.split(' ').length < maxWordsPerChunk + 1
    ) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${current[0]}`;
    } else {
      chunks.push(current.join(' '));
    }
  }

  return chunks.map((c) => c.replace(/\u00A0/g, ' '));
}

/**
 * Splits a caption into short chunks and spreads them over the scene, weighted by character length,
 * so longer phrases stay on screen longer. Used when no speech timing is available.
 */
export function chunkCaption(
  text: string,
  durationInFrames: number,
  maxWordsPerChunk = 4,
  leadInFrames = 4,
): CaptionChunk[] {
  if (durationInFrames <= leadInFrames) return [];
  const chunks = splitCaptionChunks(text, maxWordsPerChunk);
  if (!chunks.length) return [];

  const available = durationInFrames - leadInFrames;
  const weights = chunks.map((c) => Math.max(4, c.length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const result: CaptionChunk[] = [];
  let cursor = leadInFrames;
  chunks.forEach((chunkText, i) => {
    const isLast = i === chunks.length - 1;
    const length = isLast ? durationInFrames - cursor : Math.round((available * weights[i]!) / totalWeight);
    result.push({ text: chunkText.replace(/\u00A0/g, ' '), startFrame: cursor, endFrame: cursor + length });
    cursor += length;
  });
  return result.filter((c) => c.endFrame > c.startFrame);
}

/** Formats an ILS amount for customer-facing UI, e.g. 29.9 → "29.90 ₪" (Intl adds bidi marks). */
export function formatIls(amount: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 2,
  }).format(amount);
}
