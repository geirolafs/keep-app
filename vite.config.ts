import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;
const isBrowser = process.env.VITE_BROWSER === "true";

const aliases: Record<string, string> = {
  "@": path.resolve(__dirname, "./src"),
};

if (isBrowser) {
  aliases["@tauri-apps/plugin-sql"] = path.resolve(__dirname, "./src/mocks/tauri-sql.ts");
  aliases["@tauri-apps/api/core"] = path.resolve(__dirname, "./src/mocks/tauri-core.ts");
  aliases["@tauri-apps/plugin-dialog"] = path.resolve(__dirname, "./src/mocks/tauri-dialog.ts");
  aliases["@tauri-apps/api/webviewWindow"] = path.resolve(__dirname, "./src/mocks/tauri-webview.ts");
}

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: aliases,
  },

  clearScreen: false,
  server: {
    port: isBrowser ? 1421 : 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
