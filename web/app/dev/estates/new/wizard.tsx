"use client";

import { useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { clsx } from "clsx";
import { Copy } from "lucide-react";
import { PickMap } from "@/components/pick-map";
import { useWallet } from "@/components/wallet";
import { BracketCard, Button, Field } from "@/components/ui";
import { NETWORK, ROOT_ACCOUNT, USDC_ID } from "@/lib/config";
import { isValidAccountId } from "@/lib/estates";

const acct = z.string().refine((v) => isValidAccountId(v), "Not a valid NEAR account");
const schema = z
  .object({
    name: z.string().min(3).max(60),
    slug: z.string().regex(/^[a-z0-9-]{3,32}$/, "lowercase letters, digits and dashes"),
    location: z.string().min(2).max(80),
    lat: z.coerce.number().min(-90).max(90),
    lon: z.coerce.number().min(-180).max(180),
    radius: z.coerce.number().int().min(0).max(5000),
    mobilisation: z.coerce.number().min(0).max(10),
    // SPEC M5 / §13.6: exactly 4 milestones (default 20/30/30/20).
    milestones: z.array(z.object({ key: z.string().min(2), title: z.string().min(2), pct: z.coerce.number().min(1).max(100), deadline: z.string().min(1, "pick a date") })).length(4, "An estate has exactly 4 milestones"),
    payout: acct,
    surveyor: acct,
    developer: acct,
    demo: z.boolean(),
    units: z.coerce.number().int().min(1).max(200),
  })
  .superRefine((v, ctx) => {
    const sum = v.milestones.reduce((n, m) => n + m.pct, 0) + v.mobilisation;
    if (Math.abs(sum - 100) > 1e-9) ctx.addIssue({ code: "custom", path: ["milestones"], message: `Shares plus mobilisation must add up to 100% (now ${sum}%).` });
    const ds = v.milestones.map((m) => Date.parse(m.deadline));
    for (let i = 1; i < ds.length; i++) if (!(ds[i] > ds[i - 1])) ctx.addIssue({ code: "custom", path: ["milestones", i, "deadline"], message: "Deadlines must increase" });
  });

type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

const STEPS = ["Details", "Milestones", "Roles", "Params", "Review"];

export function NewEstateWizard() {
  const { accountId } = useWallet();
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<Out | null>(null);
  const y = new Date().getUTCFullYear() + 1;
  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = useForm<In, unknown, Out>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "", slug: "", location: "", lat: 6.447, lon: 3.474, radius: 300, mobilisation: 0,
      milestones: [
        { key: "foundation", title: "Foundation", pct: 20, deadline: `${y}-02-01` },
        { key: "roofing", title: "Roofing", pct: 30, deadline: `${y}-05-03` },
        { key: "finishing", title: "Finishing", pct: 30, deadline: `${y}-08-02` },
        { key: "handover", title: "Handover", pct: 20, deadline: `${y}-11-01` },
      ],
      payout: accountId ?? "", surveyor: "", developer: accountId ?? "", demo: true, units: 6,
    },
  });
  const { fields } = useFieldArray({ control, name: "milestones" });
  const slug = watch("slug");
  const ms = watch("milestones");
  const mob = Number(watch("mobilisation") || 0);
  const sum = (ms ?? []).reduce((n, m) => n + Number(m.pct || 0), 0) + mob;
  const units = Number(watch("units") || 0);
  const lat = Number(watch("lat"));
  const lon = Number(watch("lon"));
  const radius = Number(watch("radius") || 0);
  const preview = `${slug || "your-estate"}.${ROOT_ACCOUNT || `plote.${NETWORK}`}`;
  const nearNeeded = useMemo(() => (8 + units * 0.03 + 5).toFixed(2), [units]);

  const json = config
    ? JSON.stringify(
        {
          account: preview, name: config.name, location: config.location,
          developer_id: config.developer, payout_id: config.payout, surveyor_id: config.surveyor,
          usdc_id: USDC_ID, outlayer_id: NETWORK === "mainnet" ? "outlayer.near" : "outlayer.testnet",
          verifier: { repo: "https://github.com/<you>/plote-verifier", commit: "<sha>", build_target: "wasm32-wasip2" },
          geofence: { lat_e6: Math.round(config.lat * 1e6), lon_e6: Math.round(config.lon * 1e6), radius_m: config.radius },
          milestones: config.milestones.map((m) => ({ key: m.key, title: m.title, bps: Math.round(m.pct * 100), deadline: new Date(m.deadline + "T12:00:00Z").toISOString() })),
          params: {
            reserve_ttl_ns: config.demo ? "1800000000000" : "86400000000000", min_initial_bps: 1000, mobilisation_bps: Math.round(config.mobilisation * 100),
            grace_ns: config.demo ? "120000000000" : "2592000000000000", veto_window_ns: config.demo ? "120000000000" : "86400000000000",
            default_grace_ns: config.demo ? "120000000000" : "1209600000000000", penalty_bps: 500, dust_threshold: "1000000",
            late_claim_ns: config.demo ? "600000000000" : "604800000000000", capture_ttl_ns: "1800000000000",
            proposal_period_ns: config.demo ? "600000000000" : "604800000000000", max_phash_distance: 8, max_exif_age_h: 72, min_ai_confidence: 70,
            demo_mode: config.demo, playground: false,
          },
          units: [],
        },
        null,
        2,
      )
    : "";

  return (
    <form onSubmit={handleSubmit((v) => { setConfig(v); setStep(4); })} className="space-y-6" noValidate>
      <ol className="flex gap-1 overflow-x-auto" aria-label="Steps">
        {STEPS.map((t, i) => (
          <li key={t}><button type="button" onClick={() => setStep(i === 4 && !config ? step : i)} className={clsx("mono min-h-11 border-b-2 px-3 text-sm", i === step ? "border-orange text-orange" : "border-line text-muted")} aria-current={i === step ? "step" : undefined}>{i + 1}. {t}</button></li>
        ))}
      </ol>
      <BracketCard className="space-y-4">
        <div className={step === 0 ? "space-y-4" : "hidden"}>
          <Field label="Estate name" htmlFor="name" error={errors.name?.message}><input id="name" className="input" {...register("name")} placeholder="Harmattan Court" /></Field>
          <Field label="Slug" htmlFor="slug" error={errors.slug?.message} hint={<>Account: <span className="mono text-text">{preview}</span>. Units become <span className="mono">a-4b.{preview}</span>.</>}><input id="slug" className="input" {...register("slug")} placeholder="harmattan-court" /></Field>
          <Field label="Location" htmlFor="location" error={errors.location?.message}><input id="location" className="input" {...register("location")} placeholder="Lekki, Lagos" /></Field>
          <div className="space-y-2">
            <p className="label">Location pin</p>
            <PickMap lat={lat} lon={lon} radiusM={radius} onPick={(la, lo) => { setValue("lat", la, { shouldValidate: true, shouldDirty: true }); setValue("lon", lo, { shouldValidate: true, shouldDirty: true }); }} />
            <p className="text-xs text-muted">Click the map to drop the pin (drag to move around). The dashed circle is the geofence photos must be taken inside. Or type exact coordinates below.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Latitude" htmlFor="lat" error={errors.lat?.message}><input id="lat" className="input" inputMode="decimal" {...register("lat")} /></Field>
            <Field label="Longitude" htmlFor="lon" error={errors.lon?.message}><input id="lon" className="input" inputMode="decimal" {...register("lon")} /></Field>
            <Field label="Geofence radius (m)" htmlFor="radius" error={errors.radius?.message} hint="0 = no geofence"><input id="radius" className="input" inputMode="numeric" {...register("radius")} /></Field>
          </div>
        </div>
        <div className={step === 1 ? "space-y-3" : "hidden"}>
          <p className="text-sm text-muted">Four stages, each released only when its photo passes the check and the surveyor signs. Shares plus mobilisation add up to 100%.</p>
          {fields.map((f, i) => (
            <div key={f.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_90px_160px]">
              <Field label={`${i + 1}. key`} htmlFor={`mk${i}`}><input id={`mk${i}`} className="input" {...register(`milestones.${i}.key`)} /></Field>
              <Field label="Title" htmlFor={`mt${i}`}><input id={`mt${i}`} className="input" {...register(`milestones.${i}.title`)} /></Field>
              <Field label="%" htmlFor={`mp${i}`}><input id={`mp${i}`} className="input" inputMode="decimal" {...register(`milestones.${i}.pct`)} /></Field>
              <Field label="Deadline" htmlFor={`md${i}`} error={errors.milestones?.[i]?.deadline?.message}><input id={`md${i}`} type="date" className="input" {...register(`milestones.${i}.deadline`)} /></Field>
            </div>
          ))}
          <Field label="Mobilisation tranche (%)" htmlFor="mob" hint="0–10%, released when a unit is allocated." error={errors.mobilisation?.message}><input id="mob" className="input" inputMode="decimal" {...register("mobilisation")} /></Field>
          <p className={clsx("mono text-sm", Math.abs(sum - 100) < 1e-9 ? "text-orange" : "text-red")}>Total {sum}% {Math.abs(sum - 100) < 1e-9 ? "✓" : "— must be 100%"}</p>
          {errors.milestones?.message ? <p className="text-sm text-red">{errors.milestones.message}</p> : null}
        </div>
        <div className={step === 2 ? "space-y-4" : "hidden"}>
          <Field label="Developer account" htmlFor="developer" error={errors.developer?.message}><input id="developer" className="input" {...register("developer")} /></Field>
          <Field label="Payout account (receives releases, must be USDC-registered)" htmlFor="payout" error={errors.payout?.message}><input id="payout" className="input" {...register("payout")} /></Field>
          <Field label="Surveyor account (holders can vote to replace)" htmlFor="surveyor" error={errors.surveyor?.message}><input id="surveyor" className="input" {...register("surveyor")} placeholder="qs-adaeze.testnet" /></Field>
        </div>
        <div className={step === 3 ? "space-y-4" : "hidden"}>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-orange" {...register("demo")} /> Demo mode (2-minute veto and grace windows, 10-minute votes)</label>
          <Field label="Units to add" htmlFor="units" error={errors.units?.message}><input id="units" className="input" inputMode="numeric" {...register("units")} /></Field>
          <p className="text-sm text-muted">Estimated NEAR needed: <span className="mono text-text">≈ {nearNeeded} NEAR</span> (estate storage ≈ 5 NEAR, {units} units × 0.03 NEAR, 5 NEAR verification budget).</p>
        </div>
        <div className={step === 4 ? "space-y-4" : "hidden"}>
          {config ? (
            <>
              <p className="text-sm">Save this as <span className="mono">config/{config.slug}.{NETWORK}.json</span>, then run:</p>
              <pre className="mono overflow-auto bg-bg p-3 text-xs">{`pnpm tsx scripts/deploy-estate.ts config/${config.slug}.${NETWORK}.json\npnpm tsx scripts/add-units.ts config/${config.slug}.${NETWORK}.json`}</pre>
              <pre className="mono max-h-96 overflow-auto bg-bg p-3 text-xs">{json}</pre>
              <Button onClick={() => navigator.clipboard?.writeText(json).catch(() => {})}><Copy className="h-4 w-4" aria-hidden /> Copy config</Button>
            </>
          ) : <p className="text-sm text-muted">Fix the highlighted fields, then review.</p>}
        </div>
      </BracketCard>
      <div className="flex justify-between gap-2">
        <Button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</Button>
        {step < 3 ? <Button variant="primary" onClick={() => setStep((s) => s + 1)}>Next</Button> : step === 3 ? <Button type="submit" variant="primary">Review</Button> : null}
      </div>
    </form>
  );
}
