import type { Config } from "tailwindcss";

// Colors map to the CSS tokens in src/index.css, which switch with the
// system light/dark appearance.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: token("page"),
        surface: token("surface"),
        fill: token("fill"),
        label: token("label"),
        secondary: token("secondary"),
        tertiary: token("tertiary"),
        separator: token("separator"),
        cleared: token("cleared"),
        risk: token("risk"),
        high: token("high"),
        medium: token("medium"),
        focus: token("focus"),
      },
    },
  },
  plugins: [],
} satisfies Config;
