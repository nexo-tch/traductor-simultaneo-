// Transcripción de la reunión para el panel. El audio de la pestaña de Meet llega
// mezclado (no se sabe quién habla), así que las entradas se separan por idioma y
// por pausas: una entrada nueva cuando cambia el idioma detectado o tras una pausa.
// Gemini solo traduce lo que no está en el idioma de destino; lo demás queda sin traducción.
//
// Es lógica pura: los tiempos entran como parámetro.

export interface Entrada {
  id: number;
  /** Código de dos letras que detectó Gemini ("es", "en"), o "" si no lo dijo. */
  idioma: string;
  original: string;
  traduccion: string;
  /** Reloj de pared al empezar. */
  hora: number;
}

const PAUSA_MS = 2000;

export class Transcripcion {
  readonly entradas: Entrada[] = [];
  private siguienteId = 1;
  private ultimoOriginal = -Infinity;
  private readonly cambiadas = new Set<Entrada>();

  constructor(
    private readonly destino: string,
    private readonly reloj: () => number = Date.now,
  ) {}

  original(texto: string, idioma: string | undefined, t: number): void {
    if (!texto) return;
    const codigo = idioma?.slice(0, 2).toLowerCase() ?? "";
    let entrada = this.entradas.at(-1);
    const otroIdioma = entrada && codigo && entrada.idioma && entrada.idioma !== codigo;
    if (!entrada || otroIdioma || t - this.ultimoOriginal > PAUSA_MS) entrada = this.nueva(codigo);
    entrada.idioma ||= codigo;
    entrada.original = entrada.original ? entrada.original + texto : texto.trimStart();
    this.ultimoOriginal = t;
    this.cambiadas.add(entrada);
  }

  /** La traducción va a la entrada más reciente que no está en el idioma de destino. */
  traduccion(texto: string): void {
    if (!texto) return;
    const entrada = [...this.entradas].reverse().find((e) => e.idioma !== this.destino) ?? this.nueva("");
    entrada.traduccion = entrada.traduccion ? entrada.traduccion + texto : texto.trimStart();
    this.cambiadas.add(entrada);
  }

  /** Entradas que cambiaron desde la última llamada. */
  tomarCambios(): Entrada[] {
    const cambios = [...this.cambiadas].map((e) => ({ ...e }));
    this.cambiadas.clear();
    return cambios;
  }

  private nueva(idioma: string): Entrada {
    const entrada: Entrada = { id: this.siguienteId++, idioma, original: "", traduccion: "", hora: this.reloj() };
    this.entradas.push(entrada);
    return entrada;
  }
}
