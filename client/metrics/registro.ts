// Registro de la sesión: arma los fragmentos (original + traducción) y sus
// marcas de tiempo (SPEC.md, 11.1).
//
// gpt-realtime-translate entrega el texto como un flujo continuo de pedazos,
// sin identificador de fragmento. Aquí se corta el original por pausas de voz
// (detector local) y por puntuación, y la traducción se asigna en orden al
// fragmento más antiguo que aún no tiene su traducción cerrada. Las latencias
// salen aproximadas, pero sirven para p50/p95.
//
// Es lógica pura: todos los tiempos entran como parámetro (performance.now()).

export interface ConfigRegistro {
  hablante: string;
  /** Tras el fin de la voz, cuánto se espera texto rezagado del original. */
  esperaTranscripcionMs: number;
  /** Silencio en la voz traducida que cierra la traducción de un fragmento. */
  silencioSalidaMs: number;
  /** Sin texto ni voz nueva durante este tiempo, se cierra la traducción pendiente. */
  esperaTraduccionMs: number;
  /** Mínimo de palabras para cortar el original en un punto final sin pausa. */
  palabrasMinCorte: number;
  /** Máximo de palabras: se corta en la siguiente coma, o a la fuerza a 1.5× este valor. */
  palabrasMax: number;
}

export const CONFIG_REGISTRO: ConfigRegistro = {
  hablante: "Hablante",
  esperaTranscripcionMs: 1500,
  silencioSalidaMs: 700,
  esperaTraduccionMs: 4000,
  palabrasMinCorte: 4,
  palabrasMax: 25,
};

export interface Fragmento {
  id: number;
  hablante: string;
  original: string;
  traduccion: string;
  originalFinal: boolean;
  traduccionFinal: boolean;
  /** true si el fin del habla se tomó del corte por puntuación y no de una pausa real. */
  finAproximado: boolean;
  /** Reloj de pared al empezar el fragmento (para el historial y la exportación). */
  hora: number;
  t_inicio_habla?: number;
  t_fin_habla?: number;
  t_primer_texto_original?: number;
  t_texto_original_final?: number;
  /** Última llegada de texto original (interno: aproxima el fin si se detiene sin pausa). */
  t_ultimo_texto_original?: number;
  t_primer_texto_traducido?: number;
  t_texto_traducido_final?: number;
  t_primer_audio_traducido?: number;
  t_fin_audio_traducido?: number;
  /** Momento en que se cierra el original si no llega más texto. */
  cierreEn?: number;
}

export interface Latencias {
  /** Principal (SPEC 11.1): primer audio traducido − fin del habla. Negativa = empezó antes de que terminara la frase. */
  voz?: number;
  /** Primer texto traducido − fin del habla. */
  texto?: number;
  /** Fin del audio traducido − fin del habla: cuánto tarda en terminar de sonar. */
  cierre?: number;
}

export function latencias(f: Fragmento): Latencias {
  const fin = f.t_fin_habla;
  if (fin === undefined) return {};
  const resta = (t?: number) => (t === undefined ? undefined : t - fin);
  return { voz: resta(f.t_primer_audio_traducido), texto: resta(f.t_primer_texto_traducido), cierre: resta(f.t_fin_audio_traducido) };
}

const FIN_ORACION = /[.?!…]["')\]]*$/;
const PAUSA = /[,;:]["')\]]*$/;

function palabras(texto: string): number {
  return texto.trim().split(/\s+/).filter(Boolean).length;
}

export class RegistroSesion {
  readonly fragmentos: Fragmento[] = [];
  private siguienteId = 1;
  private vozActiva = false;
  private inicioVoz?: number;
  private finVoz?: number;
  private salidaSonando = false;
  private ultimoSonido?: number;
  private ultimoTextoSalida?: number;
  private audioSinFragmento?: number;

  constructor(
    private readonly config: ConfigRegistro = CONFIG_REGISTRO,
    private readonly relojPared: () => number = Date.now,
  ) {}

  /** Cambio de actividad de la voz local (detector de voz sobre el micrófono o el archivo). */
  vozLocal(activa: boolean, t: number): void {
    const abierto = this.abiertoOriginal();
    if (activa) {
      this.vozActiva = true;
      this.inicioVoz = t;
      if (abierto) {
        if (abierto.t_fin_habla !== undefined) {
          // Empezó otra frase: el texto rezagado de la anterior tiene poco margen.
          abierto.cierreEn = Math.min(abierto.cierreEn ?? Infinity, t + 400);
        } else {
          abierto.t_inicio_habla ??= t;
          this.inicioVoz = undefined;
        }
      }
      return;
    }
    this.vozActiva = false;
    this.finVoz = t;
    if (abierto && abierto.t_fin_habla === undefined) {
      abierto.t_fin_habla = t;
      abierto.finAproximado = false;
      abierto.cierreEn = t + this.config.esperaTranscripcionMs;
    }
  }

  textoOriginal(delta: string, t: number): void {
    if (!delta) return;
    const f = this.abiertoOriginal() ?? this.nuevoFragmento(t);
    f.original = f.original ? f.original + delta : delta.trimStart();
    f.t_primer_texto_original ??= t;
    f.t_ultimo_texto_original = t;
    const texto = f.original.trim();
    const n = palabras(texto);

    if (f.t_fin_habla !== undefined) {
      // Ya hubo pausa: un punto final confirma que no viene más texto.
      if (FIN_ORACION.test(texto)) this.cerrarOriginal(f, t);
      return;
    }
    const cortar =
      (FIN_ORACION.test(texto) && n >= this.config.palabrasMinCorte) ||
      (PAUSA.test(texto) && n >= this.config.palabrasMax) ||
      n >= this.config.palabrasMax * 1.5;
    if (cortar) {
      // Habla continua sin pausa: se corta por puntuación y el fin es aproximado.
      f.t_fin_habla = t;
      f.finAproximado = true;
      this.cerrarOriginal(f, t);
      if (this.vozActiva) this.inicioVoz = t;
    }
  }

  textoTraducido(delta: string, t: number): void {
    if (!delta) return;
    const f = this.objetivoTraduccion() ?? this.nuevoFragmento(t);
    f.traduccion = f.traduccion ? f.traduccion + delta : delta.trimStart();
    f.t_primer_texto_traducido ??= t;
    this.ultimoTextoSalida = t;
    if (this.salidaSonando) f.t_primer_audio_traducido ??= t;

    // Un punto final con la frase original ya cerrada y otra esperando: pasa a la siguiente.
    if (f.originalFinal && FIN_ORACION.test(f.traduccion.trim()) && this.hayPosterior(f)) {
      this.cerrarTraduccion(f, t);
    }
  }

  /** Cambio de actividad de la voz traducida (detector sobre la pista de salida). */
  audioSalida(sonando: boolean, t: number): void {
    this.salidaSonando = sonando;
    this.ultimoSonido = t;
    if (!sonando) return;
    const f = this.objetivoTraduccion();
    if (f) {
      f.t_primer_audio_traducido ??= t;
    } else {
      this.audioSinFragmento = t;
    }
  }

  /** Revisa los plazos. Llamar seguido (cada ~100 ms). */
  tick(t: number): void {
    if (this.salidaSonando) this.ultimoSonido = t;
    for (const f of this.fragmentos) {
      if (!f.originalFinal && f.cierreEn !== undefined && t >= f.cierreEn) this.cerrarOriginal(f, t);
    }
    const f = this.objetivoTraduccion();
    if (!f || !f.originalFinal) return;
    const ultimaNovedad = Math.max(this.ultimoTextoSalida ?? -Infinity, f.t_texto_original_final ?? -Infinity);
    const silencioSalida =
      !this.salidaSonando &&
      f.t_primer_texto_traducido !== undefined &&
      t - (this.ultimoSonido ?? -Infinity) >= this.config.silencioSalidaMs &&
      t - (this.ultimoTextoSalida ?? -Infinity) >= this.config.silencioSalidaMs;
    if (silencioSalida || t - ultimaNovedad >= this.config.esperaTraduccionMs) this.cerrarTraduccion(f, t);
  }

  /** Cierra todo lo pendiente (al detener la sesión). */
  cerrarTodo(t: number): void {
    for (const f of this.fragmentos) {
      if (!f.originalFinal) {
        // Sin pausa antes de detener: el último texto recibido es la mejor aproximación del fin.
        if (f.t_fin_habla === undefined) {
          f.t_fin_habla = f.t_ultimo_texto_original ?? t;
          f.finAproximado = true;
        }
        this.cerrarOriginal(f, t);
      }
      if (!f.traduccionFinal) this.cerrarTraduccion(f, t);
    }
  }

  /** Tiempo desde el fin del habla del fragmento más antiguo cuya traducción no ha terminado (SPEC 8.3). */
  retrasoAcumulado(t: number): number {
    let masAntiguo: number | undefined;
    for (const f of this.fragmentos) {
      if (f.traduccionFinal || f.t_fin_habla === undefined) continue;
      masAntiguo = Math.min(masAntiguo ?? Infinity, f.t_fin_habla);
    }
    return masAntiguo === undefined ? 0 : Math.max(0, t - masAntiguo);
  }

  /** Fragmentos con traducción aún pendiente. */
  pendientes(): number {
    return this.fragmentos.filter((f) => !f.traduccionFinal && f.t_fin_habla !== undefined).length;
  }

  private abiertoOriginal(): Fragmento | undefined {
    const ultimo = this.fragmentos.at(-1);
    return ultimo && !ultimo.originalFinal ? ultimo : undefined;
  }

  private objetivoTraduccion(): Fragmento | undefined {
    return this.fragmentos.find((f) => !f.traduccionFinal);
  }

  private hayPosterior(f: Fragmento): boolean {
    return this.fragmentos.some((otro) => otro.id > f.id && otro.original.trim().length > 0);
  }

  private nuevoFragmento(t: number): Fragmento {
    // inicioVoz solo está definido mientras ningún fragmento lo haya usado.
    const inicio = this.vozActiva ? (this.inicioVoz ?? t) : t;
    if (this.vozActiva) this.inicioVoz = undefined;
    const f: Fragmento = {
      id: this.siguienteId++,
      hablante: this.config.hablante,
      original: "",
      traduccion: "",
      originalFinal: false,
      traduccionFinal: false,
      finAproximado: false,
      hora: this.relojPared(),
      t_inicio_habla: inicio,
    };
    // El texto llegó después de que la voz ya había terminado.
    if (!this.vozActiva && this.finVoz !== undefined && this.inicioVoz !== undefined && this.finVoz >= this.inicioVoz) {
      f.t_inicio_habla = this.inicioVoz;
      f.t_fin_habla = this.finVoz;
      f.cierreEn = Math.max(t, this.finVoz + this.config.esperaTranscripcionMs);
      this.inicioVoz = undefined;
    }
    if (this.audioSinFragmento !== undefined) {
      f.t_primer_audio_traducido = this.audioSinFragmento;
      this.audioSinFragmento = undefined;
    }
    this.fragmentos.push(f);
    return f;
  }

  private cerrarOriginal(f: Fragmento, t: number): void {
    f.originalFinal = true;
    f.original = f.original.trim();
    f.t_texto_original_final = t;
    f.cierreEn = undefined;
  }

  private cerrarTraduccion(f: Fragmento, t: number): void {
    f.traduccionFinal = true;
    f.traduccion = f.traduccion.trim();
    if (f.t_primer_texto_traducido !== undefined) f.t_texto_traducido_final = this.ultimoTextoSalida ?? t;
    if (f.t_primer_audio_traducido !== undefined) {
      const finAudio = this.salidaSonando ? t : (this.ultimoSonido ?? t);
      f.t_fin_audio_traducido = Math.max(finAudio, f.t_primer_audio_traducido);
    }
  }
}
