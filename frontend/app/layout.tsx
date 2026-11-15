import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Fraunces } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { AppShell } from "@/components/shell";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "S-PYRO — NASA Combustion Science Research Intelligence", template: "%s · S-PYRO" },
  description: "Explore, retrieve, compare and understand NASA combustion science investigations. S-PYRO assists researchers; researchers make the decisions.",
};
export const viewport: Viewport = { themeColor: "#050406", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${display.variable} ${mono.variable}`}>
      <body className="font-sans">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
