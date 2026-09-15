import type { Metadata } from "next";
import { Fredoka, Nunito } from "next/font/google";
import SiteHeader from "@/components/site-header";
import "./globals.css";

const display = Fredoka({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display-family",
});

const body = Nunito({
  subsets: ["latin"],
  variable: "--font-body-family",
});

export const metadata: Metadata = {
  title: "Doodly Squat",
  description:
    "Hoard a skribbl.io word list with your friends, then export it as one comma-separated line.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh font-sans text-ink antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
