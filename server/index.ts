// Servidor local: guarda la API key, emite tokens efímeros y sirve la página.
// La key nunca sale de este proceso ni se escribe en logs.
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { crearSecretoCliente, ErrorProveedor, esIdioma, type Idioma } from "./openai.js";
import { crearSesionGemini } from "./gemini.js";
import { crearSesionSoniox, listarVoces } from "./soniox.js";
import { corsExtension, exigirCodigo, LimitePorIp, limitar } from "./acceso.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const produccion = process.argv.includes("--produccion") || process.env.NODE_ENV === "production";
const puerto = Number(process.env.PORT) || 5173;
/** En local solo escucha en esta máquina; en un servidor publicado, HOST=0.0.0.0. */
const host = process.env.HOST?.trim() || "127.0.0.1";
/** Si está definido, /api/sesion exige este código (cabecera X-Codigo-Acceso). Obligatorio al publicar. */
const codigoAcceso = process.env.CODIGO_ACCESO?.trim() ?? "";

const proveedorPorDefecto = process.env.PROVIDER || "openai";
const idiomaOrigen: Idioma = esIdioma(process.env.SOURCE_LANG) ? process.env.SOURCE_LANG : "es";
const idiomaDestino: Idioma = esIdioma(process.env.TARGET_LANG) ? process.env.TARGET_LANG : "en";

/** Variable de entorno con la key de cada proveedor. Se leen en cada pedido, nunca se envían al navegador. */
const KEYS: Record<string, string> = { openai: "OPENAI_API_KEY", soniox: "SONIOX_API_KEY", gemini: "GEMINI_API_KEY" };

function apiKey(proveedor: string): string {
  return (process.env[KEYS[proveedor]] ?? "").trim();
}

const app = express();
app.disable("x-powered-by");
// Detrás del proxy de la plataforma (Railway): la IP real viene en X-Forwarded-For.
if (host !== "127.0.0.1") app.set("trust proxy", 1);
app.use(corsExtension);
app.use(express.json({ limit: "16kb" }));

app.get("/api/config", (_req, res) => {
  res.json({
    proveedor: proveedorPorDefecto,
    idiomaOrigen,
    idiomaDestino,
    keys: Object.fromEntries(Object.keys(KEYS).map((p) => [p, apiKey(p).length > 0])),
  });
});

app.post("/api/sesion", limitar(new LimitePorIp(20, 60000)), exigirCodigo(codigoAcceso), async (req, res) => {
  const proveedor: unknown = req.body?.proveedor ?? "openai";
  const destino: unknown = req.body?.idiomaDestino;
  if (typeof proveedor !== "string" || !KEYS[proveedor]) {
    res.status(400).json({ codigo: "proveedor_invalido", mensaje: "Proveedor desconocido." });
    return;
  }
  if (!esIdioma(destino)) {
    res.status(400).json({ codigo: "idioma_invalido", mensaje: "Idioma de destino no soportado (usa es o en)." });
    return;
  }
  const key = apiKey(proveedor);
  if (!key) {
    res.status(500).json({
      codigo: "sin_key",
      mensaje: `Falta la API key. Abre el archivo .env, pon tu ${KEYS[proveedor]} y reinicia el servidor.`,
    });
    return;
  }

  try {
    res.json(
      proveedor === "soniox"
        ? await crearSesionSoniox(key, destino, process.env.SONIOX_VOICE?.trim())
        : proveedor === "gemini"
          ? await crearSesionGemini(key, destino)
          : await crearSecretoCliente(key, destino),
    );
  } catch (error) {
    if (error instanceof ErrorProveedor) {
      console.warn(`[sesion:${proveedor}] ${error.codigo} (${error.estadoHttp})`);
      res.status(error.estadoHttp).json({ codigo: error.codigo, mensaje: error.message });
      return;
    }
    console.error(`[sesion:${proveedor}] error inesperado`, error instanceof Error ? error.message : error);
    res.status(500).json({ codigo: "error_servidor", mensaje: "Error inesperado en el servidor local." });
  }
});

app.get("/api/soniox/voces", async (req, res) => {
  const key = apiKey("soniox");
  const idioma = esIdioma(req.query.idioma) ? req.query.idioma : idiomaDestino;
  if (!key) {
    res.json({ voces: [], porDefecto: "" });
    return;
  }
  try {
    res.json({ voces: await listarVoces(key, idioma), porDefecto: process.env.SONIOX_VOICE?.trim() || "Adrian" });
  } catch (error) {
    const mensaje = error instanceof ErrorProveedor ? error.message : "No se pudo obtener la lista de voces.";
    res.status(502).json({ voces: [], mensaje });
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

if (host !== "127.0.0.1" && !codigoAcceso) {
  console.error("Falta CODIGO_ACCESO: sin él, cualquiera en internet podría gastar tu API key. El servidor no arranca.");
  process.exit(1);
}

app.listen(puerto, host, () => {
  console.log(host === "127.0.0.1" ? `Probador de fluidez en http://localhost:${puerto}` : `Servidor escuchando en ${host}:${puerto}`);
  const faltan = Object.entries(KEYS).filter(([p]) => !apiKey(p)).map(([, v]) => v);
  if (faltan.length) console.log(`Aviso: falta ${faltan.join(" y ")} en .env (ese proveedor no estará disponible).`);
});
