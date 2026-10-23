// Servidor local: guarda la API key, emite tokens efímeros y sirve la página.
// La key nunca sale de este proceso ni se escribe en logs.
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { crearSecretoCliente, ErrorProveedor, esIdioma, type Idioma } from "./openai.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const produccion = process.argv.includes("--produccion") || process.env.NODE_ENV === "production";
const puerto = Number(process.env.PORT) || 5173;

const proveedor = process.env.PROVIDER || "openai";
const idiomaOrigen: Idioma = esIdioma(process.env.SOURCE_LANG) ? process.env.SOURCE_LANG : "es";
const idiomaDestino: Idioma = esIdioma(process.env.TARGET_LANG) ? process.env.TARGET_LANG : "en";

function apiKey(): string {
  return (process.env.OPENAI_API_KEY ?? "").trim();
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.get("/api/config", (_req, res) => {
  res.json({
    proveedor,
    idiomaOrigen,
    idiomaDestino,
    apiKeyConfigurada: apiKey().length > 0,
  });
});

app.post("/api/sesion", async (req, res) => {
  const destino: unknown = req.body?.idiomaDestino;
  if (!esIdioma(destino)) {
    res.status(400).json({ codigo: "idioma_invalido", mensaje: "Idioma de destino no soportado (usa es o en)." });
    return;
  }
  if (!apiKey()) {
    res.status(500).json({
      codigo: "sin_key",
      mensaje: "Falta la API key. Copia .env.example a .env, pon tu OPENAI_API_KEY y reinicia el servidor.",
    });
    return;
  }

  try {
    res.json(await crearSecretoCliente(apiKey(), destino));
  } catch (error) {
    if (error instanceof ErrorProveedor) {
      console.warn(`[sesion] ${error.codigo} (${error.estadoHttp})`);
      res.status(error.estadoHttp).json({ codigo: error.codigo, mensaje: error.message });
      return;
    }
    console.error("[sesion] error inesperado", error instanceof Error ? error.message : error);
    res.status(500).json({ codigo: "error_servidor", mensaje: "Error inesperado en el servidor local." });
  }
});

if (produccion) {
  const dist = path.join(raiz, "dist", "client");
  app.use(express.static(dist));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: path.join(raiz, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(puerto, "127.0.0.1", () => {
  console.log(`Probador de fluidez en http://localhost:${puerto}`);
  if (!apiKey()) {
    console.log("Aviso: falta OPENAI_API_KEY en .env. La página lo mostrará hasta que la configures.");
  }
});
