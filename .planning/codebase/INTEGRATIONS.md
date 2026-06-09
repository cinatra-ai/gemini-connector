# External Integrations

**Analysis Date:** 2026-06-09

## APIs & External Services

**Google Gemini AI:**
- Google Gemini API - LLM inference, audio transcription, and image generation for Cinatra agents and workflows
  - SDK/Client: Direct HTTP (no official SDK); requests built via `buildGeminiRequestHeaders()` in `src/index.ts`
  - Auth: `x-goog-api-key` HTTP header; key stored in Nango (never stored in plaintext after save)
  - Provider identifier in Nango: `"google-gemini"`

**Cinatra MCP Self-Client:**
- In-app MCP (Model Context Protocol) self-client — auth headers injected via `deps.buildAppMcpSelfClientHeaders()` into every Gemini API request (see `buildGeminiRequestHeaders` in `src/index.ts`)
  - Auth: Host-supplied; connector does not construct these headers itself

## Data Storage

**Databases:**
- Connector configuration persisted via host-injected `readConnectorConfigFromDatabase` / `writeConnectorConfigToDatabase` (DI surface defined in `src/deps.ts`)
  - Connection: Host-managed; connector never touches DB directly
  - Client: Abstracted behind `GeminiConnectorDeps` interface; concrete impl registered by host at boot

**File Storage:**
- Local filesystem log files — optional, toggle-controlled
  - Directory: `data/logs/gemini-api` relative to `process.cwd()` (constant in `src/log-directory.ts`)
  - Format: JSON files named `<ISO-timestamp>__<label>__<request|response>.json`
  - Written by `writeGeminiLogFile()` in `src/index.ts`; skipped when `loggingEnabled === false`

**Caching:**
- None — Nango `getCredentials` supports `{ forceRefresh: true }` to bypass Nango's own cache during readback verification (see `syncGeminiAPISettingsToNango` in `src/index.ts`)

## Authentication & Identity

**Auth Provider — Nango:**
- Nango is the credential vault for the Gemini API key
  - Implementation: Host binds a `GeminiNangoCapability` implementation to `deps.nango` at boot (interface in `src/deps.ts`)
  - Credential type stored in Nango: `{ type: "API_KEY", apiKey: string }`
  - Provider config key: runtime-sourced from `nango.providerConfigKeys.gemini`
  - Connection ID: runtime-sourced from `nango.connectionIds.gemini`
  - Readback-verify-then-save pattern: connector imports credential, reads it back with `forceRefresh`, compares to input, and only then writes the cinatra-side pointer record (`saveConnectionRecord`) — ensuring no unverified key reaches the LLM provider

**Action Authorization — Cinatra SDK:**
- `requireExtensionAction("@cinatra-ai/gemini-connector", "manage")` from `@cinatra-ai/sdk-extensions`
- Applied as first awaited call in both `saveGeminiConnectionAction` and `clearGeminiConnectionAction` in `src/actions.ts`
- Permits: `org_owner`, `org_admin`, `platform_admin` roles only (fail-closed)

## Monitoring & Observability

**Error Tracking:**
- Not detected — no third-party error tracking SDK integrated

**Logs:**
- Per-call request and response JSON log files written to local disk (`data/logs/gemini-api/`)
- Enabled by default (`loggingEnabled` defaults to `true` in settings)
- Controlled via `saveGeminiLoggingSettings(enabled: boolean)` exported from `src/index.ts`

## CI/CD & Deployment

**Hosting:**
- Deployed as a package consumed by the Cinatra AI Next.js host application
- No standalone deployment — operates as a connector extension

**CI Pipeline:**
- `.github/` directory present (contents not inspected); CI configuration likely defined there

## Environment Configuration

**Required env vars:**
- None required directly by this connector; all secrets flow through the host's Nango integration
- Gemini API key is stored in Nango, not in environment variables

**Secrets location:**
- Gemini API key: Nango credential vault (accessed through host-injected `deps.nango`)
- No `.env` files present in this repo

## Webhooks & Callbacks

**Incoming:**
- None — this connector is purely outbound (Cinatra → Google Gemini API)

**Outgoing:**
- Gemini API calls made with `x-goog-api-key` header (constructed by `buildGeminiRequestHeaders` in `src/index.ts`)
- MCP self-client headers injected alongside Gemini auth headers for every request

---

*Integration audit: 2026-06-09*
