// Canary regression for the Gemini log-body redactor (ported from
// openai-connector). Asserts a unique canary token placed in every
// Authorization-bearing location does NOT survive redaction.

import { describe, expect, it } from "vitest";

import { redactAuthorizationDeep } from "../log-redaction";

const CANARY = `CANARY_TOKEN_${Math.random().toString(36).slice(2)}_DO_NOT_LEAK`;

describe("redactAuthorizationDeep (@cinatra-ai/gemini-connector copy)", () => {
  it("replaces Authorization anywhere in the tree with [REDACTED] and leaves the canary nowhere", () => {
    const body = {
      model: "gemini-2.5-flash",
      headers: { Authorization: `Bearer ${CANARY}` },
      mcp_servers: [
        { name: "x", authorization_token: CANARY },
        { name: "y", headers: { authorization: `Bearer ${CANARY}` } },
      ],
      deeply: { nested: [{ Authorization: CANARY }] },
    };

    const serialized = JSON.stringify(redactAuthorizationDeep(body));

    expect(serialized).not.toContain(CANARY);
    expect(serialized).toContain("[REDACTED]");
    // Non-secret structure preserved.
    expect(JSON.parse(serialized).model).toBe("gemini-2.5-flash");
  });

  it("is a no-op for primitives / non-authorization keys", () => {
    expect(redactAuthorizationDeep("hello")).toBe("hello");
    expect(redactAuthorizationDeep(123)).toBe(123);
    expect(redactAuthorizationDeep(null)).toBe(null);
    expect(redactAuthorizationDeep([1, 2, 3])).toEqual([1, 2, 3]);
    expect(redactAuthorizationDeep({ a: { b: "c" } })).toEqual({ a: { b: "c" } });
  });
});
