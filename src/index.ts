import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HostRequiredPackageDefinition } from "@cinatra-ai/sdk-extensions";
import { GEMINI_API_LOG_DIRECTORY } from "./log-directory";
import { getGeminiDeps } from "./deps";

/**
 * Nango connection-storage surface — host-bound via the connector's `deps`
 * (sourced from the nango-connector extension at boot). Resolved lazily so the
 * separately-compiled setup/page bundles share the same globalThis deps slot.
 */
function geminiNango() {
  return getGeminiDeps().nango;
}

// Shared extractor that accepts both the `{ apiKey: string }` object shape and
// the raw-string fallback shape that `getNangoCredentials` can return. Mirrors
// `extractApiKey` in connector-apify so the readback compare is consistent
// across credential writers.
function extractApiKey(credentials: unknown): string | null {
  if (credentials && typeof credentials === "object" && "apiKey" in credentials) {
    const candidate = (credentials as { apiKey: unknown }).apiKey;
    return typeof candidate === "string" ? candidate : null;
  }
  if (typeof credentials === "string") return credentials;
  return null;
}

export type GeminiAPISettings = {
  apiKey?: string;
  lastSavedAt?: string;
  loggingEnabled?: boolean;
};

export { GEMINI_API_LOG_DIRECTORY } from "./log-directory";

export const geminiAPIConnectionPackage: HostRequiredPackageDefinition = {
  packageId: "@cinatra-ai/gemini-connector",
  name: "Gemini API Connection",
  slug: "connector-gemini",
  description: "Optional API connection for Gemini-powered audio transcription and other Google AI workflows.",
  settingsHref: "/configuration/llm?modal=gemini",
};

function readSettings() {
  return getGeminiDeps().readConnectorConfigFromDatabase<GeminiAPISettings>("gemini", {});
}

function writeSettings(value: GeminiAPISettings) {
  getGeminiDeps().writeConnectorConfigToDatabase("gemini", value);
}

function sanitizeLogLabel(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "gemini-call"
  );
}

function buildLogTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isGeminiLoggingEnabled() {
  return readSettings().loggingEnabled !== false;
}

export async function writeGeminiLogFile(input: {
  label: string;
  kind: "request" | "response";
  body: unknown;
}) {
  if (!isGeminiLoggingEnabled()) {
    return;
  }

  await mkdir(GEMINI_API_LOG_DIRECTORY, { recursive: true });
  const filename = `${buildLogTimestamp()}__${sanitizeLogLabel(input.label)}__${input.kind}.json`;
  const content = typeof input.body === "string" ? { raw: input.body } : input.body;
  await writeFile(path.join(GEMINI_API_LOG_DIRECTORY, filename), JSON.stringify(content, null, 2), "utf8");
}

export function buildGeminiRequestHeaders(input: {
  apiKey?: string;
  contentType?: string;
  extraHeaders?: Record<string, string>;
}) {
  return {
    ...(input.contentType ? { "Content-Type": input.contentType } : {}),
    ...(input.apiKey ? { "x-goog-api-key": input.apiKey } : {}),
    ...getGeminiDeps().buildAppMcpSelfClientHeaders(),
    ...(input.extraHeaders ?? {}),
  } satisfies Record<string, string>;
}

export function getGeminiAPISettings() {
  const settings = readSettings();

  return {
    apiKey: settings.apiKey,
    lastSavedAt: settings.lastSavedAt,
    loggingEnabled: settings.loggingEnabled ?? true,
  } satisfies GeminiAPISettings;
}

export async function getConfiguredGeminiAPIKey() {
  const nango = geminiNango();
  if (!nango.isConfigured()) {
    return null;
  }

  // Require a saved local Nango pointer record before reading the credential.
  // Without this gate, a save sequence that imported the credential but failed
  // readback verification, and therefore correctly skipped
  // `saveConnectionRecord`, would still leak an unverified credential to
  // the LLM provider via the deterministic providerConfigKey/connectionId
  // fallback. The local pointer is the "verified + committed" signal; the LLM
  // must respect it.
  const savedConnection = nango.getPrimarySavedConnection("gemini");
  if (!savedConnection) {
    return null;
  }

  const credentials = await nango.getCredentials(
    savedConnection.providerConfigKey,
    savedConnection.connectionId,
  );

  // Shared extractor accepts both `{ apiKey }` object shape and raw-string
  // shape.
  return extractApiKey(credentials);
}

export function getGeminiLoggingSettings() {
  const settings = getGeminiAPISettings();
  return {
    enabled: settings.loggingEnabled !== false,
    directory: GEMINI_API_LOG_DIRECTORY,
  };
}

export function getGeminiAPIStatus() {
  const settings = getGeminiAPISettings();
  const savedConnection = geminiNango().getPrimarySavedConnection("gemini");

  if (savedConnection) {
    return {
      status: "connected" as const,
      detail: savedConnection
        ? `Connected${savedConnection.displayName ? ` as ${savedConnection.displayName}` : ""}.`
        : "Gemini is configured.",
    };
  }

  if (settings.apiKey) {
    return {
      status: "incomplete" as const,
      detail: "Save the Gemini API key to enable transcript generation.",
    };
  }

  return {
    status: "not_connected" as const,
    detail: "Add a Gemini API key to enable transcript generation.",
  };
}

export async function saveGeminiAPISettings(input: {
  apiKey?: string;
}) {
  const current = getGeminiAPISettings();
  const trimmedInput = input.apiKey?.trim() ?? "";

  // The connected-state modal copy says "Leave blank to keep the currently
  // saved key." A vaulted credential is never reloaded into `current.apiKey`
  // because DB plaintext is intentionally `undefined`, so the
  // `trimmedInput || current.apiKey` fallback resolves to undefined on a blank
  // re-submit and throws "Enter a Gemini API key to continue." Honour the UI
  // promise: when a saved local pointer exists and no new key was typed, no-op
  // cleanly.
  if (!trimmedInput) {
    const savedConnection = geminiNango().getPrimarySavedConnection("gemini");
    if (savedConnection) {
      return current;
    }
    throw new Error("Enter a Gemini API key to continue.");
  }

  if (!geminiNango().isConfigured()) {
    throw new Error("Configure the connection service first so Gemini API requests can authenticate.");
  }

  await syncGeminiAPISettingsToNango({ apiKey: trimmedInput });

  const nextSettings: GeminiAPISettings = {
    apiKey: undefined,
    lastSavedAt: new Date().toISOString(),
    loggingEnabled: current.loggingEnabled ?? true,
  };
  writeSettings(nextSettings);
  return nextSettings;
}

export async function saveGeminiLoggingSettings(enabled: boolean) {
  writeSettings({
    ...readSettings(),
    loggingEnabled: enabled,
  });
}

export async function clearGeminiAPISettings() {
  const current = readSettings();
  writeSettings({
    loggingEnabled: current.loggingEnabled ?? true,
  });
  const nango = geminiNango();
  const savedConnection = nango.getPrimarySavedConnection("gemini");
  await nango.deleteConnection(
    savedConnection?.providerConfigKey ?? nango.providerConfigKeys.gemini,
    savedConnection?.connectionId ?? nango.connectionIds.gemini,
  );
  await nango.clearConnectionRecords("gemini");
}

export async function syncGeminiAPISettingsToNango(input: {
  apiKey: string;
}) {
  const nango = geminiNango();
  if (!nango.isConfigured()) {
    return;
  }

  const providerConfigKey = nango.providerConfigKeys.gemini;
  const connectionId = nango.connectionIds.gemini;
  const trimmedInput = input.apiKey.trim();

  await nango.ensureIntegration({
    provider: "google-gemini",
    providerConfigKey,
    displayName: "Cinatra Gemini",
  });

  // Readback-safe order mirrors saveApifySettings:
  //   1. import WITHOUT `connectorKey` so saveNangoConnectionRecord is
  //      NOT auto-written before verification.
  //   2. getNangoCredentials forceRefresh + extract via shared helper +
  //      compare against the trimmed input. Generic error on mismatch
  //      (no token in message). Combined with the saved-pointer gate in
  //      getConfiguredGeminiAPIKey, a verification failure leaves NO usable
  //      Gemini credential reachable to the LLM provider.
  //   3. ONLY THEN call saveNangoConnectionRecord ourselves with
  //      `{ multiple: false }` (single workspace-wide credential).
  await nango.importConnection({
    providerConfigKey,
    connectionId,
    credentials: { type: "API_KEY", apiKey: trimmedInput },
  });

  const readback = await nango.getCredentials(providerConfigKey, connectionId, { forceRefresh: true });
  const readbackKey = extractApiKey(readback);
  if (readbackKey !== trimmedInput) {
    throw new Error(
      "Nango credential verification failed: the readback value did not match the saved credential.",
    );
  }

  await nango.saveConnectionRecord(
    "gemini",
    {
      connectionId,
      providerConfigKey,
      metadata: {},
    },
    { multiple: false },
  );
}

// Host DI surface (boot wiring lives in src/lib/register-transport-connectors.ts).
export { registerGeminiConnector, getGeminiDeps, _resetGeminiDepsForTests } from "./deps";
export type { GeminiConnectorDeps } from "./deps";
