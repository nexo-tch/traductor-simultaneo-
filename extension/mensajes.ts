// Mensajes entre las tres piezas de la extensión: el servicio de fondo (inicia la
// captura de la pestaña), el documento oculto (audio y traducción) y el panel lateral.
import type { EstadoConexion, Idioma } from "../client/providers/tipos";
import type { Entrada } from "./transcripcion";

export interface Ajustes {
  /** Idioma al que se traduce (el de quien escucha). Gemini calla lo que ya está en este idioma. */
  destino: Idioma;
  vozEncendida: boolean;
  /** 0–1. */
  volumenVoz: number;
  /** 0–1: volumen de la reunión cuando no suena la traducción. */
  volumenOriginal: number;
  /** Bajar la reunión mientras suena la traducción. */
  ducking: boolean;
  vista: "ambos" | "traduccion";
}

export const AJUSTES: Ajustes = {
  destino: "es",
  vozEncendida: true,
  volumenVoz: 1,
  volumenOriginal: 1,
  ducking: true,
  vista: "ambos",
};

export async function leerAjustes(): Promise<Ajustes> {
  const { ajustes } = await chrome.storage.local.get("ajustes");
  return { ...AJUSTES, ...(ajustes as Partial<Ajustes> | undefined) };
}

export async function guardarAjustes(ajustes: Ajustes): Promise<void> {
  await chrome.storage.local.set({ ajustes });
}

/** Lo que el panel necesita mostrar. */
export interface Foto {
  activo: boolean;
  estado: EstadoConexion;
  detalle?: string;
  retrasoMs: number;
  sonando: boolean;
  /** Nivel del audio de la reunión (RMS 0–1), para ver si llega sonido. */
  nivel: number;
  /** Segundos desde que empezó la sesión. */
  duracionS: number;
  entradas: Entrada[];
  /** Líneas de diagnóstico (eventos de Google, estados, errores). En "cambios" solo las nuevas. */
  diagnostico: string[];
}

export type AlFondo = { para: "fondo"; tipo: "iniciar" } | { para: "fondo"; tipo: "detener" };

export type AlDocumento =
  | { para: "documento"; tipo: "iniciar"; streamId: string; ajustes: Ajustes }
  | { para: "documento"; tipo: "detener" }
  | { para: "documento"; tipo: "ajustes"; ajustes: Ajustes }
  | { para: "documento"; tipo: "foto" }
  | { para: "documento"; tipo: "limpiar" };

export type AlPanel =
  | { para: "panel"; tipo: "cambios"; foto: Omit<Foto, "entradas" | "diagnostico">; entradas: Entrada[]; diagnostico: string[] }
  | { para: "panel"; tipo: "aviso"; nivel: "error" | "alerta"; texto: string }
  | { para: "panel"; tipo: "ajustes"; ajustes: Ajustes };

export type Mensaje = AlFondo | AlDocumento | AlPanel;

/** Manda un mensaje sin fallar si nadie lo recibe (por ejemplo, el panel está cerrado). */
export async function enviar<R = unknown>(mensaje: Mensaje): Promise<R | undefined> {
  try {
    return (await chrome.runtime.sendMessage(mensaje)) as R;
  } catch {
    return undefined;
  }
}
