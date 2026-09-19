import type { Metadata } from "next";
import localFont from "next/font/local";

import { APP_NAME } from "@/config/app";
import { AppHeader } from "@/components/shared/AppHeader";

import "./globals.css";

// Self-hosted (see fonts/README.md) rather than next/font/google's Inter,
// which fetches this same file live from fonts.gstatic.com on every cold
// dev/build — occasionally hitting a network timeout in this environment
// that both Turbopack and Webpack then surface as a hard build error.
const inter = localFont({
  src: "./fonts/Inter-Variable.woff2",
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Upload a video, generate captions, style them, export.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex h-full min-h-screen flex-col bg-background text-foreground">
        <AppHeader />
        <main className="flex flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
