import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Footer, Nav } from "@/components/nav";
import { APP_URL } from "@/lib/config";
import { MOTION_BOOT, MotionRoot } from "@/components/motion";

// Self-hosted at build time by next/font (no runtime font CDN): Geist for display + body, Geist Mono for labels and numbers.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: "Plote — Pay for the house you can see", template: "%s · Plote" },
  description:
    "Plote holds your off-plan deposit in its own on-chain account and releases it to the developer only when each construction stage is proven. Check any unit in seconds.",
  applicationName: "Plote",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/mark.svg", type: "image/svg+xml" }], apple: "/apple-touch-icon.png" },
  openGraph: {
    title: "Plote — Pay for the house you can see",
    description: "Every off-plan home gets its own on-chain account. Money moves only on proof.",
    images: [{ url: "/og-default.png", width: 1200, height: 630, alt: "Plote — Pay for the house you can see" }],
    siteName: "Plote",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#f2f4f7",
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <Providers>
          <MotionRoot />
          <Nav />
          <div className="flex-1">{children}</div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
