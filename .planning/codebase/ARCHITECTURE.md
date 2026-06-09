<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                   UI Layer (React / Next.js RSC)             │
├───────────────────────────┬─────────────────────────────────┤
│  GeminiConnectorSetupPage │      SaveGeminiForm              │
│  `src/setup-page.tsx`     │   `src/save-gemini-form.tsx`     │
│  (RSC, async)             │   (client component)             │
└──────────────┬────────────┴───────────┬─────────────────────┘
               │                        │
               ▼                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Server Actions Layer                            │
│              `src/actions.ts`                                │
│   saveGeminiConnectionAction / clearGeminiConnectionAction   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Core Logic / Public API                         │
│              `src/index.ts`                                  │
│  saveGeminiAPISettings, getConfiguredGeminiAPIKey,           │
│  syncGeminiAPISettingsToNango, writeGeminiLogFile, etc.      │
└──────────┬───────────────────────────┬──────────────────────┘
           │                           │
           ▼                           ▼
┌──────────────────────┐   ┌──────────────────────────────────┐
│  Deps / DI Layer     │   │  Leaf Utilities                   │
│  `src/deps.ts`       │   │  `src/log-directory.ts`           │
│  GeminiConnectorDeps │   │  GEMINI_API_LOG_DIRECTORY const   │
│  registered on       │   └──────────────────────────────────┘
│  globalThis Symbol   │
└──────────┬───────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│   Host Runtime (injected at boot by host app)                │
│   - readConnectorConfigFromDatabase / writeConnectorConfig   │
│   - buildAppMcpSelfClientHeaders                             │
│   - nango: GeminiNangoCapability (Nango credential vault)    │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| GeminiConnectorSetupPage | RSC setup page for `/connectors/.../setup` route; reads connection status, renders form | `src/setup-page.tsx` |
| SaveGeminiForm | Client component; wraps form submit, shows toast notifications, refreshes RSC tree | `src/save-gemini-form.tsx` |
| Server Actions | Zod-validated Next.js server actions; authority-gated via `requireExtensionAction` | `src/actions.ts` |
| Core / Public API | All business logic: save, clear, sync, status, logging, header building | `src/index.ts` |
| Dependency Injection | `GeminiConnectorDeps` interface; host binds concrete impls at boot via `registerGeminiConnector` | `src/deps.ts` |
| Log Directory | Dependency-free constant; path for API request/response JSON log files | `src/log-directory.ts` |
| UI Primitives | shadcn-style Button, Input, Label components built on Radix UI + CVA | `src/components/ui/` |

## Pattern Overview

**Overall:** Dependency-Injected Connector (SDK-only decouple pattern)

**Key Characteristics:**
- All host-internal dependencies (`@/lib/database`, `@/lib/mcp-self-client`, nango sibling extension) are injected via `GeminiConnectorDeps` at boot — the connector itself imports no host-internal or sibling `@cinatra-ai/*` code.
- The deps slot is anchored on `globalThis` via a namespaced versioned Symbol (`@cinatra-ai/gemini-connector:host-deps/v1`) so separately-compiled Next.js bundles (setup page, server actions, core) all resolve the same registration.
- Credential storage follows a readback-safe order: `ensureIntegration` → `importConnection` (no connectorKey) → `getCredentials` with `forceRefresh` → equality compare → `saveConnectionRecord`. A verification failure leaves no usable credential reachable to the LLM provider.
- The saved local Nango pointer (`getPrimarySavedConnection`) acts as a "verified + committed" gate; `getConfiguredGeminiAPIKey` returns `null` if no pointer exists, even if a Nango vault entry is present.

## Layers

**UI Layer:**
- Purpose: Render the connector setup page and save form
- Location: `src/setup-page.tsx`, `src/save-gemini-form.tsx`, `src/components/ui/`
- Contains: React Server Components, Client Components, shadcn-style UI primitives
- Depends on: Server Actions (`src/actions.ts`), Core (`src/index.ts`), `@cinatra-ai/sdk-ui`
- Used by: Host app dispatch route for `/connectors/cinatra-ai/gemini-connector/setup`

**Server Actions Layer:**
- Purpose: Next.js `"use server"` actions; authority-gate and validate form inputs before calling core logic
- Location: `src/actions.ts`
- Contains: `saveGeminiConnectionAction`, `clearGeminiConnectionAction`
- Depends on: `zod`, `@cinatra-ai/sdk-extensions` (`requireExtensionAction`), Core (`src/index.ts`)
- Used by: `SaveGeminiForm` (via `formAction`), host app re-exports

**Core / Public API Layer:**
- Purpose: All business logic for credential management, status queries, logging, header building
- Location: `src/index.ts`
- Contains: `saveGeminiAPISettings`, `clearGeminiAPISettings`, `syncGeminiAPISettingsToNango`, `getConfiguredGeminiAPIKey`, `getGeminiAPIStatus`, `writeGeminiLogFile`, `buildGeminiRequestHeaders`
- Depends on: Deps layer (`src/deps.ts`), Log Directory (`src/log-directory.ts`)
- Used by: Server Actions, UI layer, host app consumer code

**Dependency Injection Layer:**
- Purpose: Decouple connector from host internals; provide `registerGeminiConnector(deps)` boot wiring point
- Location: `src/deps.ts`
- Contains: `GeminiConnectorDeps` interface, `GeminiNangoCapability` interface, `registerGeminiConnector`, `getGeminiDeps`, `_resetGeminiDepsForTests`
- Depends on: Nothing (no imports beyond TypeScript types)
- Used by: Core layer (`src/index.ts`), host boot wiring (`src/lib/register-transport-connectors.ts` in host app)

## Data Flow

### Save Credential Path

1. User submits form — `SaveGeminiForm` (`src/save-gemini-form.tsx`)
2. `handleSubmit` calls `saveGeminiConnectionAction(formData)` — Next.js server action (`src/actions.ts:24`)
3. `requireExtensionAction` authority check; Zod parse of `apiKey` field (`src/actions.ts:25-27`)
4. Calls `saveGeminiAPISettings({ apiKey })` (`src/index.ts:171`)
5. Calls `syncGeminiAPISettingsToNango({ apiKey })` (`src/index.ts:196`)
6. Readback-safe Nango sequence via injected `deps.nango`: `ensureIntegration` → `importConnection` → `getCredentials(forceRefresh)` → equality compare → `saveConnectionRecord` (`src/index.ts:240-278`)
7. Writes settings to DB via `deps.writeConnectorConfigToDatabase` with `apiKey: undefined` (plaintext never stored) (`src/index.ts:202`)
8. `SaveGeminiForm` shows success toast; calls `router.refresh()` to re-render RSC tree (`src/save-gemini-form.tsx:26-30`)

### Retrieve Credential Path (for LLM provider use)

1. Host calls `getConfiguredGeminiAPIKey()` (`src/index.ts:109`)
2. Checks `deps.nango.isConfigured()` — returns `null` if unconfigured
3. Checks `deps.nango.getPrimarySavedConnection("gemini")` — returns `null` if no verified pointer
4. Calls `deps.nango.getCredentials(providerConfigKey, connectionId)`
5. Extracts key via `extractApiKey(credentials)` — handles both `{ apiKey }` object and raw string shapes
6. Returns extracted key string or `null`

### Request Header Build Path

1. Caller invokes `buildGeminiRequestHeaders({ apiKey, contentType, extraHeaders })` (`src/index.ts:86`)
2. Merges Content-Type, `x-goog-api-key`, MCP self-client headers (from `deps.buildAppMcpSelfClientHeaders()`), and extra headers

**State Management:**
- Connector settings (logging toggle, `lastSavedAt`) persisted via `deps.readConnectorConfigFromDatabase` / `deps.writeConnectorConfigToDatabase` under key `"gemini"`
- API keys are NEVER stored in the connector DB; stored exclusively in Nango credential vault
- Runtime deps registered once on `globalThis[Symbol.for("@cinatra-ai/gemini-connector:host-deps/v1")]`

## Key Abstractions

**GeminiConnectorDeps:**
- Purpose: Interface the host must implement and inject at boot; isolates connector from all host internals
- Examples: `src/deps.ts:77-86`
- Pattern: Dependency injection via `registerGeminiConnector(deps)` + `globalThis` Symbol slot

**GeminiNangoCapability:**
- Purpose: Structural type for the Nango credential-vault surface; inlined (not imported from sibling extension) so the connector has zero non-SDK `@cinatra-ai/*` code dependencies
- Examples: `src/deps.ts:27-75`
- Pattern: Structural interface with connector-key-scoped literal types (`connectorKey: "gemini"`)

**extractApiKey:**
- Purpose: Shared credential shape normalizer; handles both `{ apiKey: string }` object shape and raw string shape from `getNangoCredentials`
- Examples: `src/index.ts:20-27`
- Pattern: Private module function, consistent across connectors (mirrors `connector-apify`)

**geminiAPIConnectionPackage:**
- Purpose: `HostRequiredPackageDefinition` descriptor consumed by the host's connector registry
- Examples: `src/index.ts:37-43`
- Pattern: Named export of a static manifest object

## Entry Points

**Package Public API:**
- Location: `src/index.ts`
- Triggers: Imported by host app at boot and by consuming code at runtime
- Responsibilities: Exports all public functions, types, and the connection package manifest

**Connector Setup Page:**
- Location: `src/setup-page.tsx`
- Triggers: Host dispatch route for `/connectors/cinatra-ai/gemini-connector/setup`
- Responsibilities: Render credential form; read and display connection status

**Server Actions:**
- Location: `src/actions.ts`
- Triggers: Form submissions from `SaveGeminiForm` and host re-exports
- Responsibilities: Authority gating, input validation, delegation to core logic

## Architectural Constraints

- **Global state:** Deps registered on `globalThis` via `Symbol.for("@cinatra-ai/gemini-connector:host-deps/v1")` — one singleton per process; see `src/deps.ts:88-90`
- **No host-internal imports:** The connector must not import from `@/lib/*` host paths or non-SDK `@cinatra-ai/*` sibling packages. All host services flow through `GeminiConnectorDeps`.
- **API key plaintext:** Never written to the connector's own database. `writeSettings` always sets `apiKey: undefined`. Credential lives exclusively in the Nango vault.
- **Readback gate:** `saveConnectionRecord` is never called before a successful `getCredentials` readback equality check. `getConfiguredGeminiAPIKey` never reads credentials without a saved local pointer.
- **Threading:** Single-threaded Node.js event loop; async operations use `node:fs/promises` and Nango async APIs.
- **Circular imports:** Not detected. `src/log-directory.ts` is intentionally a leaf with zero imports to avoid ESM init-order cycles.

## Anti-Patterns

### Importing host internals directly

**What happens:** Importing from `@/lib/database`, `@/lib/auth-session`, or sibling `@cinatra-ai/nango-connector` directly in this package
**Why it's wrong:** Breaks the SDK-only decouple contract; causes bundle coupling and makes the connector unloadable without the full host
**Do this instead:** Add required capabilities to `GeminiConnectorDeps` in `src/deps.ts` and have the host inject them via `registerGeminiConnector`

### Calling saveConnectionRecord before readback

**What happens:** Saving the Nango pointer row before verifying the stored credential matches the submitted key
**Why it's wrong:** An unverified credential becomes reachable to the LLM provider via `getConfiguredGeminiAPIKey`
**Do this instead:** Follow the order in `syncGeminiAPISettingsToNango` (`src/index.ts:240-278`): import → forceRefresh readback → compare → saveConnectionRecord

### Storing apiKey in connector DB

**What happens:** Writing `apiKey` value to `writeConnectorConfigToDatabase`
**Why it's wrong:** Puts plaintext credentials in the application database
**Do this instead:** Set `apiKey: undefined` in settings (see `src/index.ts:199`); the key lives only in the Nango vault

## Error Handling

**Strategy:** Throw `Error` instances with user-facing messages; server actions catch and re-throw; client form catches and shows toast notifications

**Patterns:**
- `saveGeminiAPISettings` throws `"Enter a Gemini API key to continue."` on blank input with no saved pointer
- `syncGeminiAPISettingsToNango` throws generic `"Nango credential verification failed: ..."` on readback mismatch — message intentionally omits the submitted key or readback value
- Server action `saveGeminiConnectionAction` catches and re-throws with original message (no wrapping noise)
- `SaveGeminiForm` catches action errors and shows them via `addNotification` toast

## Cross-Cutting Concerns

**Logging:** Optional request/response file logging to `GEMINI_API_LOG_DIRECTORY` (`data/logs/gemini-api/`); controlled by `loggingEnabled` setting; written via `writeGeminiLogFile` in `src/index.ts:71-84`
**Validation:** Zod schema in server actions (`src/actions.ts:20-22`); inline guards in core functions
**Authentication:** `requireExtensionAction("@cinatra-ai/gemini-connector", "manage")` from `@cinatra-ai/sdk-extensions` in every server action — covers org_owner/org_admin/platform_admin roles, fail-closed

---

*Architecture analysis: 2026-06-09*
