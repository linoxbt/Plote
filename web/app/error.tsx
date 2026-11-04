"use client";

import { ErrorState, Page } from "@/components/ui";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Page narrow>
      <ErrorState error={error} title="This page hit a problem" onRetry={reset} />
    </Page>
  );
}
