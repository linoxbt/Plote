import type { Metadata } from "next";
import { Camera, KeyRound, Smartphone, Users, Zap } from "lucide-react";
import { CtaBand, Dial, FeatureCard, GlowPanel, Heading, Hl, PageHero, PillLink, Section, Split, StepCard } from "@/components/site";

export const metadata: Metadata = {
  title: "For surveyors",
  description: "Snap the site photo on your phone. Plote checks it and you sign. Your key can only sign milestones — it can't move money.",
};

export default function SurveyorsPage() {
  return (
    <main id="main">
      <PageHero
        eyebrow="For quantity surveyors"
        tone="orange"
        title={<>Your sign-off, <Hl>on the record</Hl>.</>}
        lead="You already inspect stages. Plote turns your sign-off into the thing that releases money — with a phone app, a key that can only sign milestones, and no gas to pay."
        actions={
          <>
            <PillLink href="/qs">Open the surveyor app</PillLink>
            <PillLink href="/verification" variant="ghost">
              How checks work
            </PillLink>
          </>
        }
        art={
          <Dial label="milestone signed">
            <Camera className="h-10 w-10 text-accent" strokeWidth={1.1} aria-hidden />
          </Dial>
        }
      />

      <Section label="On site">
        <Heading eyebrow="On site" title={<>Four taps from photo to <Hl>sign-off</Hl>.</>} />
        <ol className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <StepCard n={1} title="Open a capture">
            Pick the milestone. The contract issues a one-time code, shown in large type.
          </StepCard>
          <StepCard n={2} title="Photograph the stage">
            Write the code on paper, keep it in the frame, take the photo. The app checks time and location before upload.
          </StepCard>
          <StepCard n={3} title="Watch the check">
            The photo is checked in secure hardware — hash, freshness, location, reuse, stage, code — and the verdict lands on-chain.
          </StepCard>
          <StepCard n={4} title="Sign">
            Confirm you inspected in person and sign. Holders get a veto window, then the stage&apos;s share releases.
          </StepCard>
        </ol>
      </Section>

      <Section label="Your key" className="!pt-0">
        <GlowPanel tone="sky" className="p-6 sm:p-12">
          <Split
            visual={
              <div className="glass w-full max-w-sm space-y-3 rounded-2xl p-6 mono text-sm" aria-hidden>
                <p className="text-xs text-muted">Allowed by your key</p>
                {["open_capture", "submit_evidence", "qs_sign"].map((m) => (
                  <p key={m} className="flex items-center gap-2 text-orange">
                    <span className="h-1.5 w-1.5 rounded-full bg-orange" /> {m}
                  </p>
                ))}
                <p className="pt-2 text-xs text-muted">Not allowed</p>
                {["claim_release", "refund", "ft_transfer"].map((m) => (
                  <p key={m} className="flex items-center gap-2 text-red/90 line-through">
                    <span className="h-1.5 w-1.5 rounded-full bg-red" /> {m}
                  </p>
                ))}
              </div>
            }
          >
            <Heading eyebrow="Your key" title={<>A key that <Hl>can&apos;t move money</Hl>.</>} lead="Your phone holds a function-call key limited to the milestone methods. It's created in your browser — non-extractable where the browser supports it, PIN-encrypted otherwise. Even if it leaked, nobody could use it to take a cent." />
          </Split>
        </GlowPanel>
      </Section>

      <Section label="Built for the field" className="!pt-0">
        <div className="grid gap-5 md:grid-cols-3">
          <FeatureCard icon={<Zap className="h-5 w-5" strokeWidth={1.5} />} title="No gas to pay">
            A relayer pays the network fee for your calls, so your phone never needs NEAR.
          </FeatureCard>
          <FeatureCard icon={<Smartphone className="h-5 w-5" strokeWidth={1.5} />} title="Installable, works offline">
            Add the surveyor app to your home screen; it opens even with a weak signal on site.
          </FeatureCard>
          <FeatureCard icon={<Users className="h-5 w-5" strokeWidth={1.5} />} title="Accountable both ways">
            Your record is public, and holders — not the developer — can vote to replace you. That&apos;s what makes your sign-off worth trusting.
          </FeatureCard>
        </div>
      </Section>

      <Section label="Set up" className="!pt-0">
        <FeatureCard icon={<KeyRound className="h-5 w-5" strokeWidth={1.5} />} title="Set up in a minute" href="/qs/setup" cta="Set up your phone key">
          The estate&apos;s developer names you as surveyor. Open the setup page on your phone, create your key, and you&apos;re ready to capture.
        </FeatureCard>
      </Section>

      <CtaBand title={<>Try a capture <Hl>right now</Hl>.</>} lead="In the Playground any wallet can act as surveyor and photograph the code anywhere." primary={{ href: "/qs", label: "Open the surveyor app" }} secondary={{ href: "/estates/playground", label: "Open the Playground" }} />
    </main>
  );
}
