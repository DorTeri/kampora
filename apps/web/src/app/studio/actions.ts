'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { CampaignRequestSchema } from '@kampora/shared';
import { ApiRequestError, api, type CampaignDetail, type RenderDto } from '@/lib/api';

export interface ActionState {
  error?: string;
}

const errorCode = (e: unknown) => (e instanceof ApiRequestError ? e.code : 'UNKNOWN');

export async function createCampaignAction(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = CampaignRequestSchema.safeParse({
    goal: form.get('goal'),
    productName: String(form.get('productName') ?? '').trim(),
    offer: String(form.get('offer') ?? '').trim() || undefined,
    notes: String(form.get('notes') ?? '').trim() || undefined,
  });
  if (!parsed.success) return { error: 'VALIDATION_FAILED' };
  const businessId = String(form.get('businessId'));
  // Paid AI: the customer ticked the approval box for the quoted ceiling.
  const approvedMax = form.get('aiApproved') === 'on' ? Number(form.get('aiMaxUsd')) : undefined;
  let campaign: CampaignDetail;
  try {
    campaign = await api<CampaignDetail>(`/v1/businesses/${businessId}/campaigns`, {
      method: 'POST',
      body: { ...parsed.data, aiApprovalUsd: approvedMax && approvedMax > 0 ? approvedMax : undefined },
    });
  } catch (e) {
    return { error: errorCode(e) };
  }
  revalidatePath('/studio', 'layout');
  redirect(`/studio/campaigns/${campaign.id}`);
}

export async function selectConceptAction(_: ActionState, form: FormData): Promise<ActionState> {
  const campaignId = String(form.get('campaignId'));
  const conceptId = String(form.get('conceptId'));
  let projectId: string;
  try {
    ({ projectId } = await api<{ projectId: string }>(
      `/v1/campaigns/${campaignId}/concepts/${conceptId}/select`,
      { method: 'POST' },
    ));
  } catch (e) {
    return { error: errorCode(e) };
  }
  revalidatePath('/studio', 'layout');
  redirect(`/studio/projects/${projectId}`);
}

export async function approvePlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  const projectId = String(form.get('projectId'));
  try {
    await api(`/v1/projects/${projectId}/approve`, { method: 'POST' });
  } catch (e) {
    return { error: errorCode(e) };
  }
  revalidatePath(`/studio/projects/${projectId}`);
  return {};
}

export async function requestRenderAction(
  projectId: string,
  quality: 'preview' | 'final',
): Promise<{ render?: RenderDto; error?: string }> {
  try {
    const render = await api<RenderDto>(`/v1/projects/${projectId}/renders`, {
      method: 'POST',
      body: { quality },
    });
    revalidatePath('/studio/videos');
    return { render };
  } catch (e) {
    return { error: errorCode(e) };
  }
}

export async function approveScriptAction(_: ActionState, form: FormData): Promise<ActionState> {
  const projectId = String(form.get('projectId'));
  try {
    await api(`/v1/projects/${projectId}/approve-script`, { method: 'POST' });
  } catch (e) {
    return { error: errorCode(e) };
  }
  revalidatePath(`/studio/projects/${projectId}`);
  return {};
}

export async function requestNarrationAction(
  projectId: string,
  voiceId: string,
  approvedUsd?: number,
): Promise<{ error?: string }> {
  try {
    await api(`/v1/projects/${projectId}/narration`, { method: 'POST', body: { voiceId, approvedUsd } });
    return {};
  } catch (e) {
    return { error: errorCode(e) };
  }
}
