import type { Metadata, Viewport } from "next";
import { Suspense } from 'react'
import { Manrope } from "next/font/google";
import Image from "next/image";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["500", "700", "800"],
});

export const metadata: Metadata = {
  title: "Vier Gewinnt gegen den RV6L | Walter Reis Institut",
  description: "Spiele Vier Gewinnt gegen den RV6L Roboter am Walter Reis Institut in Obernburg",
};

export const viewport: Viewport = {
  themeColor: "#0d4453",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className={`${manrope.variable} antialiased min-h-screen flex flex-col relative`}>
        {/* petrol/cyan band, the panel below overlaps its lower edge */}
        <div aria-hidden className="absolute inset-x-0 top-0 h-[320px] bg-wri-band">
          <div className="absolute inset-0 bg-blueprint" />
        </div>

        <header className="relative z-10 mx-auto w-full max-w-xl px-4 sm:px-6 pt-6">
          <a href="https://wri-obernburg.de" target="_blank" rel="noopener noreferrer" aria-label="Walter Reis Institut" className="inline-block">
            <Image src="/wri-logo-white.svg" alt="Walter Reis Institut" width={120} height={40} priority />
          </a>
        </header>
        <main className="relative z-10 flex-1 mx-auto w-full max-w-xl px-4 sm:px-6 pb-10">
          <Suspense>
            {children}
          </Suspense>
        </main>
        <footer className="relative z-10 mx-auto w-full max-w-xl px-4 sm:px-6 py-6 text-sm text-wri-grey">
          Walter Reis Institut für Technologie, Obernburg
        </footer>
      </body>
    </html>
  );
}
