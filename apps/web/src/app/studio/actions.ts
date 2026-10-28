'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { CampaignRequestSchema, type VoiceStyle } from '@kampora/shared';
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
  approvedUsd: number | undefined,
  style: VoiceStyle,
): Promise<{ error?: string }> {
  try {
    // New recordings are one continuous read (natural flow); the API cuts it into scenes.
    await api(`/v1/projects/${projectId}/narration`, {
      method: 'POST',
      body: { voiceId, approvedUsd, mode: 'continuous', style },
    });
    return {};
  } catch (e) {
    return { error: errorCode(e) };
  }
}

/** Re-records one line only; the rest of the narration is kept. */
export async function rerecordLineAction(
  projectId: string,
  sceneKey: string,
  voiceId: string,
  approvedUsd?: number,
): Promise<{ error?: string }> {
  try {
    await api(`/v1/projects/${projectId}/narration/segments/${encodeURIComponent(sceneKey)}`, {
      method: 'POST',
      body: { voiceId, approvedUsd },
    });
    return {};
  } catch (e) {
    return { error: errorCode(e) };
  }
}

/** Generates a new version of a scene image. Paid providers send the approved estimate. */
export async function requestSceneImageAction(
  projectId: string,
  sceneKey: string,
  approvedUsd?: number,
): Promise<{ error?: string }> {
  try {
    await api(`/v1/projects/${projectId}/scenes/${encodeURIComponent(sceneKey)}/image`, {
      method: 'POST',
      body: { approvedUsd },
    });
    return {};
  } catch (e) {
    return { error: errorCode(e) };
  }
}

/** Approves or rejects a scene image; the API re-plans the project. */
export async function decideSceneImageAction(
  projectId: string,
  imageId: string,
  decision: 'APPROVED' | 'REJECTED',
): Promise<{ error?: string }> {
  try {
    await api(`/v1/projects/${projectId}/images/${imageId}/decision`, { method: 'POST', body: { decision } });
  } catch (e) {
    return { error: errorCode(e) };
  }
  revalidatePath(`/studio/projects/${projectId}`);
  return {};
}

/** Voice lab (internal): record one reading. Paid voices send the approved estimate. */
export async function requestVoiceLabSampleAction(
  candidateId: string,
  style: VoiceStyle,
  approvedUsd?: number,
): Promise<{ error?: string }> {
  try {
    await api('/v1/voice-lab/samples', { method: 'POST', body: { candidateId, style, approvedUsd } });
    return {};
  } catch (e) {
    return { error: errorCode(e) };
  }
}

export async function rateVoiceLabSampleAction(
  sampleId: string,
  ratings: Record<string, number>,
  notes: string,
): Promise<{ error?: string }> {
  try {
    await api(`/v1/voice-lab/samples/${sampleId}/rating`, {
      method: 'POST',
      body: { ratings, notes: notes.trim() || undefined },
    });
    return {};
  } catch (e) {
    return { error: errorCode(e) };
  }
}
