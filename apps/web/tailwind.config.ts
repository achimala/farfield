import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(210 20% 98%)",
        foreground: "hsl(222 25% 12%)",
        card: "hsl(0 0% 100%)",
        "card-foreground": "hsl(222 25% 12%)",
        border: "hsl(216 18% 88%)",
        muted: "hsl(214 18% 95%)",
        "muted-foreground": "hsl(215 16% 36%)",
        primary: "hsl(221 83% 53%)",
        "primary-foreground": "hsl(0 0% 100%)",
        ring: "hsl(221 83% 53%)"
      },
      borderRadius: {
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.375rem"
      },
      fontFamily: {
        sans: ["'Söhne'", "'Geist'", "'SF Pro Text'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "'SF Mono'", "monospace"]
      }
    }
  },
  plugins: []
} satisfies Config;
