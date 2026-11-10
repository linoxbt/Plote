import type { Metadata } from "next";
import { FAQ, EXTRA_FAQ } from "@/components/faq-data";
import { CtaBand, Faq, Hl, PageHero, Section } from "@/components/site";

export const metadata: Metadata = { title: "FAQ", description: "Where your money is, who can move it, and what Plote doesn't do." };

export default function FaqPage() {
  return (
    <main id="main">
      <PageHero eyebrow="FAQ" title={<>Questions buyers <Hl>ask</Hl>.</>} lead="Where your money is, who can move it, what it costs and what Plote doesn't do." />
      <Section label="Questions">
        <div className="mx-auto max-w-4xl">
          <Faq items={[...FAQ, ...EXTRA_FAQ]} />
        </div>
      </Section>
      <CtaBand title={<>Still unsure? <Hl>Check a unit</Hl>.</>} lead="Look up any unit's holder, payments, releases and proofs — no login." primary={{ href: "/check", label: "Check a unit" }} secondary={{ href: "/security", label: "Security" }} />
    </main>
  );
}
