/**
 * cinatra#4474 — the tool loops replay the model's own parts.
 *
 * Gemini 3.x models attach an opaque `thoughtSignature` to the parts of a
 * model turn and an `id` to each `functionCall`. A tool-result round trip
 * must send that model turn back unchanged, and each `functionResponse` must
 * carry the `id` of its call; otherwise the API answers HTTP 400. Both loops
 * used to rebuild the model turn from `{ name, args }`, which dropped the
 * signature and the id.
 *
 * The proof is taken at the WIRE (the pattern of no-empty-tools-block.test.ts):
 * the real `@google/genai` client runs and `globalThis.fetch` is intercepted,
 * so each assertion reads the JSON body the SDK serializes for the NEXT
 * request, after the SDK has parsed the scripted reply. No network is used.
 *
 * Pinned, for `generate` and `stream`:
 *   - three requests in a row; each later request carries the earlier model
 *     turns part for part (same order, nothing merged, nothing duplicated),
 *     with every `thoughtSignature` and call `id`;
 *   - two calls with distinct ids to the same function, a shell result, an
 *     error result, and a call that has no id (its response carries no id,
 *     and the host-side synthetic id never reaches the wire);
 *   - stream: several chunks per turn, including text-only chunks that carry
 *     a signature (one with text, one with empty text);
 *   - a thought part (`thought: true`) with a signature comes back in place;
 *   - a `sandbox_execute` response carries its call id, and a call whose id is
 *     the empty string is answered without an id (the host gets the synthetic id);
 *   - `thinkingConfig.thinkingLevel` is `MEDIUM` for `gemini-3.5-flash-lite*`
 *     (also with the `models/` prefix) with at least one function declaration,
 *     and absent otherwise.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../index", () => ({
  buildGeminiRequestHeaders: () => ({}),
  writeGeminiLogFile: async () => {},
}));

import { createGeminiProviderAdapter } from "../adapter/gemini-adapter";
import type {
  LlmFunctionTool,
  LlmSandboxExecutionTool,
  LlmShellTool,
  LlmTool,
  LlmToolCall,
  LlmToolResult,
  StreamInput,
} from "@cinatra-ai/sdk-extensions/llm-provider-adapter-contract";

type WirePart = Record<string, unknown>;
type WireBody = {
  contents: Array<{ role: string; parts: WirePart[] }>;
  generationConfig?: Record<string, unknown>;
  tools?: unknown;
};

/** Captured wire bodies and URLs, in call order. */
let bodies: WireBody[] = [];
let urls: string[] = [];
/** Scripted replies: generate takes one parts list per request, stream one list of chunks (each a parts list). */
let generateReplies: WirePart[][] = [];
let streamReplies: WirePart[][][] = [];
const realFetch = globalThis.fetch;

const usageMetadata = { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 };

const generateReply = (parts: WirePart[]) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
      usageMetadata,
      modelVersion: "gemini-test-001",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const streamReply = (chunks: WirePart[][]) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((parts, i) => {
        const last = i === chunks.length - 1;
        const chunk = {
          candidates: [{ content: { role: "model", parts }, ...(last ? { finishReason: "STOP" } : {}) }],
          ...(last ? { usageMetadata } : {}),
          modelVersion: "gemini-test-001",
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\r\n\r\n`));
      });
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

beforeEach(() => {
  bodies = [];
  urls = [];
  generateReplies = [];
  streamReplies = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const raw = typeof init?.body === "string" ? init.body : "{}";
    bodies.push(JSON.parse(raw) as WireBody);
    if (url.includes("streamGenerateContent")) {
      const next = streamReplies.shift();
      if (!next) throw new Error("test: no scripted stream reply left");
      return streamReply(next);
    }
    const next = generateReplies.shift();
    if (!next) throw new Error("test: no scripted generate reply left");
    return generateReply(next);
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const adapter = () => createGeminiProviderAdapter("test-api-key");

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const lookupTool: LlmFunctionTool = {
  name: "lookup_contact",
  description: "Look up a contact by email.",
  parameters: { type: "object", properties: { email: { type: "string" } }, required: ["email"] },
  execute: async (args) => ({ email: args.email, found: true }),
};

const failingTool: LlmFunctionTool = {
  name: "failing_tool",
  description: "A tool whose backend is down.",
  parameters: { type: "object", properties: {} },
  execute: async () => {
    throw new Error("lookup service down");
  },
};

const shellTool: LlmShellTool = {
  type: "shell",
  skills: [{ name: "report", description: "reads the report", path: "/skills/report" }],
  execute: async (action) =>
    action.commands.map(() => ({
      stdout: '{"ok":true}',
      stderr: "",
      outcome: { type: "exit" as const, exitCode: 0 },
    })),
};

const sandboxTool: LlmSandboxExecutionTool = {
  type: "sandbox_execution",
  toolName: "sandbox_execute",
  description: "Execute shell commands in an isolated sandbox.",
  execute: async (action) =>
    action.commands.map(() => ({ stdout: "sandbox-ok", stderr: "", outcome: { type: "exit" as const, exitCode: 0 } })),
};

const selfMcpTool: LlmTool = {
  type: "mcp",
  serverLabel: "cinatra",
  serverUrl: "https://example.test/api/mcp",
  serverDescription: "Cinatra self-MCP",
  allowedTools: null,
};

const loopTools: LlmTool[] = [lookupTool, failingTool, shellTool];

// ---------------------------------------------------------------------------
// The scripted model turns (signatures are opaque base64 strings)
// ---------------------------------------------------------------------------

const callA: WirePart = {
  functionCall: { id: "call-a", name: "lookup_contact", args: { email: "a@example.test" } },
  thoughtSignature: "c2lnLUE=",
};
const callB: WirePart = {
  functionCall: { id: "call-b", name: "lookup_contact", args: { email: "b@example.test" } },
};
const callShell: WirePart = {
  functionCall: { id: "call-c", name: "shell", args: { commands: ["cat report.json"] } },
  thoughtSignature: "c2lnLUM=",
};
/** A thought part with a signature: it must come back in place, unchanged. */
const thoughtPart: WirePart = { text: "Planning the two lookups.", thought: true, thoughtSignature: "c2lnLVA=" };
/** A call with NO id: its response must carry no id either. */
const callNoId: WirePart = { functionCall: { name: "failing_tool", args: {} } };

/** The responses step 1 must send back, in call order. */
const step1Responses: WirePart[] = [
  { functionResponse: { id: "call-a", name: "lookup_contact", response: { email: "a@example.test", found: true } } },
  { functionResponse: { id: "call-b", name: "lookup_contact", response: { email: "b@example.test", found: true } } },
];
/** The responses step 2 must send back: a shell result with its id, an error result with no id. */
const step2Responses: WirePart[] = [
  { functionResponse: { id: "call-c", name: "shell", response: { ok: true } } },
  { functionResponse: { name: "failing_tool", response: { error: "lookup service down" } } },
];

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

describe("cinatra#4474 — generate replays the model's own parts", () => {
  const step1: WirePart[] = [thoughtPart, { text: "Looking both up." }, callA, callB];
  const step2: WirePart[] = [callShell, callNoId];
  const step3: WirePart[] = [{ text: "Both contacts found; the report is ok." }];

  const run = async () => {
    generateReplies = [step1, step2, step3];
    return adapter().generate({
      system: "You are helpful.",
      prompt: "Find a and b, then read the report.",
      tools: loopTools,
      maxSteps: 3,
    });
  };

  it("sends three requests and returns the final answer", async () => {
    const res = await run();
    expect(bodies).toHaveLength(3);
    expect(urls.every((u) => u.includes(":generateContent"))).toBe(true);
    expect(res.text).toBe("Both contacts found; the report is ok.");
  });

  it("the second request carries the first model turn part for part, signature and ids included", async () => {
    await run();
    const contents = bodies[1].contents;
    expect(contents).toHaveLength(3);
    expect(contents[0].role).toBe("user");
    expect(contents[1]).toEqual({ role: "model", parts: step1 });
    expect(contents[2]).toEqual({ role: "user", parts: step1Responses });
  });

  it("the third request carries both earlier model turns unchanged, nothing merged or duplicated", async () => {
    await run();
    const contents = bodies[2].contents;
    expect(contents).toHaveLength(5);
    expect(contents.slice(1)).toEqual([
      { role: "model", parts: step1 },
      { role: "user", parts: step1Responses },
      { role: "model", parts: step2 },
      { role: "user", parts: step2Responses },
    ]);
  });

  it("a call without an id gets a response without an id", async () => {
    await run();
    const last = bodies[2].contents[4].parts[1].functionResponse as Record<string, unknown>;
    expect(last.name).toBe("failing_tool");
    expect(last).not.toHaveProperty("id");
  });
});

// ---------------------------------------------------------------------------
// stream
// ---------------------------------------------------------------------------

describe("cinatra#4474 — stream replays the parts of every chunk", () => {
  /** A text-only chunk that carries a signature, a plain text chunk, then one call per chunk. */
  const step1Chunks: WirePart[][] = [
    [thoughtPart],
    [{ text: "Checking ", thoughtSignature: "c2lnLVQ=" }],
    [{ text: "both." }],
    [callA],
    [callB],
  ];
  /** Two calls, then a text-only chunk with EMPTY text that carries the signature. */
  const step2Chunks: WirePart[][] = [[callShell], [callNoId], [{ text: "", thoughtSignature: "c2lnLUU=" }]];
  const step3Chunks: WirePart[][] = [[{ text: "Both found" }], [{ text: "; report ok." }]];

  const run = async () => {
    streamReplies = [step1Chunks, step2Chunks, step3Chunks];
    const toolCalls: LlmToolCall[] = [];
    const toolResults: LlmToolResult[] = [];
    let text = "";
    await adapter().stream({
      system: "You are helpful.",
      messages: [{ role: "user", content: "Find a and b, then read the report." }],
      tools: loopTools,
      maxSteps: 3,
      onTextDelta: (d: string) => {
        text += d;
      },
      onToolCall: (c: LlmToolCall) => {
        toolCalls.push(c);
      },
      onToolResult: (r: LlmToolResult) => {
        toolResults.push(r);
      },
      onStepStart: () => {},
      onStepEnd: () => {},
      onError: (e: Error) => {
        throw e;
      },
    } as StreamInput);
    return { toolCalls, toolResults, text };
  };

  it("sends three requests and streams the final answer", async () => {
    const { text } = await run();
    expect(bodies).toHaveLength(3);
    expect(urls.every((u) => u.includes(":streamGenerateContent"))).toBe(true);
    expect(text).toBe("Checking both.Both found; report ok.");
  });

  it("the second request carries every part of every chunk, in order, unmerged, with signatures and ids", async () => {
    await run();
    const contents = bodies[1].contents;
    expect(contents).toHaveLength(3);
    expect(contents[1]).toEqual({ role: "model", parts: step1Chunks.flat() });
    expect(contents[2]).toEqual({ role: "user", parts: step1Responses });
  });

  it("the third request carries both earlier model turns unchanged, the empty-text signature part included", async () => {
    await run();
    const contents = bodies[2].contents;
    expect(contents).toHaveLength(5);
    expect(contents.slice(1)).toEqual([
      { role: "model", parts: step1Chunks.flat() },
      { role: "user", parts: step1Responses },
      { role: "model", parts: step2Chunks.flat() },
      { role: "user", parts: step2Responses },
    ]);
  });

  it("host callbacks use Gemini's call id, and a synthetic id only when Gemini gave none", async () => {
    const { toolCalls, toolResults } = await run();
    expect(toolCalls.map((c) => c.id)).toEqual(["call-a", "call-b", "call-c", "failing_tool-1"]);
    expect(toolResults.map((r) => r.id)).toEqual(expect.arrayContaining(["call-a", "call-b", "failing_tool-1"]));
    // The synthetic id is for the host only: it never reaches Gemini.
    expect(JSON.stringify(bodies[2])).not.toContain("failing_tool-1");
    const last = bodies[2].contents[4].parts[1].functionResponse as Record<string, unknown>;
    expect(last).not.toHaveProperty("id");
  });
});

// ---------------------------------------------------------------------------
// sandbox_execute and an empty id
// ---------------------------------------------------------------------------

describe("cinatra#4474 — a sandbox_execute response carries its id; an empty id counts as none", () => {
  const callSandbox: WirePart = {
    functionCall: { id: "call-s", name: "sandbox_execute", args: { commands: ["ls"] } },
    thoughtSignature: "c2lnLVM=",
  };
  const callEmptyId: WirePart = {
    functionCall: { id: "", name: "lookup_contact", args: { email: "e@example.test" } },
  };
  const expectedResponses: WirePart[] = [
    {
      functionResponse: {
        id: "call-s",
        name: "sandbox_execute",
        response: { results: [{ stdout: "sandbox-ok", stderr: "", outcome: { type: "exit", exit_code: 0 } }] },
      },
    },
    { functionResponse: { name: "lookup_contact", response: { email: "e@example.test", found: true } } },
  ];

  it("generate", async () => {
    generateReplies = [[callSandbox, callEmptyId], [{ text: "ok" }]];
    await adapter().generate({ system: "S", prompt: "go", tools: [sandboxTool, lookupTool], maxSteps: 2 });
    const contents = bodies[1].contents;
    expect(contents.slice(1)).toEqual([
      { role: "model", parts: [callSandbox, callEmptyId] },
      { role: "user", parts: expectedResponses },
    ]);
    expect(contents[2].parts[1].functionResponse).not.toHaveProperty("id");
  });

  it("stream", async () => {
    streamReplies = [[[callSandbox], [callEmptyId]], [[{ text: "ok" }]]];
    const toolCalls: LlmToolCall[] = [];
    await adapter().stream({
      system: "S",
      messages: [{ role: "user", content: "go" }],
      tools: [sandboxTool, lookupTool],
      maxSteps: 2,
      onTextDelta: () => {},
      onToolCall: (c: LlmToolCall) => {
        toolCalls.push(c);
      },
      onToolResult: () => {},
      onStepStart: () => {},
      onStepEnd: () => {},
      onError: (e: Error) => {
        throw e;
      },
    } as StreamInput);
    const contents = bodies[1].contents;
    expect(contents.slice(1)).toEqual([
      { role: "model", parts: [callSandbox, callEmptyId] },
      { role: "user", parts: expectedResponses },
    ]);
    expect(contents[2].parts[1].functionResponse).not.toHaveProperty("id");
    expect(toolCalls.map((c) => c.id)).toEqual(["call-s", "lookup_contact-0"]);
  });
});

// ---------------------------------------------------------------------------
// thinkingConfig
// ---------------------------------------------------------------------------

describe("cinatra#4474 — thinkingLevel MEDIUM for gemini-3.5-flash-lite with tools", () => {
  const runGenerate = async (model: string, tools: LlmTool[] | undefined) => {
    generateReplies = [[{ text: "hello" }]];
    await adapter().generate({ model, system: "S", prompt: "hi", tools });
    return bodies[0];
  };
  const runStream = async (model: string, tools: LlmTool[] | undefined) => {
    streamReplies = [[[{ text: "hello" }]]];
    await adapter().stream({
      model,
      system: "S",
      messages: [{ role: "user", content: "hi" }],
      tools,
      maxSteps: 1,
      onTextDelta: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
      onStepStart: () => {},
      onStepEnd: () => {},
      onError: (e: Error) => {
        throw e;
      },
    } as StreamInput);
    return bodies[0];
  };
  const runners = { generate: runGenerate, stream: runStream };

  describe.each(Object.keys(runners) as Array<keyof typeof runners>)("%s", (path) => {
    it.each(["gemini-3.5-flash-lite", "gemini-3.5-flash-lite-001", "models/gemini-3.5-flash-lite"])(
      "sets thinkingLevel MEDIUM for %s with a function tool",
      async (model) => {
        const body = await runners[path](model, [lookupTool]);
        expect(body.generationConfig?.thinkingConfig).toEqual({ thinkingLevel: "MEDIUM" });
      },
    );

    const absent: Array<[string, string, LlmTool[] | undefined]> = [
      ["gemini-2.5-flash with a function tool", "gemini-2.5-flash", [lookupTool]],
      ["gemini-3.5-flash with a function tool", "gemini-3.5-flash", [lookupTool]],
      ["gemini-3.5-flash-lite with omitted tools", "gemini-3.5-flash-lite", undefined],
      ["gemini-3.5-flash-lite with tools: []", "gemini-3.5-flash-lite", []],
      ["gemini-3.5-flash-lite with unsupported-only tools", "gemini-3.5-flash-lite", [selfMcpTool]],
    ];
    it.each(absent)("sets no thinking config for %s", async (_label, model, tools) => {
      const body = await runners[path](model, tools);
      expect(body.generationConfig?.thinkingConfig).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("thinkingLevel");
    });
  });
});
