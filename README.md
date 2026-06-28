# Google Gemini

Gemini connector for cinatra. Registers an `llm-provider-surface` capability that routes agent and workflow calls to Google Gemini models, storing the API key securely through the Nango credential vault so the cinatra database never holds it in plaintext. Full documentation lives in the Integrations hub at https://docs.cinatra.ai/integrations/gemini/

## Works with

- cinatra `capabilities` host port (`llm-provider-surface` and `nango-system` surfaces)
- Google Gemini API (models, audio transcription, image generation)

## Capabilities

- Routes cinatra agents and workflows to Google Gemini models at runtime
- Stores and reads the Gemini API key via the Nango credential vault with readback verification
- Exposes `getConfiguredAPIKey`, `getLoggingSettings`, and `saveLoggingSettings` through the `llm-provider-surface` capability
- Writes per-call request and response log files to a configurable log directory
- Audio and video transcription via Gemini
- Image generation via Gemini with handoff to downstream agents
