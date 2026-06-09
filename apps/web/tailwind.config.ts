import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Neutral surface palette for the grid chrome.
        surface: { DEFAULT: "#ffffff", muted: "#f7f7f8", border: "#e5e5e7" },
      },
    },
  },
  plugins: [],
} satisfies Config;
