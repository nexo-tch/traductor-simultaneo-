// Adaptador de Soniox: transcripción + traducción en streaming (stt-rt-v5) y
// voz en streaming (tts-rt-v2), con el SDK oficial @soniox/client.
//
// A diferencia de OpenAI, son dos piezas: cada tanda de traducción que Soniox
// confirma se manda a la voz como una frase cerrada apenas llega.
// La voz vuelve en pedazos de PCM que reproduce una cola propia, así que se
// puede acelerar o descartar lo pendiente (SPEC.md 8.3).
import {
  AuthError,
  QuotaError,
  RealtimeSttSession,
  RealtimeTtsConnection,
  type RealtimeResult,
  type RealtimeTtsStream,
  type SttSessionConfig,
} from "@soniox/client";
import { ReproductorPcm } from "../audio/reproductor";
import type { AjustesVoz, EstadoConexion, EventoProveedor, OpcionesConexion, ProveedorTraduccion } from "./tipos";

const URL_STT = "wss://stt-rt.soniox.com/transcribe-websocket";
const URL_TTS = "wss://tts-rt.soniox.com/tts-websocket";
const FRECUENCIA = 24000;
const MAX_REINTENTOS = 5;
/** Con más audio en cola que esto, las frases nuevas se generan un 15% más rápido (RF-14), hasta 1.3x. */
const ACELERAR_DESDE_S = 2;
const FACTOR_ACELERACION = 1.15;
const VELOCIDAD_MAXIMA = 1.3;
/** Con más audio en cola que esto, se descarta lo pendiente y se sigue con lo más reciente. */
const DESCARTAR_DESDE_S = 5;
/** En modo "frase", una tanda muy corta espera hasta este tiempo para juntarse con la siguiente. */
const ESPERA_TANDA_CORTA_MS = 600;
/**
 * Sin cortes por pausa, Soniox deja las últimas palabras sin confirmar hasta
 * que se vuelve a hablar (en una prueba, el final de un audio nunca se tradujo).
 * Si la cola sin confirmar no cambia en este tiempo, la persona se calló: se
 * pide a Soniox que la confirme. Es más largo que las micro-pausas al hablar.
 */
const CONFIRMAR_TRAS_MS = 1600;
/** Punto (o exclamación) al final de un pedazo de texto. La "?" se respeta siempre. */
const PUNTO_FINAL = /[.!…](["')\]]*)\s*$/;
/** En modo "frase", una tanda sin pausa natural y con menos palabras que esto espera a la siguiente. */
const PAUSA_NATURAL = /[,;:.?!…]["')\]]*\s*$/;
const PALABRAS_MINIMAS = 3;

interface RespuestaSesion {
  llaveStt: string;
  llaveTts: string;
  modeloStt: string;
  modeloTts: string;
  voz: string;
}

/** Una frase de voz: su stream de TTS y el audio que llegó antes de que le tocara sonar. */
interface Tramo {
  id: number;
  /** Para diagnóstico: cuándo se mandó el texto y si ya llegó audio. */
  enviado: number;
  conAudio: boolean;
  stream: RealtimeTtsStream;
  pendiente: Uint8Array[];
  terminado: boolean;
}

type Pieza = "sesión" | "transcripción" | "voz";

/** Convierte un error del SDK en un mensaje claro, conservando lo que respondió Soniox. */
function traducirError(error: unknown, pieza: Pieza): ErrorConexion {
  const detalle = error instanceof Error ? error.message : String(error);
  const codigo = (error as { statusCode?: number }).statusCode;
  const original = `(Soniox, ${pieza}${codigo ? `, código ${codigo}` : ""}: «${detalle}»)`;
  if (error instanceof AuthError) {
    return new ErrorConexion(
      `Soniox rechazó la llave. Revisa SONIOX_API_KEY en el archivo .env y reinicia el servidor. ${original}`,
      "key_invalida",
      false,
    );
  }
  if (error instanceof QuotaError && codigo === 402) {
    return new ErrorConexion(
      `La cuenta de Soniox no tiene saldo. Agrega crédito o un medio de pago en console.soniox.com. ${original}`,
      "sin_saldo",
      false,
    );
  }
  if (error instanceof QuotaError) {
    return new ErrorConexion(
      `Soniox rechazó la conexión por límite de uso o de conexiones simultáneas. Espera un minuto y vuelve a intentar; si se repite, revisa los límites de tu cuenta en console.soniox.com. ${original}`,
      "limite_uso",
      false,
    );
  }
  return new ErrorConexion(`Error de Soniox. ${original}`, "conexion", true);
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

export class ProveedorSoniox implements ProveedorTraduccion {
  readonly id = "soniox";
  readonly nombre = "Soniox (stt-rt-v5 + tts-rt-v2)";
  readonly capacidades = {
    glosario: true,
    vozEnVivo: false,
    notaGlosario:
      "Se envía a Soniox como términos de traducción: corrige la voz y los subtítulos. Además mide cuántos términos salen bien.",
  };

  private opciones: OpcionesConexion | null = null;
  private alEvento: (evento: EventoProveedor) => void = () => {};
  private activo = false;
  private reintentos = 0;
  private temporizador: number | undefined;

  private stt: RealtimeSttSession | null = null;
  private tts: RealtimeTtsConnection | null = null;
  private grabador: MediaRecorder | null = null;
  private envioAudio: Promise<void> = Promise.resolve();
  private reproductor: ReproductorPcm | null = null;

  private tramos: Tramo[] = [];
  private cadenaVoz: Promise<void> = Promise.resolve();
  private provisionalOriginal = "";
  private provisionalTraduccion = "";
  private ajustes: AjustesVoz | null = null;
  private vozServidor = "";
  /** Tanda corta que espera juntarse con la siguiente (modo "frase"). */
  private porDecir = "";
  private esperaEnvio: number | undefined;
  private colaVigilada = "";
  private siguienteTramo = 1;
  private palabrasProvisionales = 0;
  private esperaConfirmar: number | undefined;

  async conectar(opciones: OpcionesConexion, alEvento: (evento: EventoProveedor) => void): Promise<void> {
    this.opciones = opciones;
    this.alEvento = alEvento;
    this.ajustes = { ...opciones.ajustesVoz };
    this.activo = true;
    this.reintentos = 0;
    this.reproductor = new ReproductorPcm(FRECUENCIA);
    await this.reproductor.reanudar();
    this.emitir({ tipo: "audio_traducido", pista: this.reproductor.flujo, t: performance.now() });
    this.emitirEstado("conectando");
    await this.abrir();
  }

  ajustarVoz(ajustes: AjustesVoz): void {
    this.ajustes = { ...ajustes };
  }

  retrasoVoz(): number {
    return (this.reproductor?.pendiente ?? 0) * 1000;
  }

  desconectar(): void {
    this.activo = false;
    window.clearTimeout(this.temporizador);
    this.cerrarConexiones();
    this.reproductor?.cerrar();
    this.reproductor = null;
    this.emitirEstado("desconectado");
  }

  // ---------- Conexión ----------

  private async abrir(): Promise<void> {
    if (!this.opciones) return;
    let pieza: Pieza = "sesión";
    try {
      const sesion = await this.pedirSesion(this.opciones.idiomaDestino);
      if (!this.activo) return;

      pieza = "transcripción";
      const stt = new RealtimeSttSession(sesion.llaveStt, URL_STT, this.configStt(sesion.modeloStt));
      stt.on("result", (r) => this.procesar(r));
      stt.on("error", (e) => this.fallo(e, "transcripción"));
      stt.on("disconnected", () => {
        if (this.activo && this.stt === stt) this.programarReconexion("Se perdió la conexión con Soniox");
      });
      this.stt = stt;
      await stt.connect();

      pieza = "voz";
      this.vozServidor = sesion.voz;
      const tts = new RealtimeTtsConnection(sesion.llaveTts, URL_TTS, {
        model: sesion.modeloTts,
        language: this.opciones.idiomaDestino,
        voice: this.ajustes?.voz || sesion.voz,
        audio_format: "pcm_s16le",
        sample_rate: FRECUENCIA,
      });
      tts.on("error", (e) => this.fallo(e, "voz"));
      this.tts = tts;
      await tts.connect();
      if (!this.activo) return;

      this.iniciarGrabador(this.opciones.entrada);
      this.reintentos = 0;
      this.emitirEstado("conectado");
    } catch (error) {
      this.fallo(error, pieza);
    }
  }

  private configStt(modelo: string): SttSessionConfig {
    const { idiomaOrigen, idiomaDestino, glosario } = this.opciones!;
    const terminos = glosario.filter((t) => t.original.trim());
    const config: SttSessionConfig = {
      model: modelo,
      audio_format: "auto",
      language_hints: [idiomaOrigen],
      translation: { type: "one_way", target_language: idiomaDestino },
      context: {
        general: [{ key: "domain", value: "Reunión de trabajo de un equipo de producto y desarrollo de software" }],
      },
    };
    // Cortar frases en las pausas confirma antes, pero Soniox pone un punto en cada corte
    // (en las pruebas: "con respecto a el. Modelo de suscripciones. Mi. Idea…").
    const cortes = this.ajustes?.cortes ?? "largas";
    if (cortes !== "largas") {
      config.enable_endpoint_detection = true;
      config.max_endpoint_delay_ms = 500;
      config.endpoint_latency_adjustment_level = cortes === "rapido" ? 2 : 0;
    }
    if (terminos.length) {
      config.context!.terms = terminos.map((t) => t.original.trim());
      config.context!.translation_terms = terminos.map((t) => ({
        source: t.original.trim(),
        // Traducción vacía = no traducir: se pide que salga igual.
        target: (t.traduccion || t.original).trim(),
      }));
    }
    return config;
  }

  private async pedirSesion(idiomaDestino: string): Promise<RespuestaSesion> {
    let respuesta: Response;
    try {
      respuesta = await fetch("/api/sesion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedor: "soniox", idiomaDestino }),
      });
    } catch {
      throw new ErrorConexion("No hay conexión con el servidor local. ¿Sigue corriendo `npm run dev`?", "sin_servidor", true);
    }
    const cuerpo = (await respuesta.json().catch(() => ({}))) as Partial<RespuestaSesion> & {
      codigo?: string;
      mensaje?: string;
    };
    if (!respuesta.ok || !cuerpo.llaveStt || !cuerpo.llaveTts) {
      const codigo = cuerpo.codigo ?? "error_sesion";
      const recuperable = !["sin_key", "key_invalida", "sin_saldo", "idioma_invalido", "proveedor_invalido"].includes(codigo);
      throw new ErrorConexion(cuerpo.mensaje ?? `El servidor local respondió ${respuesta.status}.`, codigo, recuperable);
    }
    return cuerpo as RespuestaSesion;
  }

  /** Manda el audio en pedazos de 100 ms (WebM/Opus; Soniox detecta el formato solo). */
  private iniciarGrabador(entrada: MediaStream): void {
    const grabador = new MediaRecorder(new MediaStream(entrada.getAudioTracks()), {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : undefined,
    });
    this.envioAudio = Promise.resolve();
    grabador.ondataavailable = ({ data }) => {
      if (!data.size) return;
      // En cadena, para que los pedazos lleguen en orden.
      this.envioAudio = this.envioAudio.then(async () => {
        const bytes = await data.arrayBuffer();
        if (this.stt?.state === "connected") this.stt.sendAudio(bytes);
      });
    };
    grabador.start(100);
    this.grabador = grabador;
  }

  private cerrarConexiones(): void {
    window.clearTimeout(this.esperaEnvio);
    window.clearTimeout(this.esperaConfirmar);
    this.colaVigilada = "";
    this.porDecir = "";
    if (this.grabador && this.grabador.state !== "inactive") this.grabador.stop();
    this.grabador = null;
    const stt = this.stt;
    this.stt = null;
    stt?.close();
    const tts = this.tts;
    this.tts = null;
    tts?.close();
    this.tramos = [];
    this.cadenaVoz = Promise.resolve();
    this.provisionalOriginal = "";
    this.provisionalTraduccion = "";
  }

  private fallo(error: unknown, pieza: Pieza = "sesión"): void {
    if (!this.activo) return;
    const e = error instanceof ErrorConexion ? error : traducirError(error, pieza);
    if (e.recuperable && this.reintentos < MAX_REINTENTOS) {
      this.programarReconexion(e.message);
      return;
    }
    this.emitir({ tipo: "error", codigo: e.codigo, mensaje: e.message, recuperable: false, t: performance.now() });
    this.emitirEstado("error", e.message);
    this.activo = false;
    this.cerrarConexiones();
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
    this.cerrarConexiones();
    this.temporizador = window.setTimeout(() => void this.abrir(), espera);
  }

  // ---------- Texto ----------

  private procesar(resultado: RealtimeResult): void {
    const t = performance.now();
    let original = "";
    let traduccion = "";
    let provisionalOriginal = "";
    let provisionalTraduccion = "";
    for (const token of resultado.tokens) {
      const esTraduccion = token.translation_status === "translation";
      if (token.is_final) {
        if (esTraduccion) traduccion += token.text;
        else original += token.text;
      } else if (esTraduccion) {
        provisionalTraduccion += token.text;
      } else {
        provisionalOriginal += token.text;
      }
    }

    if (original) this.emitir({ tipo: "transcripcion_parcial", texto: original, t });
    if ((this.ajustes?.cortes ?? "largas") === "largas") this.vigilarCola(provisionalOriginal + provisionalTraduccion);
    if (provisionalOriginal !== this.provisionalOriginal) {
      this.provisionalOriginal = provisionalOriginal;
      this.emitir({ tipo: "transcripcion_provisional", texto: provisionalOriginal, t });
    }
    if (traduccion) {
      this.emitir({ tipo: "traduccion_parcial", texto: traduccion, t });
      this.hablar(traduccion);
    }
    const palabrasProv = provisionalTraduccion.trim() ? provisionalTraduccion.trim().split(/\s+/).length : 0;
    if (palabrasProv > this.palabrasProvisionales) {
      this.emitir({ tipo: "diagnostico", nombre: "traduccion_provisional", muestra: provisionalTraduccion, t });
    }
    this.palabrasProvisionales = palabrasProv;
    if (provisionalTraduccion !== this.provisionalTraduccion) {
      this.provisionalTraduccion = provisionalTraduccion;
      this.emitir({ tipo: "traduccion_provisional", texto: provisionalTraduccion, t });
    }
  }

  /** Si la cola sin confirmar deja de cambiar, pide a Soniox que la confirme (ver CONFIRMAR_TRAS_MS). */
  private vigilarCola(cola: string): void {
    if (cola === this.colaVigilada) return;
    this.colaVigilada = cola;
    window.clearTimeout(this.esperaConfirmar);
    if (cola.trim()) this.esperaConfirmar = window.setTimeout(() => this.stt?.finalize(), CONFIRMAR_TRAS_MS);
  }

  // ---------- Voz ----------
  //
  // En una prueba real, la voz de Soniox no hablaba un texto hasta recibir el
  // siguiente o el cierre (esperaba 3.5–5.4 s, y con la frase abierta sin audio
  // Soniox la cortaba: «output audio rate below minimum»). Por eso cada tanda
  // confirmada es una frase de voz propia que se cierra en el acto. Las tandas de
  // Soniox ya son frases naturales (6–9 palabras en las pruebas).

  /** Recibe una tanda de traducción confirmada y decide cuándo mandarla a la voz. */
  private hablar(texto: string): void {
    this.porDecir += texto;
    window.clearTimeout(this.esperaEnvio);
    const corta = !PAUSA_NATURAL.test(this.porDecir) && this.porDecir.trim().split(/\s+/).length < PALABRAS_MINIMAS;
    if (this.ajustes?.envio === "frase" && corta) {
      this.esperaEnvio = window.setTimeout(() => this.soltarPorDecir(), ESPERA_TANDA_CORTA_MS);
    } else {
      this.soltarPorDecir();
    }
  }

  private soltarPorDecir(): void {
    window.clearTimeout(this.esperaEnvio);
    if (!this.porDecir.trim()) return;
    let texto = this.porDecir;
    this.porDecir = "";
    // Un punto mientras la persona sigue hablando suele ser un corte a mitad de la idea:
    // como coma, la voz no baja la entonación como en un final de oración.
    if (this.ajustes?.suavizarPuntos && this.provisionalOriginal.trim()) texto = texto.replace(PUNTO_FINAL, ",$1");
    this.enviarAVoz(texto);
  }

  /** Manda una frase cerrada a la voz. Las llamadas se encadenan para respetar el orden. */
  private enviarAVoz(texto: string): void {
    this.cadenaVoz = this.cadenaVoz
      .then(async () => {
        if (!this.tts || !this.activo) return;
        const tramo = await this.abrirTramo();
        tramo.stream.sendText(texto, { end: true });
        this.emitir({ tipo: "diagnostico", nombre: `a_la_voz#${tramo.id}`, muestra: texto, t: performance.now() });
      })
      .catch((error) => this.emitir({ tipo: "error", codigo: "voz", mensaje: `Voz de Soniox: ${error instanceof Error ? error.message : error}`, recuperable: true, t: performance.now() }));
  }

  private async abrirTramo(): Promise<Tramo> {
    const ajustes = this.ajustes;
    const base = ajustes?.velocidad ?? 1;
    const atrasada = (this.reproductor?.pendiente ?? 0) > ACELERAR_DESDE_S;
    const stream = await this.tts!.stream({
      speed: Math.min(VELOCIDAD_MAXIMA, atrasada ? base * FACTOR_ACELERACION : base),
      reduce_silence: ajustes?.reducirSilencios ?? false,
      voice: ajustes?.voz || this.vozServidor,
    });
    const tramo: Tramo = { id: this.siguienteTramo++, stream, pendiente: [], terminado: false, conAudio: false, enviado: performance.now() };
    this.tramos.push(tramo);
    stream.on("audio", (bytes) => {
      if (!tramo.conAudio) {
        tramo.conAudio = true;
        const t = performance.now();
        this.emitir({
          tipo: "diagnostico",
          nombre: `voz_primer_audio#${tramo.id}`,
          muestra: `${Math.round(t - tramo.enviado)} ms después del texto; en cola: ${(this.reproductor?.pendiente ?? 0).toFixed(1)} s`,
          t,
        });
      }
      if (this.tramos[0] === tramo) this.sonar(bytes);
      else tramo.pendiente.push(bytes);
    });
    const terminar = () => {
      if (tramo.terminado) return;
      tramo.terminado = true;
      this.avanzar();
    };
    stream.on("terminated", terminar);
    stream.on("error", (error) => {
      terminar();
      // Sin voz, los subtítulos siguen: se avisa pero no se corta la sesión.
      const e = traducirError(error, "voz");
      this.emitir({ tipo: "error", codigo: e.codigo, mensaje: e.message, recuperable: true, t: performance.now() });
    });
    return tramo;
  }

  /** Cuando termina la frase que está sonando, pasa el audio guardado de las siguientes. */
  private avanzar(): void {
    while (this.tramos[0]?.terminado) {
      this.tramos.shift();
      const siguiente = this.tramos[0];
      if (!siguiente) return;
      for (const bytes of siguiente.pendiente.splice(0)) this.sonar(bytes);
    }
  }

  private sonar(bytes: Uint8Array): void {
    if (!this.reproductor) return;
    this.reproductor.agregar(bytes);
    if (this.reproductor.pendiente > DESCARTAR_DESDE_S) this.descartar();
  }

  /** SPEC 8.3: con demasiado retraso, se corta la voz pendiente y se sigue con lo nuevo. Los subtítulos conservan todo. */
  private descartar(): void {
    this.reproductor?.vaciar();
    for (const tramo of this.tramos) {
      tramo.pendiente = [];
      if (tramo.stream.state === "active" || tramo.stream.state === "finishing") tramo.stream.cancel();
    }
    this.tramos = [];
    this.porDecir = "";
    this.emitir({ tipo: "diagnostico", nombre: "voz_descartada", muestra: `Más de ${DESCARTAR_DESDE_S} s de voz en cola`, t: performance.now() });
  }

  private emitirEstado(estado: EstadoConexion, detalle?: string): void {
    this.emitir({ tipo: "estado_conexion", estado, detalle, t: performance.now() });
  }

  private emitir(evento: EventoProveedor): void {
    this.alEvento(evento);
  }
}
