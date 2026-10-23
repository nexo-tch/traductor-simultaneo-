// Panel de transcripción bilingüe (SPEC.md, sección 5).
import { aplicarGlosario, type TerminoGlosario } from "../glosario/glosario";
import { formatoSegundos } from "../metrics/estadisticas";
import { latencias, type Fragmento } from "../metrics/registro";
import type { Idioma } from "../providers/tipos";

interface Nodos {
  raiz: HTMLLIElement;
  hablante: HTMLSpanElement;
  latencia: HTMLSpanElement;
  original: HTMLParagraphElement;
  traduccion: HTMLParagraphElement;
  firma: string;
}

/**
 * Texto confirmado + cola provisional en gris. Si el proveedor no confirma
 * palabra por palabra, todo el párrafo va en gris hasta cerrarse.
 */
function escribir(parrafo: HTMLParagraphElement, confirmado: string, provisional: string, todoParcial: boolean): void {
  parrafo.classList.toggle("parcial", todoParcial);
  if (!confirmado && !provisional) {
    parrafo.textContent = "…";
    return;
  }
  const cola = document.createElement("span");
  cola.className = "parcial";
  cola.textContent = provisional;
  parrafo.replaceChildren(confirmado, cola);
}

const formatoHora = new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export class PanelBilingue {
  private readonly nodos = new Map<number, Nodos>();
  private seguir = true;

  constructor(
    private readonly contenedor: HTMLElement,
    private readonly lista: HTMLOListElement,
    private readonly botonReciente: HTMLButtonElement,
  ) {
    // Al llegar al final (también por código) se vuelve a seguir lo más reciente.
    contenedor.addEventListener("scroll", () => {
      this.seguir = this.cercaDelFinal();
      this.botonReciente.hidden = this.seguir;
    });
    botonReciente.addEventListener("click", () => {
      this.seguir = true;
      this.botonReciente.hidden = true;
      this.irAlFinal();
    });
  }

  set vista(valor: "ambos" | "traduccion" | "original") {
    this.lista.dataset.vista = valor;
  }

  render(fragmentos: Fragmento[], glosario: TerminoGlosario[], origen: Idioma, destino: Idioma): void {
    let cambio = false;
    for (const f of fragmentos) {
      if (!f.original && !f.traduccion && !f.originalProvisional && !f.traduccionProvisional) continue;
      // Con voz continua, la traducción de esta intervención quedó en una anterior.
      const traduccion = f.traduccionEn !== undefined && !f.traduccion ? `(va en la traducción de arriba, #${f.traduccionEn})` : aplicarGlosario(f.traduccion, glosario);
      const traduccionProvisional = aplicarGlosario(f.traduccionProvisional, glosario);
      const l = latencias(f);
      const firma = [
        f.hablante,
        f.original,
        f.originalProvisional,
        traduccion,
        traduccionProvisional,
        f.originalFinal,
        f.traduccionFinal,
        l.cola,
        l.arranque,
        origen,
      ].join("|");
      let n = this.nodos.get(f.id);
      if (n && n.firma === firma) continue;
      if (!n) {
        n = this.crear(f);
        this.nodos.set(f.id, n);
        this.lista.append(n.raiz);
      }
      n.firma = firma;
      cambio = true;

      n.hablante.textContent = f.hablante;
      escribir(n.original, f.original, f.originalProvisional, !f.originalFinal && !f.porPalabra);
      n.original.lang = origen;
      escribir(n.traduccion, traduccion, traduccionProvisional, !f.traduccionFinal && !f.porPalabra);
      n.traduccion.lang = destino;
      n.latencia.textContent =
        l.cola === undefined ? "" : `${f.colaInterrumpida ? "≥ " : ""}${formatoSegundos(l.cola, true)}`;
      n.latencia.title = [
        l.cola === undefined
          ? ""
          : `La traducción siguió sonando ${formatoSegundos(l.cola)} después de que terminaste${f.colaInterrumpida ? " (o más: volviste a hablar antes)" : ""}.`,
        l.arranque === undefined ? "" : `Empezó a sonar ${formatoSegundos(l.arranque)} después de que empezaste a hablar.`,
      ]
        .filter(Boolean)
        .join(" ");
    }
    if (cambio && this.seguir) this.irAlFinal();
  }

  limpiar(): void {
    this.nodos.clear();
    this.lista.replaceChildren();
    this.seguir = true;
    this.botonReciente.hidden = true;
  }

  private crear(f: Fragmento): Nodos {
    const raiz = document.createElement("li");
    raiz.className = "entrada";
    const cabecera = document.createElement("div");
    cabecera.className = "entrada-cabecera";
    const hablante = document.createElement("span");
    hablante.className = "hablante";
    const hora = document.createElement("time");
    hora.dateTime = new Date(f.hora).toISOString();
    hora.textContent = formatoHora.format(f.hora);
    const latencia = document.createElement("span");
    latencia.className = "latencia";
    cabecera.append(hablante, hora, latencia);
    const original = document.createElement("p");
    original.className = "original";
    const traduccion = document.createElement("p");
    traduccion.className = "traduccion";
    raiz.append(cabecera, original, traduccion);
    return { raiz, hablante, latencia, original, traduccion, firma: "" };
  }

  private cercaDelFinal(): boolean {
    const c = this.contenedor;
    return c.scrollHeight - c.scrollTop - c.clientHeight < 48;
  }

  private irAlFinal(): void {
    this.contenedor.scrollTop = this.contenedor.scrollHeight;
  }
}
