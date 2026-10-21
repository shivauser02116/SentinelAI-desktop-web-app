# SentinelAI Integration Setup Guide

This guide explains how to configure identity providers (OIDC), business system adapters, and webhook handlers for the SentinelAI server-side policy gateway.

---

## 1. OpenID Connect (OIDC) Authentication

SentinelAI relies on standards-compliant OpenID Connect (OIDC) for user authentication. Authority originates from the authenticated human user, never from the client application or AI model.

### General Configuration

Set these environment variables in `backend/.env`:
```env
OIDC_ISSUER_URL="https://your-idp-domain"
OIDC_CLIENT_ID="sentinelai-client-id"
OIDC_CLIENT_SECRET="sentinelai-client-secret"
OIDC_REDIRECT_URI="http://localhost:3001/auth/callback"
OIDC_SCOPES="openid profile email"
FRONTEND_ORIGIN="http://localhost:5173"
```

### Provider-Specific Instructions

#### Google Workspace / Google Cloud Console
1. Navigate to the **Google Cloud Console** > **APIs & Services** > **Credentials**.
2. Click **Create Credentials** > **OAuth client ID**.
3. Application Type: **Web application**.
4. Authorized Redirect URIs: Add `http://localhost:3001/auth/callback` (or your production callback URL).
5. Copy the **Client ID** and **Client Secret**.
6. Set `OIDC_ISSUER_URL="https://accounts.google.com"`.

#### Auth0
1. In the Auth0 Dashboard, go to **Applications** > **Applications** > **Create Application**.
2. Select **Regular Web Applications**.
3. Settings:
   - **Allowed Callback URLs**: `http://localhost:3001/auth/callback`
   - **Allowed Logout URLs**: `http://localhost:5173`
   - **Allowed Web Origins**: `http://localhost:5173`
4. Set:
   ```env
   OIDC_ISSUER_URL="https://{your-tenant}.auth0.com/"
   OIDC_CLIENT_ID="{your-client-id}"
   OIDC_CLIENT_SECRET="{your-client-secret}"
   ```

#### Okta / Workforce Identity
1. In the Okta Admin Console, go to **Applications** > **Create App Integration**.
2. Sign-in method: **OIDC - OpenID Connect**.
3. Application type: **Web Application**.
4. Sign-in redirect URIs: `http://localhost:3001/auth/callback`.
5. Sign-out redirect URIs: `http://localhost:5173`.
6. Copy the **Client ID** and **Client Secret**.
7. Set `OIDC_ISSUER_URL="https://{your-okta-domain}/oauth2/default"`.

#### Zitadel / Keycloak (Self-Hosted)
1. Create a project and client with response type `code` and grant type `authorization_code`.
2. Redirect URI: `http://localhost:3001/auth/callback`.
3. Set `OIDC_ISSUER_URL` to your realm URL (e.g., `https://auth.example.com/realms/master`).

---

## 2. Business System Provider Adapters

SentinelAI uses a modular adapter architecture defined in `backend/src/adapters/types.ts`:

```typescript
export interface ProviderAdapter {
  readonly provider: string
  readonly capabilities: readonly ProviderCapability[]
  readonly isSandbox: boolean
  execute(tool: ToolName, args: Record<string, unknown>, idempotencyKey: string, orgId: string): Promise<ToolResult>
  healthCheck(): Promise<AdapterHealthStatus>
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean
}
```

### Supported Adapter Modes

| Adapter | Status | Capabilities | Purpose |
|---------|--------|--------------|---------|
| `MockAdapter` | Built-in | `invoice.lookup`, `refund.issue`, `customer.export`, `payroll.export` | Offline testing, local development, deterministic test scenarios. Always returns `_simulated: true`. |
| `DisabledAdapter` | Scaffold | Configurable | Safe fallback for unconfigured providers. Rejects tool calls with an explicit setup requirement error. |
| Custom Adapters (e.g. Stripe, Zendesk) | Extensible | Provider-specific | Connected via `POST /v1/integrations/:provider/connect` using server-side credentials. |

### Connecting an Integration via API

To enable and configure a provider for an organization:

```http
POST /v1/integrations/stripe/connect
Content-Type: application/json

{
  "toolScope": ["refund.issue"],
  "isSandbox": true,
  "config": {
    "webhookToleranceSeconds": 300
  }
}
```

Credentials must be stored server-side in the encrypted `credentials` table using AES-256-GCM. The encryption key is loaded from `CREDENTIAL_ENCRYPTION_KEY` in environment variables.

---

## 3. Webhook Handling

Provider webhooks enter through an unauthenticated webhook ingress endpoint:

```http
POST /v1/webhooks/:provider
```

### Webhook Ingestion Flow
1. **Durable Inbox**: The raw request body, headers, and provider event ID are immediately written to the `webhook_events` table with status `'received'`.
2. **Deduplication**: A unique index on `(provider, provider_event_id)` ensures duplicate deliveries from the provider are discarded without error.
3. **Signature Verification**: Signatures are checked using the provider's shared secret before processing.
4. **Asynchronous Processing**: Background workers process validated events to reconcile transaction state or update approval status.
