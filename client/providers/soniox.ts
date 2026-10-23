// Adaptador de Soniox: transcripción + traducción en streaming (stt-rt-v5) y
// voz en streaming (tts-rt-v2), con el SDK oficial @soniox/client.
//
// A diferencia de OpenAI, son dos piezas: las palabras traducidas que Soniox
// confirma se mandan a la voz apenas llegan, sin esperar la frase completa.
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
import { Anticipador } from "./anticipador";
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
/**
 * Sin texto nuevo durante este tiempo, se cierra la frase de voz para que termine de sonar.
 * Mientras llega texto, la voz sigue en una sola frase continua: cerrarla en cada punto
 * hace que baje la entonación y haga una pausa a mitad de la idea.
 */
const CIERRE_FRASE_MS = 1000;
/**
 * Sin cortes por pausa, Soniox deja las últimas palabras sin confirmar hasta
 * que se vuelve a hablar (en una prueba, el final de un audio nunca se tradujo).
 * Si la cola sin confirmar no cambia en este tiempo, la persona se calló: se
 * pide a Soniox que la confirme. Es más largo que las micro-pausas al hablar.
 */
const CONFIRMAR_TRAS_MS = 900;
/** Punto (o exclamación) al final de un pedazo de texto. La "?" se respeta siempre. */
const PUNTO_FINAL = /[.!…](["')\]]*)\s*$/;
/** En modo "frase", se manda a la voz al llegar a una pausa natural o a este número de palabras. */
const PAUSA_NATURAL = /[,;:.?!…]["')\]]*\s*$/;
const PALABRAS_POR_ENVIO = 5;

interface RespuestaSesion {
  llaveStt: string;
  llaveTts: string;
  modeloStt: string;
  modeloTts: string;
  voz: string;
}

/** Una frase de voz: su stream de TTS y el audio que llegó antes de que le tocara sonar. */
interface Tramo {
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
  private abierto: Tramo | null = null;
  private cadenaVoz: Promise<void> = Promise.resolve();
  private cierreFrase: number | undefined;
  private provisionalOriginal = "";
  private provisionalTraduccion = "";
  private ajustes: AjustesVoz | null = null;
  private vozServidor = "";
  /** Texto traducido que espera una pausa natural (modo "frase"). */
  private porDecir = "";
  private esperaEnvio: number | undefined;
  /** Se quitó un punto al final del último texto: si sigue llegando texto, se lee como coma. */
  private puntoPendiente = false;
  private colaVigilada = "";
  private readonly anticipador = new Anticipador();
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
    window.clearTimeout(this.cierreFrase);
    window.clearTimeout(this.esperaEnvio);
    window.clearTimeout(this.esperaConfirmar);
    this.colaVigilada = "";
    this.anticipador.reiniciar();
    this.porDecir = "";
    this.puntoPendiente = false;
    if (this.grabador && this.grabador.state !== "inactive") this.grabador.stop();
    this.grabador = null;
    const stt = this.stt;
    this.stt = null;
    stt?.close();
    const tts = this.tts;
    this.tts = null;
    tts?.close();
    this.tramos = [];
    this.abierto = null;
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
    if (traduccion) this.emitir({ tipo: "traduccion_parcial", texto: traduccion, t });
    if (this.ajustes?.anticipar) {
      // Lo estable va a la voz apenas se sabe, sin agrupar por frases.
      const correccionesAntes = this.anticipador.correcciones;
      const decir = this.anticipador.actualizar(traduccion, provisionalTraduccion);
      if (decir) this.enviarAVoz(decir);
      if (this.anticipador.correcciones > correccionesAntes) {
        this.emitir({ tipo: "diagnostico", nombre: "correccion_ya_dicha", muestra: this.anticipador.ultimaCorreccion, t });
      }
    } else if (traduccion) {
      this.hablar(traduccion);
    }
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

  /** Recibe texto traducido confirmado y decide cuándo mandarlo a la voz. */
  private hablar(texto: string): void {
    if (this.ajustes?.envio !== "frase") {
      this.enviarAVoz(texto);
      return;
    }
    this.porDecir += texto;
    window.clearTimeout(this.esperaEnvio);
    const palabras = this.porDecir.trim().split(/\s+/).length;
    if (PAUSA_NATURAL.test(this.porDecir) || palabras >= PALABRAS_POR_ENVIO) this.soltarPorDecir();
    else this.esperaEnvio = window.setTimeout(() => this.soltarPorDecir(), CIERRE_FRASE_MS);
  }

  private soltarPorDecir(): void {
    window.clearTimeout(this.esperaEnvio);
    if (!this.porDecir) return;
    const texto = this.porDecir;
    this.porDecir = "";
    this.enviarAVoz(texto);
  }

  /** Manda texto a la voz. Las llamadas se encadenan para respetar el orden. */
  private enviarAVoz(texto: string): void {
    let envio = texto;
    if (this.puntoPendiente) {
      // Siguió llegando texto: el punto quitado era un corte a mitad de la idea.
      envio = `,${envio}`;
      this.puntoPendiente = false;
    }
    if (this.ajustes?.suavizarPuntos && PUNTO_FINAL.test(envio)) {
      envio = envio.replace(PUNTO_FINAL, "$1");
      this.puntoPendiente = true;
    }
    window.clearTimeout(this.cierreFrase);
    this.cierreFrase = window.setTimeout(() => this.cerrarFrase(), CIERRE_FRASE_MS);
    this.cadenaVoz = this.cadenaVoz
      .then(async () => {
        if (!this.tts || !this.activo || !envio.trim()) return;
        if (!this.abierto || this.abierto.stream.state !== "active") this.abierto = await this.abrirTramo();
        this.abierto.stream.sendText(envio);
      })
      .catch((error) => this.emitir({ tipo: "error", codigo: "voz", mensaje: `Voz de Soniox: ${error instanceof Error ? error.message : error}`, recuperable: true, t: performance.now() }));
  }

  private cerrarFrase(): void {
    this.soltarPorDecir();
    window.clearTimeout(this.cierreFrase);
    // No llegó más texto: el punto era real y la frase termina.
    const punto = this.puntoPendiente;
    this.puntoPendiente = false;
    this.cadenaVoz = this.cadenaVoz.then(() => {
      if (punto && this.abierto?.stream.state === "active") this.abierto.stream.sendText(".");
      this.finTramo();
    });
  }

  private finTramo(): void {
    window.clearTimeout(this.cierreFrase);
    const tramo = this.abierto;
    this.abierto = null;
    if (tramo && tramo.stream.state === "active") tramo.stream.finish();
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
    const tramo: Tramo = { stream, pendiente: [], terminado: false };
    this.tramos.push(tramo);
    stream.on("audio", (bytes) => {
      if (this.tramos[0] === tramo) this.sonar(bytes);
      else tramo.pendiente.push(bytes);
    });
    const terminar = () => {
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
    this.abierto = null;
    this.porDecir = "";
    this.puntoPendiente = false;
    this.emitir({ tipo: "diagnostico", nombre: "voz_descartada", muestra: `Más de ${DESCARTAR_DESDE_S} s de voz en cola`, t: performance.now() });
  }

  private emitirEstado(estado: EstadoConexion, detalle?: string): void {
    this.emitir({ tipo: "estado_conexion", estado, detalle, t: performance.now() });
  }

  private emitir(evento: EventoProveedor): void {
    this.alEvento(evento);
  }
}
