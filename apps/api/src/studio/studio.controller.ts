import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CampaignRequestSchema, RenderQualitySchema } from '@kampora/shared';
import { Auth, type AuthContext } from '../common/auth';
import { UuidPipe, ZodPipe, openApiSchema } from '../common/zod';
import { BusinessService } from './business.service';
import { NarrationService } from './narration.service';
import { PaidOperationsService } from './paid.service';
import { StudioService } from './studio.service';

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
});
type NarrationRequest = z.infer<typeof NarrationRequestSchema>;

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
  ) {}

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
  ) {
    return this.narration.quote(ctx, id, String(voiceId ?? ''));
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
    return this.narration.request(ctx, id, body.voiceId, body.approvedUsd);
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
