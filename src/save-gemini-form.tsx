"use client";

// Gemini save form — relocated from the central `@cinatra-ai/connectors` host
// hub into the connector itself (SDK-only decouple). A thin
// "use client" wrapper that submits to the colocated server action and refreshes
// the RSC tree so the connected/disconnected chrome updates without a hard
// navigation. Consumed by both the connector setup page and the host
// /configuration/llm settings page (via re-export).

import { useRouter } from "next/navigation";
import { useNotify } from "@cinatra-ai/sdk-ui";
import { saveGeminiConnectionAction } from "./actions";

export function SaveGeminiForm({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { addNotification } = useNotify();
  const router = useRouter();

  async function handleSubmit(formData: FormData) {
    try {
      await saveGeminiConnectionAction(formData);
      addNotification({
        title: "Gemini connection saved",
        body: "Your Gemini API key has been validated and stored.",
        kind: "success",
      });
      router.refresh();
    } catch {
      // Never surface the caught error's message: in a Next.js production
      // build a thrown Server Action error reaches this catch with its real
      // message replaced by the framework's generic masking blurb, so piping
      // `error.message` into the toast shows that paragraph to the user.
      // Friendly operation-specific copy is unconditional; the real failure
      // detail stays in the server-side logs (cinatra-ai/cinatra#51 pattern).
      addNotification({
        title: "Gemini save failed",
        body: "Unable to save the Gemini connection.",
        kind: "error",
      });
    }
  }

  return (
    <form action={handleSubmit} className={className}>
      {children}
    </form>
  );
}
