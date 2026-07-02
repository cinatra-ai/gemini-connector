// Verifies the readback and saved-pointer chain in connector-gemini.
//
// syncGeminiAPISettingsToNango uses the readback-safe order
//   (ensure → import WITHOUT connectorKey → getCredentials forceRefresh
//   → extractApiKey → equality compare → saveConnectionRecord
//   separately). Generic error on mismatch; no token in the message.
//
// getConfiguredGeminiAPIKey() REQUIRES a saved local Nango pointer
//   (getPrimarySavedConnection) before reading credentials. A
//   save→import→readback-fail sequence (which correctly skips
//   saveConnectionRecord) MUST leave NO usable Gemini credential
//   reachable to the LLM provider.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// The nango capability is host-INJECTED via deps.nango (not imported from the
// nango-connector sibling extension). Each method below is a module-level mock
// fn wired into deps in beforeEach. Mirrors the old mocked names:
//   isNangoConfigured           → isConfigured
//   getPrimarySavedNangoConnection → getPrimarySavedConnection
//   getNangoCredentials         → getCredentials
//   ensureNangoIntegration      → ensureIntegration
//   importNangoConnection       → importConnection
//   saveNangoConnectionRecord   → saveConnectionRecord
//   clearNangoConnectionRecords → clearConnectionRecords
//   deleteNangoConnection       → deleteConnection
// Constants CINATRA_NANGO_{PROVIDER_CONFIG_KEYS,CONNECTION_IDS} →
//   providerConfigKeys / connectionIds bags.
const isConfigured = vi.fn<() => boolean>();
const getPrimarySavedConnection =
  vi.fn<
    (connectorKey: "gemini") =>
      | { providerConfigKey: string; connectionId: string; displayName?: string }
      | null
  >();
const getCredentials = vi.fn(async (..._args: unknown[]): Promise<unknown> => null);
const ensureIntegration = vi.fn(async (..._args: unknown[]): Promise<unknown> => null);
const importConnection = vi.fn(async (..._args: unknown[]): Promise<unknown> => null);
const saveConnectionRecord = vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined);
const deleteConnection = vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined);
const clearConnectionRecords = vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined);

import {
  getConfiguredGeminiAPIKey,
  saveGeminiAPISettings,
  syncGeminiAPISettingsToNango,
  registerGeminiConnector,
  _resetGeminiDepsForTests,
} from "../index";

const APIKEY = "AIza_test_apikey_1234567890";

// Host deps are INJECTED (registerGeminiConnector), not imported from `@/lib/*`.
// CONFIG_STORE backs the connector_config read/write; deps registered in beforeEach.
let CONFIG_STORE: Record<string, unknown> = {};

beforeEach(() => {
  // resetAllMocks clears mockResolvedValueOnce queues from prior tests (which
  // would otherwise leak into the next test's getCredentials reads).
  vi.resetAllMocks();
  CONFIG_STORE = {};
  // Wire injected host deps (boot does this in register-transport-connectors).
  registerGeminiConnector({
    readConnectorConfigFromDatabase: <T>(key: string, fallback: T): T =>
      (CONFIG_STORE[key] as T) ?? fallback,
    writeConnectorConfigToDatabase: (key: string, value: unknown) => {
      CONFIG_STORE[key] = value;
    },
    buildAppMcpSelfClientHeaders: () => ({}),
    isAppDevelopmentMode: () => false,
    nango: {
      isConfigured,
      getPrimarySavedConnection,
      ensureIntegration,
      importConnection,
      getCredentials,
      saveConnectionRecord,
      deleteConnection,
      clearConnectionRecords,
      providerConfigKeys: { gemini: "cinatra-google-gemini" },
      connectionIds: { gemini: "cinatra-google-gemini" },
    },
  });
  isConfigured.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetGeminiDepsForTests();
});

describe("syncGeminiAPISettingsToNango — readback-safe", () => {
  it("happy path: ensure → import (no connectorKey) → forceRefresh readback → saveConnectionRecord (in that order)", async () => {
    getCredentials.mockResolvedValueOnce({ apiKey: APIKEY } as never);

    await syncGeminiAPISettingsToNango({ apiKey: APIKEY });

    // import WITHOUT connectorKey for the readback-safe pattern.
    expect(importConnection).toHaveBeenCalledTimes(1);
    const importCall = importConnection.mock.calls[0][0] as Record<string, unknown>;
    expect(importCall).toMatchObject({
      providerConfigKey: "cinatra-google-gemini",
      connectionId: "cinatra-google-gemini",
      credentials: { type: "API_KEY", apiKey: APIKEY },
    });
    expect(importCall.connectorKey).toBeUndefined();

    // forceRefresh readback against the same provider/connection.
    expect(getCredentials).toHaveBeenCalledWith(
      "cinatra-google-gemini",
      "cinatra-google-gemini",
      { forceRefresh: true },
    );

    // saveConnectionRecord called AFTER readback, with multiple:false.
    expect(saveConnectionRecord).toHaveBeenCalledWith(
      "gemini",
      expect.objectContaining({
        connectionId: "cinatra-google-gemini",
        providerConfigKey: "cinatra-google-gemini",
      }),
      { multiple: false },
    );

    // Assert the actual mock invocation ORDER (ensure → import → readback →
    // saveRecord), not just that each was called. invocationCallOrder is a
    // monotonic global sequence number per call; comparing them locks the
    // temporal order.
    const ensureOrder = ensureIntegration.mock.invocationCallOrder[0];
    const importOrder = importConnection.mock.invocationCallOrder[0];
    const readbackOrder = getCredentials.mock.invocationCallOrder[0];
    const saveRecordOrder = saveConnectionRecord.mock.invocationCallOrder[0];
    expect(ensureOrder).toBeLessThan(importOrder);
    expect(importOrder).toBeLessThan(readbackOrder);
    expect(readbackOrder).toBeLessThan(saveRecordOrder);
  });

  it("readback mismatch THROWS generic error (no token in message) and skips saveConnectionRecord", async () => {
    getCredentials.mockResolvedValueOnce({ apiKey: "DIFFERENT_KEY" } as never);

    await expect(syncGeminiAPISettingsToNango({ apiKey: APIKEY })).rejects.toThrow(
      /Nango credential verification failed/,
    );

    expect(saveConnectionRecord).not.toHaveBeenCalled();

    // The thrown message MUST NOT contain the submitted key, the readback
    // value, or any partial.
    try {
      await syncGeminiAPISettingsToNango({ apiKey: APIKEY });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(APIKEY);
      expect(msg).not.toContain("DIFFERENT_KEY");
      expect(msg).not.toContain(APIKEY.slice(0, 5));
    }
  });

  it("readback null THROWS the same generic error", async () => {
    getCredentials.mockResolvedValueOnce(null);
    await expect(syncGeminiAPISettingsToNango({ apiKey: APIKEY })).rejects.toThrow(
      /Nango credential verification failed/,
    );
    expect(saveConnectionRecord).not.toHaveBeenCalled();
  });

  it("input apiKey is trimmed before compare (whitespace-tolerant)", async () => {
    getCredentials.mockResolvedValueOnce({ apiKey: APIKEY } as never);
    await syncGeminiAPISettingsToNango({ apiKey: `  ${APIKEY}  ` });
    expect(saveConnectionRecord).toHaveBeenCalled();
  });

  it("isConfigured=false returns early (no Nango calls)", async () => {
    isConfigured.mockReturnValue(false);
    await syncGeminiAPISettingsToNango({ apiKey: APIKEY });
    expect(importConnection).not.toHaveBeenCalled();
    expect(saveConnectionRecord).not.toHaveBeenCalled();
  });
});

// The "Leave blank to keep the currently saved key." modal copy must not
// resolve to a thrown "Enter a Gemini API key to continue." error.
describe("saveGeminiAPISettings — blank-submit no-op", () => {
  it("blank input + saved pointer present → no-op (no sync, no throw)", async () => {
    getPrimarySavedConnection.mockReturnValue({
      providerConfigKey: "cinatra-google-gemini",
      connectionId: "cinatra-google-gemini",
    } as never);

    await expect(saveGeminiAPISettings({ apiKey: "" })).resolves.toBeDefined();
    await expect(saveGeminiAPISettings({})).resolves.toBeDefined();
    await expect(saveGeminiAPISettings({ apiKey: "   " })).resolves.toBeDefined();

    expect(importConnection).not.toHaveBeenCalled();
    expect(saveConnectionRecord).not.toHaveBeenCalled();
  });

  it("blank input + NO saved pointer → throws (no silent miss)", async () => {
    getPrimarySavedConnection.mockReturnValue(null);
    await expect(saveGeminiAPISettings({ apiKey: "" })).rejects.toThrow(
      /Enter a Gemini API key to continue/,
    );
  });

  it("non-blank input still triggers the full sync (regression — no-op path doesn't swallow real saves)", async () => {
    getPrimarySavedConnection.mockReturnValue(null);
    getCredentials.mockResolvedValueOnce({ apiKey: APIKEY } as never);

    await saveGeminiAPISettings({ apiKey: APIKEY });

    expect(importConnection).toHaveBeenCalledTimes(1);
    expect(saveConnectionRecord).toHaveBeenCalledTimes(1);
  });
});

describe("getConfiguredGeminiAPIKey — saved-pointer gate", () => {
  it("returns null when no saved local pointer (closes readback-fail bypass)", async () => {
    getPrimarySavedConnection.mockReturnValue(null);
    // Even if the Nango vault has a credential at the deterministic key,
    // the LLM provider must NOT see it without a verified+committed pointer.
    getCredentials.mockResolvedValueOnce({ apiKey: "leaked-key" } as never);

    const key = await getConfiguredGeminiAPIKey();

    expect(key).toBeNull();
    // The deterministic-fallback Nango read must NOT happen at all when no
    // pointer exists.
    expect(getCredentials).not.toHaveBeenCalled();
  });

  it("returns the apiKey when a saved local pointer exists (extractor: {apiKey} shape)", async () => {
    getPrimarySavedConnection.mockReturnValue({
      providerConfigKey: "cinatra-google-gemini",
      connectionId: "cinatra-google-gemini",
    } as never);
    getCredentials.mockResolvedValueOnce({ apiKey: APIKEY } as never);

    const key = await getConfiguredGeminiAPIKey();
    expect(key).toBe(APIKEY);
    expect(getCredentials).toHaveBeenCalledWith(
      "cinatra-google-gemini",
      "cinatra-google-gemini",
    );
  });

  it("returns the apiKey when credentials are a raw string (extractor: string shape)", async () => {
    getPrimarySavedConnection.mockReturnValue({
      providerConfigKey: "cinatra-google-gemini",
      connectionId: "cinatra-google-gemini",
    } as never);
    getCredentials.mockResolvedValueOnce(APIKEY as never);
    expect(await getConfiguredGeminiAPIKey()).toBe(APIKEY);
  });

  it("returns null when Nango is unconfigured (early return; never reads pointer)", async () => {
    isConfigured.mockReturnValue(false);
    expect(await getConfiguredGeminiAPIKey()).toBeNull();
    expect(getPrimarySavedConnection).not.toHaveBeenCalled();
  });

  it("after a save where import succeeds + readback fails, getConfiguredGeminiAPIKey leaks nothing", async () => {
    // Simulate the failure path end-to-end:
    //   1. import succeeds (no throw)
    //   2. readback returns a wrong key (verification throws)
    //   3. saveConnectionRecord is NOT called (verification throws before it)
    //   4. getPrimarySavedConnection therefore returns null (no pointer)
    //   5. getConfiguredGeminiAPIKey() must return null (saved-pointer gate)
    getCredentials.mockResolvedValueOnce({ apiKey: "WRONG" } as never);
    await expect(syncGeminiAPISettingsToNango({ apiKey: APIKEY })).rejects.toThrow();
    expect(saveConnectionRecord).not.toHaveBeenCalled();

    getPrimarySavedConnection.mockReturnValue(null);
    getCredentials.mockClear();
    // Even if the vault still holds the imported-but-unverified credential:
    getCredentials.mockResolvedValueOnce({ apiKey: APIKEY } as never);

    const leaked = await getConfiguredGeminiAPIKey();
    expect(leaked).toBeNull();
    expect(getCredentials).not.toHaveBeenCalled();
  });
});
