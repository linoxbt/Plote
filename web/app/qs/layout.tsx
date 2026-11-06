import type { ReactNode } from "react";
import { QsServiceWorker } from "@/components/qs-service-worker";

/** Surveyor app (/qs/*): same chrome as the rest of the site, plus the offline service worker (SPEC §13.7). */
export default function QsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <QsServiceWorker />
    </>
  );
}
