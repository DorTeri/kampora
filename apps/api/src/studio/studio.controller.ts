import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  CampaignRequestSchema,
  NarrationModeSchema,
  RenderQualitySchema,
  StaticAdEditSchema,
  StaticAdFormatSchema,
  VoiceStyleSchema,
  type StaticAdEdit,
} from '@kampora/shared';
import { Auth, type AuthContext } from '../common/auth';
import { UuidPipe, ZodPipe, openApiSchema } from '../common/zod';
import { BusinessService } from './business.service';
import { NarrationService } from './narration.service';
import { PaidOperationsService } from './paid.service';
import { SceneImagesService } from './scene-images.service';
import { StaticAdsService } from './static-ads.service';
import { StudioService } from './studio.service';
import { VoiceLabService } from './voice-lab.service';

const RenderRequestSchema = z.object({ quality: RenderQualitySchema.default('final') });
type RenderRequest = z.infer<typeof RenderRequestSchema>;

/** The owner's request plus, for paid AI providers, the approved spending ceiling (USD) from the quote. */
const CreateCampaignSchema = CampaignRequestSchema.extend({
  aiApprovalUsd: z.number().positive().max(100).optional(),
});
type CreateCampaign = z.infer<typeof CreateCampaignSchema>;

const NarrationRequestSchema = z.object({
  voiceId: z.string().min(1).max(64),
  /** Required for paid voices: the approved estimate (USD) from the narration quote. */
  approvedUsd: z.number().positive().max(100).optional(),
  mode: NarrationModeSchema.default('continuous'),
  style: VoiceStyleSchema.default('natural'),
});
type NarrationRequest = z.infer<typeof NarrationRequestSchema>;

const SceneImageRequestSchema = z.object({ approvedUsd: z.number().nonnegative().max(5).optional() });
type SceneImageRequest = z.infer<typeof SceneImageRequestSchema>;
const SceneImageDecisionRequestSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) });
type SceneImageDecisionRequest = z.infer<typeof SceneImageDecisionRequestSchema>;

const StaticAdsRequestSchema = z.object({ formats: z.array(StaticAdFormatSchema).min(1).max(3).optional() });
type StaticAdsRequest = z.infer<typeof StaticAdsRequestSchema>;

const NarrationLineRequestSchema = z.object({
  voiceId: z.string().min(1).max(64),
  approvedUsd: z.number().positive().max(100).optional(),
});
type NarrationLineRequest = z.infer<typeof NarrationLineRequestSchema>;

@ApiTags('businesses')
@ApiBearerAuth()
@Controller('v1/businesses')
export class BusinessesController {
  constructor(
    private readonly businesses: BusinessService,
    private readonly studio: StudioService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List businesses in the organization' })
  list(@Auth() ctx: AuthContext) {
    return this.businesses.list(ctx);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Business profile, brand and media assets' })
  get(@Auth() ctx: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.businesses.detail(ctx, id);
  }

  @Post(':id/campaigns')
  @ApiOperation({ summary: 'Create a campaign: goal → brief → three concepts' })
  @ApiBody({ schema: openApiSchema(CreateCampaignSchema) })
  createCampaign(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(CreateCampaignSchema)) body: CreateCampaign,
  ) {
    const { aiApprovalUsd, ...request } = body;
    return this.studio.createCampaign(ctx, id, request, aiApprovalUsd);
  }
}

@ApiTags('campaigns')
@ApiBearerAuth()
@Controller('v1/campaigns')
export class CampaignsController {
  constructor(private readonly studio: StudioService) {}

  @Get()
  list(@Auth() ctx: AuthContext) {
    return this.studio.listCampaigns(ctx);
  }

  @Get(':id')
  get(@Auth() ctx: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.studio.getCampaign(ctx, id);
  }

  @Post(':id/concepts')
  @ApiOperation({ summary: 'Request alternative concepts (new batch)' })
  regenerate(@Auth() ctx: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.studio.generateConceptBatch(ctx, id);
  }

  @Post(':id/concepts/:conceptId/select')
  @HttpCode(200)
  @ApiOperation({ summary: 'Select a concept → storyboard + production plan + project (idempotent)' })
  select(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Param('conceptId', UuidPipe) conceptId: string,
  ) {
    return this.studio.selectConcept(ctx, id, conceptId);
  }
}

@ApiTags('projects')
@ApiBearerAuth()
@Controller('v1/projects')
export class ProjectsController {
  constructor(
    private readonly studio: StudioService,
    private readonly narration: NarrationService,
    private readonly images: SceneImagesService,
    private readonly staticAds: StaticAdsService,
  ) {}

  @Get(':id/static-ads')
  @ApiOperation({
    summary: 'Static image ads: latest version per format (1:1, 4:5, 9:16) and usable pictures',
  })
  listStaticAds(@Auth() ctx: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.staticAds.list(ctx, id);
  }

  @Post(':id/static-ads')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Build static image ads from the approved script and queue their render (no paid calls)',
  })
  @ApiBody({ schema: openApiSchema(StaticAdsRequestSchema) })
  createStaticAds(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(StaticAdsRequestSchema)) body: StaticAdsRequest,
  ) {
    return this.staticAds.create(ctx, id, body.formats);
  }

  @Patch(':id/static-ads/:adId')
  @HttpCode(202)
  @ApiOperation({ summary: 'Edit a static ad (texts, background); creates a new version and re-renders it' })
  @ApiBody({ schema: openApiSchema(StaticAdEditSchema) })
  editStaticAd(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Param('adId', UuidPipe) adId: string,
    @Body(new ZodPipe(StaticAdEditSchema)) body: StaticAdEdit,
  ) {
    return this.staticAds.edit(ctx, id, adId, body);
  }

  @Get(':id/images')
  @ApiOperation({ summary: 'Scene images: per-scene quote and every generated version' })
  listImages(@Auth() ctx: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.images.list(ctx, id);
  }

  @Post(':id/scenes/:sceneKey/image')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Generate a (new version of the) scene image; paid providers require approvedUsd',
  })
  @ApiBody({ schema: openApiSchema(SceneImageRequestSchema) })
  requestImage(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Param('sceneKey') sceneKey: string,
    @Body(new ZodPipe(SceneImageRequestSchema)) body: SceneImageRequest,
  ) {
    return this.images.request(ctx, id, sceneKey, body.approvedUsd);
  }

  @Post(':id/images/:imageId/decision')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve or reject a scene image version (re-plans the project)' })
  @ApiBody({ schema: openApiSchema(SceneImageDecisionRequestSchema) })
  decideImage(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Param('imageId', UuidPipe) imageId: string,
    @Body(new ZodPipe(SceneImageDecisionRequestSchema)) body: SceneImageDecisionRequest,
  ) {
    return this.images.decide(ctx, id, imageId, body.decision);
  }

  @Get(':id')
  get(@Auth() ctx: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.studio.getProject(ctx, id);
  }

  @Get(':id/costs')
  @ApiOperation({ summary: 'Cost ledger summary (simulated / estimated / confirmed kept apart)' })
  costs(@Auth() ctx: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.studio.projectCosts(ctx, id);
  }

  @Post(':id/approve-script')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve the script (voiceover lines) of the storyboard' })
  approveScript(@Auth() ctx: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.studio.approveScript(ctx, id);
  }

  @Get(':id/narration/quote')
  @ApiOperation({
    summary: 'Narration estimate: characters, cost (ESTIMATED), speaking time, script-length check',
  })
  narrationQuote(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Query('voiceId') voiceId: string,
    @Query('mode') mode?: string,
    @Query('style') style?: string,
    @Query('sceneKey') sceneKey?: string,
  ) {
    return this.narration.quote(ctx, id, String(voiceId ?? ''), {
      mode: NarrationModeSchema.catch('continuous').parse(mode),
      style: VoiceStyleSchema.catch('natural').parse(style),
      sceneKey: sceneKey ? String(sceneKey).slice(0, 64) : undefined,
    });
  }

  @Post(':id/narration')
  @HttpCode(202)
  @ApiOperation({ summary: 'Record narration (paid voices require approvedUsd ≥ quote)' })
  @ApiBody({ schema: openApiSchema(NarrationRequestSchema) })
  narrate(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(NarrationRequestSchema)) body: NarrationRequest,
  ) {
    return this.narration.request(ctx, id, body.voiceId, body.approvedUsd, {
      mode: body.mode,
      style: body.style,
    });
  }

  @Post(':id/narration/segments/:sceneKey')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Re-record one narration line (keeps the other lines; paid voices require approvedUsd)',
  })
  @ApiBody({ schema: openApiSchema(NarrationLineRequestSchema) })
  narrateLine(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Param('sceneKey') sceneKey: string,
    @Body(new ZodPipe(NarrationLineRequestSchema)) body: NarrationLineRequest,
  ) {
    return this.narration.request(ctx, id, body.voiceId, body.approvedUsd, {
      mode: 'per-scene',
      style: 'natural',
      sceneKey: String(sceneKey).slice(0, 64),
    });
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve the production plan and its estimate → timeline version' })
  approve(@Auth() ctx: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.studio.approvePlan(ctx, id);
  }

  @Post(':id/renders')
  @ApiOperation({ summary: 'Queue a render (idempotent per timeline version + quality)' })
  @ApiBody({ schema: openApiSchema(RenderRequestSchema) })
  render(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(RenderRequestSchema)) body: RenderRequest,
  ) {
    return this.studio.requestRender(ctx, id, body.quality);
  }
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('v1')
export class AiController {
  constructor(
    private readonly paid: PaidOperationsService,
    private readonly narration: NarrationService,
  ) {}

  @Get('creative/quote')
  @ApiOperation({ summary: 'Creative AI provider status and spending ceiling to approve' })
  creativeQuote() {
    return this.paid.creativeQuote();
  }

  @Get('voices')
  @ApiOperation({ summary: 'Configured narration voices and provider status' })
  voices() {
    return this.narration.voices();
  }
}

@ApiTags('renders')
@ApiBearerAuth()
@Controller('v1')
export class RendersController {
  constructor(private readonly studio: StudioService) {}

  @Get('renders/:id')
  get(@Auth() ctx: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.studio.getRender(ctx, id);
  }

  @Get('videos')
  @ApiOperation({ summary: 'Finished videos with signed stream/download URLs' })
  videos(@Auth() ctx: AuthContext) {
    return this.studio.listVideos(ctx);
  }
}

const VoiceLabRequestSchema = z.object({
  candidateId: z.string().min(3).max(160),
  style: VoiceStyleSchema.default('natural'),
  /** Required for paid voices: the approved estimate (USD) from the quote. */
  approvedUsd: z.number().positive().max(5).optional(),
});
type VoiceLabRequest = z.infer<typeof VoiceLabRequestSchema>;

const VoiceLabRatingSchema = z.object({
  ratings: z.record(z.string().max(32), z.number().int().min(1).max(5)),
  notes: z.string().max(2000).optional(),
});
type VoiceLabRating = z.infer<typeof VoiceLabRatingSchema>;

@ApiTags('voice-lab')
@ApiBearerAuth()
@Controller('v1/voice-lab')
export class VoiceLabController {
  constructor(private readonly lab: VoiceLabService) {}

  @Get()
  @ApiOperation({
    summary: 'Voice comparison: candidates, fixed script, estimates, recorded samples and ratings',
  })
  overview(@Auth() ctx: AuthContext) {
    return this.lab.overview(ctx);
  }

  @Get('quote')
  @ApiOperation({ summary: 'Exact text and estimated cost for one candidate + style' })
  quote(@Query('candidateId') candidateId: string, @Query('style') style?: string) {
    return this.lab.quote(String(candidateId ?? ''), VoiceStyleSchema.catch('natural').parse(style));
  }

  @Post('samples')
  @HttpCode(202)
  @ApiOperation({ summary: 'Record one reading (paid voices require approvedUsd ≥ quote; capped per org)' })
  @ApiBody({ schema: openApiSchema(VoiceLabRequestSchema) })
  record(@Auth() ctx: AuthContext, @Body(new ZodPipe(VoiceLabRequestSchema)) body: VoiceLabRequest) {
    return this.lab.request(ctx, body.candidateId, body.style, body.approvedUsd);
  }

  @Post('samples/:id/rating')
  @HttpCode(200)
  @ApiOperation({ summary: 'Save listening ratings (1–5 per criterion) and notes' })
  @ApiBody({ schema: openApiSchema(VoiceLabRatingSchema) })
  rate(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(VoiceLabRatingSchema)) body: VoiceLabRating,
  ) {
    return this.lab.rate(ctx, id, body.ratings, body.notes);
  }
}
