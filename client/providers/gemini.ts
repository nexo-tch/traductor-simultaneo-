// Adaptador de Gemini Live Translate (el modelo de traducción de Google Meet), con el SDK
// oficial @google/genai. Es un modelo de voz a voz: decide solo cuándo hablar y
// conserva la entonación de quien habla. El servidor local entrega un token efímero
// con la configuración bloqueada; el navegador manda PCM de 16 kHz y recibe voz en
// PCM de 24 kHz, que suena por la misma cola que Soniox.
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { aBase64, capturarPcm, deBase64, type CapturaPcm } from "../audio/pcm";
import { ReproductorPcm } from "../audio/reproductor";
import type { EstadoConexion, EventoProveedor, OpcionesConexion, ProveedorTraduccion } from "./tipos";

const FRECUENCIA_ENTRADA = 16000;
const FRECUENCIA_SALIDA = 24000;
const PEDAZO_MS = 100;
const MAX_REINTENTOS = 5;
/** El modelo puede mandar audio más rápido que el tiempo real, así que el umbral es más alto que con Soniox. */
const DESCARTAR_DESDE_S = 8;
/** Un hueco de voz más largo que esto cuenta como "la voz retoma" en el diagnóstico. */
const HUECO_MS = 600;

interface RespuestaSesion {
  token: string;
  modelo: string;
}

class ErrorConexion extends Error {
  constructor(
    mensaje: string,
    readonly codigo: string,
    readonly recuperable: boolean,
  ) {
    super(mensaje);
  }
}

export class ProveedorGemini implements ProveedorTraduccion {
  readonly id = "gemini";
  readonly nombre = "Google Gemini Live Translate";
  readonly capacidades = {
    glosario: false,
    vozEnVivo: true,
    notaGlosario:
      "Gemini Live Translate no acepta glosario: aquí se usa para corregir los subtítulos y medir cuántos términos traduce bien. La voz no se corrige.",
  };

  private opciones: OpcionesConexion | null = null;
  private alEvento: (evento: EventoProveedor) => void = () => {};
  private activo = false;
  private reintentos = 0;
  private temporizador: number | undefined;
  private sesion: Session | null = null;
  private captura: CapturaPcm | null = null;
  private reproductor: ReproductorPcm | null = null;
  private campos = new Set<string>();
  private ultimoAudio = 0;
  private ultimaEntrada = 0;
  private hayProvisional = false;

  async conectar(opciones: OpcionesConexion, alEvento: (evento: EventoProveedor) => void): Promise<void> {
    this.opciones = opciones;
    this.alEvento = alEvento;
    this.activo = true;
    this.reintentos = 0;
    this.reproductor = new ReproductorPcm(FRECUENCIA_SALIDA);
    await this.reproductor.reanudar();
    this.emitir({ tipo: "audio_traducido", pista: this.reproductor.flujo, t: performance.now() });
    this.emitirEstado("conectando");
    await this.abrir();
  }

  desconectar(): void {
    this.activo = false;
    window.clearTimeout(this.temporizador);
    this.cerrarConexion();
    this.reproductor?.cerrar();
    this.reproductor = null;
    this.emitirEstado("desconectado");
  }

  retrasoVoz(): number {
    return (this.reproductor?.pendiente ?? 0) * 1000;
  }

  // ---------- Conexión ----------

  private async abrir(): Promise<void> {
    if (!this.opciones) return;
    try {
      const { token, modelo } = await this.pedirSesion(this.opciones.idiomaDestino);
      if (!this.activo) return;
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });
      let listo: () => void = () => {};
      const configurada = new Promise<void>((ok) => (listo = ok));
      const sesion = await ai.live.connect({
        model: modelo,
        // La misma configuración que bloqueó el servidor en el token.
        config: {
          responseModalities: [Modality.AUDIO],
          translationConfig: { targetLanguageCode: this.opciones.idiomaDestino },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onmessage: (mensaje) => {
            if (mensaje.setupComplete) listo();
            this.procesar(mensaje);
          },
          onerror: () => {
            if (this.activo && this.sesion === sesion) this.programarReconexion("Error en la conexión con Google");
          },
          onclose: (evento) => {
            if (!this.activo || this.sesion !== sesion) return;
            this.fallo(errorDeCierre(evento));
          },
        },
      });
      this.sesion = sesion;
      // Se espera la confirmación de la configuración antes de mandar audio.
      await Promise.race([configurada, new Promise((_, falla) => setTimeout(() => falla(new Error("Google no confirmó la sesión")), 10000))]);
      if (!this.activo || this.sesion !== sesion) return;

      this.captura = await capturarPcm(this.opciones.entrada, FRECUENCIA_ENTRADA, PEDAZO_MS, (pcm) => {
        if (this.sesion !== sesion) return;
        sesion.sendRealtimeInput({
          audio: { data: aBase64(new Uint8Array(pcm.buffer)), mimeType: `audio/pcm;rate=${FRECUENCIA_ENTRADA}` },
        });
      });
      this.reintentos = 0;
      this.emitirEstado("conectado");
    } catch (error) {
      this.fallo(error);
    }
  }

  private async pedirSesion(idiomaDestino: string): Promise<RespuestaSesion> {
    let respuesta: Response;
    try {
      respuesta = await fetch("/api/sesion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedor: "gemini", idiomaDestino }),
      });
    } catch {
      throw new ErrorConexion("No hay conexión con el servidor local. ¿Sigue corriendo `npm run dev`?", "sin_servidor", true);
    }
    const cuerpo = (await respuesta.json().catch(() => ({}))) as Partial<RespuestaSesion> & { codigo?: string; mensaje?: string };
    if (!respuesta.ok || !cuerpo.token || !cuerpo.modelo) {
      const codigo = cuerpo.codigo ?? "error_sesion";
      const recuperable = !["sin_key", "key_invalida", "sin_saldo", "idioma_invalido", "proveedor_invalido"].includes(codigo);
      throw new ErrorConexion(cuerpo.mensaje ?? `El servidor local respondió ${respuesta.status}.`, codigo, recuperable);
    }
    return cuerpo as RespuestaSesion;
  }

  private cerrarConexion(): void {
    this.captura?.detener();
    this.captura = null;
    const sesion = this.sesion;
    this.sesion = null;
    try {
      sesion?.close();
    } catch {
      // Ya estaba cerrada.
    }
    this.hayProvisional = false;
  }

  private fallo(error: unknown): void {
    if (!this.activo) return;
    const e =
      error instanceof ErrorConexion
        ? error
        : new ErrorConexion(`Google: ${error instanceof Error ? error.message : String(error)}`, "conexion", true);
    if (e.recuperable && this.reintentos < MAX_REINTENTOS) {
      this.programarReconexion(e.message);
      return;
    }
    this.emitir({ tipo: "error", codigo: e.codigo, mensaje: e.message, recuperable: false, t: performance.now() });
    this.emitirEstado("error", e.message);
    this.activo = false;
    this.cerrarConexion();
  }

  private programarReconexion(motivo: string): void {
    if (!this.activo) return;
    window.clearTimeout(this.temporizador);
    this.reintentos += 1;
    if (this.reintentos > MAX_REINTENTOS) {
      this.fallo(new ErrorConexion(`${motivo}. No se pudo reconectar después de ${MAX_REINTENTOS} intentos.`, "reconexion_fallida", false));
      return;
    }
    const espera = Math.min(1000 * 2 ** (this.reintentos - 1), 8000);
    this.emitirEstado("reconectando", `${motivo}. Reintento ${this.reintentos} de ${MAX_REINTENTOS}…`);
    this.cerrarConexion();
    this.temporizador = window.setTimeout(() => void this.abrir(), espera);
  }

  // ---------- Mensajes ----------

  private procesar(mensaje: LiveServerMessage): void {
    const t = performance.now();
    this.registrarCampos(mensaje, t);

    if (mensaje.goAway) {
      // Google avisa que cerrará la conexión: se reabre antes de que se corte.
      this.emitir({ tipo: "diagnostico", nombre: "gemini_go_away", muestra: mensaje.goAway.timeLeft ?? "", t });
      this.programarReconexion("Google pidió renovar la conexión");
      return;
    }
    const contenido = mensaje.serverContent;
    if (!contenido) return;

    for (const parte of contenido.modelTurn?.parts ?? []) {
      if (parte.inlineData?.data) this.sonar(deBase64(parte.inlineData.data), t);
    }
    if (contenido.interimInputTranscription?.text !== undefined) {
      this.hayProvisional = true;
      this.emitir({ tipo: "transcripcion_provisional", texto: contenido.interimInputTranscription.text, t });
    }
    if (contenido.inputTranscription?.text) {
      this.ultimaEntrada = t;
      if (this.hayProvisional) {
        this.hayProvisional = false;
        this.emitir({ tipo: "transcripcion_provisional", texto: "", t });
      }
      this.emitir({ tipo: "transcripcion_parcial", texto: contenido.inputTranscription.text, t });
    }
    if (contenido.outputTranscription?.text) {
      this.emitir({ tipo: "traduccion_parcial", texto: contenido.outputTranscription.text, t });
    }
  }

  private sonar(bytes: Uint8Array, t: number): void {
    if (!this.reproductor) return;
    // Diagnóstico: cada vez que la voz retoma tras un hueco, cuánto había en cola y hace cuánto llegó texto del original.
    if (t - this.ultimoAudio > HUECO_MS) {
      const desdeEntrada = this.ultimaEntrada ? `${Math.round(t - this.ultimaEntrada)} ms desde el último texto del original` : "sin texto del original aún";
      this.emitir({
        tipo: "diagnostico",
        nombre: "gemini_voz_retoma",
        muestra: `hueco de ${this.ultimoAudio ? Math.round(t - this.ultimoAudio) : "—"} ms; ${desdeEntrada}; en cola: ${this.reproductor.pendiente.toFixed(1)} s`,
        t,
      });
    }
    this.ultimoAudio = t;
    this.reproductor.agregar(bytes);
    if (this.reproductor.pendiente > DESCARTAR_DESDE_S) {
      this.reproductor.vaciar();
      this.emitir({ tipo: "diagnostico", nombre: "voz_descartada", muestra: `Más de ${DESCARTAR_DESDE_S} s de voz en cola`, t });
    }
  }

  /** Anota una vez cada campo nuevo que manda Google, para revisar el protocolo con datos reales. */
  private registrarCampos(mensaje: LiveServerMessage, t: number): void {
    const claves = [
      ...Object.keys(mensaje).filter((k) => k !== "serverContent"),
      ...Object.keys(mensaje.serverContent ?? {}).map((k) => `serverContent.${k}`),
    ];
    for (const clave of claves) {
      if (this.campos.has(clave)) continue;
      this.campos.add(clave);
      const muestra = JSON.stringify(clave.startsWith("serverContent.") ? mensaje.serverContent?.[clave.slice(14) as keyof typeof mensaje.serverContent] : mensaje[clave as keyof LiveServerMessage]);
      this.emitir({ tipo: "diagnostico", nombre: `gemini_campo:${clave}`, muestra: (muestra ?? "").slice(0, 200), t });
    }
  }

  private emitirEstado(estado: EstadoConexion, detalle?: string): void {
    this.emitir({ tipo: "estado_conexion", estado, detalle, t: performance.now() });
  }

  private emitir(evento: EventoProveedor): void {
    this.alEvento(evento);
  }
}

/** Traduce el cierre del WebSocket de Google a un mensaje claro. */
function errorDeCierre(evento: CloseEvent): ErrorConexion {
  const razon = evento.reason || `código ${evento.code}`;
  if (/api key|permission|unauthenticated|auth/i.test(razon)) {
    return new ErrorConexion(`Google rechazó la conexión: ${razon}. Revisa GEMINI_API_KEY en el archivo .env.`, "key_invalida", false);
  }
  if (/quota|resource_exhausted|rate/i.test(razon)) {
    return new ErrorConexion(`Google: límite de uso alcanzado (${razon}). Espera un minuto y vuelve a intentar.`, "limite_uso", false);
  }
  if (/not found|not supported|model/i.test(razon)) {
    return new ErrorConexion(`Google no encontró el modelo o no lo tiene habilitado para tu key: ${razon}`, "sin_acceso_modelo", false);
  }
  return new ErrorConexion(`Google cerró la conexión (${razon})`, "conexion", true);
}
