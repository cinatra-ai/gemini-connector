// End-to-end writer proof for the gemini logging chokepoint:
//   - a RAW JSON-STRING response body is parsed then redacted (not stored as an
//     opaque string that would smuggle a Bearer token to disk);
//   - the default gate is OFF in production when the preference is unset;
//   - the host-owned capture port (cinatra#981) is only ever called when
//     logging is effectively enabled — the connector no longer touches
//     `node:fs` directly, so this test asserts against the captured call
//     rather than a real on-disk file.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  writeGeminiLogFile,
  registerGeminiConnector,
  _resetGeminiDepsForTests,
} from "../index";
import { GEMINI_LOG_CAPTURE_CHANNEL } from "../log-capture-channel";

const CANARY = `CANARY_TOKEN_${Math.random().toString(36).slice(2)}_DO_NOT_LEAK`;

type Config = Record<string, unknown>;
let CONFIG: Config;
let captured: Array<{ channel: string; entry: { label: string; kind: string; body: unknown } }>;

function wireDeps(opts: { loggingEnabled?: boolean; developmentMode: boolean }) {
  CONFIG = { gemini: { loggingEnabled: opts.loggingEnabled } };
  captured = [];
  registerGeminiConnector({
    readConnectorConfigFromDatabase: <T>(key: string, fallback: T): T =>
      (CONFIG[key] as T) ?? fallback,
    writeConnectorConfigToDatabase: (key, value) => {
      CONFIG[key] = value;
    },
    buildAppMcpSelfClientHeaders: () => ({}),
    isAppDevelopmentMode: () => opts.developmentMode,
    nango: {} as never,
    captureLog: async (channel, entry) => {
      captured.push({ channel, entry });
    },
    captureLogDirectory: (channel) => `/host-owned/${channel}`,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  _resetGeminiDepsForTests();
});

describe("writeGeminiLogFile — default-off gate + string-body redaction", () => {
  it("does NOT call the host capture port when logging is unset in production (secure default)", async () => {
    wireDeps({ loggingEnabled: undefined, developmentMode: false });
    await writeGeminiLogFile({ label: "gemini-transcribe", kind: "request", body: { a: 1 } });
    expect(captured).toHaveLength(0);
  });

  it("captures when logging is unset in development (dev-only default-on)", async () => {
    wireDeps({ loggingEnabled: undefined, developmentMode: true });
    await writeGeminiLogFile({ label: "gemini-transcribe", kind: "request", body: { a: 1 } });
    expect(captured).toHaveLength(1);
    expect(captured[0].channel).toBe(GEMINI_LOG_CAPTURE_CHANNEL);
  });

  it("parses a raw JSON-string body and redacts Authorization before it reaches the host capture port", async () => {
    wireDeps({ loggingEnabled: true, developmentMode: false });
    const rawResponse = JSON.stringify({
      candidates: [{ text: "hi" }],
      request_echo: { headers: { Authorization: `Bearer ${CANARY}` } },
      mcp_servers: [{ authorization_token: CANARY }],
    });
    await writeGeminiLogFile({ label: "gemini-transcribe", kind: "response", body: rawResponse });

    expect(captured).toHaveLength(1);
    const { entry } = captured[0];
    expect(entry.label).toBe("gemini-transcribe");
    expect(entry.kind).toBe("response");
    const written = JSON.stringify(entry.body);
    // Parsed (not stored as an opaque {raw} string) and fully redacted.
    expect(written).not.toContain(CANARY);
    expect(written).toContain("[REDACTED]");
    expect(written).not.toContain('"raw"');
    expect((entry.body as { candidates: Array<{ text: string }> }).candidates[0].text).toBe("hi");
  });
});
