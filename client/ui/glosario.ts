// Panel editable del glosario (SPEC.md, sección 5). Se guarda en el navegador
// y se puede llevar a un archivo JSON.
import {
  cargarGlosario,
  guardarGlosario,
  normalizarEntrada,
  type TerminoGlosario,
} from "../glosario/glosario";
import { descargar } from "../metrics/exportar";

const CAMPOS: { clave: keyof TerminoGlosario; etiqueta: string }[] = [
  { clave: "original", etiqueta: "Término original" },
  { clave: "traduccion", etiqueta: "Traducción deseada" },
  { clave: "nota", etiqueta: "Nota" },
  { clave: "variantes", etiqueta: "Variantes a corregir" },
];

export class PanelGlosario {
  terminos: TerminoGlosario[] = cargarGlosario();

  constructor(
    private readonly filas: HTMLTableSectionElement,
    agregar: HTMLButtonElement,
    exportar: HTMLButtonElement,
    importar: HTMLInputElement,
    private readonly alAviso: (mensaje: string) => void,
  ) {
    agregar.addEventListener("click", () => {
      this.terminos.push({ original: "", traduccion: "", nota: "", variantes: "" });
      this.render();
      this.filas.querySelector<HTMLInputElement>("tr:last-child input")?.focus();
    });
    exportar.addEventListener("click", () =>
      descargar("glosario.json", JSON.stringify(this.activos(), null, 2), "application/json"),
    );
    importar.addEventListener("change", async () => {
      const archivo = importar.files?.[0];
      importar.value = "";
      if (!archivo) return;
      try {
        const datos: unknown = JSON.parse(await archivo.text());
        if (!Array.isArray(datos)) throw new Error("no es una lista");
        this.terminos = datos.map(normalizarEntrada).filter((t): t is TerminoGlosario => t !== null);
        this.guardar();
        this.render();
      } catch {
        this.alAviso(`No se pudo cargar «${archivo.name}»: debe ser un JSON exportado desde este glosario.`);
      }
    });
    this.render();
  }

  /** Términos con texto (las filas vacías no cuentan). */
  activos(): TerminoGlosario[] {
    return this.terminos.filter((t) => t.original.trim());
  }

  private guardar(): void {
    guardarGlosario(this.activos());
  }

  private render(): void {
    this.filas.replaceChildren(
      ...this.terminos.map((termino, indice) => {
        const fila = document.createElement("tr");
        for (const { clave, etiqueta } of CAMPOS) {
          const celda = document.createElement("td");
          const entrada = document.createElement("input");
          entrada.type = "text";
          entrada.value = termino[clave];
          entrada.setAttribute("aria-label", `${etiqueta}, fila ${indice + 1}`);
          if (clave === "traduccion") entrada.placeholder = "(no traducir)";
          if (clave === "variantes") entrada.placeholder = "p. ej. Nexus, Next";
          entrada.addEventListener("input", () => {
            termino[clave] = entrada.value;
            this.guardar();
          });
          celda.append(entrada);
          fila.append(celda);
        }
        const celda = document.createElement("td");
        const quitar = document.createElement("button");
        quitar.type = "button";
        quitar.textContent = "✕";
        quitar.setAttribute("aria-label", `Quitar «${termino.original || `fila ${indice + 1}`}»`);
        quitar.addEventListener("click", () => {
          this.terminos.splice(indice, 1);
          this.guardar();
          this.render();
        });
        celda.append(quitar);
        fila.append(celda);
        return fila;
      }),
    );
  }
}
