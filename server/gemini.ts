// Tokens efímeros para Gemini Live Translate (el modelo de traducción de Google Meet).
// Referencia: SDK oficial @google/genai (authTokens.create, LiveConnectConfig.translationConfig).
import { GoogleGenAI, Modality } from "@google/genai";
import { ErrorProveedor, type Idioma } from "./openai.js";

export const MODELO_GEMINI = process.env.GEMINI_TRANSLATE_MODEL?.trim() || "gemini-3.5-live-translate-preview";

export interface SesionGemini {
  token: string;
  modelo: string;
  idiomaDestino: Idioma;
}

/** Configuración de la sesión. Va dentro del token y queda bloqueada: el navegador no la puede cambiar. */
export function configGemini(idiomaDestino: Idioma) {
  return {
    responseModalities: [Modality.AUDIO],
    // Intérprete de una dirección: si alguien ya habla en el idioma de destino, el modelo calla
    // en vez de repetirlo (recomendación de la documentación oficial).
    translationConfig: { targetLanguageCode: idiomaDestino, echoTargetLanguage: false },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

export async function crearSesionGemini(apiKey: string, idiomaDestino: Idioma): Promise<SesionGemini> {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
  const ahora = Date.now();
  try {
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        // La sesión puede durar hasta 2 h; el token sirve para abrirla durante 1 minuto.
        expireTime: new Date(ahora + 2 * 60 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(ahora + 60 * 1000).toISOString(),
        liveConnectConstraints: { model: MODELO_GEMINI, config: configGemini(idiomaDestino) },
        lockAdditionalFields: [],
      },
    });
    if (!token.name) throw new ErrorProveedor("Google respondió sin un token efímero.", "respuesta_invalida", 502);
    return { token: token.name, modelo: MODELO_GEMINI, idiomaDestino };
  } catch (error) {
    if (error instanceof ErrorProveedor) throw error;
    throw traducirError(error);
  }
}

function traducirError(error: unknown): ErrorProveedor {
  const mensaje = error instanceof Error ? error.message : String(error);
  const estado = Number((error as { status?: number }).status) || Number(mensaje.match(/\b(4\d\d|5\d\d)\b/)?.[1]) || 0;
  if (estado === 400 && /api key/i.test(mensaje)) {
    return new ErrorProveedor("La API key de Google no es válida. Revisa GEMINI_API_KEY en el archivo .env y reinicia el servidor.", "key_invalida", 401);
  }
  if (estado === 401 || estado === 403) {
    return new ErrorProveedor(
      `Google rechazó la key o no tiene acceso a ${MODELO_GEMINI}. Revisa GEMINI_API_KEY y que el modelo esté habilitado en aistudio.google.com. (${mensaje.slice(0, 160)})`,
      "key_invalida",
      401,
    );
  }
  if (estado === 429) {
    return new ErrorProveedor("Se alcanzó el límite de uso de Google. Espera un minuto y vuelve a intentar.", "limite_uso", 429);
  }
  if (!estado) {
    return new ErrorProveedor(`No se pudo contactar a Google: ${mensaje.slice(0, 160)}`, "sin_red", 502);
  }
  return new ErrorProveedor(`Google respondió con error ${estado}. ${mensaje.slice(0, 200)}`, "error_proveedor", 502);
}
