import type { Metadata } from "next";
import { Cpu, FileCheck2, Fingerprint, ScanEye, ShieldAlert, UserCheck } from "lucide-react";
import { CtaBand, Dial, FeatureCard, GlowPanel, Heading, Hl, PageHero, PillLink, Section, Split, TextLink } from "@/components/site";

export const metadata: Metadata = {
  title: "Proof & verification",
  description: "How Plote checks a site photo inside secure hardware before any money moves: integrity, freshness, location, reuse, stage and a one-time challenge code.",
};

const VERSION = "31c7225df81449c11bac1ae31b00fbfcc353a64a2f1aed4b0ce9c90e1dd818f8";

const CHECKS: [string, string, string][] = [
  ["Integrity", "The photo's SHA-256 matches the hash committed on-chain before the check ran.", "fail"],
  ["Readable", "The image decodes and is large enough to judge.", "fail"],
  ["Fresh", "EXIF time exists, isn't in the future and isn't older than the estate allows.", "fail"],
  ["On site", "GPS is present and inside the estate's geofence (skipped in the Playground).", "fail"],
  ["Never used before", "Its perceptual hash isn't close to any earlier photo for the estate.", "fail"],
  ["Right stage", "NEAR AI's vision model names the stage shown, and flags photos of screens.", "screen: fail · stage: warning in Playground"],
  ["Challenge code", "The one-time code issued on-chain is written on paper and readable in the frame.", "fail, always"],
];

export default function VerificationPage() {
  return (
    <main id="main">
      <PageHero
        eyebrow="Proof before payment"
        tone="teal"
        title={<>Money moves only when a photo <Hl>passes the check</Hl>.</>}
        lead="Before any stage releases money, a site photo is checked inside an Intel TDX enclave on OutLayer, with stage recognition by NEAR AI Cloud. The verdict lands on-chain. Then a surveyor signs, and holders get a veto window."
        actions={
          <>
            <PillLink href="/estates/harmattan-court/milestones">See real proofs</PillLink>
            <PillLink href="/surveyors" variant="ghost">
              For surveyors
            </PillLink>
          </>
        }
        art={
          <Dial label="verdict on-chain">
            <ScanEye className="h-10 w-10 text-teal" strokeWidth={1.1} aria-hidden />
          </Dial>
        }
      />

      <Section label="The checks">
        <Heading eyebrow="Seven checks, in order" title={<>Fail fast. <Hl>Record everything.</Hl></>} lead="The worker stops at the first hard failure. Softened checks are kept as warnings and shown in amber on the proof page." />
        <ol className="mt-12 grid gap-4 md:grid-cols-2">
          {CHECKS.map(([t, b, mode], i) => (
            <li key={t} className="flex gap-5 rounded-3xl bg-surface p-6 ring-1 ring-white/[0.08]">
              <span className="mono pt-1 text-sm text-gold">0{i + 1}</span>
              <div className="space-y-2">
                <p className="text-lg">{t}</p>
                <p className="text-[15px] text-muted">{b}</p>
                <p className="text-xs text-muted">
                  If it fails: <span className={mode.startsWith("fail") ? "text-red" : "text-amber"}>{mode}</span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section label="The challenge code" className="!pt-0">
        <GlowPanel tone="gold" className="p-6 sm:p-12">
          <Split
            visual={
              <svg viewBox="0 0 240 200" className="w-full max-w-[320px]" aria-hidden>
                <path d="M30 60V30h30M180 30h30v30M210 140v30h-30M60 170H30v-30" stroke="#F4F4F5" strokeWidth="3" fill="none" />
                <rect x="70" y="80" width="100" height="40" rx="6" fill="#F4F4F5" />
                <text x="120" y="107" textAnchor="middle" fill="#0A0A0B" fontSize="20" fontFamily="var(--font-jet), monospace">K7RQ4M</text>
              </svg>
            }
          >
            <Heading eyebrow="Why a code on paper" title={<>It proves the photo was taken <Hl>after</Hl> the capture opened.</>} lead="EXIF time and GPS can be forged with free tools. So the contract issues a fresh six-character code when the surveyor opens a capture, and the photo must show it written on paper. A photo from last month can't contain today's code." />
          </Split>
        </GlowPanel>
      </Section>

      <Section label="Where it runs" className="!pt-0">
        <Heading eyebrow="Where it runs" title={<>Checks you can <Hl>verify yourself</Hl>.</>} />
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          <FeatureCard icon={<Cpu className="h-5 w-5" strokeWidth={1.5} />} title="Secure hardware">
            The verifier runs on OutLayer inside an Intel TDX enclave. The estate calls it with yield/resume, so the verdict comes back to the contract — not through Plote&apos;s servers.
          </FeatureCard>
          <FeatureCard icon={<Fingerprint className="h-5 w-5" strokeWidth={1.5} />} title="Pinned code">
            Each estate is pinned on-chain to one version of the checking code, named by its SHA-256. Anyone can download the binary and re-hash it.
            <span className="mono mt-3 block break-all text-xs text-text/80">{VERSION}</span>
          </FeatureCard>
          <FeatureCard icon={<FileCheck2 className="h-5 w-5" strokeWidth={1.5} />} title="Public proof page">
            Every check is published: the photo, each result, the model&apos;s observations, the challenge read back, the worker version and the raw verdict hash.
          </FeatureCard>
        </div>
        <div className="mt-6 flex flex-wrap gap-6">
          <TextLink href={`https://test.fastfs.io/plote.testnet/outlayer.testnet/${VERSION}.wasm`}>Download the verifier binary</TextLink>
          <TextLink href="/security">Read the security model</TextLink>
        </div>
      </Section>

      <Section label="After the check" className="!pt-0">
        <div className="grid gap-5 md:grid-cols-2">
          <FeatureCard icon={<UserCheck className="h-5 w-5" strokeWidth={1.5} />} title="A surveyor still signs">
            A passed check is necessary, not sufficient. A named quantity surveyor signs the milestone with a key that can only sign milestones — it can&apos;t move money.
          </FeatureCard>
          <FeatureCard icon={<ShieldAlert className="h-5 w-5" strokeWidth={1.5} />} title="Holders can still say no">
            After the sign-off, holders get a veto window. A holder vote can veto the sign-off, freeze releases or replace the surveyor.
          </FeatureCard>
        </div>
      </Section>

      <CtaBand title={<>Watch a verdict land <Hl>on-chain</Hl>.</>} lead="In the Playground any wallet can act as surveyor: photograph the code anywhere and follow the check live." primary={{ href: "/estates/playground", label: "Open the Playground" }} secondary={{ href: "/qs", label: "Surveyor app" }} />
    </main>
  );
}
