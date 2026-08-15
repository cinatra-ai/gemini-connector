/**
 * cinatra#2776 — a tool-less Gemini request carries NO top-level `tools` key.
 *
 * Gemini is the conversation-only provider in the self-MCP gate: it declares
 * no native MCP, so a chat turn whose toolbox is the self-MCP catalog reaches
 * this adapter with tools that translate to NOTHING. Before this fix the
 * adapter still emitted the container, and a wire probe showed
 * `"tools":[{"functionDeclarations":[]}]` — a tool block declaring nothing.
 * The gate asserts the conversation-only shape as `tools` ABSENT, so the
 * empty container is the difference between the gate passing and failing.
 *
 * The proof is taken at the WIRE, not at the adapter's pre-SDK object: the
 * real `@google/genai` client runs and `globalThis.fetch` is intercepted, so
 * what is asserted is the JSON body the SDK actually serializes. (Stated
 * explicitly because mocking the `@google/genai` module — as the sibling
 * adapter tests do — would only capture the request object handed to the SDK
 * and could not see what the SDK puts on the wire.)
 *
 * Pinned, for BOTH entry points (`generate` and `stream`):
 *   - toolbox that translates to zero declarations (self-MCP only, and the
 *     empty array) → no `tools` key at all;
 *   - a real function tool → `tools` present, carrying that declaration, so
 *     the fix suppresses only the EMPTY block.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../index", () => ({
  buildGeminiRequestHeaders: () => ({}),
  writeGeminiLogFile: async () => {},
}));

import { createGeminiProviderAdapter } from "../adapter/gemini-adapter";
import type {
  LlmTool,
  StreamInput,
} from "@cinatra-ai/sdk-extensions/llm-provider-adapter-contract";

/** Captured wire bodies, in call order. */
let bodies: Array<Record<string, unknown>> = [];
let urls: string[] = [];
const realFetch = globalThis.fetch;

/** A non-streaming `generateContent` reply: one text candidate, no tool calls. */
const generateReply = () =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: "hello" }], role: "model" } }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 },
      modelVersion: "gemini-2.5-flash-001",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

/** A `streamGenerateContent` SSE reply: one text chunk, no tool calls. */
const streamReply = () => {
  const chunk = {
    candidates: [{ content: { parts: [{ text: "hello" }], role: "model" } }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 },
    modelVersion: "gemini-2.5-flash-001",
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\r\n\r\n`));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

beforeEach(() => {
  bodies = [];
  urls = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const raw = typeof init?.body === "string" ? init.body : "{}";
    bodies.push(JSON.parse(raw) as Record<string, unknown>);
    return url.includes("streamGenerateContent") ? streamReply() : generateReply();
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const adapter = () => createGeminiProviderAdapter("test-api-key");

/** The self-MCP catalog as the host hands it to a provider adapter. */
const selfMcpTool: LlmTool = {
  type: "mcp",
  serverLabel: "cinatra",
  serverUrl: "https://example.test/api/mcp",
  serverDescription: "Cinatra self-MCP",
  allowedTools: null,
};

const functionTool: LlmTool = {
  name: "lookup_contact",
  description: "Look up a contact by email.",
  parameters: {
    type: "object",
    properties: { email: { type: "string" } },
    required: ["email"],
  },
};

const streamCallbacks: Omit<StreamInput, "system" | "messages"> = {
  onTextDelta: () => {},
  onToolCall: () => {},
  onToolResult: () => {},
  onStepStart: () => {},
  onStepEnd: () => {},
  onError: (e: Error) => {
    throw e;
  },
};

const runStream = (tools: LlmTool[] | undefined) =>
  adapter().stream({
    ...streamCallbacks,
    system: "You are helpful.",
    messages: [{ role: "user", content: "hi" }],
    tools,
    maxSteps: 1,
  } as StreamInput);

const runGenerate = (tools: LlmTool[] | undefined) =>
  adapter().generate({
    system: "You are helpful.",
    prompt: "hi",
    tools,
  });

describe("cinatra#2776 — Gemini emits no empty tools block", () => {
  describe("generate", () => {
    it("omits `tools` entirely when the toolbox is the self-MCP catalog (conversation-only)", async () => {
      await runGenerate([selfMcpTool]);

      expect(bodies).toHaveLength(1);
      expect(urls[0]).toContain("generateContent");
      // The regression shape, named so a failure is diagnosable:
      expect(JSON.stringify(bodies[0])).not.toContain("functionDeclarations");
      expect(Object.keys(bodies[0])).not.toContain("tools");
      expect(bodies[0].tools).toBeUndefined();
    });

    it("omits `tools` entirely when the toolbox is empty", async () => {
      await runGenerate([]);

      expect(bodies[0].tools).toBeUndefined();
      expect(Object.keys(bodies[0])).not.toContain("tools");
    });

    it("omits `tools` entirely when no toolbox is supplied", async () => {
      await runGenerate(undefined);

      expect(bodies[0].tools).toBeUndefined();
    });

    it("still sends `tools` when a real function tool is declared", async () => {
      await runGenerate([functionTool]);

      expect(bodies[0].tools).toEqual([
        {
          functionDeclarations: [
            {
              name: "lookup_contact",
              description: "Look up a contact by email.",
              // Upcased by the SDK on serialization — further proof this is
              // the WIRE body and not the adapter's pre-SDK object.
              parameters: {
                type: "OBJECT",
                properties: { email: { type: "STRING" } },
                required: ["email"],
              },
            },
          ],
        },
      ]);
    });
  });

  describe("stream", () => {
    it("omits `tools` entirely when the toolbox is the self-MCP catalog (conversation-only)", async () => {
      await runStream([selfMcpTool]);

      expect(bodies).toHaveLength(1);
      expect(urls[0]).toContain("streamGenerateContent");
      expect(JSON.stringify(bodies[0])).not.toContain("functionDeclarations");
      expect(Object.keys(bodies[0])).not.toContain("tools");
      expect(bodies[0].tools).toBeUndefined();
    });

    it("omits `tools` entirely when the toolbox is empty", async () => {
      await runStream([]);

      expect(bodies[0].tools).toBeUndefined();
      expect(Object.keys(bodies[0])).not.toContain("tools");
    });

    it("omits `tools` entirely when no toolbox is supplied", async () => {
      await runStream(undefined);

      expect(bodies[0].tools).toBeUndefined();
    });

    it("still sends `tools` when a real function tool is declared", async () => {
      await runStream([functionTool]);

      expect(bodies[0].tools).toEqual([
        {
          functionDeclarations: [
            {
              name: "lookup_contact",
              description: "Look up a contact by email.",
              // Upcased by the SDK on serialization — further proof this is
              // the WIRE body and not the adapter's pre-SDK object.
              parameters: {
                type: "OBJECT",
                properties: { email: { type: "STRING" } },
                required: ["email"],
              },
            },
          ],
        },
      ]);
    });
  });
});
