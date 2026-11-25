import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import config from "./src/app-config.json" with { type: "json" };

export default defineConfig(({mode}) => ({
  base: config.basePath,
  resolve: mode==="native" ? {alias:[{find:"./browser-db.js",replacement:fileURLToPath(new URL("./src/tauri-db.js",import.meta.url))}]} : {},
  build: { manifest: true, target: "es2022" },
  worker: { format: "es" },
  server: { strictPort: true, port: 5173 }
}));
