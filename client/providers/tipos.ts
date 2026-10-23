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
  | { tipo: "audio_traducido"; pista: MediaStream; t: number }
  | { tipo: "estado_conexion"; estado: EstadoConexion; detalle?: string; t: number }
  | { tipo: "error"; codigo: string; mensaje: string; recuperable: boolean; t: number };

export interface OpcionesConexion {
  entrada: MediaStream;
  idiomaOrigen: Idioma;
  idiomaDestino: Idioma;
  glosario: TerminoGlosario[];
}

export interface CapacidadesProveedor {
  /** El proveedor acepta el glosario como instrucción. */
  glosario: boolean;
  /** La voz llega como pista en vivo (sin cola controlable: no se puede acelerar). */
  vozEnVivo: boolean;
}

export interface ProveedorTraduccion {
  readonly id: string;
  readonly nombre: string;
  readonly capacidades: CapacidadesProveedor;
  conectar(opciones: OpcionesConexion, alEvento: (evento: EventoProveedor) => void): Promise<void>;
  desconectar(): void;
}
