import { Controller, Get, Inject, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { Database } from '@kampora/database';
import { DevAuthGuard, Public } from './common/auth';
import { ApiExceptionFilter } from './common/errors';
import { InfraModule } from './infra/infra.module';
import { DATABASE } from './infra/tokens';
import { MediaController } from './media/media.controller';
import { ArtDirectionService } from './studio/art-direction.service';
import { CriticService } from './studio/critic.service';
import { BusinessService } from './studio/business.service';
import {
  AiController,
  BusinessesController,
  CampaignsController,
  ProjectsController,
  QualityController,
  RendersController,
  VoiceLabController,
} from './studio/studio.controller';
import { StudioService } from './studio/studio.service';
import { NarrationService } from './studio/narration.service';
import { PaidOperationsService } from './studio/paid.service';
import { VoiceLabService } from './studio/voice-lab.service';
import { SceneImagesService } from './studio/scene-images.service';
import { StaticAdsService } from './studio/static-ads.service';

@ApiTags('health')
@Controller('health')
class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Public()
  @Get()
  async health() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    InfraModule,
    // Generous for the dev UI; per-tenant limits for paid operations live in the budget guard.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
  ],
  controllers: [
    HealthController,
    BusinessesController,
    CampaignsController,
    ProjectsController,
    QualityController,
    RendersController,
    AiController,
    MediaController,
    VoiceLabController,
  ],
  providers: [
    BusinessService,
    PaidOperationsService,
    NarrationService,
    VoiceLabService,
    StudioService,
    SceneImagesService,
    StaticAdsService,
    ArtDirectionService,
    CriticService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: DevAuthGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
