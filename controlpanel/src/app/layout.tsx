import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import {SidebarProvider, SidebarTrigger} from "@/components/ui/sidebar";
import {AppSidebar} from "@/components/AppSidebar";
import WebsocketProvider from "@/provider/WebsocketProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RV6L Controlpanel",
  description: "Controlpanel for the RV6L robot",
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
      <SidebarProvider>
          <AppSidebar />
          <main className={"w-full m-8 flex flex-col"}>
              <WebsocketProvider>
                  {children}
              </WebsocketProvider>
          </main>
      </SidebarProvider>

      </body>
    </html>
  );
}
