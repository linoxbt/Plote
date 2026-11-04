import { NextResponse } from "next/server";
import type { z } from "zod";

export type ApiError = { code: string; message: string };

export function jsonError(code: string, message: string, status = 400, headers?: Record<string, string>) {
  return NextResponse.json<ApiError>({ code, message }, { status, headers });
}

/** 503 with a clear message when a route's env vars are missing. */
export function notConfigured(what: string, vars: string[]) {
  return jsonError("NOT_CONFIGURED", `${what} is not configured on this deployment (missing ${vars.join(", ")}).`, 503);
}

export function ok<T>(data: T, init?: { status?: number; headers?: Record<string, string> }) {
  return NextResponse.json(data, init);
}

export async function parseJson<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, res: jsonError("E_BAD_ARGS", "Body must be JSON.") };
  }
  const r = schema.safeParse(body);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return { ok: false, res: jsonError("E_BAD_ARGS", msg) };
  }
  return { ok: true, data: r.data };
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
