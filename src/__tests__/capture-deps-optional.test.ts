// Convergence regression (cinatra#981): the two host-owned capture members are
// ADDITIVE and OPTIONAL at every layer. register(ctx) feature-detects
// ctx.logger.capture / ctx.logger.captureDirectory, so a host below the SDK ABI
// 2.3.0 floor already degrades to a no-op writer and an empty directory. The
// deps layer must degrade the same way: a host that wires this connector with a
// partial deps object (several host wiring sites do, casting the literal) would
// otherwise hit "captureLog is not a function" on the logging write path and —
// worse, because it is a pure READ that used to be a module constant —
// "captureLogDirectory is not a function" from getGeminiLoggingSettings() even
// with logging switched OFF.
import { afterEach, describe, expect, it } from "vitest";

import {
  writeGeminiLogFile,
  getGeminiLoggingSettings,
  registerGeminiConnector,
  _resetGeminiDepsForTests,
} from "../index";

function wirePartialDeps(loggingEnabled: boolean) {
  registerGeminiConnector({
    readConnectorConfigFromDatabase: <T,>(key: string, fallback: T): T =>
      (key === "gemini" ? ({ loggingEnabled } as unknown as T) : fallback),
    writeConnectorConfigToDatabase: () => {},
    buildAppMcpSelfClientHeaders: () => ({}),
    isAppDevelopmentMode: () => false,
    nango: {} as never,
    // captureLog / captureLogDirectory DELIBERATELY absent.
  } as never);
}

afterEach(() => {
  _resetGeminiDepsForTests();
});

describe("capture deps are optional (partial host wiring)", () => {
  it("does not throw on the write path when the host wired no capture port", async () => {
    wirePartialDeps(true);
    await expect(
      writeGeminiLogFile({ label: "gemini-transcribe", kind: "request", body: { a: 1 } }),
    ).resolves.toBeUndefined();
  });

  it("reads the logging settings without a capture port, degrading the directory to an empty string", () => {
    wirePartialDeps(false);
    const settings = getGeminiLoggingSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.directory).toBe("");
  });

  it("still propagates a genuine host write failure when the port IS wired", async () => {
    const failure = new Error("host write failed");
    registerGeminiConnector({
      readConnectorConfigFromDatabase: <T,>(key: string, fallback: T): T =>
        (key === "gemini" ? ({ loggingEnabled: true } as unknown as T) : fallback),
      writeConnectorConfigToDatabase: () => {},
      buildAppMcpSelfClientHeaders: () => ({}),
      isAppDevelopmentMode: () => false,
      nango: {} as never,
      captureLog: async () => {
        throw failure;
      },
      captureLogDirectory: () => "/host-owned/gemini-api",
    } as never);
    await expect(
      writeGeminiLogFile({ label: "gemini-transcribe", kind: "request", body: { a: 1 } }),
    ).rejects.toBe(failure);
  });
});
