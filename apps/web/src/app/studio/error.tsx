'use client';

import { ButtonLink, EmptyState } from '@/components/ui';

/** A Studio page that could not load its data (most often: the Kampora API is not reachable from here). */
export default function StudioError({ error }: { error: Error & { digest?: string } }) {
  return (
    <EmptyState
      title={`העמוד הזה צריך את השרת של Kampora, והוא לא זמין כרגע. סקירת הקריאייטיב המוקלטת זמינה גם בלי שרת.${error.digest ? ` (${error.digest})` : ''}`}
      action={<ButtonLink href="/studio/review">לסקירת הקריאייטיב</ButtonLink>}
    />
  );
}
