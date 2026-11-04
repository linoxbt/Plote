import type { Metadata } from "next";
import { FAQ, EXTRA_FAQ } from "@/components/faq-data";
import { Page, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "FAQ", description: "Where your money is, who can move it, and what Plote doesn't do." };

export default function FaqPage() {
  return (
    <Page narrow>
      <PageHeader eyebrow="FAQ" title="Questions buyers ask" />
      <div className="space-y-3">
        {[...FAQ, ...EXTRA_FAQ].map(([q, a]) => (
          <details key={q} className="corners corners-hover bg-surface p-4 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex min-h-11 cursor-pointer items-center font-medium">{q}</summary>
            <p className="mt-2 text-muted">{a}</p>
          </details>
        ))}
      </div>
    </Page>
  );
}
