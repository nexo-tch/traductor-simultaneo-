// Emisión de secretos efímeros para gpt-realtime-translate.
// Referencia: OpenAI Cookbook, "Build Live Translation Apps with gpt-realtime-translate".

export const MODELO_TRADUCCION = "gpt-realtime-translate";
export const MODELO_TRANSCRIPCION = "gpt-realtime-whisper";
const URL_CLIENT_SECRETS = "https://api.openai.com/v1/realtime/translations/client_secrets";

export const IDIOMAS = ["es", "en"] as const;
export type Idioma = (typeof IDIOMAS)[number];

export function esIdioma(valor: unknown): valor is Idioma {
  return typeof valor === "string" && (IDIOMAS as readonly string[]).includes(valor);
}

export interface SecretoCliente {
  secreto: string;
  expiraEn: number | null;
  modelo: string;
  idiomaDestino: Idioma;
}

/** Error con un mensaje pensado para mostrarse tal cual en la interfaz. */
export class ErrorProveedor extends Error {
  constructor(
    mensaje: string,
    readonly codigo: string,
    readonly estadoHttp: number,
  ) {
    super(mensaje);
    this.name = "ErrorProveedor";
  }
}

export async function crearSecretoCliente(
  apiKey: string,
  idiomaDestino: Idioma,
  fetchImpl: typeof fetch = fetch,
): Promise<SecretoCliente> {
  const cuerpo = {
    session: {
      model: MODELO_TRADUCCION,
      audio: {
        input: {
          transcription: { model: MODELO_TRANSCRIPCION },
          noise_reduction: { type: "near_field" },
        },
        output: { language: idiomaDestino },
      },
    },
  };

  let respuesta: Response;
  try {
    respuesta = await fetchImpl(URL_CLIENT_SECRETS, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorProveedor(
      "No se pudo contactar a OpenAI. Revisa tu conexión a internet y vuelve a intentar.",
      "sin_red",
      502,
    );
  }

  if (!respuesta.ok) {
    throw await traducirError(respuesta);
  }

  const datos = (await respuesta.json()) as { value?: unknown; expires_at?: unknown };
  if (typeof datos.value !== "string") {
    throw new ErrorProveedor("OpenAI respondió sin un token efímero.", "respuesta_invalida", 502);
  }
  return {
    secreto: datos.value,
    expiraEn: typeof datos.expires_at === "number" ? datos.expires_at : null,
    modelo: MODELO_TRADUCCION,
    idiomaDestino,
  };
}

async function traducirError(respuesta: Response): Promise<ErrorProveedor> {
  let codigo = "";
  let detalle = "";
  try {
    const cuerpo = (await respuesta.json()) as { error?: { code?: string; type?: string; message?: string } };
    codigo = cuerpo.error?.code ?? cuerpo.error?.type ?? "";
    detalle = cuerpo.error?.message ?? "";
  } catch {
    // Cuerpo vacío o no JSON: basta con el código HTTP.
  }

  switch (respuesta.status) {
    case 401:
      return new ErrorProveedor(
        "La API key de OpenAI no es válida. Revisa OPENAI_API_KEY en el archivo .env y reinicia el servidor.",
        "key_invalida",
        401,
      );
    case 429:
      return codigo === "insufficient_quota"
        ? new ErrorProveedor(
            "La cuenta de OpenAI no tiene saldo. Agrega crédito en platform.openai.com → Billing y vuelve a intentar.",
            "sin_saldo",
            429,
          )
        : new ErrorProveedor(
            "Se alcanzó el límite de uso de OpenAI. Espera un minuto y vuelve a intentar.",
            "limite_uso",
            429,
          );
    case 403:
    case 404:
      return new ErrorProveedor(
        `Tu cuenta de OpenAI no tiene acceso a ${MODELO_TRADUCCION}. Revisa el proyecto y los permisos de la key en platform.openai.com.${detalle ? ` (${detalle})` : ""}`,
        "sin_acceso_modelo",
        respuesta.status,
      );
    default:
      return new ErrorProveedor(
        `OpenAI respondió con error ${respuesta.status}.${detalle ? ` ${detalle}` : ""}`,
        codigo || "error_proveedor",
        502,
      );
  }
}
