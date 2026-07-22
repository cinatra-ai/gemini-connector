// Host dependency injection for the gemini connector.
//
// Keeps the connector decoupled from host-internal modules (`@/lib/database`
// connector-config, `@/lib/mcp-self-client`) AND from sibling extensions. The
// host binds concrete impls at boot via `registerGeminiConnector(deps)`; runtime
// functions resolve them via `getGeminiDeps()`. The Nango connection-storage
// surface is delivered through `deps.nango` (host-sourced from the
// nango-connector extension) so this connector carries NO non-SDK
// `@cinatra-ai/*` code dependency (SDK-only decouple).
//
// The deps slot is anchored on `globalThis` via a namespaced+versioned Symbol so
// the boot-time registration and the runtime callers — which live in
// SEPARATELY-COMPILED Next.js bundles (the /connectors page, the connector setup
// page, server actions) that do NOT import the registrar — resolve the SAME
// slot. A plain module-local binding would leave those bundles' instance
// unregistered → getGeminiDeps() would throw. (Same reason as the SDK
// action-guard + apify deps + email-connector registry.)

/**
 * Structural shape of the Nango connection-storage surface gemini uses. Inlined
 * (NOT imported from `@cinatra-ai/nango-connector`) so the connector carries no
 * non-SDK `@cinatra-ai/*` code dependency — the host binds the concrete impls at
 * boot. Keys are literal-scoped to this connector's slug so an invalid key can't
 * compile here. Returns stay permissive (`unknown`); the connector reads
 * credentials through its own `extractApiKey` shared extractor.
 */
export interface GeminiNangoCapability {
  /** True when the workspace has Nango configured (credentials present). */
  isConfigured(): boolean;
  /** The primary saved cinatra-side connection pointer for this connector, or
   *  null when none is saved. */
  getPrimarySavedConnection(
    connectorKey: "gemini",
  ): { providerConfigKey: string; connectionId: string; displayName?: string } | null;
  /** Ensure the provider-config (integration) row exists. */
  ensureIntegration(input: {
    provider: string;
    providerConfigKey: string;
    displayName?: string;
  }): Promise<unknown>;
  /** Upsert a connection record by (providerConfigKey, connectionId). gemini
   *  omits connectorKey so the cinatra-side pointer is NOT saved before readback. */
  importConnection(input: {
    providerConfigKey: string;
    connectionId: string;
    credentials: { type: string; apiKey: string };
  }): Promise<unknown>;
  /** Read back the stored credentials. forceRefresh bypasses Nango's cache so
   *  write-then-read-back verification reads the just-written credential. */
  getCredentials(
    providerConfigKey: string,
    connectionId: string,
    opts?: { forceRefresh?: boolean },
  ): Promise<unknown>;
  /** Persist the cinatra-side pointer row after a verified readback.
   *  `{ multiple: false }` enforces a single workspace-wide credential. */
  saveConnectionRecord(
    connectorKey: "gemini",
    record: {
      connectionId: string;
      providerConfigKey: string;
      displayName?: string;
      metadata?: Record<string, unknown>;
    },
    opts?: { multiple?: boolean },
  ): Promise<unknown>;
  /** Delete the Nango connection (scrubs stored credentials). */
  deleteConnection(providerConfigKey: string, connectionId: string): Promise<unknown>;
  /** Clear the cinatra-side pointer rows for this connector. */
  clearConnectionRecords(connectorKey: "gemini"): Promise<unknown>;
  /** Provider-config-key bag — only this connector's slug is exposed. */
  providerConfigKeys: { gemini: string };
  /** Connection-id bag — only this connector's slug is exposed. */
  connectionIds: { gemini: string };
}

export interface GeminiConnectorDeps {
  /** Read this connector's persisted settings (raw connectorId key). */
  readConnectorConfigFromDatabase: <T>(connectorId: string, fallback: T) => T;
  /** Write this connector's persisted settings. */
  writeConnectorConfigToDatabase: (connectorId: string, value: unknown) => void;
  /** Auth headers for the in-app MCP self-client (the `@/lib/mcp-self-client` surface). */
  buildAppMcpSelfClientHeaders: () => Record<string, string>;
  /** True in the app's development runtime mode (host `@/lib/runtime-mode`).
   *  Gates the dev-only default-on for request/response body logging: unset
   *  logging defaults OFF in production, ON in development. */
  isAppDevelopmentMode: () => boolean;
  /**
   * The single host-resolved local-CLI eligibility predicate (cinatra#1926):
   * `development-mode OR preview-installation`, backed by the host
   * `localCliEligible` helper via the `@cinatra-ai/host:runtime-mode` service.
   * The connection-mode write rejection + transport resolution consume THIS
   * (never an independent re-derivation); binds fail-closed to `false` on a host
   * that predates the service member (the mode stays hidden/API-only).
   */
  localCliEligible: () => boolean;
  /** Nango connection-storage surface (host-bound from the nango-connector extension). */
  nango: GeminiNangoCapability;
}

const GEMINI_DEPS_KEY = Symbol.for("@cinatra-ai/gemini-connector:host-deps/v1");
type DepsHolder = { [k: symbol]: GeminiConnectorDeps | null | undefined };
const _holder = globalThis as unknown as DepsHolder;

/**
 * Wire the host's runtime deps. Called once at boot
 * (src/lib/register-transport-connectors.ts). Re-calling replaces — tests swap stubs.
 */
export function registerGeminiConnector(deps: GeminiConnectorDeps): void {
  _holder[GEMINI_DEPS_KEY] = deps;
}

export function getGeminiDeps(): GeminiConnectorDeps {
  const deps = _holder[GEMINI_DEPS_KEY];
  if (!deps) {
    throw new Error(
      "@cinatra-ai/gemini-connector: host runtime deps not registered. " +
        "Call registerGeminiConnector(deps) at boot.",
    );
  }
  return deps;
}

/** @internal test-only. */
export function _resetGeminiDepsForTests(): void {
  _holder[GEMINI_DEPS_KEY] = null;
}
