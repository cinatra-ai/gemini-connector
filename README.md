# Google Gemini

Connect Google's Gemini API so Cinatra can use Gemini models for transcription, image generation, and general-purpose generation. Once connected, agents and workflows pinned to a Gemini model become runnable across the workspace.

## Works with

- Cinatra (connector kind)

## Capabilities

- Run Cinatra agents on Google Gemini models
- Transcribe audio and video through Gemini
- Generate images with Gemini and hand them off to downstream agents
- Keep per-call request and response logs for debugging when you need them

---

## Purpose

The Gemini connector bridges your Cinatra workspace to Google's Gemini API. It registers a single workspace-wide API key credential, stores it securely through the Nango credential vault (the Cinatra database never holds it in plaintext), and exposes a provider surface that Cinatra's agent runtime resolves at call time. Any agent or workflow configured to use a Gemini model routes through this connector.

---

## Install

The Gemini connector is distributed as a Cinatra marketplace extension. Install it from the Cinatra marketplace UI or by importing the package into a self-hosted Cinatra instance that supports connector extensions.

Once installed, the connector activates automatically when the Cinatra host boots and the workspace has Nango configured.

---

## Configuration

### Prerequisites

- A Cinatra workspace with the Nango integration service configured (required for secure credential storage).
- A Google Gemini API key. You can create one at [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
- Workspace role: `org_owner`, `org_admin`, or `platform_admin` (required to save or clear the API key).

### Add your API key

1. In your Cinatra workspace, go to **Configuration → LLM → Gemini** (or open the connector's setup page from the marketplace).
2. Paste your Gemini API key into the **API key** field (format: `AIza…`).
3. Click **Save API connection**.

Cinatra writes the key to Nango, performs a readback verification, and only commits the saved connection pointer once the readback matches the submitted value. If verification fails, the connection pointer is not saved and no Gemini-powered feature is activated.

### Update your API key

Repeat the steps above with the new key. Submitting a blank field while a saved connection already exists is a no-op (the existing credential is kept).

### Disconnect

On the setup page, click **Disconnect**. This clears the Nango connection record and the Cinatra-side connection pointer. Subsequent Gemini API calls will be rejected until a new key is saved.

---

## Usage

### Agents and workflows

Once the API key is saved, any Cinatra agent or campaign pinned to a Gemini model resolves the key automatically at runtime. No per-agent configuration is needed.

### Logging

Per-call request and response logs are written to `<app-root>/data/logs/gemini-api/` by default. Each log file is named with a timestamp, a sanitized call label, and a `request` or `response` suffix.

Logging is enabled by default. To toggle it:

1. Go to the Gemini settings page in your workspace (**Configuration → LLM → Gemini**).
2. Toggle the **Request logging** switch.

To inspect recent logs (example using the default path):

```sh
ls <app-root>/data/logs/gemini-api/
```

---

## Development

### Requirements

- Node.js (see `package.json` for the engine range used by the project).
- The peer dependencies `react`, `react-dom`, `@cinatra-ai/sdk-extensions`, and `@cinatra-ai/sdk-ui` must be satisfied by the host application.

### Running tests

```sh
npm test
```

Tests use [Vitest](https://vitest.dev/) and cover: the extension action gate, the `llm-provider-surface` registration, the settings form, and the Nango sync/readback flow.

### Linting

```sh
npm run lint
```

### Project layout

```
src/
  index.ts           – public API: settings read/write, credential sync, logging
  deps.ts            – host dependency injection (GeminiConnectorDeps interface)
  register.ts        – connector entry point; binds host services at activation
  actions.ts         – server actions for saving and clearing the API connection
  setup-page.tsx     – marketplace setup UI (API key form)
  log-directory.ts   – log directory path (dependency-free leaf module)
  components/        – shared UI primitives (Button, Input, Label)
```

### Dependency injection

The connector uses a `globalThis`-anchored dependency injection slot so that separately compiled Next.js bundles (setup page, settings page, server actions) share the same registered deps without importing the host directly. In tests, call `registerGeminiConnector(stubDeps)` to inject a stub and `_resetGeminiDepsForTests()` to tear it down.

---

## Troubleshooting

### "Configure the connection service first…"

Nango is not configured in your workspace. The workspace administrator must set up the Nango integration before a Gemini API key can be stored.

### "Enter a Gemini API key to continue."

No key was submitted and no saved connection pointer exists. Paste a valid API key in the setup form.

### "Nango credential verification failed: the readback value did not match the saved credential."

The key was written to Nango but the immediate readback returned a different value. This is a transient Nango state error. Wait a moment and try saving the key again. If it persists, check the Nango dashboard for the `google-gemini` provider configuration.

### Agents fail with "host service not registered"

The connector's `register(ctx)` entry point was not called at host boot, or the host's connector-services wiring ran after the connector was accessed. Verify that the connector is activated in the marketplace and that the host boot order is correct.

### Logs are not being written

Check that logging is enabled (the toggle in **Configuration → LLM → Gemini**) and that the process has write permission to `<app-root>/data/logs/gemini-api/`.

---

## License

Apache-2.0
