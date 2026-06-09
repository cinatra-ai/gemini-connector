# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
gemini-connector/
├── src/
│   ├── __tests__/                  # Vitest test suites
│   │   ├── gemini-actions-extension-gate.test.ts
│   │   └── sync-and-readback.test.ts
│   ├── components/
│   │   └── ui/                     # shadcn-style UI primitives
│   │       ├── button.tsx
│   │       ├── input.tsx
│   │       └── label.tsx
│   ├── lib/
│   │   └── utils.ts                # Tailwind class merging utility (clsx + tailwind-merge)
│   ├── actions.ts                  # Next.js "use server" server actions
│   ├── deps.ts                     # Host DI interfaces and globalThis registration
│   ├── index.ts                    # Public API and all core business logic
│   ├── log-directory.ts            # Leaf module: GEMINI_API_LOG_DIRECTORY constant
│   ├── save-gemini-form.tsx        # "use client" form component
│   └── setup-page.tsx              # RSC connector setup page (default export)
├── .github/
│   └── workflows/
│       ├── ci.yml                  # CI pipeline
│       └── release.yml             # Release pipeline
├── .npmrc                          # npm registry config
├── LICENSE                         # Apache-2.0
├── README.md                       # Package documentation
├── package.json                    # Package manifest with `cinatra` connector metadata
├── tsconfig.json                   # TypeScript configuration
└── vitest.config.ts                # Vitest test runner configuration
```

## Directory Purposes

**`src/`:**
- Purpose: All TypeScript source code
- Contains: Core logic, DI layer, server actions, React components, UI primitives, tests
- Key files: `src/index.ts` (public API), `src/deps.ts` (DI), `src/actions.ts` (server actions)

**`src/__tests__/`:**
- Purpose: Vitest test suites colocated under src
- Contains: Integration-style tests that inject stub deps via `registerGeminiConnector`
- Key files: `src/__tests__/sync-and-readback.test.ts` (readback security tests), `src/__tests__/gemini-actions-extension-gate.test.ts` (server action authority gate tests)

**`src/components/ui/`:**
- Purpose: shadcn-style UI primitives scoped to this connector
- Contains: `Button`, `Input`, `Label` built on Radix UI + class-variance-authority + tailwind-merge
- Key files: `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/label.tsx`

**`src/lib/`:**
- Purpose: Shared utility helpers
- Contains: `utils.ts` — `cn()` helper (clsx + tailwind-merge)
- Key files: `src/lib/utils.ts`

## Key File Locations

**Entry Points:**
- `src/index.ts`: Package public API — all exports consumed by the host app and LLM provider integrations
- `src/setup-page.tsx`: Default export RSC page for the connector's setup route
- `src/actions.ts`: Next.js server actions for save and clear operations

**Configuration:**
- `package.json`: Package name `@cinatra-ai/gemini-connector`; includes `cinatra` manifest block (apiVersion, kind, displayName, dependencies)
- `tsconfig.json`: TypeScript configuration
- `vitest.config.ts`: Test runner configuration

**Core Logic:**
- `src/index.ts`: `saveGeminiAPISettings`, `clearGeminiAPISettings`, `syncGeminiAPISettingsToNango`, `getConfiguredGeminiAPIKey`, `getGeminiAPIStatus`, `getGeminiAPISettings`, `getGeminiLoggingSettings`, `saveGeminiLoggingSettings`, `writeGeminiLogFile`, `buildGeminiRequestHeaders`
- `src/deps.ts`: `GeminiConnectorDeps` interface, `GeminiNangoCapability` interface, `registerGeminiConnector`, `getGeminiDeps`, `_resetGeminiDepsForTests`

**Testing:**
- `src/__tests__/sync-and-readback.test.ts`: Readback security, saved-pointer gate, blank-submit no-op tests
- `src/__tests__/gemini-actions-extension-gate.test.ts`: Server action authority gating tests

## Naming Conventions

**Files:**
- `kebab-case.ts` / `kebab-case.tsx` for all source files
- `*.test.ts` for test files (no `.spec.` variant used)
- `setup-page.tsx` — RSC page default exports
- `save-gemini-form.tsx` — client component files named for their component

**Directories:**
- `lowercase` with hyphens for multi-word directories (`src/__tests__`, `src/components/ui`)
- `ui/` under `components/` for primitive UI building blocks

**Exports:**
- Named exports preferred; one default export only for the setup page RSC component
- Action functions use the `Action` suffix: `saveGeminiConnectionAction`, `clearGeminiConnectionAction`
- Settings functions use the `Settings` suffix: `saveGeminiAPISettings`, `getGeminiAPISettings`
- DI functions use the `registerXxx` / `getXxxDeps` / `_resetXxxForTests` pattern

## Where to Add New Code

**New core business logic function:**
- Implementation: `src/index.ts` — add to the existing export surface
- Export from: `src/index.ts` (already the package entry point)

**New server action:**
- Implementation: `src/actions.ts` — mark `"use server"`, add `requireExtensionAction` authority gate, validate with Zod

**New React UI component (connector-specific):**
- Implementation: `src/components/ui/` for primitives; or directly in `src/` for page-level components

**New host capability needed from the host:**
- Add to `GeminiConnectorDeps` interface in `src/deps.ts`
- Implement in `getGeminiDeps()` usage in `src/index.ts`
- Update host boot wiring in host app's `src/lib/register-transport-connectors.ts`

**New test:**
- Location: `src/__tests__/` — follow the stub-inject pattern using `registerGeminiConnector` in `beforeEach` and `_resetGeminiDepsForTests` in `afterEach`

**New utility helper:**
- Shared class/style utilities: `src/lib/utils.ts`
- Dependency-free constants that must be leaf modules (no ESM init-order cycle risk): create a new `src/<name>.ts` peer to `src/log-directory.ts`

## Special Directories

**`.github/workflows/`:**
- Purpose: CI and release automation
- Generated: No
- Committed: Yes

**`.planning/codebase/`:**
- Purpose: GSD codebase mapping documents for AI-assisted planning and execution
- Generated: Yes (by GSD tools)
- Committed: Up to team preference

---

*Structure analysis: 2026-06-09*
