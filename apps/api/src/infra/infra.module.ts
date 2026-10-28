import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PriceCatalog, budgetPolicyFromEnv } from '@kampora/cost-engine';
import { createDatabase, type DatabaseHandle } from '@kampora/database';
import { ttsSetupFromEnv } from '@kampora/hebrew-voice';
import { NARRATION_QUEUE_NAME, RENDER_QUEUE_NAME } from '@kampora/shared';
import { storageFromEnv } from '@kampora/storage';
import { loadConfig, type AppConfig } from '../config';
import { createCreativeProvider, type CreativeProviderInfo } from './creative-provider';
import {
  BUDGET_POLICY,
  CONFIG,
  CREATIVE_PROVIDER,
  DATABASE,
  DB_HANDLE,
  LLM_PROVIDER,
  NARRATION_QUEUE,
  PRICE_CATALOG,
  RENDER_QUEUE,
  STORAGE,
  TTS_SETUP,
} from './tokens';

function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
  };
}

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: DB_HANDLE, useFactory: (c: AppConfig) => createDatabase(c.DATABASE_URL), inject: [CONFIG] },
    { provide: DATABASE, useFactory: (h: DatabaseHandle) => h.db, inject: [DB_HANDLE] },
    { provide: STORAGE, useFactory: () => storageFromEnv() },
    {
      provide: RENDER_QUEUE,
      useFactory: (c: AppConfig) =>
        new Queue(RENDER_QUEUE_NAME, { connection: redisConnection(c.REDIS_URL) }),
      inject: [CONFIG],
    },
    {
      provide: NARRATION_QUEUE,
      useFactory: (c: AppConfig) =>
        new Queue(NARRATION_QUEUE_NAME, { connection: redisConnection(c.REDIS_URL) }),
      inject: [CONFIG],
    },
    { provide: PRICE_CATALOG, useFactory: () => PriceCatalog.fromEnv() },
    { provide: BUDGET_POLICY, useFactory: () => budgetPolicyFromEnv() },
    // CREATIVE_PROVIDER=mock (default) | openai. A misconfigured paid provider is reported, never silently mocked.
    {
      provide: CREATIVE_PROVIDER,
      useFactory: (c: AppConfig, catalog: PriceCatalog) => createCreativeProvider(c, catalog),
      inject: [CONFIG, PRICE_CATALOG],
    },
    {
      provide: LLM_PROVIDER,
      useFactory: (info: CreativeProviderInfo) => info.provider,
      inject: [CREATIVE_PROVIDER],
    },
    { provide: TTS_SETUP, useFactory: () => ttsSetupFromEnv() },
  ],
  exports: [
    CONFIG,
    DATABASE,
    STORAGE,
    RENDER_QUEUE,
    NARRATION_QUEUE,
    PRICE_CATALOG,
    BUDGET_POLICY,
    CREATIVE_PROVIDER,
    LLM_PROVIDER,
    TTS_SETUP,
  ],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    @Inject(RENDER_QUEUE) private readonly queue: Queue,
    @Inject(NARRATION_QUEUE) private readonly narrationQueue: Queue,
  ) {}

  async onApplicationShutdown() {
    await this.queue.close();
    await this.narrationQueue.close();
    await this.handle.close();
  }
}
