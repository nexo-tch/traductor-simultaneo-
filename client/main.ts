// Probador de fluidez: une captura, proveedor, registro de fragmentos, voz y panel.
import { archivoDePrueba, ErrorCaptura, microfono, type Fuente } from "./audio/captura";
import { DetectorActividad } from "./audio/detector";
import { VozTraducida } from "./audio/voz";
import { formatoSegundos } from "./metrics/estadisticas";
import { aCSV, aJSON, descargar, resumirSesion, type DatosSesion } from "./metrics/exportar";
import { CONFIG_REGISTRO, RegistroSesion } from "./metrics/registro";
import { PROVEEDORES } from "./providers";
import type { EstadoConexion, EventoProveedor, Idioma, ProveedorTraduccion } from "./providers/tipos";
import { PanelGlosario } from "./ui/glosario";
import { PanelBilingue } from "./ui/panel";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  empezar: $<HTMLButtonElement>("btn-empezar"),
  estadoGrabacion: $("estado-grabacion"),
  direccion: $<HTMLSelectElement>("direccion"),
  voz: $<HTMLButtonElement>("btn-voz"),
  volumen: $<HTMLInputElement>("volumen"),
  conexion: $("conexion"),
  latUltimo: $("lat-ultimo"),
  latP50: $("lat-p50"),
  latP95: $("lat-p95"),
  retraso: $("retraso"),
  archivo: $<HTMLInputElement>("archivo"),
  vista: $<HTMLSelectElement>("vista"),
  proveedor: $<HTMLSelectElement>("proveedor"),
  json: $<HTMLButtonElement>("btn-json"),
  csv: $<HTMLButtonElement>("btn-csv"),
  limpiar: $<HTMLButtonElement>("btn-limpiar"),
  botonGlosario: $<HTMLButtonElement>("btn-glosario"),
  glosario: $("glosario"),
  precision: $("glosario-precision"),
  avisos: $("avisos"),
  vacio: $("vacio"),
  nombreProveedor: $("nombre-proveedor"),
  hablante: $<HTMLInputElement>("aj-hablante"),
  umbral: $<HTMLInputElement>("aj-umbral"),
  umbralValor: $<HTMLOutputElement>("aj-umbral-valor"),
  silencio: $<HTMLInputElement>("aj-silencio"),
  descarte: $<HTMLInputElement>("aj-descarte"),
  umbralDescarte: $<HTMLInputElement>("aj-umbral-descarte"),
  monitor: $<HTMLInputElement>("aj-monitor"),
};

const panel = new PanelBilingue($("panel"), $<HTMLOListElement>("transcripcion"), $<HTMLButtonElement>("ir-reciente"));
const glosario = new PanelGlosario(
  $<HTMLTableSectionElement>("glosario-filas"),
  $<HTMLButtonElement>("glosario-agregar"),
  $<HTMLButtonElement>("glosario-exportar"),
  $<HTMLInputElement>("glosario-importar"),
  (mensaje) => avisar("glosario", "alerta", mensaje),
);
const voz = new VozTraducida();

interface Sesion {
  proveedor: ProveedorTraduccion;
  fuente: Fuente;
  contexto: AudioContext;
  entrada: DetectorActividad;
  salida?: DetectorActividad;
  tick: number;
}

let sesion: Sesion | null = null;
let iniciando = false;
let registro = nuevoRegistro();
let t0: number | null = null;
let inicio = Date.now();
let retrasoMaximo = 0;
let apiKeyConfigurada = true;

function nuevoRegistro(): RegistroSesion {
  return new RegistroSesion({ ...CONFIG_REGISTRO, hablante: ui.hablante.value.trim() || "Hablante" });
}

function idiomas(): { origen: Idioma; destino: Idioma } {
  return ui.direccion.value === "en-es" ? { origen: "en", destino: "es" } : { origen: "es", destino: "en" };
}

function fuenteElegida(): "microfono" | "archivo" {
  return (document.querySelector<HTMLInputElement>('input[name="fuente"]:checked')?.value as "microfono" | "archivo") ?? "microfono";
}

// ---------- Avisos ----------

type TipoAviso = "error" | "alerta";

function avisar(clave: string, tipo: TipoAviso, ...parrafos: string[]): void {
  let aviso = ui.avisos.querySelector<HTMLElement>(`[data-clave="${clave}"]`);
  if (!aviso) {
    aviso = document.createElement("div");
    aviso.className = "aviso";
    aviso.dataset.clave = clave;
    const texto = document.createElement("div");
    const cerrar = document.createElement("button");
    cerrar.type = "button";
    cerrar.textContent = "Cerrar";
    cerrar.addEventListener("click", () => aviso?.remove());
    aviso.append(texto, cerrar);
    ui.avisos.append(aviso);
  }
  aviso.dataset.tipo = tipo;
  aviso.firstElementChild!.replaceChildren(
    ...parrafos.map((p) => {
      const nodo = document.createElement("p");
      nodo.textContent = p;
      return nodo;
    }),
  );
}

function quitarAviso(clave: string): void {
  ui.avisos.querySelector(`[data-clave="${clave}"]`)?.remove();
}

// ---------- Estado de la interfaz ----------

const TEXTO_ESTADO: Record<EstadoConexion, string> = {
  desconectado: "Desconectado",
  conectando: "Conectando…",
  conectado: "Conectado",
  reconectando: "Reconectando…",
  error: "Error",
};

function mostrarConexion(estado: EstadoConexion, detalle?: string): void {
  ui.conexion.dataset.estado = estado;
  ui.conexion.querySelector(".texto")!.textContent = TEXTO_ESTADO[estado];
  ui.conexion.title = detalle ?? "";
  if (estado === "reconectando") avisar("conexion", "alerta", detalle ?? "Reconectando con el proveedor…", "El historial se conserva.");
  if (estado === "conectado") quitarAviso("conexion");
}

function mostrarGrabando(activo: boolean): void {
  ui.empezar.dataset.grabando = String(activo);
  ui.empezar.querySelector(".btn-texto")!.textContent = activo ? "Detener" : "Empezar";
  ui.estadoGrabacion.textContent = activo ? "Grabando" : "Sin grabar";
  ui.direccion.disabled = activo;
  ui.proveedor.disabled = activo;
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="fuente"]')) radio.disabled = activo;
  ui.empezar.disabled = !activo && !apiKeyConfigurada;
}

function mostrarVoz(): void {
  const encendida = !voz.estaSilenciada("apagada");
  ui.voz.setAttribute("aria-pressed", String(encendida));
  const momentaneo = voz.estaSilenciada("mantenida") || voz.estaSilenciada("descarte");
  ui.voz.dataset.momentaneo = String(encendida && momentaneo);
  let estado = encendida ? "encendida" : "apagada";
  if (encendida && voz.estaSilenciada("mantenida")) estado = "en pausa (tecla)";
  else if (encendida && voz.estaSilenciada("descarte")) estado = "saltando retraso";
  ui.voz.querySelector("strong")!.textContent = estado;
}

function nivelLatencia(ms: number | null): string {
  if (ms === null) return "";
  return ms > 2500 ? "alto" : ms > 1500 ? "medio" : "";
}

function actualizarMedidor(retrasoMs: number): void {
  const resumen = resumirSesion(registro.fragmentos, glosario.activos(), retrasoMaximo);
  const r = resumen.latenciaVoz;
  ui.latUltimo.textContent = formatoSegundos(r.ultimo);
  ui.latP50.textContent = formatoSegundos(r.p50);
  ui.latP95.textContent = formatoSegundos(r.p95);
  ui.latP50.dataset.nivel = nivelLatencia(r.p50);
  ui.latP95.dataset.nivel = nivelLatencia(r.p95);
  ui.retraso.textContent = sesion ? formatoSegundos(retrasoMs) : "—";
  ui.retraso.dataset.nivel = retrasoMs > 5000 ? "alto" : retrasoMs > 2000 ? "medio" : "";

  const g = resumen.glosario;
  ui.precision.textContent = g.apariciones
    ? `Esta sesión: ${g.correctas} de ${g.apariciones} términos bien traducidos por el modelo (${g.porcentaje}%).`
    : "";
}

function render(): void {
  const { origen, destino } = idiomas();
  panel.render(registro.fragmentos, glosario.activos(), origen, destino);
  ui.vacio.hidden = registro.fragmentos.some((f) => f.original || f.traduccion);
  const ahora = performance.now();
  actualizarMedidor(sesion ? registro.retrasoAcumulado(ahora) : 0);
}

// ---------- Sesión ----------

async function empezar(): Promise<void> {
  if (sesion || iniciando) return;
  iniciando = true;
  quitarAviso("error");
  quitarAviso("microfono");
  const { origen, destino } = idiomas();
  const contexto = new AudioContext();
  let fuente: Fuente;
  try {
    if (fuenteElegida() === "archivo") {
      const archivo = ui.archivo.files?.[0];
      if (!archivo) {
        ui.archivo.click();
        throw new ErrorCaptura("Elige un archivo de audio de prueba y vuelve a pulsar Empezar.", "archivo_invalido");
      }
      await contexto.resume();
      fuente = await archivoDePrueba(contexto, archivo, Number(ui.monitor.value));
    } else {
      fuente = await microfono();
    }
  } catch (error) {
    void contexto.close();
    iniciando = false;
    if (error instanceof ErrorCaptura && error.codigo === "sin_permiso") {
      avisar(
        "microfono",
        "error",
        "No hay permiso para usar el micrófono.",
        "En Chrome: haz clic en el ícono a la izquierda de la dirección (candado o ajustes) → Micrófono → Permitir. Luego vuelve a pulsar Empezar.",
      );
    } else {
      avisar("microfono", "error", error instanceof Error ? error.message : String(error));
    }
    return;
  }

  const ahora = performance.now();
  t0 ??= ahora;
  if (registro.fragmentos.length === 0) inicio = Date.now();
  const proveedor = PROVEEDORES[ui.proveedor.value].crear();
  const entrada = new DetectorActividad(
    contexto,
    fuente.flujo,
    { umbral: Number(ui.umbral.value), silencioMs: Number(ui.silencio.value) },
    (activa, t) => registro.vozLocal(activa, t),
  );
  const actual: Sesion = { proveedor, fuente, contexto, entrada, tick: 0 };
  sesion = actual;
  iniciando = false;
  mostrarGrabando(true);
  fuente.alTerminar?.(() => avisar("archivo", "alerta", "El audio de prueba terminó. Pulsa Detener cuando acabe la traducción."));

  actual.tick = window.setInterval(() => {
    const t = performance.now();
    registro.tick(t);
    const retraso = registro.retrasoAcumulado(t);
    retrasoMaximo = Math.max(retrasoMaximo, retraso);
    controlarRetraso(retraso);
    render();
  }, 100);

  await proveedor.conectar({ entrada: fuente.flujo, idiomaOrigen: origen, idiomaDestino: destino, glosario: glosario.activos() }, (evento) =>
    manejarEvento(actual, evento),
  );
}

function manejarEvento(actual: Sesion, evento: EventoProveedor): void {
  if (sesion !== actual) return;
  switch (evento.tipo) {
    case "transcripcion_parcial":
    case "transcripcion_final":
      registro.textoOriginal(evento.texto, evento.t);
      break;
    case "traduccion_parcial":
    case "traduccion_final":
      registro.textoTraducido(evento.texto, evento.t);
      break;
    case "audio_traducido":
      voz.conectar(evento.pista);
      actual.salida?.detener();
      actual.salida = new DetectorActividad(actual.contexto, evento.pista, { umbral: 0.01, silencioMs: 250 }, (sonando, t) =>
        registro.audioSalida(sonando, t),
      );
      break;
    case "estado_conexion":
      mostrarConexion(evento.estado, evento.detalle);
      break;
    case "error":
      if (evento.recuperable) {
        avisar("proveedor", "alerta", evento.mensaje);
      } else {
        avisar("error", "error", evento.mensaje);
        detener();
      }
      break;
  }
}

/** Sección 8.3: si la voz se atrasa demasiado, se salta hasta lo más reciente. */
function controlarRetraso(retrasoMs: number): void {
  const umbral = Number(ui.umbralDescarte.value) * 1000;
  const saltando = voz.estaSilenciada("descarte");
  if (!saltando && ui.descarte.checked && retrasoMs > umbral) {
    voz.silenciar("descarte", true);
    mostrarVoz();
  } else if (saltando && (!ui.descarte.checked || (registro.pendientes() <= 1 && retrasoMs < umbral / 2))) {
    voz.silenciar("descarte", false);
    mostrarVoz();
  }
}

function detener(): void {
  const actual = sesion;
  if (!actual) return;
  sesion = null;
  window.clearInterval(actual.tick);
  actual.proveedor.desconectar();
  actual.entrada.detener();
  actual.salida?.detener();
  actual.fuente.detener();
  void actual.contexto.close();
  voz.desconectar();
  voz.silenciar("descarte", false);
  registro.cerrarTodo(performance.now());
  quitarAviso("conexion");
  quitarAviso("archivo");
  mostrarConexion("desconectado");
  mostrarGrabando(false);
  mostrarVoz();
  render();
}

function datosSesion(): DatosSesion {
  const { origen, destino } = idiomas();
  return {
    proveedor: ui.proveedor.selectedOptions[0]?.textContent ?? ui.proveedor.value,
    direccion: `${origen}→${destino}`,
    fuente: fuenteElegida() === "archivo" ? `archivo: ${ui.archivo.files?.[0]?.name ?? "?"}` : "micrófono",
    t0: t0 ?? performance.now(),
    inicio,
    fragmentos: registro.fragmentos,
    glosario: glosario.activos(),
    retrasoMaximoMs: Math.round(retrasoMaximo),
    config: {
      umbralVoz: Number(ui.umbral.value),
      silencioMs: Number(ui.silencio.value),
      saltarRetraso: ui.descarte.checked,
      umbralSaltoS: Number(ui.umbralDescarte.value),
    },
  };
}

function nombreArchivo(extension: string): string {
  const fecha = new Date(inicio).toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `sesion-${fecha}.${extension}`;
}

// ---------- Eventos de la interfaz ----------

ui.empezar.addEventListener("click", () => (sesion ? detener() : void empezar()));

ui.voz.addEventListener("click", () => {
  voz.silenciar("apagada", !voz.estaSilenciada("apagada"));
  mostrarVoz();
});

ui.volumen.addEventListener("input", () => (voz.volumen = Number(ui.volumen.value)));

ui.vista.addEventListener("change", () => (panel.vista = ui.vista.value as "ambos" | "traduccion" | "original"));

ui.botonGlosario.addEventListener("click", () => {
  const abrir = ui.glosario.hidden;
  ui.glosario.hidden = !abrir;
  ui.botonGlosario.setAttribute("aria-expanded", String(abrir));
});

ui.json.addEventListener("click", () => descargar(nombreArchivo("json"), aJSON(datosSesion()), "application/json"));
ui.csv.addEventListener("click", () => descargar(nombreArchivo("csv"), aCSV(datosSesion()), "text/csv;charset=utf-8"));

ui.limpiar.addEventListener("click", () => {
  if (registro.fragmentos.length && !confirm("¿Borrar el historial de esta sesión? Exporta antes si lo necesitas.")) return;
  registro = nuevoRegistro();
  t0 = sesion ? performance.now() : null;
  inicio = Date.now();
  retrasoMaximo = 0;
  panel.limpiar();
  render();
});

ui.hablante.addEventListener("change", () => {
  if (!registro.fragmentos.length) registro = nuevoRegistro();
});

ui.umbral.addEventListener("input", () => {
  ui.umbralValor.textContent = ui.umbral.value;
  if (sesion) sesion.entrada.config.umbral = Number(ui.umbral.value);
});
ui.silencio.addEventListener("change", () => {
  if (sesion) sesion.entrada.config.silencioMs = Number(ui.silencio.value);
});

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="fuente"]')) {
  radio.addEventListener("change", () => {
    if (fuenteElegida() === "archivo" && !ui.archivo.files?.length) ui.archivo.click();
  });
}

// RF-11: mantener presionada la barra espaciadora silencia la voz (fuera de campos de texto).
function esCampo(objetivo: EventTarget | null): boolean {
  return objetivo instanceof HTMLElement && (objetivo.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(objetivo.tagName));
}
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || esCampo(e.target)) return;
  e.preventDefault();
  if (e.repeat) return;
  voz.silenciar("mantenida", true);
  mostrarVoz();
});
window.addEventListener("keyup", (e) => {
  if (e.code !== "Space" || esCampo(e.target)) return;
  e.preventDefault();
  voz.silenciar("mantenida", false);
  mostrarVoz();
});
window.addEventListener("blur", () => {
  if (!voz.estaSilenciada("mantenida")) return;
  voz.silenciar("mantenida", false);
  mostrarVoz();
});

// ---------- Inicio ----------

for (const [id, { nombre }] of Object.entries(PROVEEDORES)) {
  ui.proveedor.add(new Option(nombre, id));
}

async function revisarConfig(): Promise<void> {
  try {
    const respuesta = await fetch("/api/config");
    const config = (await respuesta.json()) as {
      proveedor: string;
      idiomaOrigen: Idioma;
      idiomaDestino: Idioma;
      apiKeyConfigurada: boolean;
    };
    if (PROVEEDORES[config.proveedor]) ui.proveedor.value = config.proveedor;
    ui.direccion.value = config.idiomaOrigen === "en" && config.idiomaDestino === "es" ? "en-es" : "es-en";
    apiKeyConfigurada = config.apiKeyConfigurada;
    if (!apiKeyConfigurada) {
      avisar(
        "key",
        "error",
        "Falta la API key de OpenAI.",
        "Copia .env.example a .env, pon tu clave en OPENAI_API_KEY y reinicia el servidor (npm run dev). Luego recarga esta página.",
      );
    }
  } catch {
    avisar("key", "error", "No se pudo hablar con el servidor local. ¿Está corriendo `npm run dev`?");
  }
  ui.nombreProveedor.textContent = ui.proveedor.selectedOptions[0]?.textContent?.split(" ")[0] ?? "el proveedor";
  mostrarGrabando(false);
}

mostrarVoz();
render();
void revisarConfig();
