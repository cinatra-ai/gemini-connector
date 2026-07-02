// End-to-end writer proof for the gemini logging chokepoint:
//   - a RAW JSON-STRING response body is parsed then redacted (not stored as an
//     opaque string that would smuggle a Bearer token to disk);
//   - the default gate is OFF in production when the preference is unset;
//   - retention/write only happen when logging is effectively enabled.

import { mkdtempSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Point the connector's on-disk log directory at an isolated temp dir.
const { TMP_LOG_DIR } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require("node:fs") as typeof import("node:fs");
  return {
    TMP_LOG_DIR: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "gemini-writer-")),
  };
});

vi.mock("../log-directory", () => ({ GEMINI_API_LOG_DIRECTORY: TMP_LOG_DIR }));

import {
  writeGeminiLogFile,
  registerGeminiConnector,
  _resetGeminiDepsForTests,
} from "../index";

const CANARY = `CANARY_TOKEN_${Math.random().toString(36).slice(2)}_DO_NOT_LEAK`;

type Config = Record<string, unknown>;
let CONFIG: Config;

function wireDeps(opts: { loggingEnabled?: boolean; developmentMode: boolean }) {
  CONFIG = { gemini: { loggingEnabled: opts.loggingEnabled } };
  registerGeminiConnector({
    readConnectorConfigFromDatabase: <T>(key: string, fallback: T): T =>
      (CONFIG[key] as T) ?? fallback,
    writeConnectorConfigToDatabase: (key, value) => {
      CONFIG[key] = value;
    },
    buildAppMcpSelfClientHeaders: () => ({}),
    isAppDevelopmentMode: () => opts.developmentMode,
    nango: {} as never,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(async () => {
  _resetGeminiDepsForTests();
  await rm(TMP_LOG_DIR, { recursive: true, force: true }).catch(() => {});
});

afterAll(async () => {
  await rm(TMP_LOG_DIR, { recursive: true, force: true }).catch(() => {});
});

describe("writeGeminiLogFile — default-off gate + string-body redaction", () => {
  it("does NOT write when logging is unset in production (secure default)", async () => {
    wireDeps({ loggingEnabled: undefined, developmentMode: false });
    await writeGeminiLogFile({ label: "gemini-transcribe", kind: "request", body: { a: 1 } });
    // Nothing written: the log dir is either absent or empty.
    const files = await readdir(TMP_LOG_DIR).catch(() => [] as string[]);
    expect(files).toHaveLength(0);
  });

  it("writes when logging is unset in development (dev-only default-on)", async () => {
    wireDeps({ loggingEnabled: undefined, developmentMode: true });
    await writeGeminiLogFile({ label: "gemini-transcribe", kind: "request", body: { a: 1 } });
    expect((await readdir(TMP_LOG_DIR)).length).toBe(1);
  });

  it("parses a raw JSON-string body and redacts Authorization before it hits disk", async () => {
    wireDeps({ loggingEnabled: true, developmentMode: false });
    const rawResponse = JSON.stringify({
      candidates: [{ text: "hi" }],
      request_echo: { headers: { Authorization: `Bearer ${CANARY}` } },
      mcp_servers: [{ authorization_token: CANARY }],
    });
    await writeGeminiLogFile({ label: "gemini-transcribe", kind: "response", body: rawResponse });

    const files = await readdir(TMP_LOG_DIR);
    expect(files).toHaveLength(1);
    const written = await readFile(path.join(TMP_LOG_DIR, files[0]), "utf8");
    // Parsed (not stored as an opaque {raw} string) and fully redacted.
    expect(written).not.toContain(CANARY);
    expect(written).toContain("[REDACTED]");
    expect(written).not.toContain('"raw"');
    expect(JSON.parse(written).candidates[0].text).toBe("hi");
  });
});
