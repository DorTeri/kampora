import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CampaignRequestSchema, RenderQualitySchema, type CampaignRequest } from '@kampora/shared';
import { Auth, type AuthContext } from '../common/auth';
import { UuidPipe, ZodPipe, openApiSchema } from '../common/zod';
import { BusinessService } from './business.service';
import { StudioService } from './studio.service';

const RenderRequestSchema = z.object({ quality: RenderQualitySchema.default('final') });
type RenderRequest = z.infer<typeof RenderRequestSchema>;

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
  @ApiBody({ schema: openApiSchema(CampaignRequestSchema) })
  createCampaign(
    @Auth() ctx: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(CampaignRequestSchema)) body: CampaignRequest,
  ) {
    return this.studio.createCampaign(ctx, id, body);
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
  constructor(private readonly studio: StudioService) {}

  @Get(':id')
  get(@Auth() ctx: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.studio.getProject(ctx, id);
  }

  @Get(':id/costs')
  @ApiOperation({ summary: 'Cost ledger summary (simulated / estimated / confirmed kept apart)' })
  costs(@Auth() ctx: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.studio.projectCosts(ctx, id);
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
