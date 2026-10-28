import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  API_PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  DEV_API_TOKEN: z.string().min(16).optional(),
  CREATIVE_PROVIDER: z.enum(['mock']).default('mock'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  MEDIA_SIGNING_SECRET: z.string().min(16).optional(),
});
export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = EnvSchema.parse(env);
  if (config.NODE_ENV === 'production' && config.DEV_API_TOKEN) {
    // Dev auth must never ship. Real authentication is a Phase 3 deliverable.
    throw new Error('DEV_API_TOKEN must not be set in production');
  }
  return config;
}
