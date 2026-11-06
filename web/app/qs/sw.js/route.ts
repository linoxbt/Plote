// GET /qs/sw.js — the surveyor app's service worker (SPEC §13.7: installable PWA that opens offline).
// Served from an app route (web/public belongs to the shell). Scope is /qs only (Service-Worker-Allowed: /qs).
// Strategy, deliberately small:
//   - only same-origin GETs are touched; POSTs, uploads, RPC, Supabase and map tiles go straight to the network
//   - /api/*            network-first, never cached; offline → a JSON 503 the pages already render as an error
//   - /_next/static/*   cache-first (content-hashed, immutable)
//   - /qs navigations   network-first, cached copy when offline (falls back to the cached /qs shell)
//   - icons/manifest    stale-while-revalidate; everything else (incl. RSC fetches) goes to the network untouched
// When a page is cached, the /_next/static assets it references are cached too, so the capture page boots offline.

export const dynamic = "force-static";

const VERSION = "plote-qs-v1";

const SW = `
const VERSION = ${JSON.stringify(VERSION)};
const SHELL = ["/qs", "/qs/setup", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];
const STATIC_RE = /\\/_next\\/static\\/[^"'\\\\\\s)]+/g;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => cachePage(c, u).catch(() => undefined)))).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("plote-qs-") && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Pages post {type:"warm", urls:[…]} with the capture pages and the assets they've loaded.
self.addEventListener("message", (event) => {
  const d = event.data;
  if (!d || d.type !== "warm" || !Array.isArray(d.urls)) return;
  event.waitUntil(
    caches.open(VERSION).then((c) =>
      Promise.all(
        d.urls.slice(0, 200).map((u) => {
          let url;
          try { url = new URL(u, self.location.origin); } catch { return undefined; }
          if (url.origin !== self.location.origin) return undefined;
          if (url.pathname.startsWith("/_next/static/")) return c.match(url.href).then((hit) => hit || fetch(url.href).then((r) => (r.ok ? c.put(url.href, r) : undefined))).catch(() => undefined);
          if (url.pathname === "/qs" || url.pathname.startsWith("/qs/")) return cachePage(c, url.pathname).catch(() => undefined);
          return undefined;
        }),
      ),
    ),
  );
});

async function cachePage(cache, path) {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) return;
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/html")) {
    const html = await res.clone().text();
    const assets = Array.from(new Set(html.match(STATIC_RE) || []));
    await Promise.all(assets.map((a) => cache.match(a).then((hit) => hit || fetch(a).then((r) => (r.ok ? cache.put(a, r) : undefined))).catch(() => undefined)));
  }
  await cache.put(path, res);
}

function offlineJson() {
  return new Response(JSON.stringify({ code: "OFFLINE", message: "You're offline. This needs a connection." }), { status: 503, headers: { "content-type": "application/json" } });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never touch POSTs (uploads, relay, quotes)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // RPC, Supabase, OSM tiles: network as usual

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req).catch(offlineJson));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(VERSION).then((c) => c.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }))),
    );
    return;
  }

  const isQs = url.pathname === "/qs" || url.pathname.startsWith("/qs/");
  // Client-side RSC fetches pass through: offline they fail, Next falls back to a full navigation, served below.
  if (req.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok && isQs) caches.open(VERSION).then((c) => c.put(url.pathname, r.clone()));
          return r;
        })
        .catch(() => caches.open(VERSION).then((c) => c.match(url.pathname).then((hit) => hit || c.match("/qs")).then((hit) => hit || Response.error()))),
    );
    return;
  }

  if (/\\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(VERSION).then((c) =>
        c.match(req).then((hit) => {
          const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit || Response.error());
          return hit || net;
        }),
      ),
    );
  }
});
`;

export function GET() {
  return new Response(SW, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "service-worker-allowed": "/qs",
      "cache-control": "no-cache",
    },
  });
}
