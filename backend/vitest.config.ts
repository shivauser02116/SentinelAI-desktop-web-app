import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    env: {
      DATABASE_URL: 'postgres://localhost:5432/sentinelai_test',
      SESSION_SECRET: 'test-session-secret-at-least-32-chars-long-here',
      CSRF_SECRET: 'test-csrf-secret-at-least-32-chars-long-here',
      OIDC_ISSUER_URL: 'https://accounts.google.com',
      OIDC_CLIENT_ID: 'test-client-id',
      OIDC_CLIENT_SECRET: 'test-client-secret',
      OIDC_REDIRECT_URI: 'http://localhost:3001/auth/callback',
      FRONTEND_ORIGIN: 'http://localhost:5173',
      CREDENTIAL_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
  },
})
