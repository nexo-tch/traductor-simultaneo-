// Llaves temporales y voces de Soniox.
// Referencia: SDK oficial @soniox/node 2.4.0 (auth.createTemporaryKey, tts.listModels).
import { ErrorProveedor, type Idioma } from "./openai.js";

const API = "https://api.soniox.com";
export const MODELO_STT = "stt-rt-v5";
export const MODELO_TTS = "tts-rt-v2";
const VOZ_PREFERIDA = "Adrian";

export interface SesionSoniox {
  llaveStt: string;
  llaveTts: string;
  modeloStt: string;
  modeloTts: string;
  voz: string;
  idiomaDestino: Idioma;
}

async function pedir(apiKey: string, ruta: string, init: RequestInit = {}): Promise<unknown> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${API}${ruta}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...init.headers },
    });
  } catch {
    throw new ErrorProveedor("No se pudo contactar a Soniox. Revisa tu conexión a internet y vuelve a intentar.", "sin_red", 502);
  }
  if (!respuesta.ok) throw await traducirError(respuesta);
  return respuesta.json();
}

async function traducirError(respuesta: Response): Promise<ErrorProveedor> {
  const detalle = (await respuesta.text().catch(() => "")).slice(0, 200);
  switch (respuesta.status) {
    case 401:
      return new ErrorProveedor(
        "La API key de Soniox no es válida. Revisa SONIOX_API_KEY en el archivo .env y reinicia el servidor.",
        "key_invalida",
        401,
      );
    case 402:
      return new ErrorProveedor(
        "La cuenta de Soniox no tiene saldo. Agrega crédito en console.soniox.com y vuelve a intentar.",
        "sin_saldo",
        402,
      );
    case 429:
      return new ErrorProveedor("Se alcanzó el límite de uso de Soniox. Espera un minuto y vuelve a intentar.", "limite_uso", 429);
    default:
      return new ErrorProveedor(`Soniox respondió con error ${respuesta.status}. ${detalle}`, "error_proveedor", 502);
  }
}

async function llaveTemporal(apiKey: string, uso: "transcribe_websocket" | "tts_rt"): Promise<string> {
  const datos = (await pedir(apiKey, "/v1/auth/temporary-api-key", {
    method: "POST",
    body: JSON.stringify({ usage_type: uso, expires_in_seconds: 3600, client_reference_id: "probador-fluidez" }),
  })) as { api_key?: unknown };
  if (typeof datos.api_key !== "string") {
    throw new ErrorProveedor("Soniox respondió sin una llave temporal.", "respuesta_invalida", 502);
  }
  return datos.api_key;
}

interface ModeloTts {
  id: string;
  languages?: { code: string }[];
  voices?: { id: string; description?: string; gender?: string }[];
}

let modelosEnCache: ModeloTts[] | null = null;

async function modelos(apiKey: string): Promise<ModeloTts[]> {
  modelosEnCache ??= ((await pedir(apiKey, "/v1/tts-models")) as { models?: ModeloTts[] }).models ?? [];
  return modelosEnCache;
}

function modeloPara(lista: ModeloTts[], idioma: Idioma): ModeloTts | undefined {
  return lista.find((m) => m.id === MODELO_TTS) ?? lista.find((m) => m.languages?.some((l) => l.code === idioma));
}

export interface Voz {
  id: string;
  descripcion: string;
  genero: string;
}

/** Voces del modelo de voz, para el selector de Ajustes. */
export async function listarVoces(apiKey: string, idioma: Idioma): Promise<Voz[]> {
  const modelo = modeloPara(await modelos(apiKey), idioma);
  return (modelo?.voices ?? []).map((v) => ({ id: v.id, descripcion: v.description ?? "", genero: v.gender ?? "" }));
}

/** Elige la voz: la de SONIOX_VOICE si existe, si no "Adrian" (la del ejemplo oficial), si no la primera del modelo. */
async function elegirVoz(apiKey: string, idioma: Idioma, preferida?: string): Promise<string> {
  let voces: string[] = [];
  try {
    voces = (await listarVoces(apiKey, idioma)).map((v) => v.id);
  } catch {
    return preferida || VOZ_PREFERIDA;
  }
  if (preferida && voces.includes(preferida)) return preferida;
  if (voces.includes(VOZ_PREFERIDA)) return VOZ_PREFERIDA;
  return voces[0] ?? preferida ?? VOZ_PREFERIDA;
}

export async function crearSesionSoniox(apiKey: string, idiomaDestino: Idioma, vozPreferida?: string): Promise<SesionSoniox> {
  const [llaveStt, llaveTts, voz] = await Promise.all([
    llaveTemporal(apiKey, "transcribe_websocket"),
    llaveTemporal(apiKey, "tts_rt"),
    elegirVoz(apiKey, idiomaDestino, vozPreferida),
  ]);
  return { llaveStt, llaveTts, modeloStt: MODELO_STT, modeloTts: MODELO_TTS, voz, idiomaDestino };
}
