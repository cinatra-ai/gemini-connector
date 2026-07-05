import type { HostRequiredPackageDefinition } from "@cinatra-ai/sdk-extensions";
import { GEMINI_LOG_CAPTURE_CHANNEL } from "./log-capture-channel";
import { redactAuthorizationDeep } from "./log-redaction";
import { resolveLoggingEnabled } from "./logging-policy";
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

export { GEMINI_LOG_CAPTURE_CHANNEL } from "./log-capture-channel";

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

// Fail-closed development-mode probe: resolves the host runtime-mode service,
// treating any absence/error as PRODUCTION so body logging defaults OFF when the
// signal is unavailable. Wrapped so the logging gate never throws.
function isGeminiDevelopmentMode(): boolean {
  try {
    return getGeminiDeps().isAppDevelopmentMode();
  } catch {
    return false;
  }
}

function isGeminiLoggingEnabled() {
  // Default OFF in production (dev-only default-on): an explicit stored
  // preference wins; unset follows the runtime mode.
  return resolveLoggingEnabled(readSettings().loggingEnabled, isGeminiDevelopmentMode());
}

// Tolerant JSON extraction for a raw response-body string (mirrors the
// openai-connector helper) so redaction can reach Authorization material nested
// inside a JSON response instead of it surviving as an opaque string.
function parseJsonResponseBody<T>(rawBody: string): T | null {
  const candidates = [
    rawBody.trim(),
    rawBody.includes("\n") ? rawBody.split("\n").map((line) => line.trim()).find(Boolean) : undefined,
    rawBody.includes("{") && rawBody.includes("}")
      ? rawBody.slice(rawBody.indexOf("{"), rawBody.lastIndexOf("}") + 1).trim()
      : undefined,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Best-effort request/response capture through the HOST-owned
 * `ctx.logger.capture` port (cinatra#981) — storage, directory placement, and
 * rotation/retention are entirely host-side now (see
 * `@cinatra-ai/sdk-extensions` `HostLoggerPort.capture`). This connector keeps
 * ONLY the domain policy the host cannot own: the enabled/opt-in gate
 * (`isGeminiLoggingEnabled`) and the Authorization-header redaction — the
 * host receives an already-redacted body.
 */
export async function writeGeminiLogFile(input: {
  label: string;
  kind: "request" | "response";
  body: unknown;
}) {
  if (!isGeminiLoggingEnabled()) {
    return;
  }

  const rawContent =
    typeof input.body === "string"
      ? parseJsonResponseBody<unknown>(input.body) ?? { raw: input.body }
      : input.body;
  // Strip Bearer tokens (Authorization / authorization_token) from the logged
  // body before it hits disk — the request body can carry the resolved in-app
  // MCP self-client Authorization header. Ports the openai-connector redaction.
  const content = redactAuthorizationDeep(rawContent);
  await getGeminiDeps().captureLog(GEMINI_LOG_CAPTURE_CHANNEL, {
    label: input.label,
    kind: input.kind,
    body: content,
  });
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
    // Raw stored preference (undefined when unset) — persistence paths must
    // preserve "unset" so the runtime-mode default applies. The EFFECTIVE
    // on/off state is exposed by getGeminiLoggingSettings().
    loggingEnabled: settings.loggingEnabled,
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
  // EFFECTIVE state: explicit stored preference wins; unset defaults OFF in
  // production, ON in development (dev-only default-on).
  return {
    enabled: resolveLoggingEnabled(readSettings().loggingEnabled, isGeminiDevelopmentMode()),
    // Host-resolved (cinatra#981) — this connector no longer owns a raw
    // filesystem path, only the channel name.
    directory: getGeminiDeps().captureLogDirectory(GEMINI_LOG_CAPTURE_CHANNEL),
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
    // Preserve the operator's explicit logging preference; leave UNSET when
    // never chosen so the runtime-mode default (OFF in production) applies —
    // never silently persist default-on.
    loggingEnabled: current.loggingEnabled,
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
    // Preserve an explicit preference; leave UNSET otherwise (runtime default).
    loggingEnabled: current.loggingEnabled,
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
