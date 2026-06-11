// The gemini connector's `register(ctx)` server entry.
//
// Transport-registration cutover: the host no longer statically imports `registerGeminiConnector` — this
// entry binds the connector's host deps AT ACTIVATION by adapting the
// per-concern host services published in the capability registry
// (`@cinatra-ai/host:connector-config`, `@cinatra-ai/host:mcp-self-client`,
// `@cinatra-ai/host:nango-connection-storage`). Every adapter field resolves
// the host service LAZILY at call time, so activation order against the host's
// boot imports never matters.
//
// SDK imports here are TYPE-ONLY (host-peer value-import gate): the host
// services arrive as DATA through `ctx.capabilities`.

import type {
  ExtensionHostContext,
  HostConnectorConfigService,
  HostMcpSelfClientService,
  HostNangoConnectionStorageService,
} from "@cinatra-ai/sdk-extensions";
import { registerGeminiConnector, type GeminiConnectorDeps } from "./deps";
import {
  getConfiguredGeminiAPIKey,
  getGeminiLoggingSettings,
  saveGeminiLoggingSettings,
} from "./index";
import { GEMINI_API_LOG_DIRECTORY } from "./log-directory";

const PACKAGE_NAME = "@cinatra-ai/gemini-connector";

function hostService<T>(ctx: ExtensionHostContext, capability: string): T {
  const provider = ctx.capabilities.resolveProviders(capability)[0];
  if (!provider) {
    throw new Error(
      `${PACKAGE_NAME}: host service "${capability}" is not registered — ` +
        `the host boot wiring (register-transport-connectors) must run before connector calls.`,
    );
  }
  return provider.impl as T;
}

export function register(ctx: ExtensionHostContext): void {
  const config = () =>
    hostService<HostConnectorConfigService>(ctx, "@cinatra-ai/host:connector-config");
  const selfClient = () =>
    hostService<HostMcpSelfClientService>(ctx, "@cinatra-ai/host:mcp-self-client");
  const nango = () =>
    hostService<HostNangoConnectionStorageService>(
      ctx,
      "@cinatra-ai/host:nango-connection-storage",
    );

  const deps: GeminiConnectorDeps = {
    readConnectorConfigFromDatabase: (connectorId, fallback) =>
      config().read(connectorId, fallback),
    writeConnectorConfigToDatabase: (connectorId, value) =>
      config().write(connectorId, value),
    buildAppMcpSelfClientHeaders: () => selfClient().buildHeaders(),
    nango: {
      isConfigured: () => nango().isConfigured(),
      getPrimarySavedConnection: (connectorKey) =>
        nango().getPrimarySavedConnection(connectorKey) as ReturnType<
          GeminiConnectorDeps["nango"]["getPrimarySavedConnection"]
        >,
      ensureIntegration: (input) => nango().ensureIntegration(input),
      importConnection: (input) => nango().importConnection(input),
      getCredentials: (providerConfigKey, connectionId, opts) =>
        nango().getCredentials(providerConfigKey, connectionId, opts),
      saveConnectionRecord: (connectorKey, record, opts) =>
        nango().saveConnectionRecord(connectorKey, record, opts),
      deleteConnection: (providerConfigKey, connectionId) =>
        nango().deleteConnection(providerConfigKey, connectionId),
      clearConnectionRecords: (connectorKey) => nango().clearConnectionRecords(connectorKey),
      get providerConfigKeys() {
        return nango().providerConfigKeys as GeminiConnectorDeps["nango"]["providerConfigKeys"];
      },
      get connectionIds() {
        return nango().connectionIds as GeminiConnectorDeps["nango"]["connectionIds"];
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
    },
  });
}
