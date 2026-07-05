import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ensureRealtimeServer } from "@/lib/gta-realtime-server";

// Start the in-process GTA realtime relay (port 3003) when this server
// component module first evaluates. Idempotent — safe under HMR/re-eval.
// This lets the *already-running* dev server pick up the relay via HMR
// without a full restart.
ensureRealtimeServer();

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lilac — just us two",
  description: "A private, bubbly little chat space for two.",
  keywords: ["chat", "private", "lilac", "couples"],
  authors: [{ name: "you" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "Lilac — just us two",
    description: "A private, bubbly little chat space for two.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#1c1730",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

// Force night mode permanently — set the dark class before paint to avoid flash.
const forceDark = `
(function(){try{document.documentElement.classList.add('dark');}catch(e){}})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: forceDark }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <SonnerToaster position="top-center" richColors />
      </body>
    </html>
  );
}
