// The estate config file the /dev/estates/new wizard emits. It must be exactly what scripts/deploy-estate.ts and
// scripts/add-units.ts read (`EstateConfig` in scripts/lib.ts; see config/*.testnet.json): role accounts are
// `developer` / `payout` / `surveyor` / `recovery` / `outlayer` (not the contract's `*_id` names, which the script
// fills in), deadlines are ISO dates or "+90d", and units are listed or generated with `generate_units`.

export type WizardValues = {
  name: string;
  slug: string;
  location: string;
  lat: number;
  lon: number;
  radius: number;
  mobilisation: number; // percent
  milestones: { key: string; title: string; pct: number; deadline: string /* YYYY-MM-DD */ }[];
  developer: string;
  payout: string;
  surveyor: string;
  demo: boolean;
  units: number;
  unitPrice: number; // USDC
  unitLabel: string; // e.g. "Block A · Unit {n}"
  unitPrefix: string; // e.g. "u" → u-01, u-02…
  verifierKey: string; // OutLayer version key (sha256 of the uploaded WASM)
};

export type EstateConfigFile = {
  account: string;
  name: string;
  location: string;
  developer: string;
  payout: string;
  surveyor: string;
  recovery: string;
  verdict_relayer: string | null;
  verify_mode: "outlayer";
  outlayer: string;
  verifier: { repo: string; commit: string; build_target: string };
  geofence: { lat_e6: number; lon_e6: number; radius_m: number };
  milestones: { key: string; title: string; bps: number; deadline: string }[];
  params: Record<string, string | number | boolean>;
  units: { id: string; label: string; price: string }[];
  generate_units?: { prefix: string; count: number; label: string; price: string };
  fund_verification_near: string;
};

/** Geofence limits `new` enforces outside the playground (INTERFACE §1.1). The wizard never makes a playground. */
export const GEOFENCE_MIN_M = 50;
export const GEOFENCE_MAX_M = 2000;
/** add_units deposit per unit (INTERFACE §1.2). */
export const NEAR_PER_UNIT = 0.035;
export const ESTATE_STORAGE_NEAR = 7; // deploy-estate.ts funds the estate account with 7 NEAR
export const VERIFICATION_FUND_NEAR = 5;

/** NEAR needed to deploy: estate account (7, of which ~5.7 is contract storage), the units, the verification budget. */
export function nearNeeded(units: number): number {
  return Math.round((ESTATE_STORAGE_NEAR + Math.max(0, units) * NEAR_PER_UNIT + VERIFICATION_FUND_NEAR) * 1000) / 1000;
}

function usdcBase(usd: number): string {
  return (BigInt(Math.round(usd * 100)) * 10_000n).toString();
}

export function buildEstateConfig(v: WizardValues, ctx: { network: "testnet" | "mainnet"; root: string }): EstateConfigFile {
  const mainnet = ctx.network === "mainnet";
  const root = ctx.root || (mainnet ? "plote.near" : "plote.testnet");
  const demo = mainnet ? false : v.demo; // demo timers are refused on mainnet
  const count = Math.max(0, Math.floor(v.units));
  return {
    account: v.slug,
    name: v.name,
    location: v.location,
    developer: v.developer,
    payout: v.payout,
    surveyor: v.surveyor,
    recovery: root,
    verdict_relayer: mainnet ? null : `relayer.${root}`,
    verify_mode: "outlayer",
    outlayer: mainnet ? "outlayer.near" : "outlayer.testnet",
    verifier: { repo: `project:${root}/plote-verifier`, commit: v.verifierKey.trim(), build_target: "wasm32-wasip2" },
    geofence: { lat_e6: Math.round(v.lat * 1e6), lon_e6: Math.round(v.lon * 1e6), radius_m: Math.round(v.radius) },
    milestones: v.milestones.map((m) => ({ key: m.key, title: m.title, bps: Math.round(m.pct * 100), deadline: new Date(m.deadline + "T12:00:00Z").toISOString() })),
    params: {
      reserve_ttl_ns: demo ? "1800000000000" : "86400000000000",
      min_initial_bps: 1000,
      mobilisation_bps: Math.round(v.mobilisation * 100),
      grace_ns: demo ? "120000000000" : "2592000000000000",
      veto_window_ns: demo ? "120000000000" : "259200000000000",
      default_grace_ns: demo ? "120000000000" : "1209600000000000",
      penalty_bps: 500,
      dust_threshold: "1000000",
      late_claim_ns: demo ? "600000000000" : "7200000000000",
      capture_ttl_ns: "1800000000000",
      proposal_period_ns: demo ? "600000000000" : "604800000000000",
      max_phash_distance: 8,
      max_exif_age_h: 72,
      min_ai_confidence: 70,
      demo_mode: demo,
      playground: false,
    },
    units: [],
    ...(count > 0 ? { generate_units: { prefix: v.unitPrefix, count, label: v.unitLabel.includes("{n}") ? v.unitLabel : `${v.unitLabel} {n}`, price: usdcBase(v.unitPrice) } } : {}),
    fund_verification_near: String(VERIFICATION_FUND_NEAR),
  };
}

/** Which wizard step shows each field, so Review can jump to the first one with an error. */
export const FIELD_STEP: Record<string, number> = {
  name: 0, slug: 0, location: 0, lat: 0, lon: 0, radius: 0,
  milestones: 1, mobilisation: 1,
  developer: 2, payout: 2, surveyor: 2,
  demo: 3, units: 3, unitPrice: 3, unitLabel: 3, unitPrefix: 3, verifierKey: 3,
};

/** The earliest step holding a field with an error, or null. */
export function firstErrorStep(errors: Record<string, unknown>): number | null {
  const steps = Object.keys(errors).map((k) => FIELD_STEP[k]).filter((x): x is number => typeof x === "number");
  return steps.length ? Math.min(...steps) : null;
}
