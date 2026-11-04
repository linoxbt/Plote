// Server-side 1Click client. The JWT never leaves the server.

import { serverEnv } from "./env";

export async function oneclickFetch(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const jwt = serverEnv.oneclickJwt();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${serverEnv.oneclickBaseUrl()}/v0${path}`, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
}
