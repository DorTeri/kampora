import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  API_PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  DEV_API_TOKEN: z.string().min(16).optional(),
  CREATIVE_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-6.1-terra'),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(500).max(32_000).default(6000),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(90_000),
  OPENAI_REASONING_EFFORT: z
    .enum(['minimal', 'low', 'medium', 'high'])
    .optional()
    .or(z.literal('').transform(() => undefined)),
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
