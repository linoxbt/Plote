"use client";

// Registers the surveyor app's service worker (app/qs/sw.js/route.ts) on /qs pages only, then asks it to cache the
// capture / sign pages and every static asset this page has loaded, so the app opens offline (SPEC §13.7).

import { useEffect } from "react";
import { ESTATES } from "@/lib/config";
import { estateSlug } from "@/lib/estates";

export function QsServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .register("/qs/sw.js", { scope: "/qs" })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        if (cancelled || !reg.active) return;
        const assets = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((u) => u.startsWith(location.origin + "/_next/static/"));
        const pages = ["/qs", "/qs/setup", location.pathname, ...ESTATES.flatMap((e) => [`/qs/${estateSlug(e)}/capture`, `/qs/${estateSlug(e)}/sign`])];
        reg.active.postMessage({ type: "warm", urls: Array.from(new Set([...pages, ...assets])) });
      })
      .catch(() => {
        /* no offline support in this browser; the app still works online */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
