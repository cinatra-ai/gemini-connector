// Contract fixtures for the declarative setup DSL (cinatra.configSchema).
//
// The Gemini connector ships a `uiSurface:"schema-config"` declaration
// (cinatra#782) so the host renders its setup page from DATA with NO rebuild,
// retiring the bundled-react setup/save-form pages. These tests prove the
// declared `cinatra.configSchema` passes the PUBLIC validation path: the SAME
// fail-closed `validateConfigSchema` the repo's `extension-kind-gate.mjs` runs
// in CI. They also pin the cinatra#1102 tab-group reorg (design spec:
// app-connectors §II — connection fields render as the implicit "Setup" tab;
// the reserved "Help" tab carries the setup how-to, always last), catching a
// connector<->host vocabulary skew at author time.

import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { validateConfigSchema } from "../../extension-kind-gate.mjs";

const configSchema = (pkg as { cinatra?: { configSchema?: unknown } }).cinatra
  ?.configSchema;

type Field = Record<string, unknown>;
type Tab = { id: string; label: string; fields: Field[] };

// The base `fields` render as the host's reserved "Setup" tab (connection
// fields); `tabs[]` are the connector's declared custom tabs — here, only the
// reserved Help tab.
const setupFields = (configSchema as { fields: Field[] }).fields;
const tabs = (configSchema as { tabs?: Tab[] }).tabs ?? [];
const helpTab = tabs.find((t) => t.id === "help");

const byKind = (list: Field[], k: string) => list.filter((f) => f.kind === k);
const byKey = (list: Field[], k: string) => list.find((f) => (f as { key?: string }).key === k);

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

  it("covers every setup element the API-key connection needs (the Setup tab)", () => {
    expect(byKey(setupFields, "apiKey")?.kind).toBe("secret");
    expect(byKind(setupFields, "status-probe")[0]?.actionId).toBe("connectionStatus");
    // The readiness advisory now lives on the Help tab (checked below), NOT
    // the Setup tab.
    expect(byKind(setupFields, "advisory")).toHaveLength(0);

    const actionIds = byKind(setupFields, "named-action").map((f) => f.actionId);
    expect(actionIds).toEqual(
      expect.arrayContaining(["saveConnection", "clearConnection"]),
    );
    const clear = byKind(setupFields, "named-action").find((f) => f.actionId === "clearConnection");
    expect(clear?.confirm).toBeTruthy();

    const banner = byKind(setupFields, "banner")[0];
    const variantNames = (banner.variants as Array<{ name: string }>).map((v) => v.name);
    expect(variantNames).toEqual(
      expect.arrayContaining(["saved", "cleared", "error"]),
    );
  });

  describe("tab groups (design spec: app-connectors §II — Setup, Help last)", () => {
    it("declares exactly one custom tab: the reserved Help tab", () => {
      expect(tabs.map((t) => t.id)).toEqual(["help"]);
      expect(helpTab?.label).toBe("Help");
    });

    it('Help tab is READ-ONLY (no form, no Save): exactly one advisory field, no keyed/action-writing field kinds', () => {
      const helpFields = helpTab!.fields;
      expect(helpFields).toHaveLength(1);
      const advisory = helpFields[0] as {
        kind: string;
        tone?: string;
        probeActionId?: string;
        whenReady?: string;
        whenNotReady?: string;
      };
      expect(advisory.kind).toBe("advisory");
      expect(advisory.tone).toBe("info");
      // Reuses the connector's existing connection-service readiness probe —
      // no new action registered.
      expect(advisory.probeActionId).toBe("connectionServiceReady");
      expect(typeof advisory.whenReady).toBe("string");
      expect(typeof advisory.whenNotReady).toBe("string");
      expect((advisory.whenReady ?? "").length).toBeGreaterThan(0);
      expect((advisory.whenNotReady ?? "").length).toBeGreaterThan(0);

      // No field kind that emits an `<input>`/action button — "no form, no
      // Save" per the design spec.
      const writeCapableKinds = new Set([
        "text", "secret", "select", "boolean", "number", "free-list",
        "named-action", "status-probe", "nango-connect", "repeatable-list",
        "record-list", "dynamic-select-options",
      ]);
      for (const f of helpFields) {
        expect(writeCapableKinds.has(f.kind as string), `${JSON.stringify(f.kind)} is not read-only`).toBe(false);
      }
    });

    it("every field key stays unique across the Setup tab AND the Help tab (one flat submit namespace)", () => {
      const allKeyed = [...setupFields, ...(helpTab?.fields ?? [])]
        .map((f) => (f as { key?: string }).key)
        .filter((k): k is string => typeof k === "string");
      expect(new Set(allKeyed).size).toBe(allKeyed.length);
    });
  });

  describe("tabs vocabulary — FAIL-CLOSED (mirrors the host parser's tab rules)", () => {
    const baseField = { kind: "secret", key: "apiKey", label: "API key" };
    const wrapTabs = (tabsRaw: unknown) => ({ fields: [baseField], tabs: tabsRaw });

    it("rejects a non-array tabs root", () => {
      expect(validateConfigSchema(wrapTabs({})).length).toBeGreaterThan(0);
    });

    it("rejects an unknown key on a tab (no executable/HTML carrier)", () => {
      expect(
        validateConfigSchema(
          wrapTabs([{ id: "x", label: "X", fields: [{ kind: "text", key: "k", label: "L" }], onClick: "alert(1)" }]),
        ).length,
      ).toBeGreaterThan(0);
    });

    it("rejects a duplicate tab id", () => {
      expect(
        validateConfigSchema(
          wrapTabs([
            { id: "dup", label: "One", fields: [{ kind: "text", key: "k1", label: "L" }] },
            { id: "dup", label: "Two", fields: [{ kind: "text", key: "k2", label: "L" }] },
          ]),
        ).length,
      ).toBeGreaterThan(0);
    });

    it("rejects a field key duplicated across the base fields and a tab", () => {
      expect(
        validateConfigSchema(wrapTabs([{ id: "t", label: "T", fields: [{ kind: "text", key: "apiKey", label: "Dup" }] }])).length,
      ).toBeGreaterThan(0);
    });

    it("rejects an invalid tab id, a missing label, and an empty fields array", () => {
      expect(validateConfigSchema(wrapTabs([{ id: "1bad", label: "X", fields: [{ kind: "text", key: "k", label: "L" }] }])).length).toBeGreaterThan(0);
      expect(validateConfigSchema(wrapTabs([{ id: "t", fields: [{ kind: "text", key: "k", label: "L" }] }])).length).toBeGreaterThan(0);
      expect(validateConfigSchema(wrapTabs([{ id: "t", label: "T", fields: [] }])).length).toBeGreaterThan(0);
    });
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
