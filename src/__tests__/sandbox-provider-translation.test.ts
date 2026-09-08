/**
 * SINGULAR-NATIVE-SHELL battery — Gemini half (epic cinatra#1705 AC4).
 *
 * REINSTATEMENT, not a new suite. The equivalent battery lived in core at
 * `packages/llm/src/__tests__/sandbox-provider-translation.test.ts` and was
 * DELETED with the in-core adapters in cinatra#1972 (llm-providers S4 /
 * cinatra#1715), leaving the rule as unguarded implementation in
 * `src/adapter/gemini-adapter.ts`. This file re-establishes the guard where
 * the code now lives, driving the REAL adapter with scripted SDK responses
 * (the SDK is mocked, the adapter is not).
 *
 * Gemini has no native shell wire form at all, so its obligations under the
 * singular-native-shell rule are:
 *   - execution is a NAMED `functionDeclaration` (`sandbox_execute`) — the
 *     only shape the model ever sees;
 *   - it coexists with the skill-delivery `shell` declaration as a SEPARATE,
 *     distinctly-named surface (they are different union members and must not
 *     collapse into one another);
 *   - `functionCall` dispatch routes to the sandbox tool's broker-bound
 *     executor (it is not an `LlmFunctionTool`, so the generic name lookup can
 *     never resolve it), including the `timeout_ms` → `timeoutMs` mapping, and
 *     the reply is wrapped as a `functionResponse` object.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  LlmSandboxExecutionTool,
  LlmShellTool,
  SandboxExecuteAction,
  SandboxExecuteOutput,
} from "@cinatra-ai/sdk-extensions/llm-provider-adapter-contract";

const geminiGenerate = vi.fn();

vi.mock("@google/genai", async () => {
  // Real `FileState` enum is fine to import — it's a string enum with no
  // runtime side effects. Only the client class needs mocking.
  const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
  class MockGoogleGenAI {
    models = { generateContent: geminiGenerate };
    constructor(_config: unknown) {}
  }
  return { ...actual, GoogleGenAI: MockGoogleGenAI };
});

// The relocated adapter (llm-providers S4, cinatra#1715) resolves its
// request-header builder and log writer through the connector's OWN `../index`
// functions. Mock them so `createClient` builds without a live host binding.
vi.mock("../index", () => ({
  buildGeminiRequestHeaders: () => ({}),
  writeGeminiLogFile: async () => {},
}));

import { createGeminiProviderAdapter } from "../adapter/gemini-adapter";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSandboxTool(): {
  tool: LlmSandboxExecutionTool;
  calls: SandboxExecuteAction[];
} {
  const calls: SandboxExecuteAction[] = [];
  const tool: LlmSandboxExecutionTool = {
    type: "sandbox_execution",
    toolName: "sandbox_execute",
    description: "Execute shell commands in an isolated sandbox.",
    stagedSkills: [
      {
        skillId: "skill-1",
        slug: "my-skill",
        description: "does things",
        resolveFiles: async () => [
          { path: "SKILL.md", content: "# body", digest: "d".repeat(64) },
        ],
      },
    ],
    execute: async (action): Promise<SandboxExecuteOutput[]> => {
      calls.push(action);
      return action.commands.map(() => ({
        stdout: "sandbox-ok",
        stderr: "",
        outcome: { type: "exit" as const, exitCode: 0 },
      }));
    },
  };
  return { tool, calls };
}

function makeSkillShellTool(): {
  tool: LlmShellTool;
  calls: SandboxExecuteAction[];
} {
  const calls: SandboxExecuteAction[] = [];
  const tool: LlmShellTool = {
    type: "shell",
    skills: [
      { name: "my-skill", description: "does things", path: "/skills/my-skill" },
    ],
    execute: async (action) => {
      calls.push(action as SandboxExecuteAction);
      return action.commands.map(() => ({
        stdout: "reader-ok",
        stderr: "",
        outcome: { type: "exit" as const, exitCode: 0 },
      }));
    },
  };
  return { tool, calls };
}

function declarations(callIndex = 0): Array<Record<string, unknown>> {
  const body = geminiGenerate.mock.calls[callIndex][0] as {
    config: { tools?: Array<{ functionDeclarations: Array<Record<string, unknown>> }> };
  };
  return body.config.tools?.[0]?.functionDeclarations ?? [];
}

beforeEach(() => {
  geminiGenerate.mockReset();
});

// ---------------------------------------------------------------------------
// Translation + dispatch
// ---------------------------------------------------------------------------

describe("Gemini translation — sandbox_execute is a named function declaration", () => {
  it("translates sandbox_execution to a named functionDeclaration", async () => {
    geminiGenerate.mockResolvedValue({ text: "done", functionCalls: null });
    const { tool } = makeSandboxTool();

    await createGeminiProviderAdapter("key").generate({
      system: "SYS",
      prompt: "hi",
      tools: [tool],
    });

    const decls = declarations();
    expect(decls.map((d) => d.name)).toContain("sandbox_execute");
    const def = decls.find((d) => d.name === "sandbox_execute")!;
    const params = def.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    // `commands` is the contract; optional siblings may grow, so this
    // asserts containment rather than a closed key set.
    expect(params.required).toEqual(["commands"]);
    expect(Object.keys(params.properties)).toContain("commands");
  });

  it("keeps skill delivery a SEPARATE declaration — the two never collapse", async () => {
    geminiGenerate.mockResolvedValue({ text: "done", functionCalls: null });
    const { tool: sandbox } = makeSandboxTool();
    const { tool: skillShell } = makeSkillShellTool();

    await createGeminiProviderAdapter("key").generate({
      system: "SYS",
      prompt: "hi",
      tools: [skillShell, sandbox],
    });

    const names = declarations().map((d) => d.name);
    expect(names).toContain("sandbox_execute");
    expect(names).toContain("shell");
    expect(names.filter((n) => n === "sandbox_execute")).toHaveLength(1);
    expect(names.filter((n) => n === "shell")).toHaveLength(1);
  });

  it("dispatches a sandbox_execute functionCall to the executor", async () => {
    const { tool: sandbox, calls } = makeSandboxTool();
    geminiGenerate
      .mockResolvedValueOnce({
        text: "",
        functionCalls: [
          { name: "sandbox_execute", args: { commands: ["node -v"], timeout_ms: 1500 } },
        ],
      })
      .mockResolvedValueOnce({ text: "done", functionCalls: null });

    const res = await createGeminiProviderAdapter("key").generate({
      system: "SYS",
      prompt: "hi",
      tools: [sandbox],
      maxSteps: 3,
    });

    expect(res.text).toBe("done");
    expect(calls).toHaveLength(1);
    expect(calls[0].commands).toEqual(["node -v"]);
    expect(calls[0].timeoutMs).toBe(1500);
    // The reply rides back as a functionResponse OBJECT carrying the stdout.
    const secondBody = geminiGenerate.mock.calls[1][0] as { contents: unknown };
    expect(JSON.stringify(secondBody.contents)).toContain("functionResponse");
    expect(JSON.stringify(secondBody.contents)).toContain("sandbox-ok");
  });

  it("routes a `shell` functionCall to the skill reader — never the sandbox", async () => {
    const { tool: sandbox, calls: sandboxCalls } = makeSandboxTool();
    const { tool: skillShell, calls: readerCalls } = makeSkillShellTool();
    geminiGenerate
      .mockResolvedValueOnce({
        text: "",
        functionCalls: [
          { name: "shell", args: { commands: ["cat /skills/my-skill/SKILL.md"] } },
        ],
      })
      .mockResolvedValueOnce({ text: "done", functionCalls: null });

    await createGeminiProviderAdapter("key").generate({
      system: "SYS",
      prompt: "hi",
      tools: [skillShell, sandbox],
      maxSteps: 3,
    });

    expect(readerCalls).toHaveLength(1);
    expect(readerCalls[0].commands).toEqual(["cat /skills/my-skill/SKILL.md"]);
    expect(sandboxCalls).toHaveLength(0);
  });

  it("refuses an empty commands array without touching the executor", async () => {
    const { tool: sandbox, calls } = makeSandboxTool();
    geminiGenerate
      .mockResolvedValueOnce({
        text: "",
        functionCalls: [{ name: "sandbox_execute", args: { commands: [] } }],
      })
      .mockResolvedValueOnce({ text: "done", functionCalls: null });

    await createGeminiProviderAdapter("key").generate({
      system: "SYS",
      prompt: "hi",
      tools: [sandbox],
      maxSteps: 3,
    });

    expect(calls).toHaveLength(0);
    const secondBody = geminiGenerate.mock.calls[1][0] as { contents: unknown };
    expect(JSON.stringify(secondBody.contents)).toContain("non-empty");
  });
});
