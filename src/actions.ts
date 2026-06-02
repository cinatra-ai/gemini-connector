"use server";

// Gemini connection server actions — relocated from the central
// `@cinatra-ai/connectors` host hub into the connector itself (SDK-only
// decouple, single source of truth). Gated by the
// SDK's `requireExtensionAction(pkg, "manage")` rather than the host
// `requireAdminSession` — Gemini is a workspace-wide LLM credential, so "manage"
// on this connector is the right authority (org_owner/org_admin/platform_admin,
// fail-closed) and keeps the connector free of `@/lib/auth-session`.
//
// Both the connector's own setup page AND the host /configuration/llm settings
// page consume these (the host re-exports them via src/app/campaigns/actions.ts
// + src/app/configuration/llm/gemini/save-gemini-form.tsx).

import { z } from "zod";
import { redirect } from "next/navigation";
import { requireExtensionAction } from "@cinatra-ai/sdk-extensions";
import { saveGeminiAPISettings, clearGeminiAPISettings } from "./index";

const geminiConnectorSchema = z.object({
  apiKey: z.string().optional(),
});

export async function saveGeminiConnectionAction(formData: FormData) {
  await requireExtensionAction("@cinatra-ai/gemini-connector", "manage");
  const parsed = geminiConnectorSchema.parse({
    apiKey: formData.get("apiKey") ?? undefined,
  });
  try {
    // saveGeminiAPISettings honours the "leave blank to keep the saved key"
    // contract (blank + saved pointer → no-op; blank + none → throws), so pass
    // the optional value straight through.
    await saveGeminiAPISettings(parsed);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save the Gemini API connection.";
    throw new Error(message);
  }
}

export async function clearGeminiConnectionAction() {
  await requireExtensionAction("@cinatra-ai/gemini-connector", "manage");
  await clearGeminiAPISettings();
  redirect("/configuration/llm/initial-setup");
}
