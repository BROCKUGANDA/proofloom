import type { Metadata } from "next";
import { Manrope, IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  fallback: ["Georgia", "serif"],
});

export const metadata: Metadata = {
  title: "PROOFLOOM — Verifiable software provenance",
  description:
    "Decentralized software provenance and AI-agent accountability on Gno.land. Evidence-backed releases, cryptographic attestations, and public verification.",
  keywords: ["software provenance", "SLSA", "attestations", "Gno.land", "verification", "AI agents", "supply chain"],
  authors: [{ name: "PROOFLOOM" }],
  openGraph: {
    title: "PROOFLOOM — Verifiable software provenance",
    description: "Evidence-backed releases and public verification on Gno.land.",
    siteName: "PROOFLOOM",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${manrope.variable} ${plexMono.variable} ${instrumentSerif.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
