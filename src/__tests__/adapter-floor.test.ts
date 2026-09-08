import { describe, expect, it } from "vitest";
import {
  geminiUserParts,
  resolvedAttachmentsPerMessage,
} from "../adapter/adapter-floor";
import type { AdapterAttachmentPart } from "@cinatra-ai/sdk-extensions/llm-provider-adapter-contract";

// Gemini slice of the provider-native part builders (inlined value floor —
// llm-providers S4, cinatra#1715). The load-bearing guarantee: NO matching
// parts => legacy plain form (a single text part for Gemini — request body
// byte-identical for callers without matching provider-native parts).

const oa: AdapterAttachmentPart = {
  nativeKind: "openai_input_file",
  providerFileId: "file_oa1",
  mime: "application/pdf",
};
const an: AdapterAttachmentPart = {
  nativeKind: "anthropic_document",
  providerFileId: "file_an1",
  mime: "application/pdf",
};
const ge: AdapterAttachmentPart = {
  nativeKind: "gemini_file_data",
  providerFileId: "gs://f1",
  mime: "image/png",
};

describe("adapter-floor: geminiUserParts", () => {
  it("Gemini: no parts → single text part (legacy-equivalent)", () => {
    expect(geminiUserParts("hi", undefined)).toEqual([{ text: "hi" }]);
    expect(geminiUserParts("hi", [])).toEqual([{ text: "hi" }]);
    expect(geminiUserParts("hi", [oa, an])).toEqual([{ text: "hi" }]); // wrong kinds filtered
  });
  it("Gemini: matching parts → text part + fileData part(s)", () => {
    expect(geminiUserParts("look", [ge])).toEqual([
      { text: "look" },
      { fileData: { mimeType: "image/png", fileUri: "gs://f1" } },
    ]);
  });
});

describe("adapter-floor: resolvedAttachmentsPerMessage", () => {
  it("no parts anywhere → all undefined (byte-identical plain text)", () => {
    expect(
      resolvedAttachmentsPerMessage(
        [
          { role: "user" },
          { role: "assistant" },
          { role: "user" },
        ],
        undefined,
      ),
    ).toEqual([undefined, undefined, undefined]);
  });

  it("request-level fallback hits ONLY the last user turn", () => {
    const out = resolvedAttachmentsPerMessage(
      [
        { role: "user" },
        { role: "assistant" },
        { role: "user" },
      ],
      [ge],
    );
    expect(out).toEqual([undefined, undefined, [ge]]);
  });

  it("a turn's OWN resolvedAttachments win; fallback never overwrites them", () => {
    const out = resolvedAttachmentsPerMessage(
      [
        { role: "user", resolvedAttachments: [an] },
        { role: "user" },
      ],
      [ge],
    );
    // msg0 keeps its own; msg1 (last user, none of its own) gets fallback
    expect(out).toEqual([[an], [ge]]);
  });

  it("last user turn with its OWN parts does NOT also get the request-level fallback", () => {
    const out = resolvedAttachmentsPerMessage(
      [{ role: "user", resolvedAttachments: [ge] }],
      [oa],
    );
    expect(out).toEqual([[ge]]);
  });

  it("fallback targets the LAST USER turn even if an assistant turn trails it", () => {
    const out = resolvedAttachmentsPerMessage(
      [{ role: "user" }, { role: "assistant" }],
      [ge],
    );
    expect(out).toEqual([[ge], undefined]);
  });

  it("NO user turns at all → request-level fallback is dropped (no misattach)", () => {
    const out = resolvedAttachmentsPerMessage(
      [{ role: "assistant" }, { role: "assistant" }],
      [ge],
    );
    expect(out).toEqual([undefined, undefined]);
  });
});
