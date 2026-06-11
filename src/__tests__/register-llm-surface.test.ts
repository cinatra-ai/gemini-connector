// `register(ctx)` llm-provider-surface shape — the Stage 2 adapter members
// (cinatra#151): `buildRequestHeaders` + `writeLogFile`, resolved by the
// host's packages/llm Gemini adapter at call time instead of a value-import.

import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.hoisted: the vi.mock factory below is hoisted above plain consts.
const { buildGeminiRequestHeadersMock, writeGeminiLogFileMock } = vi.hoisted(() => ({
  buildGeminiRequestHeadersMock: vi.fn((_input: unknown) => ({ "x-test": "1" })),
  writeGeminiLogFileMock: vi.fn(async (_input: unknown) => {}),
}));

vi.mock("../index", () => ({
  getConfiguredGeminiAPIKey: vi.fn(async () => null),
  getGeminiLoggingSettings: vi.fn(() => ({ enabled: true, directory: "/logs" })),
  saveGeminiLoggingSettings: vi.fn(async () => {}),
  buildGeminiRequestHeaders: buildGeminiRequestHeadersMock,
  writeGeminiLogFile: writeGeminiLogFileMock,
}));

vi.mock("../log-directory", () => ({ GEMINI_API_LOG_DIRECTORY: "/logs/gemini" }));

import { register } from "../register";

type RegisteredProvider = { packageName: string; impl: Record<string, unknown> };

function activate(): RegisteredProvider {
  const registered: RegisteredProvider[] = [];
  const ctx = {
    capabilities: {
      registerProvider: (capability: string, provider: RegisteredProvider) => {
        if (capability === "llm-provider-surface") registered.push(provider);
      },
      resolveProviders: () => [],
    },
  } as never;
  register(ctx);
  expect(registered).toHaveLength(1);
  return registered[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("register(ctx) — Stage 2 llm-provider-surface members", () => {
  it("registers buildRequestHeaders delegating with field-picked input", () => {
    const { impl } = activate();
    const buildRequestHeaders = impl.buildRequestHeaders as (
      input: unknown,
    ) => Record<string, string>;
    expect(typeof buildRequestHeaders).toBe("function");
    const headers = buildRequestHeaders({
      apiKey: "k",
      contentType: "application/json",
      extraHeaders: { a: "b" },
      junk: "dropped",
    });
    expect(headers).toEqual({ "x-test": "1" });
    expect(buildGeminiRequestHeadersMock).toHaveBeenCalledWith({
      apiKey: "k",
      contentType: "application/json",
      extraHeaders: { a: "b" },
    });
  });

  it("registers writeLogFile delegating to writeGeminiLogFile (field-picked)", async () => {
    const { impl } = activate();
    const writeLogFile = impl.writeLogFile as (input: unknown) => Promise<void>;
    await writeLogFile({ label: "l", kind: "response", body: "raw", junk: "dropped" });
    expect(writeGeminiLogFileMock).toHaveBeenCalledWith({
      label: "l",
      kind: "response",
      body: "raw",
    });
  });

  it("registration stays probe-safe (no I/O, no host-service calls at register time)", () => {
    activate();
    expect(buildGeminiRequestHeadersMock).not.toHaveBeenCalled();
    expect(writeGeminiLogFileMock).not.toHaveBeenCalled();
  });
});
