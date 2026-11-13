"use client";

import { useState } from "react";
import { useFieldArray, useForm, useWatch, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { clsx } from "clsx";
import { Copy } from "lucide-react";
import { PickMap } from "@/components/pick-map";
import { SatelliteMap } from "@/components/satellite-map";
import { isValidLatLon } from "@/lib/satellite";
import { useWallet } from "@/components/wallet";
import { BracketCard, Button, Field } from "@/components/ui";
import { IS_MAINNET, NETWORK, ROOT_ACCOUNT } from "@/lib/config";
import { buildEstateConfig, firstErrorStep, GEOFENCE_MAX_M, GEOFENCE_MIN_M, NEAR_PER_UNIT, nearNeeded, VERIFICATION_FUND_NEAR, ESTATE_STORAGE_NEAR } from "@/lib/estate-config";
import { isValidAccountId } from "@/lib/estates";

const acct = z.string().refine((v) => isValidAccountId(v), "Not a valid NEAR account");
const schema = z
  .object({
    name: z.string().min(3).max(60),
    slug: z.string().regex(/^[a-z0-9-]{3,32}$/, "lowercase letters, digits and dashes"),
    location: z.string().min(2).max(80),
    lat: z.coerce.number().min(-90).max(90),
    lon: z.coerce.number().min(-180).max(180),
    // `new` refuses a radius outside 50..2000 m outside the playground; the wizard never creates a playground.
    radius: z.coerce.number().int().min(GEOFENCE_MIN_M, `At least ${GEOFENCE_MIN_M} m`).max(GEOFENCE_MAX_M, `At most ${GEOFENCE_MAX_M} m`),
    mobilisation: z.coerce.number().min(0).max(10),
    // SPEC M5 / §13.6: exactly 4 milestones (default 20/30/30/20).
    milestones: z.array(z.object({ key: z.string().min(2), title: z.string().min(2), pct: z.coerce.number().min(1).max(100), deadline: z.string().min(1, "pick a date") })).length(4, "An estate has exactly 4 milestones"),
    payout: acct,
    surveyor: acct,
    developer: acct,
    demo: z.boolean(),
    units: z.coerce.number().int().min(0).max(200),
    unitPrice: z.coerce.number().positive("Price must be above 0").max(100_000_000),
    unitLabel: z.string().min(1).max(36),
    unitPrefix: z.string().regex(/^[a-z0-9]{1,8}$/, "1–8 lowercase letters or digits"),
    verifierKey: z.string().max(128),
  })
  .superRefine((v, ctx) => {
    const sum = v.milestones.reduce((n, m) => n + m.pct, 0) + v.mobilisation;
    if (Math.abs(sum - 100) > 1e-9) ctx.addIssue({ code: "custom", path: ["milestones"], message: `Shares plus mobilisation must add up to 100% (now ${sum}%).` });
    const ds = v.milestones.map((m) => Date.parse(m.deadline));
    for (let i = 1; i < ds.length; i++) if (!(ds[i] > ds[i - 1])) ctx.addIssue({ code: "custom", path: ["milestones", i, "deadline"], message: "Deadlines must increase" });
    if (IS_MAINNET && v.demo) ctx.addIssue({ code: "custom", path: ["demo"], message: "Demo mode is refused on mainnet." });
  });

type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

const STEPS = ["Details", "Milestones", "Roles", "Params", "Review"];
export function NewEstateWizard() {
  const { accountId } = useWallet();
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<Out | null>(null);
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const y = new Date().getUTCFullYear() + 1;
  const { register, control, handleSubmit, setValue, formState: { errors } } = useForm<In, unknown, Out>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "", slug: "", location: "", lat: 6.447, lon: 3.474, radius: 300, mobilisation: 0,
      milestones: [
        { key: "foundation", title: "Foundation", pct: 20, deadline: `${y}-02-01` },
        { key: "roofing", title: "Roofing", pct: 30, deadline: `${y}-05-03` },
        { key: "finishing", title: "Finishing", pct: 30, deadline: `${y}-08-02` },
        { key: "handover", title: "Handover", pct: 20, deadline: `${y}-11-01` },
      ],
      payout: accountId ?? "", surveyor: "", developer: accountId ?? "", demo: !IS_MAINNET, units: 6,
      unitPrice: 60000, unitLabel: "Unit {n}", unitPrefix: "u", verifierKey: "",
    },
  });
  const { fields } = useFieldArray({ control, name: "milestones" });
  const w = useWatch({ control });
  const slug = w.slug ?? "";
  const mob = Number(w.mobilisation || 0);
  const sum = (w.milestones ?? []).reduce((n, m) => n + Number(m?.pct || 0), 0) + mob;
  const units = Number(w.units || 0);
  const lat = Number(w.lat);
  const lon = Number(w.lon);
  const radius = Number(w.radius || 0);
  const preview = `${slug || "your-estate"}.${ROOT_ACCOUNT || `plote.${NETWORK}`}`;
  const file = `config/${config?.slug ?? slug}.${NETWORK}.json`;

  const json = config ? JSON.stringify(buildEstateConfig(config, { network: NETWORK, root: ROOT_ACCOUNT }), null, 2) : "";

  const onInvalid = (errs: FieldErrors<In>) => {
    const s = firstErrorStep(errs as Record<string, unknown>);
    setConfig(null);
    setReviewErr(`Fix the highlighted field${Object.keys(errs).length > 1 ? "s" : ""} on “${STEPS[s ?? 0]}” first.`);
    setStep(s ?? 0);
  };

  return (
    <form onSubmit={handleSubmit((v) => { setConfig(v); setReviewErr(null); setStep(4); }, onInvalid)} className="space-y-6" noValidate>
      <ol className="flex gap-1 overflow-x-auto" aria-label="Steps">
        {STEPS.map((t, i) => (
          <li key={t}><button type="button" onClick={() => setStep(i === 4 && !config ? step : i)} className={clsx("mono min-h-11 border-b-2 px-3 text-sm", i === step ? "border-orange text-orange-ink" : "border-line text-muted")} aria-current={i === step ? "step" : undefined}>{i + 1}. {t}</button></li>
        ))}
      </ol>
      {reviewErr ? <p className="text-sm text-red" role="alert">{reviewErr}</p> : null}
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
          <div className="space-y-2">
            <p className="label">Satellite preview</p>
            {isValidLatLon([lat, lon]) ? (
              <SatelliteMap center={[lat, lon]} radiusM={radius >= 1 ? radius : 0} centerLabel="Chosen site" aspect="16 / 10" caption="Check the circle covers the plot you're building on: surveyors' photos must be taken inside it." />
            ) : <p className="text-sm text-muted">Pick a point to see it from above.</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Latitude" htmlFor="lat" error={errors.lat?.message}><input id="lat" className="input" inputMode="decimal" {...register("lat")} /></Field>
            <Field label="Longitude" htmlFor="lon" error={errors.lon?.message}><input id="lon" className="input" inputMode="decimal" {...register("lon")} /></Field>
            <Field label="Geofence radius (m)" htmlFor="radius" error={errors.radius?.message} hint={`${GEOFENCE_MIN_M}–${GEOFENCE_MAX_M} m (only the Playground has none)`}><input id="radius" className="input" inputMode="numeric" {...register("radius")} /></Field>
          </div>
        </div>
        <div className={step === 1 ? "space-y-3" : "hidden"}>
          <p className="text-sm text-muted">Four stages, each released only when its photo passes the check and the surveyor signs. Stages are proven in order. Shares plus mobilisation add up to 100%.</p>
          {fields.map((f, i) => (
            <div key={f.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_90px_160px]">
              <Field label={`${i + 1}. key`} htmlFor={`mk${i}`} error={errors.milestones?.[i]?.key?.message}><input id={`mk${i}`} className="input" {...register(`milestones.${i}.key`)} /></Field>
              <Field label="Title" htmlFor={`mt${i}`} error={errors.milestones?.[i]?.title?.message}><input id={`mt${i}`} className="input" {...register(`milestones.${i}.title`)} /></Field>
              <Field label="%" htmlFor={`mp${i}`} error={errors.milestones?.[i]?.pct?.message}><input id={`mp${i}`} className="input" inputMode="decimal" {...register(`milestones.${i}.pct`)} /></Field>
              <Field label="Deadline" htmlFor={`md${i}`} error={errors.milestones?.[i]?.deadline?.message}><input id={`md${i}`} type="date" className="input" {...register(`milestones.${i}.deadline`)} /></Field>
            </div>
          ))}
          <Field label="Mobilisation tranche (%)" htmlFor="mob" hint="0–10%, released when a unit is allocated." error={errors.mobilisation?.message}><input id="mob" className="input" inputMode="decimal" {...register("mobilisation")} /></Field>
          <p className={clsx("mono text-sm", Math.abs(sum - 100) < 1e-9 ? "text-orange-ink" : "text-red")}>Total {sum}% {Math.abs(sum - 100) < 1e-9 ? "✓" : "— must be 100%"}</p>
          {errors.milestones?.message || errors.milestones?.root?.message ? <p className="text-sm text-red">{errors.milestones?.message ?? errors.milestones?.root?.message}</p> : null}
        </div>
        <div className={step === 2 ? "space-y-4" : "hidden"}>
          <Field label="Developer account" htmlFor="developer" error={errors.developer?.message}><input id="developer" className="input" {...register("developer")} /></Field>
          <Field label="Payout account (receives releases, must be USDC-registered)" htmlFor="payout" error={errors.payout?.message}><input id="payout" className="input" {...register("payout")} /></Field>
          <Field label="Surveyor account (holders can vote to replace)" htmlFor="surveyor" error={errors.surveyor?.message}><input id="surveyor" className="input" {...register("surveyor")} placeholder={`qs-adaeze.${NETWORK === "mainnet" ? "near" : "testnet"}`} /></Field>
        </div>
        <div className={step === 3 ? "space-y-4" : "hidden"}>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-orange" disabled={IS_MAINNET} {...register("demo")} /> Demo mode (2-minute veto and grace windows, 10-minute votes){IS_MAINNET ? " — not allowed on mainnet" : ""}</label>
          {errors.demo?.message ? <p className="text-sm text-red">{errors.demo.message}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Units to add" htmlFor="units" error={errors.units?.message} hint="add-units.ts creates them after deploy (ids prefix-01, prefix-02…)."><input id="units" className="input" inputMode="numeric" {...register("units")} /></Field>
            <Field label="Price per unit (USDC)" htmlFor="unitPrice" error={errors.unitPrice?.message}><input id="unitPrice" className="input" inputMode="decimal" {...register("unitPrice")} /></Field>
            <Field label="Unit id prefix" htmlFor="unitPrefix" error={errors.unitPrefix?.message}><input id="unitPrefix" className="input" {...register("unitPrefix")} /></Field>
            <Field label="Unit label ({n} = number)" htmlFor="unitLabel" error={errors.unitLabel?.message}><input id="unitLabel" className="input" {...register("unitLabel")} /></Field>
          </div>
          <Field label="Verifier version key (OutLayer, sha256 of the uploaded WASM)" htmlFor="verifierKey" error={errors.verifierKey?.message} hint="deploy-estate.ts refuses an empty key unless run with --allow-unpinned. Copy it from app.outlayer.ai → project → Versions."><input id="verifierKey" className="input mono" {...register("verifierKey")} /></Field>
          <p className="text-sm text-muted">Estimated NEAR needed: <span className="mono text-text">≈ {nearNeeded(units).toFixed(2)} NEAR</span> (estate account {ESTATE_STORAGE_NEAR} NEAR incl. ≈ 5.7 NEAR contract storage, {units} units × {NEAR_PER_UNIT} NEAR, {VERIFICATION_FUND_NEAR} NEAR verification budget).</p>
        </div>
        <div className={step === 4 ? "space-y-4" : "hidden"}>
          {config ? (
            <>
              <p className="text-sm">Save this as <span className="mono">{file}</span>, then run:</p>
              <pre className="mono overflow-auto bg-bg p-3 text-xs">{`pnpm tsx scripts/deploy-estate.ts ${file}\npnpm tsx scripts/add-units.ts ${file}`}</pre>
              {!config.verifierKey.trim() ? <p className="text-sm text-amber">The verifier version key is empty: deploy-estate.ts will refuse this config until you fill <span className="mono">verifier.commit</span> (or pass --allow-unpinned for a throwaway estate).</p> : null}
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
