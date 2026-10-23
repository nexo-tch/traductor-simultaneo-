// Documento oculto: captura el audio de la pestaña de Meet, lo traduce con Gemini y
// mezcla la salida. Como capturar una pestaña la silencia, aquí también suena el
// original, con ducking mientras suena la traducción (SPEC 8.1).
import { DetectorActividad } from "../client/audio/detector";
import { ProveedorGemini } from "../client/providers/gemini";
import { AJUSTES_VOZ, type EstadoConexion, type EventoProveedor, type Idioma } from "../client/providers/tipos";
import { AJUSTES, enviar, type Ajustes, type AlDocumento, type Foto } from "./mensajes";
import { Transcripcion } from "./transcripcion";

/** Servidor local de tokens (npm run dev). Tiene que coincidir con host_permissions del manifest. */
const SERVIDOR = "http://127.0.0.1:5173";
/** Mientras suena la traducción, la reunión baja a este factor de su volumen. */
const FACTOR_DUCKING = 0.25;

interface Sesion {
  flujo: MediaStream;
  contexto: AudioContext;
  original: GainNode;
  voz: GainNode;
  proveedor: ProveedorGemini;
  salida?: DetectorActividad;
  entrada: DetectorActividad;
  inicio: number;
  tick: number;
}

let sesion: Sesion | null = null;
let ajustes: Ajustes = { ...AJUSTES };
let transcripcion = new Transcripcion(ajustes.destino);
let estado: EstadoConexion = "desconectado";
let detalle: string | undefined;
let sonando = false;
/** Registro de diagnóstico: todo, y lo que falta mandar al panel. */
const diagnostico: string[] = [];
let diagnosticoNuevo: string[] = [];

function anotar(texto: string): void {
  const linea = `${new Date().toLocaleTimeString("es-CO")} ${texto}`;
  console.info("[traductor]", linea);
  diagnostico.push(linea);
  if (diagnostico.length > 300) diagnostico.shift();
  diagnosticoNuevo.push(linea);
}

chrome.runtime.onMessage.addListener((mensaje: AlDocumento, _remitente, responder) => {
  if (mensaje.para !== "documento") return;
  switch (mensaje.tipo) {
    case "iniciar":
      iniciar(mensaje.streamId, mensaje.ajustes).then(
        () => responder({}),
        (error: unknown) => {
          const texto = error instanceof Error ? error.message : String(error);
          anotar(`No se pudo empezar: ${texto}`);
          responder({ error: texto });
        },
      );
      return true;
    case "detener":
      detener();
      break;
    case "ajustes":
      ajustes = mensaje.ajustes;
      aplicarVolumen();
      break;
    case "foto":
      responder({ ...resumen(), entradas: transcripcion.entradas, diagnostico } satisfies Foto);
      return;
    case "limpiar":
      transcripcion = new Transcripcion(ajustes.destino);
      break;
  }
  responder({});
});

async function iniciar(streamId: string, nuevos: Ajustes): Promise<void> {
  detener();
  if (nuevos.destino !== ajustes.destino) transcripcion = new Transcripcion(nuevos.destino);
  ajustes = nuevos;
  anotar(`Empezando: traducir a ${nuevos.destino}`);
  const flujo = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } } as MediaTrackConstraints,
    video: false,
  });
  const contexto = new AudioContext();
  await contexto.resume();
  const original = contexto.createGain();
  contexto.createMediaStreamSource(flujo).connect(original).connect(contexto.destination);
  const voz = contexto.createGain();
  voz.connect(contexto.destination);

  anotar(`Pestaña capturada: ${flujo.getAudioTracks().length} pista(s) de audio`);
  const proveedor = new ProveedorGemini(SERVIDOR);
  const entrada = new DetectorActividad(contexto, flujo, { umbral: 0.01, silencioMs: 500 }, () => {});
  const actual: Sesion = { flujo, contexto, original, voz, proveedor, entrada, inicio: performance.now(), tick: 0 };
  sesion = actual;
  aplicarVolumen();
  for (const pista of flujo.getAudioTracks()) {
    pista.onended = () => {
      if (sesion !== actual) return;
      detener();
      void enviar({ para: "panel", tipo: "aviso", nivel: "alerta", texto: "La pestaña se cerró o dejó de compartir audio. Haz clic en el ícono para volver a empezar." });
    };
  }
  actual.tick = window.setInterval(() => publicar(), 200);

  const otro: Idioma = ajustes.destino === "es" ? "en" : "es";
  await proveedor.conectar(
    { entrada: flujo, idiomaOrigen: otro, idiomaDestino: ajustes.destino, glosario: [], ajustesVoz: AJUSTES_VOZ, cerrarEnPausas: false },
    (evento) => manejar(actual, evento),
  );
}

function manejar(actual: Sesion, evento: EventoProveedor): void {
  if (sesion !== actual) return;
  if (evento.tipo === "diagnostico") anotar(`${evento.nombre}: ${evento.muestra.slice(0, 160)}`);
  if (evento.tipo === "transcripcion_parcial" && !transcripcion.entradas.length) anotar(`Primer texto de Google (${evento.idioma ?? "?"}): ${evento.texto}`);
  switch (evento.tipo) {
    case "transcripcion_parcial":
      transcripcion.original(evento.texto, evento.idioma, evento.t);
      break;
    case "traduccion_parcial":
      transcripcion.traduccion(evento.texto);
      break;
    case "audio_traducido":
      actual.contexto.createMediaStreamSource(evento.pista).connect(actual.voz);
      actual.salida?.detener();
      actual.salida = new DetectorActividad(actual.contexto, evento.pista, { umbral: 0.01, silencioMs: 250 }, (activo) => {
        sonando = activo;
        aplicarVolumen();
      });
      break;
    case "estado_conexion":
      anotar(`Estado: ${evento.estado}${evento.detalle ? ` (${evento.detalle})` : ""}`);
      estado = evento.estado;
      detalle = evento.detalle;
      publicar();
      break;
    case "error":
      anotar(`Error ${evento.codigo}: ${evento.mensaje}`);
      void enviar({ para: "panel", tipo: "aviso", nivel: "error", texto: evento.mensaje });
      break;
  }
}

function aplicarVolumen(): void {
  if (!sesion) return;
  const t = sesion.contexto.currentTime;
  const bajar = ajustes.vozEncendida && ajustes.ducking && sonando;
  sesion.original.gain.setTargetAtTime(ajustes.volumenOriginal * (bajar ? FACTOR_DUCKING : 1), t, 0.06);
  sesion.voz.gain.setTargetAtTime(ajustes.vozEncendida ? ajustes.volumenVoz : 0, t, 0.02);
}

function detener(): void {
  const actual = sesion;
  if (!actual) return;
  sesion = null;
  window.clearInterval(actual.tick);
  actual.proveedor.desconectar();
  actual.salida?.detener();
  actual.entrada.detener();
  anotar("Detenido");
  for (const pista of actual.flujo.getTracks()) pista.stop();
  void actual.contexto.close();
  sonando = false;
  estado = "desconectado";
  detalle = undefined;
  publicar();
}

function resumen(): Omit<Foto, "entradas" | "diagnostico"> {
  return {
    activo: sesion !== null,
    estado,
    detalle,
    retrasoMs: sesion?.proveedor.retrasoVoz() ?? 0,
    sonando,
    nivel: sesion?.entrada.nivel ?? 0,
    duracionS: sesion ? (performance.now() - sesion.inicio) / 1000 : 0,
  };
}

function publicar(): void {
  const nuevas = diagnosticoNuevo;
  diagnosticoNuevo = [];
  void enviar({ para: "panel", tipo: "cambios", foto: resumen(), entradas: transcripcion.tomarCambios(), diagnostico: nuevas });
}
