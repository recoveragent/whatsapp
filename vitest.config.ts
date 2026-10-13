import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Next replaces this marker in server builds; Node tests need its empty entry.
    alias: {
      'server-only': fileURLToPath(
        new URL(
          './node_modules/next/dist/compiled/server-only/empty.js',
          import.meta.url
        )
      ),
    },
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Dummy secrets — encryption.ts / webhook-signature.ts read these
    // at module load. Tests never hit a real Meta/Supabase service, so
    // any 32-byte hex / non-empty string will do; keep them lexically
    // identical to the CI build env so behaviour matches.
    env: {
      ENCRYPTION_KEY:
        '0000000000000000000000000000000000000000000000000000000000000000',
      META_APP_SECRET: 'test-meta-app-secret',
    },
    clearMocks: true,
  },
});
