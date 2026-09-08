// Package-shape guard for the capture-port migration (cinatra#981).
//
// Deleting `src/log-directory.ts` (the connector no longer owns a raw
// filesystem path — the host resolves the capture directory) leaves the
// package manifest's `exports` map free to keep pointing at a file that is
// gone. A dangling subpath target is invisible to `vitest` and to
// `npm pack --dry-run`, but a consumer resolving it fails at runtime with
// ERR_MODULE_NOT_FOUND. Assert every declared entry point resolves to a file
// that actually ships in this package.
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  main?: string;
  types?: string;
  exports?: Record<string, unknown>;
};

/** The `./`-relative string targets a one-level exports entry can carry. */
function targetsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).flatMap((nested) =>
      typeof nested === "string" ? [nested] : [],
    );
  }
  return [];
}

describe("package entry points (cinatra#981 capture-port migration)", () => {
  it("resolves every exports subpath to a file that exists", () => {
    const entries = Object.entries(pkg.exports ?? {});
    expect(entries.length).toBeGreaterThan(0);
    const dangling = entries.flatMap(([subpath, value]) =>
      targetsOf(value)
        .filter((target) => !existsSync(path.join(packageRoot, target)))
        .map((target) => `${subpath} -> ${target}`),
    );
    expect(dangling).toEqual([]);
  });

  it("resolves main and types to files that exist", () => {
    for (const field of [pkg.main, pkg.types]) {
      expect(field).toBeTruthy();
      expect(existsSync(path.join(packageRoot, field as string))).toBe(true);
    }
  });

  it("declares no entry point for the retired connector-owned log directory", () => {
    // The directory is HOST-resolved through `ctx.logger.captureDirectory`
    // now; the connector exposes only the channel name.
    expect(Object.keys(pkg.exports ?? {})).not.toContain("./log-directory");
  });
});
