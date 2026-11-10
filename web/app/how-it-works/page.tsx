import type { Metadata } from "next";
import { BracketCard, Page, PageHeader } from "@/components/ui";
import { CtaBand, Hl } from "@/components/site";

export const metadata: Metadata = { title: "How it works", description: "Each off-plan unit is a NEAR account. Money moves only on a TEE-checked, surveyor-signed milestone." };

function Box({ title, sub, tone = "default" }: { title: string; sub: string; tone?: "default" | "teal" | "gold" }) {
  return (
    <div className={`corners ${tone === "teal" ? "corners-teal" : tone === "gold" ? "corners-gold" : ""} bg-surface p-3`}>
      <p className="mono text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted">{sub}</p>
    </div>
  );
}

export default function HowItWorks() {
  return (
    <>
    <Page>
      <PageHeader eyebrow="LONG-FORM" title="How Plote works">
        The chain holds every rule that touches money. The web app only reads state and asks wallets to sign. Off-chain services do what a contract can&apos;t, and each one returns something the contract can check.
      </PageHeader>

      <section className="space-y-4" aria-labelledby="arch">
        <h2 id="arch" className="text-2xl font-semibold">Architecture</h2>
        <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr_1fr]" role="img" aria-label="Architecture: users and the web app on the left, the estate and unit contracts in the middle (the only places money moves), off-chain services on the right.">
          <div className="space-y-2">
            <p className="label">People</p>
            <Box title="Buyer / holder" sub="NEAR wallet, or any chain via 1Click" />
            <Box title="Developer" sub="adds units, claims releases" />
            <Box title="Surveyor" sub="phone key: capture + sign only" />
            <Box title="Plote web app" sub="reads views, asks wallets to sign" />
          </div>
          <div className="space-y-2">
            <p className="label">NEAR (money moves only here)</p>
            <Box tone="teal" title="estate contract" sub="registry · allocation NFT · milestones · verdicts · votes · resale" />
            <Box tone="teal" title="unit account × N" sub="holds that unit's USDC; obeys only the estate" />
            <Box title="USDC (NEP-141)" sub="mock on testnet, Circle native USDC on mainnet" />
            <Box title="OutLayer" sub="request_execution → yield/resume with the TEE verdict" />
          </div>
          <div className="space-y-2">
            <p className="label">Off-chain</p>
            <Box tone="gold" title="plote-verifier (TEE)" sub="hash · EXIF · GPS · pHash · challenge code" />
            <Box title="NEAR AI Cloud" sub="vision model: which stage is shown?" />
            <Box title="1Click / NEAR Intents" sub="any-chain USDC → the unit's account" />
            <Box title="Supabase + relayer" sub="photo storage, event cache, gas for surveyor calls" />
          </div>
        </div>
      </section>

      <section className="mt-12 space-y-4" aria-labelledby="flow">
        <h2 id="flow" className="text-2xl font-semibold">A milestone, end to end</h2>
        <ol className="grid gap-3 md:grid-cols-2">
          {[
            "The surveyor opens a capture; the contract issues a 6-character challenge code valid for 30 minutes.",
            "They write it on paper and photograph the site with the paper in frame. The app hashes the original bytes and uploads them.",
            "submit_evidence stores the SHA-256 on-chain first, then asks OutLayer to run the public checker inside an Intel TDX enclave.",
            "The checker downloads the photo, matches the hash, checks EXIF time, the GPS geofence, perceptual-hash reuse, the AI stage and the challenge code.",
            "The verdict lands on-chain. If it passed, the milestone is Verified and the surveyor signs; holders get a veto window.",
            "After the window, the developer claims: each unit sends exactly its share of what was paid (capped at the price) to the payout account.",
          ].map((t, i) => (
            <li key={i}><BracketCard className="flex gap-3"><span className="mono text-teal">0{i + 1}</span><p className="text-sm">{t}</p></BracketCard></li>
          ))}
        </ol>
      </section>

      <section className="mt-12 space-y-4" aria-labelledby="money">
        <h2 id="money" className="text-2xl font-semibold">Where money can go</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead><tr className="border-b border-line"><th className="label py-2">Movement</th><th className="label py-2">From → to</th><th className="label py-2">When</th></tr></thead>
            <tbody>
              {[
                ["Payment", "buyer (or family) → unit account", "any time; credited to the holder or reserver by sync"],
                ["Release", "unit account → developer payout", "a milestone is verified, signed, and its veto window passed"],
                ["Refund", "unit account → holder", "a deadline + grace passed without approval, or a freeze opened refunds"],
                ["Excess", "unit account → holder", "you paid more than the price"],
                ["Resale", "buyer → seller (escrow stays put)", "a listing is bought; default sales pay a fixed 5% to the developer"],
                ["Late payment", "unit account → last reserver or recovery", "money arrived after a reservation ended (sweep_unattributed)"],
              ].map(([a, b, c]) => (
                <tr key={a} className="border-b border-line/60"><td className="py-2 font-medium">{a}</td><td className="mono py-2 text-xs">{b}</td><td className="py-2 text-muted">{c}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted">There is no other exit. Plote&apos;s servers hold no buyer money and no key that can move it.</p>
      </section>

      <section className="mt-12 border border-line p-6" aria-labelledby="not">
        <h2 id="not" className="text-2xl font-semibold">What Plote doesn&apos;t do.</h2>
        <ul className="mt-4 space-y-2 text-muted">
          <li>Plote is not your land title. Always check the C of O or governor&apos;s consent with a lawyer.</li>
          <li>Plote can&apos;t stop a developer who refuses to use it. Ask your developer why they don&apos;t.</li>
          <li>The surveyor is a real person. Plote checks their photos and lets holders replace them, but it doesn&apos;t remove the need for one.</li>
          <li>Today Plote works in USDC. Naira payments are on the roadmap.</li>
          <li>The secure hardware proves the checks ran on the submitted photo, not that the scene is honest. EXIF can be forged; the one-time challenge code and the surveyor&apos;s signature are there for that.</li>
        </ul>
      </section>
    </Page>
    <CtaBand title={<>See it run, <Hl>end to end</Hl>.</>} lead="Reserve a Playground unit, photograph the challenge code, watch the verdict land and the first 20% release." primary={{ href: "/estates/playground", label: "Try the Playground" }} secondary={{ href: "/check", label: "Check a unit" }} />
    </>
  );
}
