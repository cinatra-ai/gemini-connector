// Recursive Authorization redaction for provider log bodies.
//
// Replaces any value at a key matching `/^authorization$/i` OR exactly
// `"authorization_token"` with the literal string "[REDACTED]". Used by
// writeGeminiLogFile (this package) to keep Bearer tokens — e.g. the resolved
// in-app MCP self-client Authorization header carried in a logged request body
// — out of the data/logs/ files on disk.
//
// Dependency-free leaf module. DUPLICATED from `@cinatra-ai/openai-connector`
// src/log-redaction.ts (identical content): a shared copy can't be imported
// without a first-party `@cinatra-ai/*` code dependency the source-mirror shape
// forbids, and ~15 LoC is cheap enough to duplicate. Both copies are exercised
// by their own vitest canary test.

const AUTHORIZATION_KEY = /^authorization$/i;
const AUTHORIZATION_TOKEN_KEY = "authorization_token";
const REDACTED = "[REDACTED]";

export function redactAuthorizationDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactAuthorizationDeep);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (AUTHORIZATION_KEY.test(k) || k === AUTHORIZATION_TOKEN_KEY) {
        out[k] = REDACTED;
      } else {
        out[k] = redactAuthorizationDeep(v);
      }
    }
    return out;
  }
  return value;
}
