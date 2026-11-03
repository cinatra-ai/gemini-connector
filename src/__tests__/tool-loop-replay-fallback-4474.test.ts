/**
 * cinatra#4474 — the rebuild fallback of the tool-loop replay.
 *
 * Both loops replay the model's own parts (`candidates[0].content.parts`).
 * When a response carries no parts — no candidate, a content without `parts`,
 * or an empty `parts` list — the loops rebuild the model turn from the text
 * and the function calls, and the rebuilt calls keep their `id`.
 *
 * The real SDK derives `functionCalls` from the parts, so these shapes cannot
 * reach the loop through the wire. The SDK client is mocked here (the pattern
 * of sandbox-provider-translation.test.ts) so the adapter sees exactly the
 * scripted response objects. No network is used.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LlmFunctionTool, StreamInput } from "@cinatra-ai/sdk-extensions/llm-provider-adapter-contract";

const geminiGenerate = vi.fn();
const geminiStream = vi.fn();

vi.mock("@google/genai", async () => {
  const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
  class MockGoogleGenAI {
    models = { generateContent: geminiGenerate, generateContentStream: geminiStream };
    constructor(_config: unknown) {}
  }
  return { ...actual, GoogleGenAI: MockGoogleGenAI };
});

vi.mock("../index", () => ({
  buildGeminiRequestHeaders: () => ({}),
  writeGeminiLogFile: async () => {},
}));

import { createGeminiProviderAdapter } from "../adapter/gemini-adapter";

type Contents = Array<{ role: string; parts: Array<Record<string, unknown>> }>;

const lookupTool: LlmFunctionTool = {
  name: "lookup_contact",
  description: "Look up a contact by email.",
  parameters: { type: "object", properties: { email: { type: "string" } }, required: ["email"] },
  execute: async (args) => ({ email: args.email, found: true }),
};

/** The three shapes of a response that carries no parts. */
const noParts: Array<[string, Record<string, unknown>]> = [
  ["no candidate", {}],
  ["a content without parts", { candidates: [{ content: { role: "model" } }] }],
  ["an empty parts list", { candidates: [{ content: { role: "model", parts: [] } }] }],
];

const withId = { id: "call-a", name: "lookup_contact", args: { email: "a@example.test" } };
const withoutId = { name: "lookup_contact", args: { email: "a@example.test" } };

async function* chunks(list: Array<Record<string, unknown>>) {
  for (const c of list) yield c;
}

beforeEach(() => {
  geminiGenerate.mockReset();
  geminiStream.mockReset();
});

const contentsOf = (mock: ReturnType<typeof vi.fn>, call: number) =>
  (mock.mock.calls[call][0] as { contents: Contents }).contents;

describe("cinatra#4474 — generate rebuilds the model turn when the response has no parts", () => {
  it.each(noParts)("%s: the rebuilt turn keeps the call id, and the response echoes it", async (_label, shape) => {
    geminiGenerate
      .mockResolvedValueOnce({ ...shape, text: "Looking.", functionCalls: [withId] })
      .mockResolvedValueOnce({ text: "done", functionCalls: undefined });

    const res = await createGeminiProviderAdapter("key").generate({
      system: "S",
      prompt: "find a",
      tools: [lookupTool],
      maxSteps: 2,
    });

    expect(res.text).toBe("done");
    const contents = contentsOf(geminiGenerate, 1);
    expect(contents.slice(1)).toEqual([
      { role: "model", parts: [{ text: "Looking." }, { functionCall: withId }] },
      {
        role: "user",
        parts: [{ functionResponse: { id: "call-a", name: "lookup_contact", response: { email: "a@example.test", found: true } } }],
      },
    ]);
  });

  it.each(noParts)("%s: a call without an id is rebuilt and answered without an id", async (_label, shape) => {
    geminiGenerate
      .mockResolvedValueOnce({ ...shape, text: undefined, functionCalls: [withoutId] })
      .mockResolvedValueOnce({ text: "done", functionCalls: undefined });

    await createGeminiProviderAdapter("key").generate({ system: "S", prompt: "find a", tools: [lookupTool], maxSteps: 2 });

    const contents = contentsOf(geminiGenerate, 1);
    expect(contents[1]).toEqual({ role: "model", parts: [{ functionCall: withoutId }] });
    expect(contents[2].parts[0].functionResponse).not.toHaveProperty("id");
  });
});

describe("cinatra#4474 — stream rebuilds the model turn when no chunk has parts", () => {
  const run = () =>
    createGeminiProviderAdapter("key").stream({
      system: "S",
      messages: [{ role: "user", content: "find a" }],
      tools: [lookupTool],
      maxSteps: 2,
      onTextDelta: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
      onStepStart: () => {},
      onStepEnd: () => {},
      onError: (e: Error) => {
        throw e;
      },
    } as StreamInput);

  it.each(noParts)("%s: the rebuilt turn keeps the call id, and the response echoes it", async (_label, shape) => {
    geminiStream
      .mockResolvedValueOnce(
        chunks([
          { ...shape, text: "Look", functionCalls: undefined },
          { ...shape, text: "ing.", functionCalls: [withId] },
        ]),
      )
      .mockResolvedValueOnce(chunks([{ text: "done", functionCalls: undefined }]));

    await run();

    const contents = contentsOf(geminiStream, 1);
    expect(contents.slice(1)).toEqual([
      { role: "model", parts: [{ text: "Looking." }, { functionCall: withId }] },
      {
        role: "user",
        parts: [{ functionResponse: { id: "call-a", name: "lookup_contact", response: { email: "a@example.test", found: true } } }],
      },
    ]);
  });

  it.each(noParts)("%s: a call without an id is rebuilt and answered without an id", async (_label, shape) => {
    geminiStream
      .mockResolvedValueOnce(chunks([{ ...shape, text: undefined, functionCalls: [withoutId] }]))
      .mockResolvedValueOnce(chunks([{ text: "done", functionCalls: undefined }]));

    await run();

    const contents = contentsOf(geminiStream, 1);
    expect(contents[1]).toEqual({ role: "model", parts: [{ functionCall: withoutId }] });
    expect(contents[2].parts[0].functionResponse).not.toHaveProperty("id");
  });
});
