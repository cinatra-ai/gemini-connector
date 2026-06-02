/**
 * Security regression: saveGeminiConnectionAction + clearGeminiConnectionAction
 * MUST gate on requireExtensionAction("@cinatra-ai/gemini-connector", "manage")
 * as the FIRST awaited statement. Gemini is a workspace-wide LLM credential, so
 * an unprivileged caller must not be able to overwrite or clear it.
 *
 * This replaces the former host-side gemini-actions-admin-gate test (which
 * asserted requireAdminSession on the central @cinatra-ai/connectors hub action).
 * These actions were moved INTO the connector and the gate switched to the
 * SDK's requireExtensionAction(..., "manage") — admin-only (org_owner/org_admin/
 * platform_admin), fail-closed. The connector action is now THE security
 * boundary, so the invariant is asserted on the connector source.
 *
 * Strategy: extract each action's function body from the source text and assert
 * the first awaited call is the requireExtensionAction manage gate. A positional
 * check (not mere presence) is apt because the security property is precisely
 * "the gate runs before anything else".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function extractFunctionBody(source: string, fnName: string): string {
  const marker = `export async function ${fnName}`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`fn ${fnName} not found`);
  let i = source.indexOf("{", start);
  const bodyStart = i;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(bodyStart, i + 1);
}

const SOURCE = readFileSync(join(__dirname, "..", "actions.ts"), "utf-8");
const GATE = `requireExtensionAction("@cinatra-ai/gemini-connector", "manage")`;

describe("gemini connection actions — extension manage gate", () => {
  for (const fnName of ["saveGeminiConnectionAction", "clearGeminiConnectionAction"]) {
    it(`${fnName}: first awaited call is the requireExtensionAction manage gate`, () => {
      const body = extractFunctionBody(SOURCE, fnName);
      const firstAwait = body.indexOf("await ");
      const gateCall = body.indexOf(GATE);
      expect(firstAwait, `${fnName} has no await`).toBeGreaterThanOrEqual(0);
      expect(gateCall, `${fnName} missing the manage gate`).toBeGreaterThanOrEqual(0);
      // The gate must be the FIRST awaited expression — i.e. the substring right
      // after the first "await " is the gate call.
      expect(body.slice(firstAwait + "await ".length).startsWith(GATE)).toBe(true);
    });
  }
});
