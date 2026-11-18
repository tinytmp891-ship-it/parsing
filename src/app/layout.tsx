import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Upcoming Matches · Bookmakers",
  description:
    "Upcoming prematch matches from 1xBet, Fonbet, Vbet and other bookmakers, with time and sport filters, a match checker and EN/RU and dark/light themes.",
};

// Applies the saved theme before the first paint, so the page does not flash light then dark.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('matches-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-slate-100 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
