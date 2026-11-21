import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Upcoming Matches · Bookmakers",
  description:
    "Upcoming prematch matches from 1xBet, Fonbet, Betcity, Marathonbet, Unibet, BC.Game, NetBet, OddsPortal and other bookmakers, with time and sport filters, match checker and EN/RU and dark/light themes.",
};

// Applies saved theme & UI appearance attributes before first paint to prevent flicker.
const BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem('matches-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){d.classList.add('dark');}var p=JSON.parse(localStorage.getItem('matches-ui-prefs')||'null');if(p&&typeof p==='object'){if(p.accent)d.dataset.accent=p.accent;if(p.radius)d.dataset.radius=p.radius;if(p.density)d.dataset.density=p.density;if(p.surface)d.dataset.surface=p.surface;d.dataset.motion=p.motionEnabled===false?'off':'on';d.dataset.ambient=p.ambientBackdrop===false?'off':'on';}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-slate-100 font-sans text-slate-900 antialiased">{children}</body>
    </html>
  );
}
