import type { Config } from "tailwindcss";

/**
 * Design tokens extracted from the original UA Field Intel design composer file.
 * Palette: deep-green agri brand, gold accent, segment colors, soft canvas.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
      },
      colors: {
        // App canvas
        canvas: "#F2F4F0",
        // Brand greens (sidebar gradient + primary)
        brand: {
          DEFAULT: "#2E7D32",
          50: "#E8F5E9",
          100: "#C8E6C9",
          150: "#A5D6A7",
          200: "#81C784",
          300: "#66BB6A",
          400: "#43A047",
          500: "#388E3C",
          600: "#2E7D32",
          700: "#1B5E20",
          900: "#1A3A1A",
          950: "#0F2810",
        },
        // Accent gold/amber
        gold: {
          DEFAULT: "#F9A825",
          dark: "#F57F17",
          50: "#FFF8E1",
          100: "#FFE082",
          200: "#FFE0B2",
          600: "#FFA000",
        },
        // Segment / status palette
        seg: {
          high: "#2E7D32",
          medium: "#1565C0",
          low: "#F57F17",
          dormant: "#9E9E9E",
        },
        info: {
          DEFAULT: "#1565C0",
          light: "#42A5F5",
          50: "#E3F2FD",
          600: "#1E88E5",
          900: "#0D47A1",
        },
        purple: {
          DEFAULT: "#7B1FA2",
          light: "#CE93D8",
          dark: "#4527A0",
          50: "#F3E5F5",
          100: "#E1BEE7",
          300: "#9575CD",
          500: "#9C27B0",
          900: "#4A148C",
        },
        orange: {
          DEFAULT: "#E65100",
          light: "#FF8F00",
          50: "#FFF3E0",
        },
        magenta: "#AD1457",
        teal: "#00695C",
        brown: {
          DEFAULT: "#6D4C41",
          light: "#8D6E63",
        },
        steel: "#78909C",
        danger: {
          DEFAULT: "#C62828",
          50: "#FFEBEE",
        },
        ink: {
          DEFAULT: "#1A1C1A",
          soft: "#5A6B5A",
          700: "#424242",
          600: "#616161",
          500: "#757575",
          muted: "#9E9E9E",
          400: "#BDBDBD",
        },
        surface: {
          50: "#FAFAFA",
          100: "#F8F8F8",
          150: "#F5F5F5",
          200: "#F0F0F0",
          300: "#EEEEEE",
          400: "#E8E8E8",
        },
        line: {
          DEFAULT: "#E0E0E0",
          warm: "#E6E8E4",
        },
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        sidebar: "2px 0 20px rgba(0,0,0,0.15)",
        modal: "0 20px 60px rgba(0,0,0,0.25)",
      },
      keyframes: {
        fadeUp: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        countUp: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        fadeUp: "fadeUp 0.4s ease both",
        countUp: "countUp 0.6s ease both",
      },
    },
  },
  plugins: [],
};

export default config;
