import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PriceCatalog, budgetPolicyFromEnv } from '@kampora/cost-engine';
import { MockCreativeLlmProvider } from '@kampora/creative-engine';
import { createDatabase, type DatabaseHandle } from '@kampora/database';
import { RENDER_QUEUE_NAME } from '@kampora/shared';
import { storageFromEnv } from '@kampora/storage';
import { loadConfig, type AppConfig } from '../config';
import {
  BUDGET_POLICY,
  CONFIG,
  DATABASE,
  DB_HANDLE,
  LLM_PROVIDER,
  PRICE_CATALOG,
  RENDER_QUEUE,
  STORAGE,
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
    { provide: PRICE_CATALOG, useFactory: () => PriceCatalog.fromEnv() },
    { provide: BUDGET_POLICY, useFactory: () => budgetPolicyFromEnv() },
    // Increment 1 wires only the deterministic mock; real LLM adapters plug in here behind LlmProvider.
    { provide: LLM_PROVIDER, useFactory: () => new MockCreativeLlmProvider() },
  ],
  exports: [CONFIG, DATABASE, STORAGE, RENDER_QUEUE, PRICE_CATALOG, BUDGET_POLICY, LLM_PROVIDER],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    @Inject(RENDER_QUEUE) private readonly queue: Queue,
  ) {}

  async onApplicationShutdown() {
    await this.queue.close();
    await this.handle.close();
  }
}
