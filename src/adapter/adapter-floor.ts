// Inlined value floor for the relocated Gemini provider adapter (llm-providers
// S4 — cinatra#1715). PR-0 moved the ADAPTER TYPE closure to the sdk-extensions
// ABI leaf (`@cinatra-ai/sdk-extensions/llm-provider-adapter-contract`), but the
// small VALUE slices the adapter needs still live in the host's `packages/llm`
// (`attachments/provider-parts`, `execution-plane/tool`, `errors`) and are NOT
// connector-importable. So this connector inlines the gemini-relevant value
// slices verbatim: the ABI leaf supplies the TYPES; this module supplies the
// VALUES. Byte-faithful relocation — zero behavior change (core keeps its
// in-tree copy until the final core-deletion PR).

import type {
  AdapterAttachmentPart,
  LlmProvider,
} from "@cinatra-ai/sdk-extensions/llm-provider-adapter-contract";

// ---------------------------------------------------------------------------
// Provider-native part builders (gemini slice of packages/llm
// `attachments/provider-parts.ts`)
// ---------------------------------------------------------------------------
//
// Pure provider-native part builders. Each takes the user prompt text +
// the resolved attachment parts and returns the provider's user-message
// content. CRITICAL: when there are no matching parts the return is the LEGACY
// plain form (a single text part for Gemini) so the request body is
// BYTE-IDENTICAL for every existing caller. The separate `generateWithFileInput`
// path is untouched and unrelated.

function partsOf(
  resolved: AdapterAttachmentPart[] | undefined,
  nativeKind: string,
): AdapterAttachmentPart[] {
  return (resolved ?? []).filter((p) => p.nativeKind === nativeKind);
}

/**
 * Defines which resolved parts apply to each message, as an array aligned
 * to `messages`. Every user turn uses its OWN
 * resolvedAttachments; the request-level fallback applies to the LAST user
 * turn ONLY when that message carried none. An `undefined` entry ⇒ the caller emits the plain text form
 * (byte-identical). Single source of truth for all three stream builders.
 */
export function resolvedAttachmentsPerMessage(
  messages: ReadonlyArray<{
    role: "user" | "assistant";
    resolvedAttachments?: AdapterAttachmentPart[];
  }>,
  requestLevel: AdapterAttachmentPart[] | undefined,
): Array<AdapterAttachmentPart[] | undefined> {
  const out: Array<AdapterAttachmentPart[] | undefined> = messages.map((m) =>
    m.role === "user" &&
    m.resolvedAttachments &&
    m.resolvedAttachments.length > 0
      ? m.resolvedAttachments
      : undefined,
  );
  if (requestLevel && requestLevel.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") {
        if (out[i] === undefined) out[i] = requestLevel;
        break;
      }
    }
  }
  return out;
}

/** Gemini `contents` user parts. */
export function geminiUserParts(
  promptText: string,
  resolved: AdapterAttachmentPart[] | undefined,
): Array<
  | { text: string }
  | { fileData: { mimeType: string; fileUri: string } }
> {
  const files = partsOf(resolved, "gemini_file_data");
  const parts: Array<
    { text: string } | { fileData: { mimeType: string; fileUri: string } }
  > = [{ text: promptText }];
  for (const f of files) {
    parts.push({ fileData: { mimeType: f.mime, fileUri: f.providerFileId } });
  }
  return parts; // length 1 (just text) when no parts — legacy-equivalent
}

// ---------------------------------------------------------------------------
// Sandbox-execute tool name (from packages/llm `execution-plane/tool.ts`)
// ---------------------------------------------------------------------------

// The contractual tool name ("sandbox_execute") — translation + dispatch key.
export const SANDBOX_EXECUTE_TOOL_NAME = "sandbox_execute" as const;

// ---------------------------------------------------------------------------
// Batch-not-supported error (gemini slice of packages/llm `errors.ts`)
// ---------------------------------------------------------------------------

/**
 * Thrown by the adapter's batch methods because Gemini does not support the
 * OpenAI Batch API surface. Throwing — rather than returning null — is
 * intentional: it forces callers to handle the gap explicitly so a future swap
 * to a supporting provider is observable.
 */
export class BatchNotSupportedError extends Error {
  readonly code = "batch_not_supported" as const;
  readonly provider: LlmProvider;

  constructor(provider: LlmProvider) {
    super(`Batch API is not supported by provider "${provider}"`);
    this.name = "BatchNotSupportedError";
    this.provider = provider;
  }
}
