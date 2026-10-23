// Adaptador de OpenAI gpt-realtime-translate por WebRTC.
// El navegador pide un token efímero al servidor local y envía el audio
// directo a OpenAI. La voz traducida vuelve como pista de audio remota y los
// textos por el canal de datos "oai-events".
import type { EstadoConexion, EventoProveedor, OpcionesConexion, ProveedorTraduccion } from "./tipos";

const URL_LLAMADA = "https://api.openai.com/v1/realtime/translations/calls";
const MAX_REINTENTOS = 5;
const ESPERA_DESCONEXION_MS = 3000;

interface RespuestaSesion {
  secreto: string;
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

export class ProveedorOpenAI implements ProveedorTraduccion {
  readonly id = "openai";
  readonly nombre = "OpenAI gpt-realtime-translate";
  readonly capacidades = {
    glosario: false,
    vozEnVivo: true,
    notaGlosario:
      "OpenAI no acepta glosario: aquí se usa para corregir los subtítulos y medir cuántos términos traduce bien. La voz no se corrige.",
  };

  private pc: RTCPeerConnection | null = null;
  private opciones: OpcionesConexion | null = null;
  private alEvento: (evento: EventoProveedor) => void = () => {};
  private activo = false;
  private reintentos = 0;
  private temporizador: number | undefined;
  private tiposVistos = new Set<string>();

  async conectar(opciones: OpcionesConexion, alEvento: (evento: EventoProveedor) => void): Promise<void> {
    this.opciones = opciones;
    this.alEvento = alEvento;
    this.activo = true;
    this.reintentos = 0;
    this.emitirEstado("conectando");
    await this.abrir();
  }

  desconectar(): void {
    this.activo = false;
    window.clearTimeout(this.temporizador);
    this.cerrarPeer();
    this.emitirEstado("desconectado");
  }

  private async abrir(): Promise<void> {
    if (!this.opciones) return;
    try {
      const { secreto } = await this.pedirSecreto(this.opciones.idiomaDestino);
      if (!this.activo) return;
      await this.negociar(secreto, this.opciones.entrada);
    } catch (error) {
      if (!this.activo) return;
      const e =
        error instanceof ErrorConexion
          ? error
          : new ErrorConexion(
              `No se pudo conectar con OpenAI: ${error instanceof Error ? error.message : String(error)}`,
              "conexion",
              true,
            );
      if (e.recuperable && this.reintentos < MAX_REINTENTOS) {
        this.programarReconexion(e.message);
      } else {
        this.emitir({ tipo: "error", codigo: e.codigo, mensaje: e.message, recuperable: false, t: performance.now() });
        this.emitirEstado("error", e.message);
        this.activo = false;
        this.cerrarPeer();
      }
    }
  }

  private async pedirSecreto(idiomaDestino: string): Promise<RespuestaSesion> {
    let respuesta: Response;
    try {
      respuesta = await fetch("/api/sesion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedor: "openai", idiomaDestino }),
      });
    } catch {
      throw new ErrorConexion(
        "No hay conexión con el servidor local. ¿Sigue corriendo `npm run dev`?",
        "sin_servidor",
        true,
      );
    }
    const cuerpo = (await respuesta.json().catch(() => ({}))) as {
      secreto?: string;
      codigo?: string;
      mensaje?: string;
    };
    if (!respuesta.ok || !cuerpo.secreto) {
      const codigo = cuerpo.codigo ?? "error_sesion";
      // Key inválida, sin saldo o sin key: reintentar no lo arregla.
      const recuperable = !["sin_key", "key_invalida", "sin_saldo", "sin_acceso_modelo", "idioma_invalido"].includes(
        codigo,
      );
      throw new ErrorConexion(cuerpo.mensaje ?? `El servidor local respondió ${respuesta.status}.`, codigo, recuperable);
    }
    return { secreto: cuerpo.secreto };
  }

  private async negociar(secreto: string, entrada: MediaStream): Promise<void> {
    this.cerrarPeer();
    const pc = new RTCPeerConnection();
    this.pc = pc;

    for (const pista of entrada.getAudioTracks()) {
      pc.addTrack(pista, entrada);
    }

    pc.ontrack = ({ streams }) => {
      if (streams[0]) this.emitir({ tipo: "audio_traducido", pista: streams[0], t: performance.now() });
    };

    const canal = pc.createDataChannel("oai-events");
    canal.onmessage = ({ data }) => this.procesarMensaje(data);

    pc.onconnectionstatechange = () => {
      if (pc !== this.pc || !this.activo) return;
      switch (pc.connectionState) {
        case "connected":
          window.clearTimeout(this.temporizador);
          this.reintentos = 0;
          this.emitirEstado("conectado");
          break;
        case "disconnected":
          // Puede recuperarse solo; si no, se reconecta.
          this.emitirEstado("reconectando", "Se perdió la conexión, esperando…");
          window.clearTimeout(this.temporizador);
          this.temporizador = window.setTimeout(() => {
            if (pc === this.pc && pc.connectionState !== "connected") this.programarReconexion("Conexión perdida");
          }, ESPERA_DESCONEXION_MS);
          break;
        case "failed":
          this.programarReconexion("La conexión falló");
          break;
      }
    };

    const oferta = await pc.createOffer();
    await pc.setLocalDescription(oferta);

    let respuesta: Response;
    try {
      respuesta = await fetch(URL_LLAMADA, {
        method: "POST",
        headers: { Authorization: `Bearer ${secreto}`, "Content-Type": "application/sdp" },
        body: oferta.sdp,
      });
    } catch {
      throw new ErrorConexion("No se pudo contactar a OpenAI. Revisa tu conexión a internet.", "sin_red", true);
    }
    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => "");
      throw new ErrorConexion(
        `OpenAI rechazó la conexión (${respuesta.status}). ${detalle.slice(0, 200)}`,
        "sdp_rechazado",
        respuesta.status >= 500 || respuesta.status === 429,
      );
    }
    await pc.setRemoteDescription({ type: "answer", sdp: await respuesta.text() });
  }

  private procesarMensaje(datos: unknown): void {
    if (typeof datos !== "string") return;
    let evento: { type?: string; delta?: unknown; error?: { message?: string; code?: string } };
    try {
      evento = JSON.parse(datos);
    } catch {
      return;
    }
    const t = performance.now();
    switch (evento.type) {
      case "session.input_transcript.delta":
        if (typeof evento.delta === "string") this.emitir({ tipo: "transcripcion_parcial", texto: evento.delta, t });
        break;
      case "session.output_transcript.delta":
        if (typeof evento.delta === "string") this.emitir({ tipo: "traduccion_parcial", texto: evento.delta, t });
        break;
      case "error":
        this.emitir({
          tipo: "error",
          codigo: evento.error?.code ?? "error_proveedor",
          mensaje: `OpenAI: ${evento.error?.message ?? "error sin detalle"}`,
          recuperable: true,
          t,
        });
        break;
      default:
        // Eventos no documentados en la guía: se registran una vez para revisarlos.
        if (evento.type && !this.tiposVistos.has(evento.type)) {
          this.tiposVistos.add(evento.type);
          console.debug("[openai] evento", evento.type);
          this.emitir({ tipo: "diagnostico", nombre: evento.type, muestra: datos.slice(0, 500), t });
        }
    }
  }

  private programarReconexion(motivo: string): void {
    if (!this.activo) return;
    window.clearTimeout(this.temporizador);
    this.reintentos += 1;
    if (this.reintentos > MAX_REINTENTOS) {
      const mensaje = `${motivo}. No se pudo reconectar después de ${MAX_REINTENTOS} intentos.`;
      this.emitir({ tipo: "error", codigo: "reconexion_fallida", mensaje, recuperable: false, t: performance.now() });
      this.emitirEstado("error", mensaje);
      this.activo = false;
      this.cerrarPeer();
      return;
    }
    const espera = Math.min(1000 * 2 ** (this.reintentos - 1), 8000);
    this.emitirEstado("reconectando", `${motivo}. Reintento ${this.reintentos} de ${MAX_REINTENTOS}…`);
    this.cerrarPeer();
    this.temporizador = window.setTimeout(() => void this.abrir(), espera);
  }

  private cerrarPeer(): void {
    if (!this.pc) return;
    this.pc.onconnectionstatechange = null;
    this.pc.ontrack = null;
    this.pc.close();
    this.pc = null;
  }

  private emitirEstado(estado: EstadoConexion, detalle?: string): void {
    this.emitir({ tipo: "estado_conexion", estado, detalle, t: performance.now() });
  }

  private emitir(evento: EventoProveedor): void {
    this.alEvento(evento);
  }
}
