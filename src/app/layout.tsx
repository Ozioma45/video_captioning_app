import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { APP_NAME } from "@/config/app";
import { AppHeader } from "@/components/shared/AppHeader";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
