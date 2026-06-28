/**
 * SaveGeminiForm error-notification contract
 * (pattern from the host fix cinatra-ai/cinatra#51).
 *
 * In a Next.js production build, a Server Action that throws has its real
 * `Error.message` replaced by the framework's generic masking blurb before it
 * reaches the client `catch`. The form's failure notification must therefore
 * carry friendly, operation-specific copy — never the caught
 * `error.message` — or production users see the masking paragraph as the
 * toast body.
 *
 * Strategy (node environment, per this repo's vitest config): the component's
 * only hooks are `useNotify` and `useRouter`, both mocked to plain functions,
 * so the component function can be invoked directly and the `<form action>`
 * submit handler extracted from the returned element's props. That exercises
 * the exact try/catch path a real form submission runs, without a DOM.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const addNotification = vi.fn();
const refresh = vi.fn();

vi.mock("@cinatra-ai/sdk-ui", () => ({
  useNotify: () => ({ addNotification }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("../actions", () => ({
  saveGeminiConnectionAction: vi.fn(),
}));

import { SaveGeminiForm } from "../save-gemini-form";
import { saveGeminiConnectionAction } from "../actions";

// Shape of what the client receives from a rejected Server Action in a
// production build: an Error instance carrying the masking text instead of
// the original server-side message.
const PROD_MASKED_MESSAGE =
  "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.";

function getSubmitHandler(): (formData: FormData) => Promise<void> {
  const element = SaveGeminiForm({ children: null }) as unknown as {
    props: { action: (formData: FormData) => Promise<void> };
  };
  expect(typeof element.props.action).toBe("function");
  return element.props.action;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SaveGeminiForm server-action rejection", () => {
  it("shows the friendly operation-specific notification when the action rejects with a prod-masked Error", async () => {
    vi.mocked(saveGeminiConnectionAction).mockRejectedValueOnce(
      new Error(PROD_MASKED_MESSAGE),
    );

    await getSubmitHandler()(new FormData());

    expect(addNotification).toHaveBeenCalledTimes(1);
    expect(addNotification).toHaveBeenCalledWith({
      title: "Gemini save failed",
      body: "Unable to save the Gemini connection.",
      kind: "error",
    });
    const { title, body } = addNotification.mock.calls[0][0] as {
      title: string;
      body: string;
    };
    expect(body).not.toContain("omitted in production");
    expect(body).not.toContain(PROD_MASKED_MESSAGE);
    // The title identifies the failed operation (not a bare "Save failed").
    expect(title).not.toBe("Save failed");
    // Failure must not refresh the RSC tree.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the same friendly copy for non-Error rejections (no raw value leaks)", async () => {
    vi.mocked(saveGeminiConnectionAction).mockRejectedValueOnce(
      "raw internal failure string",
    );

    await getSubmitHandler()(new FormData());

    expect(addNotification).toHaveBeenCalledTimes(1);
    expect(addNotification).toHaveBeenCalledWith({
      title: "Gemini save failed",
      body: "Unable to save the Gemini connection.",
      kind: "error",
    });
    const { body } = addNotification.mock.calls[0][0] as { body: string };
    expect(body).not.toContain("raw internal failure string");
  });

  it("shows the success notification and refreshes when the action resolves", async () => {
    vi.mocked(saveGeminiConnectionAction).mockResolvedValueOnce(undefined);

    await getSubmitHandler()(new FormData());

    expect(addNotification).toHaveBeenCalledTimes(1);
    expect(addNotification).toHaveBeenCalledWith({
      title: "Gemini connection saved",
      body: "Your Gemini API key has been validated and stored.",
      kind: "success",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
