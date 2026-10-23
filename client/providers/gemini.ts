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
/** Audio que se guarda mientras Google abre la sesión, para no perder el comienzo (máximo 10 s). */
const MAX_PEDAZOS_EN_ESPERA = 100;
/**
 * Si Google (o la subida) se atrasa más que esto, se abre una sesión nueva y se
 * descarta lo pendiente: en una reunión es mejor saltar unos segundos que quedar
 * cada vez más atrás.
 */
const PONERSE_AL_DIA_MS = 6000;
/** Tras ponerse al día, no se vuelve a medir el atraso durante este tiempo. */
const PAUSA_TRAS_SALTO_MS = 10000;
/**
 * Con "avisar en cada pausa": tras este silencio se manda audioStreamEnd para que Google
 * traduzca lo pendiente sin esperar más audio. El audio (silencio) se sigue mandando:
 * cuando se dejaba de mandar, Google a veces no entregaba las últimas palabras.
 */
const FIN_TRAS_SILENCIO_MS = 700;

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
  /** Sesión que ya confirmó la configuración; mientras sea null, el audio se acumula en espera. */
  private sesionLista: Session | null = null;
  private enEspera: string[] = [];
  private reproductor: ReproductorPcm | null = null;
  private campos = new Set<string>();
  private ultimoAudio = 0;
  private ultimaEntrada = 0;
  private hayProvisional = false;
  // Medición del atraso de Google (ver medirAtraso).
  private ultimaVozEnviada = 0;
  private ruido: number[] = [];
  private atrasoGoogle = 0;
  private atrasoMedidoEn = 0;
  private bytesPorPedazo = 0;
  private saltoEn = 0;
  private vigilancia: number | undefined;
  private enPausa = false;
  /** La primera frase de una sesión nueva llega sin espacio inicial: se agrega para no pegarla a la anterior. */
  private separarEntrada = false;
  private separarSalida = false;

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
    this.cerrarConexion(true);
    this.reproductor?.cerrar();
    this.reproductor = null;
    this.emitirEstado("desconectado");
  }

  /** Voz en cola + lo que Google (o la subida) lleva de atraso. */
  retrasoVoz(): number {
    return (this.reproductor?.pendiente ?? 0) * 1000 + this.atrasoAntesDeLaVoz(performance.now());
  }

  // ---------- Conexión ----------

  private async abrir(): Promise<void> {
    if (!this.opciones) return;
    try {
      // La captura arranca antes de abrir la sesión: lo que se diga mientras Google confirma
      // (unos 2 s) queda en espera y se manda apenas la sesión esté lista.
      if (!this.captura) {
        this.captura = await capturarPcm(this.opciones.entrada, FRECUENCIA_ENTRADA, PEDAZO_MS, (pcm) => this.alCapturar(pcm));
      }
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
          translationConfig: { targetLanguageCode: this.opciones.idiomaDestino, echoTargetLanguage: false },
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

      this.sesionLista = sesion;
      this.separarEntrada = this.separarSalida = true;
      const acumulado = this.enEspera;
      this.enEspera = [];
      if (acumulado.length) this.emitir({ tipo: "diagnostico", nombre: "gemini_audio_en_espera", muestra: `${acumulado.length * PEDAZO_MS} ms enviados al abrir la sesión`, t: performance.now() });
      for (const datos of acumulado) this.enviar(datos);
      this.reintentos = 0;
      window.clearInterval(this.vigilancia);
      this.vigilancia = window.setInterval(() => this.vigilarAtraso(), 500);
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

  private alCapturar(pcm: Int16Array): void {
    const t = performance.now();
    const datos = aBase64(new Uint8Array(pcm.buffer));
    this.enviar(datos);
    if (this.hayVoz(pcm)) {
      this.ultimaVozEnviada = t;
      this.enPausa = false;
      return;
    }
    const sesion = this.sesionLista;
    if (!this.enPausa && this.opciones?.cerrarEnPausas && sesion && sesion === this.sesion && this.ultimaVozEnviada && t - this.ultimaVozEnviada >= FIN_TRAS_SILENCIO_MS) {
      this.enPausa = true;
      sesion.sendRealtimeInput({ audioStreamEnd: true });
      this.emitir({ tipo: "diagnostico", nombre: "gemini_fin_de_audio", muestra: `pausa de ${Math.round(t - this.ultimaVozEnviada)} ms`, t });
    }
  }

  private enviar(datos: string): void {
    const sesion = this.sesionLista;
    if (!sesion || sesion !== this.sesion) {
      this.enEspera.push(datos);
      if (this.enEspera.length > MAX_PEDAZOS_EN_ESPERA) this.enEspera.shift();
      return;
    }
    this.bytesPorPedazo = datos.length + 100;
    sesion.sendRealtimeInput({ audio: { data: datos, mimeType: `audio/pcm;rate=${FRECUENCIA_ENTRADA}` } });
  }

  // ---------- Atraso de Google ----------

  /** Detector de voz simple sobre lo que se manda, con el piso de ruido de los últimos 6 s. */
  private hayVoz(pcm: Int16Array): boolean {
    let suma = 0;
    for (let i = 0; i < pcm.length; i++) suma += pcm[i] * pcm[i];
    const rms = Math.sqrt(suma / Math.max(1, pcm.length)) / 32768;
    this.ruido.push(rms);
    if (this.ruido.length > 60) this.ruido.shift();
    const piso = [...this.ruido].sort((a, b) => a - b)[Math.floor(this.ruido.length * 0.2)] ?? 0;
    return rms > Math.max(0.01, piso * 2);
  }

  /** Audio que sigue en el navegador esperando subir (la conexión no da abasto). */
  private subidaPendienteMs(): number {
    const ws = (this.sesion as unknown as { conn?: { ws?: WebSocket } } | null)?.conn?.ws;
    if (!ws || !this.bytesPorPedazo) return 0;
    return (ws.bufferedAmount / this.bytesPorPedazo) * PEDAZO_MS;
  }

  /**
   * Google transcribe lo que oye. Si sigue mandando transcripción cuando ya pasó un rato
   * sin voz en lo que se le envió, va atrasado al menos ese tiempo (cota inferior: solo se
   * puede medir en las pausas).
   */
  private medirAtraso(t: number): void {
    if (!this.ultimaVozEnviada || t - this.saltoEn < PAUSA_TRAS_SALTO_MS) return;
    const sinVoz = t - this.ultimaVozEnviada;
    this.atrasoGoogle = sinVoz > 1500 ? sinVoz : 0;
    this.atrasoMedidoEn = t;
  }

  private atrasoAntesDeLaVoz(t: number): number {
    // La medida vale mientras Google siga transcribiendo; si calla, ya se puso al día.
    const google = t - this.atrasoMedidoEn < 2000 ? this.atrasoGoogle : 0;
    return Math.max(google, this.subidaPendienteMs());
  }

  private vigilarAtraso(): void {
    const t = performance.now();
    if (!this.activo || !this.sesionLista || t - this.saltoEn < PAUSA_TRAS_SALTO_MS) return;
    const subida = this.subidaPendienteMs();
    const google = t - this.atrasoMedidoEn < 2000 ? this.atrasoGoogle : 0;
    if (subida > 1000) {
      this.emitir({ tipo: "diagnostico", nombre: "gemini_subida_atrasada", muestra: `${(subida / 1000).toFixed(1)} s de audio esperando subir`, t });
    }
    const atraso = Math.max(subida, google);
    if (atraso < PONERSE_AL_DIA_MS) return;
    const donde = subida >= google ? "la conexión a internet no alcanza a subir el audio" : "Google va atrasado";
    this.saltoEn = t;
    this.atrasoGoogle = 0;
    this.emitir({ tipo: "diagnostico", nombre: "gemini_puesta_al_dia", muestra: `${(atraso / 1000).toFixed(1)} s de atraso (${donde}); sesión nueva`, t });
    this.emitirEstado("reconectando", `La traducción iba ${Math.round(atraso / 1000)} s atrasada (${donde}). Se salta lo pendiente para ponerse al día…`);
    this.reproductor?.vaciar();
    this.enEspera = [];
    this.cerrarConexion();
    void this.abrir();
  }

  /** Cierra la conexión con Google. La captura sigue (y acumula) salvo que se pida detenerla. */
  private cerrarConexion(detenerCaptura = false): void {
    if (detenerCaptura) {
      this.captura?.detener();
      this.captura = null;
      this.enEspera = [];
    }
    this.sesionLista = null;
    this.enPausa = false;
    window.clearInterval(this.vigilancia);
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
    this.cerrarConexion(true);
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
      this.medirAtraso(t);
      if (this.hayProvisional) {
        this.hayProvisional = false;
        this.emitir({ tipo: "transcripcion_provisional", texto: "", t });
      }
      const texto = contenido.inputTranscription.text;
      this.emitir({ tipo: "transcripcion_parcial", texto: this.separarEntrada ? ` ${texto.trimStart()}` : texto, t });
      this.separarEntrada = false;
    }
    if (contenido.outputTranscription?.text) {
      const texto = contenido.outputTranscription.text;
      this.emitir({ tipo: "traduccion_parcial", texto: this.separarSalida ? ` ${texto.trimStart()}` : texto, t });
      this.separarSalida = false;
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
