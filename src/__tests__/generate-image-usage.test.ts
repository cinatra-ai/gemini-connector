/**
 * cinatra#2641 — `generateImage` reports what it produced, so the host can PRICE
 * the call.
 *
 * Gemini bills image generation PER PRODUCED IMAGE. The host meters every
 * `generateImage()` call at its adapter seam, but before this adapter reported
 * anything the row could only be COUNTED: the answer named no model and stated
 * no quantity, so `/analytics/llm` showed the call with an "unknown" cost. The
 * ABI's optional `model` + `usage` on the image response are what close that,
 * and the host prices the row off a per-image rate card keyed by the model named
 * here.
 *
 * What is pinned:
 *   - the returned image payload is UNCHANGED, so the addition is additive;
 *   - the reported model is the identifier this adapter ADDRESSED (its own image
 *     default when the caller named none) — the string the rate card looks up,
 *     and the one the request is billed against. The response's `modelVersion`
 *     names a resolved point version instead, which would miss the card;
 *   - the reported image count is MEASURED off the response, not assumed to be
 *     1, and counts only `image/*` parts — it is multiplied by money host-side;
 *   - the prompt-token count is the PROVIDER's, because Gemini bills the request
 *     as well as the images and a price missing that component is short;
 *   - a response with no image reports NO usage at all, so the host counts the
 *     invocation and leaves its cost unknown rather than recording it as free.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateContentMock = vi.fn();

vi.mock("@google/genai", async () => {
  const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
  class MockGoogleGenAI {
    models = { generateContent: generateContentMock };
    constructor(_config: unknown) {}
  }
  return { ...actual, GoogleGenAI: MockGoogleGenAI };
});

vi.mock("../index", () => ({
  buildGeminiRequestHeaders: () => ({}),
  writeGeminiLogFile: async () => {},
}));

import {
  createGeminiProviderAdapter,
  DEFAULT_GEMINI_IMAGE_MODEL,
} from "../adapter/gemini-adapter";

/**
 * A response carrying `count` inline image parts on a single candidate, with
 * `usageMetadata` unless `opts.noUsageMetadata` says the provider sent none.
 */
const withImages = (
  count: number,
  opts: { promptTokenCount?: number; noUsageMetadata?: boolean } = {},
) => ({
  candidates: [
    {
      content: {
        parts: Array.from({ length: count }, (_, i) => ({
          inlineData: { mimeType: "image/png", data: `image-${i}` },
        })),
      },
    },
  ],
  usageMetadata: opts.noUsageMetadata
    ? undefined
    : { promptTokenCount: opts.promptTokenCount ?? 1200 },
});

beforeEach(() => {
  generateContentMock.mockReset();
});

describe("generateImage reports per-image usage", () => {
  it("reports the model it addressed, one image, and the prompt tokens", async () => {
    generateContentMock.mockResolvedValue(withImages(1));

    const adapter = createGeminiProviderAdapter("k");
    const result = await adapter.generateImage!({ prompt: "a cover image" });

    expect(result).toEqual({
      // The shipped fields, byte-identical — a caller that only destructures
      // these two sees no change at all.
      imageData: "image-0",
      mimeType: "image/png",
      model: DEFAULT_GEMINI_IMAGE_MODEL,
      usage: { images: 1, inputTokens: 1200 },
    });
  });

  it("reports the model identifier the CALLER named when it named one", async () => {
    generateContentMock.mockResolvedValue(withImages(1));

    const adapter = createGeminiProviderAdapter("k");
    const result = await adapter.generateImage!({
      prompt: "p",
      model: "some-other-image-model",
    });

    // The reported model must be the one actually SENT, since that is the model
    // the request was billed against and the string the rate card looks up.
    expect(result?.model).toBe("some-other-image-model");
    expect(generateContentMock.mock.calls[0]![0].model).toBe("some-other-image-model");
  });

  it("counts EVERY image the response carried, not just the one returned", async () => {
    // Gemini bills each image it produced. Reporting 1 for a multi-image
    // response would under-price the call — which is why the count is measured
    // off the response instead of hardcoded.
    generateContentMock.mockResolvedValue(withImages(3));

    const adapter = createGeminiProviderAdapter("k");
    const result = await adapter.generateImage!({ prompt: "p" });

    expect(result?.usage?.images).toBe(3);
    // Still exactly one image handed back — the return contract is unchanged.
    expect(result?.imageData).toBe("image-0");
  });

  it("counts only image/* parts — an inline non-image is not a billed image", async () => {
    // The negative control that matters most: this count is multiplied by a
    // per-image rate host-side, so a text/plain inline part counted as an image
    // would invent money. Before the count existed the same part could at worst
    // produce a broken payload.
    generateContentMock.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              { inlineData: { mimeType: "text/plain", data: "not-an-image" } },
              { inlineData: { mimeType: "image/png", data: "the-image" } },
              { inlineData: { mimeType: "application/json", data: "{}" } },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 10 },
    });

    const adapter = createGeminiProviderAdapter("k");
    const result = await adapter.generateImage!({ prompt: "p" });

    expect(result?.usage?.images).toBe(1);
    expect(result?.imageData).toBe("the-image");
  });

  it("omits the prompt tokens rather than reporting zero when none came back", async () => {
    // A `0` would state the prompt was free, and the host would then price the
    // images and silently drop the prompt charge. Absent leaves the whole row
    // unpriced instead — short by nothing rather than short by the prompt.
    generateContentMock.mockResolvedValue(withImages(1, { noUsageMetadata: true }));

    const adapter = createGeminiProviderAdapter("k");
    const result = await adapter.generateImage!({ prompt: "p" });

    expect(result?.usage).toEqual({ images: 1 });
    expect(result?.usage).not.toHaveProperty("inputTokens");
  });

  it("reports NO usage when the response carried no image", async () => {
    // The number of images Gemini billed for cannot be read off a response that
    // holds none, and a reported `0` would state the call was free. The host
    // still counts the invocation; only its price stays unknown.
    generateContentMock.mockResolvedValue({ candidates: [] });

    const adapter = createGeminiProviderAdapter("k");
    await expect(adapter.generateImage!({ prompt: "p" })).resolves.toBeNull();
  });

  it("defaults to the image model, never to the adapter's TEXT model", async () => {
    // `defaultModel` is a text model the host's per-TOKEN completion card can
    // price. Naming it on an image response would point the ledger at the wrong
    // card entirely.
    generateContentMock.mockResolvedValue(withImages(1));

    const adapter = createGeminiProviderAdapter("k");
    const result = await adapter.generateImage!({ prompt: "p" });

    expect(result?.model).toBe(DEFAULT_GEMINI_IMAGE_MODEL);
    expect(result?.model).not.toBe(adapter.defaultModel);
  });
});
