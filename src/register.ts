// The gemini connector's `register(ctx)` server entry.
//
// Transport-registration cutover: the host no longer statically imports `registerGeminiConnector` — this
// entry binds the connector's host deps AT ACTIVATION by adapting the
// per-concern host services published in the capability registry
// (`@cinatra-ai/host:connector-config`, `@cinatra-ai/host:mcp-self-client`)
// plus the connector-authored `nango-system` surface (the legacy
// `@cinatra-ai/host:nango-connection-storage` adapter id is retired —
// cinatra#151 Stage 3). Every adapter field resolves the host service LAZILY
// at call time, so activation order against the host's boot imports never
// matters.
//
// SDK imports here are TYPE-ONLY (host-peer value-import gate): the host
// services arrive as DATA through `ctx.capabilities`.

import type {
  ExtensionHostContext,
  HostConnectorConfigService,
  HostMcpSelfClientService,
  NangoSystemSurface,
  LlmProviderAdapterSurface,
} from "@cinatra-ai/sdk-extensions";
import {
  registerGeminiConnector,
  getGeminiDeps,
  type GeminiConnectorDeps,
} from "./deps";
import {
  getConfiguredGeminiAPIKey,
  getGeminiLoggingSettings,
  saveGeminiLoggingSettings,
  buildGeminiRequestHeaders,
  writeGeminiLogFile,
  saveGeminiAPISettings,
  clearGeminiAPISettings,
  getGeminiAPIStatus,
} from "./index";
import { GEMINI_API_LOG_DIRECTORY } from "./log-directory";
// The relocated Gemini request-translation adapter (llm-providers S4,
// cinatra#1715). The host's packages/llm resolves this connector's
// `createAdapter()` factory through the `llm-provider-adapter` capability
// instead of its in-core `providers/gemini.ts` switch.
import { createGeminiProviderAdapter } from "./adapter/gemini-adapter";

/** The host-published action-guard service (value, NOT the SDK
 *  `requireExtensionAction` import — a runtime serverEntry graph rejects SDK
 *  value imports). Mirrors openai-connector / anthropic-connector. */
type HostActionGuard = {
  require: (packageId: string, mode: "read" | "manage") => Promise<void>;
};

/** Local STRUCTURAL shape of the host runtime-mode service (id
 *  `@cinatra-ai/host:runtime-mode`) — mirrors openai-connector. Kept SDK-type-
 *  free so the serverEntry graph carries no host-peer value import. */
type HostRuntimeModeShape = { isDevelopment(): boolean };

const PACKAGE_NAME = "@cinatra-ai/gemini-connector";

function hostService<T>(ctx: ExtensionHostContext, capability: string): T {
  const provider = ctx.capabilities.resolveProviders(capability)[0];
  if (!provider) {
    throw new Error(
      `${PACKAGE_NAME}: host service "${capability}" is not registered — ` +
        `the host boot wiring (register-host-connector-services) must run before connector calls.`,
    );
  }
  return provider.impl as T;
}

export function register(ctx: ExtensionHostContext): void {
  const config = () =>
    hostService<HostConnectorConfigService>(ctx, "@cinatra-ai/host:connector-config");
  const selfClient = () =>
    hostService<HostMcpSelfClientService>(ctx, "@cinatra-ai/host:mcp-self-client");
  const runtimeMode = () =>
    hostService<HostRuntimeModeShape>(ctx, "@cinatra-ai/host:runtime-mode");
  // The connector-authored nango-system surface (registered by the nango
  // gateway's own register(ctx) — a systemExtension, required at boot).
  const nango = (): NangoSystemSurface => {
    const provider = ctx.capabilities.resolveProviders("nango-system")[0];
    const surface = provider?.impl as NangoSystemSurface | undefined;
    if (!surface || typeof surface.isNangoConfigured !== "function") {
      throw new Error(
        `${PACKAGE_NAME}: the "nango-system" capability surface is not registered — ` +
          `resolve at call time (post-activation), never at module eval.`,
      );
    }
    return surface;
  };

  const deps: GeminiConnectorDeps = {
    readConnectorConfigFromDatabase: (connectorId, fallback) =>
      config().read(connectorId, fallback),
    writeConnectorConfigToDatabase: (connectorId, value) =>
      config().write(connectorId, value),
    buildAppMcpSelfClientHeaders: () => selfClient().buildHeaders(),
    // Resolved LAZILY at call time (probe-safe): gates the dev-only default-on
    // for request/response body logging.
    isAppDevelopmentMode: () => runtimeMode().isDevelopment(),
    // Members delegate to the nango-system surface at CALL time (key maps are
    // getters for the same reason). Inputs are cast at this boundary where the
    // surface owns the wider shape (required displayName / NangoConnectorKey
    // union) — this connector only ever passes valid values.
    nango: {
      isConfigured: () => nango().isNangoConfigured(),
      getPrimarySavedConnection: (connectorKey) =>
        nango().getPrimarySavedNangoConnection(connectorKey),
      ensureIntegration: (input) =>
        nango().ensureNangoIntegration(input as Parameters<NangoSystemSurface["ensureNangoIntegration"]>[0]),
      importConnection: (input) => nango().importNangoConnection(input),
      getCredentials: (providerConfigKey, connectionId, opts) =>
        nango().getNangoCredentials(providerConfigKey, connectionId, opts),
      saveConnectionRecord: (connectorKey, record, opts) =>
        nango().saveNangoConnectionRecord(connectorKey, record, opts),
      deleteConnection: (providerConfigKey, connectionId) =>
        nango().deleteNangoConnection(providerConfigKey, connectionId),
      clearConnectionRecords: (connectorKey) => nango().clearNangoConnectionRecords(connectorKey),
      // Vendor identity is OPEN at the SDK (#12): the surface's key maps are
      // `Record<string, string>` (no SDK-frozen union), so this connector
      // projects ITS OWN key out of the open map at the boundary.
      get providerConfigKeys() {
        return { gemini: nango().providerConfigKeys.gemini };
      },
      get connectionIds() {
        return { gemini: nango().connectionIds.gemini };
      },
    },
  };

  registerGeminiConnector(deps);

  // Lazy/guarded host-access cutover: the host's settings/status
  // surfaces (campaign actions, telemetry, logging, the MCP llm-access test
  // route, dev auto-connect) resolve this connector's readers/writers through
  // the `llm-provider-surface` capability instead of value-importing the
  // package. Provider absence degrades each host feature per call.
  ctx.capabilities.registerProvider("llm-provider-surface", {
    packageName: PACKAGE_NAME,
    impl: {
      providerId: "gemini",
      getConfiguredAPIKey: () => getConfiguredGeminiAPIKey(),
      getLoggingSettings: () => getGeminiLoggingSettings(),
      saveLoggingSettings: (enabled: boolean) => saveGeminiLoggingSettings(enabled),
      logDirectory: GEMINI_API_LOG_DIRECTORY,
      // LLM provider adapter cutover (cinatra#151 Stage 2): the host's
      // packages/llm Gemini adapter resolves these at call time instead of
      // value-importing the package. `buildRequestHeaders` carries the
      // host self-client headers (via the deps bound above); `writeLogFile`
      // keeps the connector's logging-enabled check + redaction.
      buildRequestHeaders: (input: {
        apiKey?: string;
        contentType?: string;
        extraHeaders?: Record<string, string>;
      }) =>
        buildGeminiRequestHeaders({
          apiKey: input?.apiKey,
          contentType: input?.contentType,
          extraHeaders: input?.extraHeaders,
        }),
      writeLogFile: (input: { label: string; kind: "request" | "response"; body: unknown }) =>
        writeGeminiLogFile({ label: input.label, kind: input.kind, body: input.body }),
    },
  });

  // ---- llm-provider-adapter surface (llm-providers S4, cinatra#1715) ----
  //
  // The full Gemini request-translation adapter now lives IN this connector
  // (relocated from the host's packages/llm `providers/gemini.ts`). The host's
  // packages/llm resolves the adapter through this NEW versioned
  // `llm-provider-adapter` capability instead of its in-core factory switch:
  // once a trusted surface is registered the host calls `createAdapter()` and
  // does NOT fall back to the legacy in-core factory (the host fails CLOSED on
  // an abiVersion it does not recognise). `createAdapter()` resolves the
  // connector-owned API key internally and returns null when the connector is
  // present-but-unconfigured — an AUTHORITATIVE "not configured" (the registry's
  // existing null-adapter semantics; no new error class). Registration does no
  // host I/O (probe-safe). The capability-id is a string literal because it stays
  // host-fenced in the SDK (`./internal`), exactly like the S1 surface above.
  ctx.capabilities.registerProvider("llm-provider-adapter", {
    packageName: PACKAGE_NAME,
    impl: {
      // ABI v1 is inlined as a literal (NOT value-imported from the host-peer
      // SDK — the host-peer-value-import ban keeps @cinatra-ai/sdk-extensions
      // TYPE-only over the serverEntry graph). The `satisfies
      // LlmProviderAdapterSurface` below type-checks this literal against the
      // leaf's `typeof LLM_PROVIDER_ADAPTER_ABI_VERSION`, so an ABI bump breaks
      // the build here rather than drifting silently.
      abiVersion: 1,
      providerId: "gemini",
      createAdapter: async () => {
        const apiKey = await getConfiguredGeminiAPIKey();
        return apiKey ? createGeminiProviderAdapter(apiKey) : null;
      },
    } satisfies LlmProviderAdapterSurface,
  });

  // ---- schema-config named actions (cinatra#782) ----
  //
  // The declarative setup surface (cinatra.configSchema) renders WITHOUT
  // shipping React. Its probe + named-action fields reference these
  // host-registered actions BY ID; the host dispatches them through
  // `/api/extensions/{installId}/actions/{actionId}`, authorizing the actor at
  // the "use" tier. Saving/clearing a credential is a MANAGE-tier mutation (the
  // prior saveGeminiConnectionAction gated "manage"), so the WRITE handlers
  // re-assert the manage gate via the host action-guard service. Requires the
  // "ui" host port.

  // Resolve the host action-guard service LAZILY at action-call time as a VALUE
  // through the capability registry (NEVER an SDK value import — a runtime
  // serverEntry graph rejects those). A missing guard FAILS CLOSED.
  const requireManage = async (): Promise<void> => {
    const provider = ctx.capabilities.resolveProviders(
      "@cinatra-ai/host:extension-action-guard",
    )[0];
    const guard = provider?.impl as HostActionGuard | undefined;
    if (!guard || typeof guard.require !== "function") {
      throw new Error(
        `${PACKAGE_NAME}: host action-guard service is not registered — refusing the ungated action.`,
      );
    }
    await guard.require(PACKAGE_NAME, "manage");
  };

  // READ/PROBE: connection (Nango) service readiness — drives the advisory copy.
  ctx.ui.registerAction({
    id: "connectionServiceReady",
    handler: async (): Promise<{ ready: boolean }> => ({
      ready: getGeminiDeps().nango.isConfigured(),
    }),
  });

  // PROBE: connection status. THROWS when not connected so the status-probe pill
  // renders "error"; a connected status returns its detail.
  ctx.ui.registerAction({
    id: "connectionStatus",
    handler: async (): Promise<{ detail: string }> => {
      const status = getGeminiAPIStatus();
      if (status.status !== "connected") {
        throw new Error(status.detail);
      }
      return { detail: status.detail };
    },
  });

  // WRITE (manage-gated): persist the API key (synced to Nango). The
  // schema-config form posts the flat secret input as JSON; a blank apiKey is
  // ABSENT (saveGeminiAPISettings no-ops on a blank re-submit when a saved
  // pointer exists, and throws when none exists — which the form surfaces as the
  // error banner).
  ctx.ui.registerAction({
    id: "saveConnection",
    handler: async (input: unknown): Promise<{ banner: string }> => {
      await requireManage();
      const fields =
        input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const apiKey = typeof fields.apiKey === "string" ? fields.apiKey : "";
      await saveGeminiAPISettings({ apiKey });
      return { banner: "saved" };
    },
  });

  // WRITE (manage-gated): clear the stored connection (scrubs the Nango
  // credential + cinatra-side pointer rows).
  ctx.ui.registerAction({
    id: "clearConnection",
    handler: async (): Promise<{ banner: string }> => {
      await requireManage();
      await clearGeminiAPISettings();
      return { banner: "cleared" };
    },
  });
}
