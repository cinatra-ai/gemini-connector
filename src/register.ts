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
} from "@cinatra-ai/sdk-extensions";
import { registerGeminiConnector, type GeminiConnectorDeps } from "./deps";
import {
  getConfiguredGeminiAPIKey,
  getGeminiLoggingSettings,
  saveGeminiLoggingSettings,
  buildGeminiRequestHeaders,
  writeGeminiLogFile,
} from "./index";
import { GEMINI_API_LOG_DIRECTORY } from "./log-directory";

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
}
