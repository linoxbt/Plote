"use client";

import { useEffect, useState } from "react";
import { CheckInput, CheckResult, loadRecent, runCheck, saveRecent, type CheckOutcome } from "@/components/check";
import { LoadingCard } from "@/components/ui";
import { APP_URL } from "@/lib/config";

export function CheckClient({ initial }: { initial: string }) {
  const [o, setO] = useState<CheckOutcome | null>(null);
  const [busy, setBusy] = useState(!!initial);
  const [recent, setRecent] = useState<string[]>([]);
  const [q, setQ] = useState(initial);

  useEffect(() => {
    setRecent(loadRecent());
    if (!initial) return;
    let alive = true;
    runCheck(initial).then((r) => {
      if (!alive) return;
      saveRecent(initial);
      setO(r);
      setBusy(false);
      setRecent(loadRecent());
    });
    return () => {
      alive = false;
    };
  }, [initial]);

  const share = async () => {
    const url = `${APP_URL}/check?u=${encodeURIComponent(q)}`;
    try {
      if (navigator.share) await navigator.share({ title: "Plote unit check", url });
      else await navigator.clipboard.writeText(url);
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="space-y-6">
      <CheckInput
        key={initial}
        initial={initial}
        autoFocus
        onResult={(r) => {
          setO(r);
          setRecent(loadRecent());
          if (r.kind !== "not_plote" || r.ref) setQ(r.ref ? `${r.ref.unit}.${r.ref.estate}` : "");
          try {
            const url = new URL(window.location.href);
            url.searchParams.set("u", r.ref ? `${r.ref.unit}.${r.ref.estate}` : r.kind === "not_plote" ? r.input : "");
            window.history.replaceState(null, "", url.toString());
          } catch {
            /* ignore */
          }
        }}
      />
      <div aria-live="polite">{busy ? <LoadingCard label="Checking" /> : o ? <CheckResult o={o} onShare={share} /> : null}</div>
      {recent.length ? (
        <div>
          <p className="label">Recent checks</p>
          <ul className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <li key={r}>
                <a href={`/check?u=${encodeURIComponent(r)}`} className="mono corners corners-hover inline-flex min-h-11 items-center bg-surface px-3 text-sm">
                  {r}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
