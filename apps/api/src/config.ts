import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  API_PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  DEV_API_TOKEN: z.string().min(16).optional(),
  // End-user authentication. "dev" (local only) maps DEV_API_TOKEN to synthetic users; "oidc" verifies access tokens.
  AUTH_MODE: z.enum(['dev', 'oidc']).default('dev'),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),
  OIDC_JWKS_URL: z.string().url().optional(),
  CREATIVE_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-6.1-terra'),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(500).max(32_000).default(6000),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(90_000),
  OPENAI_REASONING_EFFORT: z
    .enum(['minimal', 'low', 'medium', 'high'])
    .optional()
    .or(z.literal('').transform(() => undefined)),
  // Campaign Director brain. "llm" also needs the paid switches below and a positive cap; otherwise rules run.
  DIRECTOR_BRAIN: z.enum(['rules', 'llm']).default('rules'),
  DIRECTOR_OPENAI_MODEL: z.string().default('gpt-6-luna'),
  DIRECTOR_OPENAI_REASONING_EFFORT: z
    .enum(['minimal', 'low', 'medium', 'high'])
    .optional()
    .or(z.literal('').transform(() => undefined)),
  DIRECTOR_LLM_ALLOW_PAID: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DIRECTOR_LLM_MONTHLY_USD_CAP: z.coerce.number().min(0).max(500).default(0),
  DIRECTOR_LLM_MAX_CALLS_PER_CONVERSATION_DAY: z.coerce.number().int().min(1).max(1000).default(60),
  DIRECTOR_LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(500).max(8000).default(1500),
  DIRECTOR_LLM_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
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
  if (config.NODE_ENV === 'production' && config.AUTH_MODE !== 'oidc') throw new Error('AUTH_MODE must be "oidc" in production');
  if (config.AUTH_MODE === 'oidc' && (!config.OIDC_ISSUER || !config.OIDC_AUDIENCE))
    throw new Error('AUTH_MODE=oidc needs OIDC_ISSUER and OIDC_AUDIENCE');
  return config;
}
