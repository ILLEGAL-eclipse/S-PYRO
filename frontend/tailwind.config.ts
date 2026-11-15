import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        sidebar: "hsl(var(--sidebar))",
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        danger: "hsl(var(--danger))",
        violet: "hsl(var(--violet))",
        ember: "#FFF3C4",
      },
      borderRadius: { sm: "6px", DEFAULT: "8px", md: "10px", lg: "12px", xl: "14px", "2xl": "16px", "3xl": "20px" },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        "fade-up": "fade-up 0.35s ease-out both",
        flame: "flame-run 2.6s linear infinite",
        "flame-rev": "flame-run-rev 4.1s linear infinite",
        ember: "ember-pulse 1.8s ease-in-out infinite",
        flicker: "flicker 2.4s ease-in-out infinite",
      },
      boxShadow: {
        "glow-cyan": "0 0 32px rgba(217,56,30,0.22), 0 0 12px rgba(255,158,27,0.15)",
        "glow-amber": "0 0 22px rgba(255,158,27,0.25)",
      },
    },
  },
  plugins: [animate],
};
export default config;
