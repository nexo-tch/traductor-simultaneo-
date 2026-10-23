// Interfaz común de proveedores (SPEC.md, sección 7). El resto de la app solo
// conoce estos tipos; cada proveedor traduce sus eventos a ellos.
import type { TerminoGlosario } from "../glosario/glosario";

export type Idioma = "es" | "en";

export type EstadoConexion = "desconectado" | "conectando" | "conectado" | "reconectando" | "error";

/**
 * Eventos de salida. Todos llevan `t` (performance.now() al recibirlos).
 * En los eventos parciales `texto` es incremental: se agrega a lo anterior.
 * `idFragmento` es opcional porque no todos los proveedores segmentan; cuando
 * falta, el registro de la sesión arma los fragmentos (ver metrics/registro.ts).
 */
export type EventoProveedor =
  | { tipo: "transcripcion_parcial"; texto: string; t: number; idFragmento?: string }
  | { tipo: "transcripcion_final"; texto: string; t: number; idFragmento: string }
  | { tipo: "traduccion_parcial"; texto: string; t: number; idFragmento?: string }
  | { tipo: "traduccion_final"; texto: string; t: number; idFragmento: string }
  /**
   * Cola de texto aún sin confirmar (el proveedor puede corregirla). Reemplaza
   * a la anterior; vacío = no hay nada pendiente. Se muestra en gris.
   */
  | { tipo: "transcripcion_provisional"; texto: string; t: number }
  | { tipo: "traduccion_provisional"; texto: string; t: number }
  | { tipo: "audio_traducido"; pista: MediaStream; t: number }
  | { tipo: "estado_conexion"; estado: EstadoConexion; detalle?: string; t: number }
  | { tipo: "error"; codigo: string; mensaje: string; recuperable: boolean; t: number }
  /** Evento del proveedor que la app no usa: se guarda para diagnóstico (primera aparición de cada tipo). */
  | { tipo: "diagnostico"; nombre: string; muestra: string; t: number };

/** Ajustes de la voz traducida para proveedores que la generan aparte (Soniox). */
export interface AjustesVoz {
  /** Velocidad base, de 0.7 a 1.3. */
  velocidad: number;
  /** Acorta los silencios entre palabras. */
  reducirSilencios: boolean;
  /** Voz del proveedor; vacío = la que elija el servidor. */
  voz: string;
  /** "palabra": cada tanda confirmada va a la voz al instante. "frase": una tanda de 1–2 palabras espera hasta 0.6 s para juntarse con la siguiente. */
  envio: "palabra" | "frase";
  /**
   * Cuándo cierra frases Soniox. "largas": solo en pausas largas (más natural).
   * "pausas": en cada pausa. "rapido": en cada pausa, lo antes posible. Las dos
   * últimas confirman antes pero ponen puntos en medio de las ideas.
   */
  cortes: "largas" | "pausas" | "rapido";
  /** Un punto que llega mientras la persona sigue hablando se lee como coma. */
  suavizarPuntos: boolean;
}

export const AJUSTES_VOZ: AjustesVoz = {
  velocidad: 1.05,
  reducirSilencios: true,
  voz: "",
  envio: "frase",
  cortes: "largas",
  suavizarPuntos: true,
};

export interface OpcionesConexion {
  entrada: MediaStream;
  idiomaOrigen: Idioma;
  idiomaDestino: Idioma;
  glosario: TerminoGlosario[];
  ajustesVoz: AjustesVoz;
}

export interface CapacidadesProveedor {
  /** El proveedor acepta el glosario como instrucción. */
  glosario: boolean;
  /** La voz llega como pista en vivo (sin cola controlable: no se puede acelerar). */
  vozEnVivo: boolean;
  /** Texto que explica en la interfaz qué hace el glosario con este proveedor. */
  notaGlosario: string;
}

export interface ProveedorTraduccion {
  readonly id: string;
  readonly nombre: string;
  readonly capacidades: CapacidadesProveedor;
  conectar(opciones: OpcionesConexion, alEvento: (evento: EventoProveedor) => void): Promise<void>;
  desconectar(): void;
  /** Cambia los ajustes de voz en vivo (aplican desde la siguiente frase). Solo si el proveedor genera la voz aparte. */
  ajustarVoz?(ajustes: AjustesVoz): void;
  /**
   * Milisegundos de voz traducida esperando a sonar. Si el proveedor lo sabe (tiene
   * su propia cola), es el retraso real; si no, la app lo estima con el registro.
   */
  retrasoVoz?(): number;
}
