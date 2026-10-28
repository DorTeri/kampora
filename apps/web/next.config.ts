import path from 'node:path';
import type { NextConfig } from 'next';

const root = path.resolve(__dirname, '../..');
// One .env at the monorepo root for every app (Next's own loader only reads apps/web). Existing vars win.
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // No root .env (e.g. CI/production with real environment variables).
}

const nextConfig: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
  // Media is served via short-lived signed URLs; we render it with plain <img>/<video>.
  poweredByHeader: false,
};

export default nextConfig;
