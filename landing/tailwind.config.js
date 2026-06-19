/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // DS v2 usa data-theme="dark" no <html>, não a classe .dark
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        head:    ["Rajdhani",     "sans-serif"],  // H1–H4, uppercase
        display: ["Orbitron",     "sans-serif"],  // Logo, selos, kicker
        price:   ["Chakra Petch", "sans-serif"],  // Preços e números de impacto
        body:    ["Manrope",      "sans-serif"],  // Corpo, labels, botões
      },
      colors: {
        // Tokens semânticos — mapeados para DS v2
        // Formato rgb(.../<alpha-value>) permite opacity modifiers: bg-background/70
        background: "rgb(var(--bg-ch) / <alpha-value>)",
        foreground: "rgb(var(--text-ch) / <alpha-value>)",
        primary: {
          DEFAULT:    "rgb(var(--brand-ch) / <alpha-value>)",
          foreground: "var(--text-on-brand)",
        },
        secondary: {
          DEFAULT:    "rgb(var(--surface2-ch) / <alpha-value>)",
          foreground: "rgb(var(--text-mid-ch) / <alpha-value>)",
        },
        muted: {
          DEFAULT:    "rgb(var(--surface2-ch) / <alpha-value>)",
          foreground: "rgb(var(--text-mid-ch) / <alpha-value>)",
        },
        accent: {
          DEFAULT:    "var(--surface-3)",
          foreground: "rgb(var(--text-ch) / <alpha-value>)",
        },
        card: {
          DEFAULT:    "rgb(var(--surface-ch) / <alpha-value>)",
          foreground: "rgb(var(--text-ch) / <alpha-value>)",
        },
        popover: {
          DEFAULT:    "rgb(var(--surface-ch) / <alpha-value>)",
          foreground: "rgb(var(--text-ch) / <alpha-value>)",
        },
        border:      "rgb(var(--border-ch) / <alpha-value>)",
        input:       "var(--surface-2)",
        ring:        "var(--brand)",
        destructive: {
          DEFAULT:    "var(--danger)",
          foreground: "#ffffff",
        },
        // Tokens de marca direta (para uso pontual)
        brand: {
          DEFAULT: "var(--brand)",
          strong:  "var(--brand-strong)",
          bright:  "var(--brand-bright)",
          soft:    "var(--brand-soft)",
          faint:   "var(--brand-faint)",
          price:   "var(--brand-price)",
        },
        surface: {
          DEFAULT: "var(--surface)",
          2:       "var(--surface-2)",
          3:       "var(--surface-3)",
          inset:   "var(--surface-inset)",
        },
        text: {
          DEFAULT: "var(--text)",
          mid:     "var(--text-mid)",
          low:     "var(--text-low)",
        },
      },
      boxShadow: {
        "glow-sm": "var(--glow-sm)",
        "glow-md": "var(--glow-md)",
        "glow-lg": "var(--glow-lg)",
        elev1:     "var(--elev-1)",
        elev2:     "var(--elev-2)",
        elev3:     "var(--elev-3)",
        elev4:     "var(--elev-4)",
        soft:      "var(--elev-3)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
