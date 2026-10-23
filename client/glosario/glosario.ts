// Glosario (RF-08). gpt-realtime-translate no acepta glosario, así que aquí se
// usa para dos cosas: corregir los subtítulos traducidos y medir cuántos
// términos tradujo bien el modelo (criterio de aceptación del 90%).

export interface TerminoGlosario {
  /** Término tal como se dice en el idioma original. */
  original: string;
  /** Traducción deseada. Vacío = no traducir (debe salir igual que el original). */
  traduccion: string;
  nota: string;
  /** Formas erróneas que se vieron en la traducción, separadas por comas. Se reemplazan en los subtítulos. */
  variantes: string;
}

export interface ResultadoTermino {
  termino: string;
  esperado: string;
  correcto: boolean;
}

const LETRA = "[\\p{L}\\p{N}]";

/** Minúsculas y sin tildes, para comparar sin importar cómo lo escribió el modelo. */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patronPalabra(termino: string): RegExp {
  return new RegExp(`(?<!${LETRA})${escapar(termino.trim())}(?!${LETRA})`, "giu");
}

export function contieneTermino(texto: string, termino: string): boolean {
  if (!termino.trim()) return false;
  return patronPalabra(normalizar(termino)).test(normalizar(texto));
}

export function esperadoDe(termino: TerminoGlosario): string {
  return (termino.traduccion || termino.original).trim();
}

function variantesDe(termino: TerminoGlosario): string[] {
  const lista = termino.variantes
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  // Si hay traducción deseada y el modelo dejó el término sin traducir, también se corrige.
  if (termino.traduccion.trim() && normalizar(termino.traduccion) !== normalizar(termino.original)) {
    lista.push(termino.original.trim());
  }
  return lista;
}

/** Reemplaza en el texto traducido las variantes conocidas por la forma deseada. */
export function aplicarGlosario(traduccion: string, glosario: TerminoGlosario[]): string {
  let texto = traduccion;
  for (const termino of glosario) {
    if (!termino.original.trim()) continue;
    const esperado = esperadoDe(termino);
    for (const variante of variantesDe(termino)) {
      texto = texto.replace(patronPalabra(variante), esperado);
    }
  }
  return texto;
}

/** Para cada término que aparece en el original, revisa si la traducción trae la forma esperada. */
export function evaluarGlosario(original: string, traduccion: string, glosario: TerminoGlosario[]): ResultadoTermino[] {
  const resultados: ResultadoTermino[] = [];
  for (const termino of glosario) {
    if (!termino.original.trim() || !contieneTermino(original, termino.original)) continue;
    const esperado = esperadoDe(termino);
    resultados.push({ termino: termino.original.trim(), esperado, correcto: contieneTermino(traduccion, esperado) });
  }
  return resultados;
}

const CLAVE = "traductor.glosario.v1";

export function cargarGlosario(): TerminoGlosario[] {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE) ?? "[]");
    return Array.isArray(datos) ? datos.map(normalizarEntrada).filter((t): t is TerminoGlosario => t !== null) : [];
  } catch {
    return [];
  }
}

export function guardarGlosario(glosario: TerminoGlosario[]): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(glosario));
  } catch {
    // Sin almacenamiento (ventana privada): el glosario vive solo en esta pestaña.
  }
}

export function normalizarEntrada(valor: unknown): TerminoGlosario | null {
  if (!valor || typeof valor !== "object") return null;
  const v = valor as Record<string, unknown>;
  const texto = (x: unknown) => (typeof x === "string" ? x : "");
  return { original: texto(v.original), traduccion: texto(v.traduccion), nota: texto(v.nota), variantes: texto(v.variantes) };
}
