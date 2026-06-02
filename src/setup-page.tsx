// Colocated setup page for the
// `/connectors/cinatra-ai/gemini-connector/setup` dispatch route.
//
// This setup UI is intentionally credential-focused: it does not add
// service-tier helpers or model-filter controls. It follows the
// dispatch-route props contract.

import { Main, PageHeader, PageContent } from "@cinatra-ai/sdk-ui/marketplace";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { getGeminiAPIStatus } from "./index";
import { clearGeminiConnectionAction } from "./actions";
import { SaveGeminiForm } from "./save-gemini-form";

type ConnectorSetupPageProps = {
  packageId: string;
  slug: string;
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function GeminiConnectorSetupPage(
  _props: ConnectorSetupPageProps,
) {
  const status = getGeminiAPIStatus();
  const isConnected = status.status === "connected";

  return (
    <Main className="min-h-screen">
      <PageHeader
        title="Gemini"
        description="Connect Google Gemini to power transcript generators and other Gemini-backed workflows."
        className="max-w-3xl"
      />
      <PageContent className="max-w-3xl flex flex-col gap-6 pb-8">
        <section className="soft-panel rounded-panel p-5 flex flex-col gap-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Gemini API</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Configure the shared Gemini API key Cinatra uses for transcript generators and other
              Gemini-powered workflows. The key is stored in the Nango credential vault; the cinatra
              DB never holds it in plaintext.
            </p>
          </div>
          <SaveGeminiForm className="grid gap-4">
            <Label className="grid gap-2">
              API key
              <Input
                name="apiKey"
                type="password"
                autoComplete="off"
                placeholder="AIza..."
                required={!isConnected}
              />
              <span className="text-xs font-normal text-muted-foreground">
                {isConnected
                  ? "Leave blank to keep the currently saved key."
                  : "Get your key at https://aistudio.google.com/app/apikey."}
              </span>
            </Label>
            <div className="flex flex-wrap gap-3">
              <Button type="submit">Save API connection</Button>
              {isConnected ? (
                <Button variant="outline" formAction={clearGeminiConnectionAction} formNoValidate>
                  Disconnect
                </Button>
              ) : null}
            </div>
          </SaveGeminiForm>
        </section>
      </PageContent>
    </Main>
  );
}
