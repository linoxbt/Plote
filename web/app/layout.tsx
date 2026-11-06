import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Footer, Nav } from "@/components/nav";
import { APP_URL } from "@/lib/config";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const space = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-space", display: "swap" });
const jet = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-jet", display: "swap" });

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
  themeColor: "#0A0B0D",
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${space.variable} ${jet.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <Providers>
          <Nav />
          <div className="flex-1">{children}</div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
