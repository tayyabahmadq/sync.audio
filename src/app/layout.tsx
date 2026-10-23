import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: "Sync.audio — beacon-locked silent group listening for Fire TV",
  description:
    "One room, one screen, zero sound. Sync.audio streams the TV's master audio over local Wi-Fi to unlimited phones — join with a single QR scan, no app install, and a closed-loop sync beacon keeps every earbud lip-locked to the picture automatically.",
  keywords: ["Sync.audio", "Fire TV", "Vega OS", "silent listening", "WebRTC", "WebSocket audio", "hackathon"],
  authors: [{ name: "Sync.audio" }],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/icon-64.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Sync.audio",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "Sync.audio",
    description: "The room stays silent. Every earbud screams.",
    siteName: "Sync.audio",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${jakarta.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
