# Testing Patterns

**Analysis Date:** 2026-06-09

## Test Framework

**Runner:**
- Vitest (version pulled from monorepo workspace)
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`) — no separate assertion library

**Run Commands:**
```bash
npm test              # Run all tests (vitest)
```

## Test File Organization

**Location:**
- Co-located under `src/__tests__/` — separate from source files but within `src/`
- Pattern: `src/__tests__/**/*.test.ts` (as configured in `vitest.config.ts` `include`)

**Naming:**
- Files named after the behavior or security property under test, not the module: `gemini-actions-extension-gate.test.ts`, `sync-and-readback.test.ts`
- Names describe the invariant, not the class: "extension-gate", "sync-and-readback"

**Structure:**
```
src/
└── __tests__/
    ├── gemini-actions-extension-gate.test.ts   # Security: server action gate order
    └── sync-and-readback.test.ts               # Integration: Nango sync + credential readback
```

## Test Structure

**Suite Organization:**
```typescript
describe("syncGeminiAPISettingsToNango — readback-safe", () => {
  it("happy path: ensure → import (no connectorKey) → forceRefresh readback → saveConnectionRecord (in that order)", async () => {
    // ...
  });
  it("readback mismatch THROWS generic error (no token in message) and skips saveConnectionRecord", async () => {
    // ...
  });
});

describe("saveGeminiAPISettings — blank-submit no-op", () => {
  it("blank input + saved pointer present → no-op (no sync, no throw)", async () => {
    // ...
  });
});
```

**Patterns:**
- `describe` blocks group by function under test with a dash-separated behavior label: `"syncGeminiAPISettingsToNango — readback-safe"`
- `it` descriptions are full sentences describing the expected outcome, including key constraints: `"readback mismatch THROWS generic error (no token in message) and skips saveConnectionRecord"`
- `beforeEach` wires full dependency injection using `registerGeminiConnector` — tests never import host modules
- `afterEach` always calls `vi.restoreAllMocks()` and `_resetGeminiDepsForTests()` to clean global state
- `vi.resetAllMocks()` called in `beforeEach` to clear `mockResolvedValueOnce` queues that leak between tests

## Mocking

**Framework:** Vitest (`vi.fn`, `vi.resetAllMocks`, `vi.restoreAllMocks`)

**Patterns:**
```typescript
// All Nango capability methods are vi.fn() declared at module level
const isConfigured = vi.fn<() => boolean>();
const getCredentials = vi.fn(async (..._args: unknown[]): Promise<unknown> => null);
const saveConnectionRecord = vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined);

// Registered into deps in beforeEach via the real DI surface
registerGeminiConnector({
  readConnectorConfigFromDatabase: <T>(key: string, fallback: T): T =>
    (CONFIG_STORE[key] as T) ?? fallback,
  writeConnectorConfigToDatabase: (key: string, value: unknown) => {
    CONFIG_STORE[key] = value;
  },
  buildAppMcpSelfClientHeaders: () => ({}),
  nango: {
    isConfigured,
    getPrimarySavedConnection,
    // ...all capability methods
  },
});

// Per-test mock return values use mockReturnValue / mockResolvedValueOnce
isConfigured.mockReturnValue(true);
getCredentials.mockResolvedValueOnce({ apiKey: APIKEY } as never);
```

**What to Mock:**
- All Nango capability methods (external side-effects): `isConfigured`, `getPrimarySavedConnection`, `getCredentials`, `ensureIntegration`, `importConnection`, `saveConnectionRecord`, `deleteConnection`, `clearConnectionRecords`
- Host infrastructure callbacks (`readConnectorConfigFromDatabase`, `writeConnectorConfigToDatabase`) via in-memory `CONFIG_STORE`

**What NOT to Mock:**
- The module under test itself (`src/index.ts`) — imported directly
- Business logic functions (`extractApiKey`, `sanitizeLogLabel`) — exercised through the public API

## Fixtures and Factories

**Test Data:**
```typescript
// Constant at module level for the test API key
const APIKEY = "AIza_test_apikey_1234567890";

// In-memory config store reset in beforeEach
let CONFIG_STORE: Record<string, unknown> = {};
```

**Location:**
- Inline in test files — no shared fixture directory within this package
- Shared stubs (for `server-only` and `@/lib/database`) live in the parent monorepo at `tests/__stubs__/` and are aliased in `vitest.config.ts`

## Coverage

**Requirements:** Not enforced — no coverage threshold configured in `vitest.config.ts`

**View Coverage:**
```bash
npx vitest run --coverage   # Not explicitly configured; available as vitest flag
```

## Test Types

**Unit Tests:**
- `src/__tests__/gemini-actions-extension-gate.test.ts` — static source-text assertion test: reads `actions.ts` as a string and asserts positional security property (first `await` must be the gate call). No mocking needed.

**Integration Tests:**
- `src/__tests__/sync-and-readback.test.ts` — full DI integration test: exercises `syncGeminiAPISettingsToNango`, `saveGeminiAPISettings`, and `getConfiguredGeminiAPIKey` with mocked Nango capability and real in-memory config store. Verifies call ordering, error messages, and credential isolation.

**E2E Tests:**
- Not used

## Common Patterns

**Async Testing:**
```typescript
// Use async/await with expect(...).resolves / expect(...).rejects
await expect(syncGeminiAPISettingsToNango({ apiKey: APIKEY })).rejects.toThrow(
  /Nango credential verification failed/,
);
await expect(saveGeminiAPISettings({ apiKey: "" })).resolves.toBeDefined();
```

**Error Testing:**
```typescript
// Assert error message pattern with regex
await expect(fn()).rejects.toThrow(/Nango credential verification failed/);

// Also verify the error does NOT contain sensitive values
try {
  await syncGeminiAPISettingsToNango({ apiKey: APIKEY });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  expect(msg).not.toContain(APIKEY);
  expect(msg).not.toContain("DIFFERENT_KEY");
}
```

**Call Order Assertions:**
```typescript
// Use invocationCallOrder (monotonic global sequence number) to assert temporal ordering
const ensureOrder = ensureIntegration.mock.invocationCallOrder[0];
const importOrder = importConnection.mock.invocationCallOrder[0];
expect(ensureOrder).toBeLessThan(importOrder);
```

**Static Source Assertion (security gate tests):**
```typescript
// Read source file as text and assert structural properties
const SOURCE = readFileSync(join(__dirname, "..", "actions.ts"), "utf-8");
const body = extractFunctionBody(SOURCE, "saveGeminiConnectionAction");
const firstAwait = body.indexOf("await ");
const gateCall = body.indexOf(GATE);
expect(body.slice(firstAwait + "await ".length).startsWith(GATE)).toBe(true);
```

## Vitest Resolver Configuration

`vitest.config.ts` uses path aliases to stub out monorepo-internal modules:
- `server-only` → `tests/__stubs__/server-only.ts` (parent monorepo)
- `@/lib/database` → `tests/__stubs__/database.ts` (parent monorepo)
- `@/(.+)` → `{repoRoot}/src/$1` (parent monorepo src)

This allows the connector tests to run in isolation without the full host app, while still resolving any transitive `@/` imports.

---

*Testing analysis: 2026-06-09*
