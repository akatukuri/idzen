import type { Config } from "tailwindcss";
export default { content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"], theme: { extend: { colors: { ink: "#17221f", leaf: "#236044", paper: "#f8f8f4", coral: "#d95f4c" } } } satisfies Config;
