// Contract fixtures for the declarative setup DSL (cinatra.configSchema).
//
// The Gemini connector ships a `uiSurface:"schema-config"` declaration
// (cinatra#782) so the host renders its setup page from DATA with NO rebuild,
// retiring the bundled-react setup/save-form pages. These tests prove the
// declared `cinatra.configSchema` passes the PUBLIC validation path: the SAME
// fail-closed `validateConfigSchema` the repo's `extension-kind-gate.mjs` runs
// in CI.

import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { validateConfigSchema } from "../../extension-kind-gate.mjs";

const configSchema = (pkg as { cinatra?: { configSchema?: unknown } }).cinatra
  ?.configSchema;

describe("gemini-connector cinatra.configSchema", () => {
  it('declares uiSurface:"schema-config" and requests the "ui" + "capabilities" host ports', () => {
    const cinatra = (pkg as { cinatra: Record<string, unknown> }).cinatra;
    expect(cinatra.uiSurface).toBe("schema-config");
    expect(cinatra.requestedHostPorts).toContain("ui");
    expect(cinatra.requestedHostPorts).toContain("capabilities");
  });

  it("the declared configSchema parses with ZERO validation errors", () => {
    expect(validateConfigSchema(configSchema)).toEqual([]);
  });

  it("covers every setup element the API-key connection needs", () => {
    const fields = (configSchema as { fields: Array<Record<string, unknown>> })
      .fields;
    const byKind = (k: string) => fields.filter((f) => f.kind === k);

    expect(byKind("secret").map((f) => f.key)).toContain("apiKey");
    expect(byKind("status-probe")[0]?.actionId).toBe("connectionStatus");
    expect(byKind("advisory")[0]?.probeActionId).toBe("connectionServiceReady");

    const actionIds = byKind("named-action").map((f) => f.actionId);
    expect(actionIds).toEqual(
      expect.arrayContaining(["saveConnection", "clearConnection"]),
    );
    const clear = byKind("named-action").find((f) => f.actionId === "clearConnection");
    expect(clear?.confirm).toBeTruthy();

    const banner = byKind("banner")[0];
    const variantNames = (banner.variants as Array<{ name: string }>).map((v) => v.name);
    expect(variantNames).toEqual(
      expect.arrayContaining(["saved", "cleared", "error"]),
    );
  });

  describe("validateConfigSchema stays fail-closed", () => {
    const wrap = (field: Record<string, unknown>) => ({ fields: [field] });

    it("rejects an advisory with an invalid tone", () => {
      expect(
        validateConfigSchema(wrap({ kind: "advisory", label: "Note", tone: "fuchsia" })).length,
      ).toBeGreaterThan(0);
    });

    it("rejects an UNKNOWN key on a field (no executable/HTML carrier smuggled in)", () => {
      for (const evil of ["html", "onClick", "render", "component", "script"]) {
        const errs = validateConfigSchema(
          wrap({ kind: "secret", key: "apiKey", label: "Key", [evil]: "<script>x</script>" }),
        );
        expect(errs.length, `expected ${evil} to be rejected`).toBeGreaterThan(0);
      }
    });
  });
});
