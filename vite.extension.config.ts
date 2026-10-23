// Construye la extensión de Chrome en dist/extension (cargar en chrome://extensions → "Cargar descomprimida").
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "extension",
  base: "./",
  build: {
    outDir: "../dist/extension",
    emptyOutDir: true,
    // Sin el polyfill de modulepreload: inyecta código en línea, que la política de seguridad de las extensiones bloquea.
    modulePreload: false,
    // El worklet de captura tiene que ser un archivo: la política de seguridad no deja cargarlo como data: URL.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        panel: resolve("extension/panel.html"),
        offscreen: resolve("extension/offscreen.html"),
        background: resolve("extension/background.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
