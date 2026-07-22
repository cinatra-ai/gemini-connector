// register(ctx) registers the schema-config named actions via `ctx.ui` so the
// declarative setup surface (cinatra.configSchema) can probe readiness/status
// and save/clear the Gemini connection WITHOUT shipping React (cinatra#782).
// The host dispatches these by id through
// `/api/extensions/{installId}/actions/{actionId}`, authorizing the actor at
// the "use" tier host-side. Because a credential write is a MANAGE-tier
// mutation, the WRITE handlers (saveConnection/clearConnection) re-assert the
// manage gate via the host action-guard service — so a missing/denying guard
// FAILS CLOSED (the action throws; nothing executes ungated).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveGeminiAPISettings: vi.fn(async () => ({})),
  clearGeminiAPISettings: vi.fn(async () => ({})),
  getGeminiAPIStatus: vi.fn(() => ({ status: "not_connected", detail: "Add a key." })),
}));

vi.mock("../index", () => ({
  getConfiguredGeminiAPIKey: vi.fn(async () => null),
  getGeminiLoggingSettings: vi.fn(() => ({ enabled: true, directory: "/tmp" })),
  saveGeminiLoggingSettings: vi.fn(async () => {}),
  buildGeminiRequestHeaders: vi.fn(() => ({})),
  writeGeminiLogFile: vi.fn(async () => {}),
  saveGeminiAPISettings: mocks.saveGeminiAPISettings,
  clearGeminiAPISettings: mocks.clearGeminiAPISettings,
  getGeminiAPIStatus: mocks.getGeminiAPIStatus,
}));

vi.mock("../log-directory", () => ({ GEMINI_API_LOG_DIRECTORY: "/tmp" }));

import { register } from "../register";
import { _resetGeminiDepsForTests } from "../deps";

type RegisteredProvider = { packageName: string; impl: unknown };
type UiAction = { id: string; handler: (input: unknown) => Promise<unknown> };

// A minimal nango-system capability surface. register(ctx) binds the deps slot
// (whose nango members resolve this capability LAZILY at call time), so the
// connectionServiceReady probe reaches isNangoConfigured() through activation.
const NANGO_SYSTEM = {
  isNangoConfigured: () => true,
  providerConfigKeys: { gemini: "cinatra-gemini" },
  connectionIds: { gemini: "cinatra-gemini" },
};

function makeCtx(services: Record<string, unknown>) {
  const uiActions: UiAction[] = [];
  return {
    ctx: {
      capabilities: {
        registerProvider: () => {},
        resolveProviders: (capability: string): RegisteredProvider[] => {
          const svc = services[capability];
          return svc ? [{ packageName: "host", impl: svc }] : [];
        },
      },
      ui: {
        registerSetupSurface: () => {},
        registerSettingsSurface: () => {},
        registerAction: (action: UiAction) => {
          uiActions.push(action);
        },
      },
    } as unknown as Parameters<typeof register>[0],
    uiActions,
  };
}

function actionById(uiActions: UiAction[], id: string): UiAction {
  const a = uiActions.find((x) => x.id === id);
  if (!a) throw new Error(`action ${id} not registered`);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetGeminiDepsForTests();
});

afterEach(() => {
  _resetGeminiDepsForTests();
});

describe("gemini-connector register(ctx) — schema-config named actions", () => {
  it("registers the probe + write actions used by the configSchema", () => {
    const { ctx, uiActions } = makeCtx({});
    register(ctx);
    expect(uiActions.map((a) => a.id).sort()).toEqual(
      [
        "clearConnection",
        "connectionServiceReady",
        "connectionStatus",
        "currentConfig",
        "saveConnection",
        "saveConnectionMode",
      ].sort(),
    );
  });

  it("connectionServiceReady reports the nango readiness as data", async () => {
    const { ctx, uiActions } = makeCtx({ "nango-system": NANGO_SYSTEM });
    register(ctx);
    await expect(actionById(uiActions, "connectionServiceReady").handler({})).resolves.toEqual({
      ready: true,
    });
  });

  it("connectionStatus THROWS when not connected (so the probe pill shows error)", async () => {
    mocks.getGeminiAPIStatus.mockReturnValueOnce({ status: "not_connected", detail: "Add a key." });
    const { ctx, uiActions } = makeCtx({});
    register(ctx);
    await expect(actionById(uiActions, "connectionStatus").handler({})).rejects.toThrow(/Add a key/);
  });

  it("connectionStatus returns the detail when connected", async () => {
    mocks.getGeminiAPIStatus.mockReturnValueOnce({ status: "connected", detail: "Gemini is configured." });
    const { ctx, uiActions } = makeCtx({});
    register(ctx);
    await expect(actionById(uiActions, "connectionStatus").handler({})).resolves.toEqual({
      detail: "Gemini is configured.",
    });
  });

  it("saveConnection FAILS CLOSED when the action-guard service is missing (no write runs)", async () => {
    const { ctx, uiActions } = makeCtx({});
    register(ctx);
    await expect(
      actionById(uiActions, "saveConnection").handler({ apiKey: "AIza-xyz" }),
    ).rejects.toThrow(/action-guard service is not registered/);
    expect(mocks.saveGeminiAPISettings).not.toHaveBeenCalled();
  });

  it("saveConnection persists the key after the manage gate passes", async () => {
    const require = vi.fn(async () => {});
    const { ctx, uiActions } = makeCtx({
      "@cinatra-ai/host:extension-action-guard": { require },
    });
    register(ctx);
    const r = await actionById(uiActions, "saveConnection").handler({ apiKey: "AIza-xyz" });
    expect(require).toHaveBeenCalledWith("@cinatra-ai/gemini-connector", "manage");
    expect(mocks.saveGeminiAPISettings).toHaveBeenCalledWith({ apiKey: "AIza-xyz" });
    expect(r).toEqual({ banner: "saved" });
  });

  it("clearConnection clears after the manage gate, and FAILS CLOSED without the guard", async () => {
    const noGuard = makeCtx({});
    register(noGuard.ctx);
    await expect(actionById(noGuard.uiActions, "clearConnection").handler({})).rejects.toThrow(
      /action-guard service is not registered/,
    );
    expect(mocks.clearGeminiAPISettings).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const require = vi.fn(async () => {});
    const withGuard = makeCtx({ "@cinatra-ai/host:extension-action-guard": { require } });
    register(withGuard.ctx);
    const r = await actionById(withGuard.uiActions, "clearConnection").handler({});
    expect(require).toHaveBeenCalledWith("@cinatra-ai/gemini-connector", "manage");
    expect(mocks.clearGeminiAPISettings).toHaveBeenCalledOnce();
    expect(r).toEqual({ banner: "cleared" });
  });

  // ---- Connection tab (cinatra#1926) ----

  // The host services the connection-mode actions read: connector-config
  // (persisted mode) + runtime-mode (localCliEligible). `store` seeds the
  // persisted row; `eligible` drives the resolved-transport fallback.
  const connectionModeServices = (opts: { store?: Record<string, unknown>; eligible?: boolean } = {}) => {
    const store = opts.store ?? {};
    return {
      "@cinatra-ai/host:connector-config": {
        read: <T,>(connectorId: string, fallback: T): T =>
          connectorId in store ? (store[connectorId] as T) : fallback,
        write: (connectorId: string, value: unknown) => {
          store[connectorId] = value;
        },
        delete: (connectorId: string) => {
          delete store[connectorId];
        },
      },
      "@cinatra-ai/host:runtime-mode": {
        isDevelopment: () => opts.eligible ?? false,
        localCliEligible: () => opts.eligible ?? false,
      },
    };
  };

  it("currentConfig hydrates the resolved transport (manage-gated); localCli only when persisted AND eligible (AC4)", async () => {
    const guarded = makeCtx({
      "@cinatra-ai/host:extension-action-guard": { require: vi.fn(async () => {}) },
      ...connectionModeServices({ store: { "gemini-connection-mode": { mode: "localCli" } }, eligible: true }),
    });
    register(guarded.ctx);
    expect(await actionById(guarded.uiActions, "currentConfig").handler({})).toEqual({ connectionMode: "localCli" });

    _resetGeminiDepsForTests();
    const ineligible = makeCtx({
      "@cinatra-ai/host:extension-action-guard": { require: vi.fn(async () => {}) },
      ...connectionModeServices({ store: { "gemini-connection-mode": { mode: "localCli" } }, eligible: false }),
    });
    register(ineligible.ctx);
    expect(await actionById(ineligible.uiActions, "currentConfig").handler({})).toEqual({ connectionMode: "api" });
  });

  it("currentConfig FAILS CLOSED when the action-guard is missing (no store read)", async () => {
    const { ctx, uiActions } = makeCtx(connectionModeServices({ eligible: true })); // no guard
    register(ctx);
    await expect(actionById(uiActions, "currentConfig").handler({})).rejects.toThrow(
      /action-guard service is not registered/,
    );
  });

  it("saveConnectionMode persists a chosen mode after the manage gate (eligible)", async () => {
    const store: Record<string, unknown> = {};
    const { ctx, uiActions } = makeCtx({
      "@cinatra-ai/host:extension-action-guard": { require: vi.fn(async () => {}) },
      ...connectionModeServices({ store, eligible: true }),
    });
    register(ctx);
    const r = await actionById(uiActions, "saveConnectionMode").handler({ connectionMode: "localCli" });
    expect(r).toEqual({ banner: "connectionSaved" });
    expect(store["gemini-connection-mode"]).toEqual({ mode: "localCli" });
  });

  it("saveConnectionMode REJECTS a forged localCli write on an INELIGIBLE install (server-side gate)", async () => {
    const store: Record<string, unknown> = {};
    const { ctx, uiActions } = makeCtx({
      "@cinatra-ai/host:extension-action-guard": { require: vi.fn(async () => {}) },
      ...connectionModeServices({ store, eligible: false }),
    });
    register(ctx);
    const r = await actionById(uiActions, "saveConnectionMode").handler({ connectionMode: "localCli" });
    expect(r).toEqual({ banner: "error" });
    expect(store["gemini-connection-mode"]).toBeUndefined();
  });

  it("saveConnectionMode persists a deliberate localCli → api switch (no no-loss trap)", async () => {
    const store: Record<string, unknown> = { "gemini-connection-mode": { mode: "localCli" } };
    const { ctx, uiActions } = makeCtx({
      "@cinatra-ai/host:extension-action-guard": { require: vi.fn(async () => {}) },
      ...connectionModeServices({ store, eligible: true }),
    });
    register(ctx);
    await actionById(uiActions, "saveConnectionMode").handler({ connectionMode: "api" });
    expect(store["gemini-connection-mode"]).toEqual({ mode: "api" });
  });

  it("saveConnectionMode FAILS CLOSED when the action-guard is missing (no write)", async () => {
    const store: Record<string, unknown> = {};
    const { ctx, uiActions } = makeCtx(connectionModeServices({ store, eligible: true })); // no guard
    register(ctx);
    await expect(
      actionById(uiActions, "saveConnectionMode").handler({ connectionMode: "localCli" }),
    ).rejects.toThrow(/action-guard service is not registered/);
    expect(store["gemini-connection-mode"]).toBeUndefined();
  });
});
