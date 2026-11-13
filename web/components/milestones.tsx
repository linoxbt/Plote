"use client";

import { clsx } from "clsx";
import { AlertTriangle, CheckCircle2, CircleDashed, MinusCircle, XCircle } from "lucide-react";
import { bpsToPct, formatDate } from "@/lib/format";
import { proofChecks, type CheckItem } from "@/lib/proof";
import type { EvidenceView, MilestoneView } from "@/lib/types";
import { StatusBadge, CountdownChip } from "./chain";

// ---------------- MilestoneTrack (4 segments) ----------------

function segTone(m: MilestoneView): string {
  if (m.status === "Approved" && m.veto_passed) return "bg-orange";
  if (m.status === "Approved") return "bg-orange/60";
  if (m.status === "Verified") return "bg-orange-dim";
  if (m.status === "Checking") return "bg-amber/60";
  if (m.status === "Missed" || m.status === "Vetoed") return "bg-red/70";
  return "bg-surface-2";
}

export function MilestoneTrack({ milestones, detailed = false, mobilisationBps = 0 }: { milestones: MilestoneView[]; detailed?: boolean; mobilisationBps?: number }) {
  if (!milestones.length) return <p className="text-sm text-muted">No milestones on this estate.</p>;
  return (
    <div>
      <div className="flex gap-1" role="list" aria-label="Milestones">
        {mobilisationBps > 0 ? (
          <div role="listitem" className="h-2 bg-accent" style={{ flexGrow: mobilisationBps }} title={`Mobilisation ${bpsToPct(mobilisationBps)}`} aria-label={`Mobilisation ${bpsToPct(mobilisationBps)}, released at allocation`} />
        ) : null}
        {milestones.map((m) => (
          <div key={m.index} role="listitem" className={clsx("h-2", segTone(m))} style={{ flexGrow: m.bps }} aria-label={`${m.title} ${bpsToPct(m.bps)}: ${m.status}`} />
        ))}
      </div>
      {detailed ? (
        <ol className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {milestones.map((m) => (
            <li key={m.index} className="min-w-0">
              <p className="mono text-xs text-muted">
                {m.index + 1}. {bpsToPct(m.bps)}
              </p>
              <p className="truncate font-medium">{m.title}</p>
              <p className="mono text-xs text-muted">due {formatDate(m.deadline)}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                <StatusBadge kind="milestone" status={m.status} />
                {m.status === "Approved" && !m.veto_passed && m.veto_until ? <CountdownChip until={m.veto_until} label="veto" /> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

// ---------------- ProofChecklist ----------------

const ICON = { pass: CheckCircle2, fail: XCircle, warn: AlertTriangle, pending: CircleDashed, skipped: MinusCircle };
const COLOR = { pass: "text-orange-ink", fail: "text-red", warn: "text-amber", pending: "text-muted", skipped: "text-muted" };
const WORD = { pass: "Passed", fail: "Failed", warn: "Warning", pending: "Pending", skipped: "Skipped" };

export function ProofChecklist({ evidence, geofenceRadius, compact = false }: { evidence: EvidenceView; geofenceRadius?: number; compact?: boolean }) {
  const items: CheckItem[] = proofChecks(evidence, { geofenceRadius });
  return (
    <ul className="space-y-2">
      {items.map((c) => {
        const Icon = ICON[c.state];
        return (
          <li key={c.key} className={clsx("flex items-start gap-3", c.state === "warn" && "bg-amber/5 p-2 -mx-2")}>
            <Icon className={clsx("mt-0.5 h-5 w-5 shrink-0", COLOR[c.state])} strokeWidth={1.75} aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">
                <span className="sr-only">{WORD[c.state]}: </span>
                {c.label}
                <span className={clsx("mono ml-2 text-xs uppercase", COLOR[c.state])}>{WORD[c.state]}</span>
              </p>
              {!compact && c.detail ? <p className="mono text-xs text-muted break-words">{c.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
