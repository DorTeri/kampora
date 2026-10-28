'use client';

import { useActionState } from 'react';
import { Button, ErrorNote } from '@/components/ui';
import { errorMessage, he } from '@/i18n/he';
import { selectConceptAction, type ActionState } from '../../actions';

export function SelectConceptButton({
  campaignId,
  conceptId,
  primary,
}: {
  campaignId: string;
  conceptId: string;
  primary: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(selectConceptAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="conceptId" value={conceptId} />
      <Button type="submit" variant={primary ? 'primary' : 'secondary'} disabled={pending} className="w-full">
        {pending ? he.concepts.choosing : he.concepts.choose}
      </Button>
      {state.error && <ErrorNote message={errorMessage(state.error)} />}
    </form>
  );
}
