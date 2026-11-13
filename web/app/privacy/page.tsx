import type { Metadata } from "next";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Privacy", description: "What Plote stores, what is public on the blockchain, and how to remove what can be removed." };

const UPDATED = "10 November 2026";

const ROWS: [string, string, string][] = [
  ["On the NEAR blockchain (public, permanent)", "Account names, payments, unit holders, milestone sign-offs, votes, photo hashes and check results (including photo time and GPS distance from the site).", "Can't be deleted by anyone. That's what makes it checkable."],
  ["Site photos (public storage)", "The original photo file a surveyor uploads, at a public URL, with its EXIF data (time, camera, and GPS if the camera saved it).", "The developer or surveyor can ask us to remove a photo file; its hash stays on-chain."],
  ["Upload log", "Which account uploaded which photo, its hash, and the EXIF time and GPS read in the browser.", "Removed on request with the photo."],
  ["Milestone emails (opt-in)", "Your email address and the unit you asked to follow, after you sign the request with your wallet.", "Every email has an unsubscribe link; unsubscribing deletes the address."],
  ["Payments from other chains", "1Click quotes: the deposit address, amount and destination unit, so the payment can be matched to the unit.", "Kept for support; removed on request."],
  ["Chip-ins and gate passes", "Transaction hashes of chip-ins, and one-time gate-pass nonces so a pass can't be replayed.", "Nonces expire; chip-in records removed on request."],
];

export default function PrivacyPage() {
  return (
    <Page narrow>
      <PageHeader eyebrow="Legal" title="Privacy notice">
        Last updated {UPDATED}. Plote has no user accounts, no passwords, no ads and no analytics trackers. Here is everything it stores.
      </PageHeader>
      <div className="space-y-4">
        {ROWS.map(([where, what, keep]) => (
          <section key={where} data-reveal className="rounded-2xl bg-surface p-6 ring-1 ring-line">
            <h2 className="text-xl">{where}</h2>
            <p className="mt-2 text-muted">{what}</p>
            <p className="mt-2 text-sm text-text-2/80">{keep}</p>
          </section>
        ))}
      </div>
      <article className="mt-10 space-y-6 text-base leading-[1.6] text-text-2/90 [&_h2]:mb-2 [&_h2]:text-2xl [&_h2]:text-text">
        <section>
          <h2>Before you upload a photo</h2>
          <p>Photos are public so anyone can check a milestone. Keep people&apos;s faces and private property out of frame. If your camera saves GPS, the exact location is in the file; on the Playground that may be your home.</p>
        </section>
        <section>
          <h2>Services involved</h2>
          <p>NEAR RPC providers see the requests your browser makes. Supabase stores photos and the tables above. OutLayer runs the photo check in secure hardware and NEAR AI reads the photo inside it. Wallets you connect have their own privacy terms. Exchange rates come from a public FX API.</p>
        </section>
        <section>
          <h2>Requests</h2>
          <p>
            To remove a photo or an email record, open an issue on{" "}
            <a className="underline underline-offset-4" href="https://github.com/linoxbt/Plote/issues" target="_blank" rel="noreferrer">GitHub</a> with the unit and the
            transaction or photo link. We can&apos;t remove anything from the blockchain. See also the <Link className="underline underline-offset-4" href="/terms">Terms</Link>.
          </p>
        </section>
      </article>
    </Page>
  );
}
