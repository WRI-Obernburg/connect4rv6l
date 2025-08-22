import type { Metadata } from "next";
import { Suspense } from 'react'
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "4 Gewinnt - RV6L",
  description: "Spiele 4 Gewinnt gegen den RV6L Roboter am WRI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
       <Suspense>
           {children}
       </Suspense>
      </body>
    </html>
  );
}
