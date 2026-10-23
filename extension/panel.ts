// Panel lateral junto a Meet: controles y transcripción bilingüe en vivo.
import { formatoSegundos } from "../client/metrics/estadisticas";
import type { EstadoConexion } from "../client/providers/tipos";
import { enviar, guardarAjustes, leerAjustes, type Ajustes, type AlPanel, type Foto } from "./mensajes";
import type { Entrada } from "./transcripcion";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  empezar: $<HTMLButtonElement>("btn-empezar"),
  estado: $("estado"),
  retraso: $("retraso"),
  destino: $<HTMLSelectElement>("destino"),
  voz: $<HTMLButtonElement>("btn-voz"),
  volVoz: $<HTMLInputElement>("vol-voz"),
  volOriginal: $<HTMLInputElement>("vol-original"),
  ducking: $<HTMLInputElement>("ducking"),
  vista: $<HTMLSelectElement>("vista"),
  limpiar: $<HTMLButtonElement>("btn-limpiar"),
  avisos: $("avisos"),
  contenedor: $("contenedor"),
  vacio: $("vacio"),
  lista: $<HTMLOListElement>("lista"),
  nivel: $<HTMLMeterElement>("nivel"),
  registro: $<HTMLPreElement>("registro"),
  copiar: $<HTMLButtonElement>("btn-copiar"),
  servidor: $<HTMLInputElement>("servidor"),
  codigo: $<HTMLInputElement>("codigo"),
  conexion: $<HTMLDetailsElement>("conexion"),
};

const TEXTO_ESTADO: Record<EstadoConexion, string> = {
  desconectado: "Detenido",
  conectando: "Conectando…",
  conectado: "Traduciendo",
  reconectando: "Reconectando…",
  error: "Error",
};
const NOMBRE_IDIOMA: Record<string, string> = { es: "Español", en: "Inglés" };
const formatoHora = new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit" });

let ajustes: Ajustes;
let activo = false;
const nodos = new Map<number, HTMLLIElement>();

// ---------- Ajustes ----------

function mostrarAjustes(a: Ajustes): void {
  ui.destino.value = a.destino;
  ui.voz.setAttribute("aria-pressed", String(a.vozEncendida));
  ui.voz.querySelector("strong")!.textContent = a.vozEncendida ? "encendida" : "apagada";
  ui.volVoz.value = String(a.volumenVoz);
  ui.volOriginal.value = String(a.volumenOriginal);
  ui.ducking.checked = a.ducking;
  ui.vista.value = a.vista;
  ui.lista.dataset.vista = a.vista;
  ui.servidor.value = a.servidor;
  ui.codigo.value = a.codigo;
}

async function cambiar(parcial: Partial<Ajustes>): Promise<void> {
  const destinoAntes = ajustes.destino;
  ajustes = { ...ajustes, ...parcial };
  mostrarAjustes(ajustes);
  await guardarAjustes(ajustes);
  await enviar({ para: "documento", tipo: "ajustes", ajustes });
  // El idioma de destino va en el token de Gemini: hay que abrir otra sesión.
  if (activo && ajustes.destino !== destinoAntes) await enviar({ para: "fondo", tipo: "iniciar", misma: true });
}

ui.destino.addEventListener("change", () => void cambiar({ destino: ui.destino.value === "en" ? "en" : "es" }));
ui.voz.addEventListener("click", () => void cambiar({ vozEncendida: !ajustes.vozEncendida }));
ui.volVoz.addEventListener("input", () => void cambiar({ volumenVoz: Number(ui.volVoz.value) }));
ui.volOriginal.addEventListener("input", () => void cambiar({ volumenOriginal: Number(ui.volOriginal.value) }));
ui.ducking.addEventListener("change", () => void cambiar({ ducking: ui.ducking.checked }));
ui.vista.addEventListener("change", () => void cambiar({ vista: ui.vista.value === "traduccion" ? "traduccion" : "ambos" }));

ui.servidor.addEventListener("change", () => void cambiar({ servidor: ui.servidor.value.trim().replace(/\/+$/, "") }));
ui.codigo.addEventListener("change", () => void cambiar({ codigo: ui.codigo.value.trim() }));

ui.empezar.addEventListener("click", async () => {
  ui.avisos.replaceChildren();
  await enviar({ para: "fondo", tipo: activo ? "detener" : "iniciar" });
});
ui.limpiar.addEventListener("click", async () => {
  await enviar({ para: "documento", tipo: "limpiar" });
  nodos.clear();
  ui.lista.replaceChildren();
  ui.vacio.hidden = false;
});

// ---------- Estado y transcripción ----------

function mostrarEstado(foto: Omit<Foto, "entradas" | "diagnostico">): void {
  activo = foto.activo;
  // Un documento de una versión anterior no manda estos campos: sin el ?? 0 el medidor lanza y el panel no se actualiza.
  const nivel = foto.nivel ?? 0;
  ui.nivel.value = nivel;
  ui.nivel.title = `Nivel ${nivel.toFixed(3)} · sesión de ${Math.round(foto.duracionS ?? 0)} s`;
  ui.empezar.textContent = activo ? "Detener" : "Empezar";
  ui.empezar.dataset.activo = String(activo);
  ui.estado.dataset.estado = foto.estado;
  ui.estado.querySelector(".texto")!.textContent = TEXTO_ESTADO[foto.estado];
  ui.estado.title = foto.detalle ?? "";
  ui.retraso.textContent = activo ? formatoSegundos(foto.retrasoMs) : "—";
  ui.retraso.dataset.nivel = foto.retrasoMs > 5000 ? "alto" : foto.retrasoMs > 3000 ? "medio" : "";
  if (foto.estado === "reconectando" && foto.detalle) avisar("alerta", foto.detalle, "conexion");
  if (foto.estado === "conectado") ui.avisos.querySelector('[data-clave="conexion"]')?.remove();
}

function mostrarDiagnostico(lineas: string[] | undefined): void {
  if (!lineas?.length) return;
  ui.registro.textContent += lineas.join("\n") + "\n";
  ui.registro.scrollTop = ui.registro.scrollHeight;
}

ui.copiar.addEventListener("click", async () => {
  await navigator.clipboard.writeText(ui.registro.textContent ?? "");
  ui.copiar.textContent = "Copiado";
  setTimeout(() => (ui.copiar.textContent = "Copiar diagnóstico"), 1500);
});

function cercaDelFinal(): boolean {
  const c = ui.contenedor;
  return c.scrollHeight - c.scrollTop - c.clientHeight < 48;
}

function mostrarEntradas(entradas: Entrada[]): void {
  if (!entradas.length) return;
  const seguir = cercaDelFinal();
  for (const e of entradas) {
    let nodo = nodos.get(e.id);
    if (!nodo) {
      nodo = document.createElement("li");
      nodo.className = "entrada";
      nodo.innerHTML = '<div class="cabecera"><span class="idioma"></span><time></time></div><p class="original"></p><p class="traduccion"></p>';
      nodo.querySelector("time")!.textContent = formatoHora.format(e.hora);
      nodos.set(e.id, nodo);
      ui.lista.append(nodo);
    }
    const propio = e.idioma === ajustes.destino;
    nodo.dataset.propio = String(propio);
    nodo.querySelector(".idioma")!.textContent = NOMBRE_IDIOMA[e.idioma] ?? "";
    const original = nodo.querySelector<HTMLParagraphElement>(".original")!;
    original.textContent = e.original;
    original.lang = e.idioma;
    const traduccion = nodo.querySelector<HTMLParagraphElement>(".traduccion")!;
    traduccion.textContent = e.traduccion;
    traduccion.lang = ajustes.destino;
    traduccion.hidden = !e.traduccion;
  }
  ui.vacio.hidden = nodos.size > 0;
  if (seguir) ui.contenedor.scrollTop = ui.contenedor.scrollHeight;
}

function avisar(nivel: "error" | "alerta", texto: string, clave = texto): void {
  ui.avisos.querySelector(`[data-clave="${CSS.escape(clave)}"]`)?.remove();
  const aviso = document.createElement("div");
  aviso.className = "aviso";
  aviso.dataset.nivel = nivel;
  aviso.dataset.clave = clave;
  const p = document.createElement("p");
  p.textContent = texto;
  const cerrar = document.createElement("button");
  cerrar.type = "button";
  cerrar.textContent = "Cerrar";
  cerrar.addEventListener("click", () => aviso.remove());
  aviso.append(p, cerrar);
  ui.avisos.append(aviso);
}

chrome.runtime.onMessage.addListener((mensaje: AlPanel) => {
  if (mensaje.para !== "panel") return;
  if (mensaje.tipo === "cambios") {
    mostrarEstado(mensaje.foto);
    mostrarEntradas(mensaje.entradas);
    mostrarDiagnostico(mensaje.diagnostico);
  } else if (mensaje.tipo === "aviso") {
    avisar(mensaje.nivel, mensaje.texto);
  } else if (mensaje.tipo === "ajustes") {
    ajustes = mensaje.ajustes;
    mostrarAjustes(ajustes);
  }
});

async function arrancar(): Promise<void> {
  $("version").textContent = `Versión ${chrome.runtime.getManifest().version}`;
  ajustes = await leerAjustes();
  mostrarAjustes(ajustes);
  // Con un servidor publicado hace falta el código: se abre la sección para que lo pongan.
  if (!ajustes.servidor.includes("127.0.0.1") && !ajustes.codigo) ui.conexion.open = true;
  // Si el panel se abre con una traducción en curso, se trae lo que ya hay.
  const foto = await enviar<Foto>({ para: "documento", tipo: "foto" });
  if (foto?.entradas) {
    mostrarEstado(foto);
    mostrarEntradas(foto.entradas);
    mostrarDiagnostico(foto.diagnostico);
  }
}

void arrancar();
