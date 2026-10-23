// Registro de la sesión: arma las intervenciones (original + traducción) y
// sus marcas de tiempo (SPEC.md, 11.1).
//
// gpt-realtime-translate entrega el texto como un flujo continuo, sin
// identificador de fragmento, y la traducción va unos segundos detrás. Por eso
// la unidad es la intervención: habla separada por una pausa larga (1.5 s por
// defecto), y la traducción se asigna a una intervención hasta que la voz
// traducida se calla después de que terminó de hablarse.
//
// La medida principal no depende de emparejar textos: la "cola" es cuánto
// sigue sonando la voz traducida después de que la persona deja de hablar.
//
// Es lógica pura: todos los tiempos entran como parámetro (performance.now()).

export interface ConfigRegistro {
  hablante: string;
  /** Pausa que separa dos intervenciones. */
  pausaIntervencionMs: number;
  /** Duración a partir de la cual una intervención se corta en la siguiente pausa corta. */
  maxIntervencionMs: number;
  /** Tras el fin de la intervención, cuánto se espera texto rezagado del original. */
  esperaTranscripcionMs: number;
  /** Silencio de la voz traducida que da por terminada la traducción si acaba en punto. */
  silencioSalidaMs: number;
  /** Igual, pero si la traducción no acaba en punto: el modelo suele callar a mitad de frase esperando contexto. */
  silencioSalidaLargoMs: number;
  /** Si la voz traducida no suena en este tiempo tras el fin del habla, se cierra sin más. */
  esperaTraduccionMs: number;
}

export const CONFIG_REGISTRO: ConfigRegistro = {
  hablante: "Hablante",
  pausaIntervencionMs: 1500,
  maxIntervencionMs: 30000,
  esperaTranscripcionMs: 1500,
  silencioSalidaMs: 600,
  silencioSalidaLargoMs: 2000,
  esperaTraduccionMs: 4000,
};

export interface Fragmento {
  id: number;
  hablante: string;
  original: string;
  traduccion: string;
  /** Cola sin confirmar (solo proveedores que la entregan): se muestra en gris y no se exporta. */
  originalProvisional: string;
  traduccionProvisional: string;
  /** El proveedor confirma palabra por palabra: lo confirmado se muestra sólido aunque la intervención siga abierta. */
  porPalabra: boolean;
  originalFinal: boolean;
  traduccionFinal: boolean;
  /** Se cortó por durar demasiado, sin pausa larga: no tiene cola medible. */
  corteForzado: boolean;
  /** La persona volvió a hablar antes de que terminara la voz traducida. */
  colaInterrumpida: boolean;
  /** Reloj de pared al empezar (para el historial y la exportación). */
  hora: number;
  t_inicio_habla?: number;
  t_fin_habla?: number;
  t_primer_texto_original?: number;
  t_ultimo_texto_original?: number;
  t_texto_original_final?: number;
  t_primer_texto_traducido?: number;
  t_texto_traducido_final?: number;
  t_primer_audio_traducido?: number;
  t_fin_audio_traducido?: number;
  /** La voz traducida empezó a sonar desde silencio dentro de esta intervención. */
  arranqueLimpio: boolean;
  /** Momento en que se cierra el original si no llega más texto. */
  cierreEn?: number;
  /** Momento en que la persona volvió a hablar (si interrumpió la cola). */
  t_reinicio_habla?: number;
  /**
   * Id de la intervención cuya traducción incluye la de esta: la voz traducida siguió
   * sin pausa (proveedores de voz continua, como Gemini) y el texto quedó allá.
   */
  traduccionEn?: number;
  /** Esta traducción incluye la de intervenciones siguientes: su cola se mide en la última. */
  incluyeSiguientes: boolean;
}

export interface Latencias {
  /**
   * Principal: fin del audio traducido − fin del habla. Si la persona volvió a
   * hablar antes, es una cota inferior (reinicio − fin del habla).
   */
  cola?: number;
  /** Primer audio traducido − inicio del habla (solo si la voz arrancó desde silencio). */
  arranque?: number;
}

export function latencias(f: Fragmento): Latencias {
  const resultado: Latencias = {};
  if (f.arranqueLimpio && f.t_primer_audio_traducido !== undefined && f.t_inicio_habla !== undefined) {
    resultado.arranque = f.t_primer_audio_traducido - f.t_inicio_habla;
  }
  if (f.corteForzado || f.incluyeSiguientes || f.t_fin_habla === undefined || !f.traduccionFinal) return resultado;
  if (f.colaInterrumpida && f.t_reinicio_habla !== undefined) {
    resultado.cola = f.t_reinicio_habla - f.t_fin_habla;
  } else if (f.t_fin_audio_traducido !== undefined && f.t_fin_audio_traducido >= f.t_fin_habla) {
    resultado.cola = f.t_fin_audio_traducido - f.t_fin_habla;
  }
  return resultado;
}

const FIN_ORACION = /[.?!…]["')\]]*$/;

export class RegistroSesion {
  readonly fragmentos: Fragmento[] = [];
  private siguienteId = 1;
  private vozActiva = false;
  private inicioVoz?: number;
  private finVoz?: number;
  private salidaSonando = false;
  private ultimoSonido?: number;
  private ultimoTextoSalida?: number;

  constructor(
    /** Se puede ajustar en vivo (Ajustes). */
    public config: ConfigRegistro = { ...CONFIG_REGISTRO },
    private readonly relojPared: () => number = Date.now,
  ) {}

  /** Cambio de actividad de la voz local (detector de voz sobre el micrófono o el archivo). */
  vozLocal(activa: boolean, t: number): void {
    const abierto = this.abiertoOriginal();
    if (!activa) {
      this.vozActiva = false;
      this.finVoz = t;
      if (abierto) {
        // Fin provisional: si vuelve a hablar antes de la pausa larga, sigue la misma intervención.
        abierto.t_fin_habla = t;
        abierto.cierreEn = t + Math.max(this.config.pausaIntervencionMs, this.config.esperaTranscripcionMs);
      }
      return;
    }

    this.vozActiva = true;
    if (!abierto) {
      this.inicioVoz = t;
      this.marcarReinicio(t);
      return;
    }
    if (abierto.t_fin_habla === undefined) {
      // El texto llegó antes que el detector: la intervención ya está abierta.
      abierto.t_inicio_habla ??= t;
      return;
    }
    const pausa = t - abierto.t_fin_habla;
    const larga = abierto.t_inicio_habla !== undefined && t - abierto.t_inicio_habla >= this.config.maxIntervencionMs;
    if (pausa < this.config.pausaIntervencionMs && !larga) {
      abierto.t_fin_habla = undefined;
      abierto.cierreEn = undefined;
      return;
    }
    // Empieza otra intervención. El texto rezagado de la anterior tiene poco margen.
    if (pausa < this.config.pausaIntervencionMs) abierto.corteForzado = true;
    abierto.cierreEn = Math.min(abierto.cierreEn ?? Infinity, t + 400);
    this.inicioVoz = t;
    this.marcarReinicio(t);
  }

  textoOriginal(delta: string, t: number): void {
    if (!delta) return;
    const abierto = this.abiertoOriginal();
    if (abierto?.cierreEn !== undefined && t >= abierto.cierreEn) this.cerrarOriginal(abierto, t);
    const f = this.abiertoOriginal() ?? this.nuevoFragmento(t);
    f.original = f.original ? f.original + delta : delta.trimStart();
    f.t_primer_texto_original ??= t;
    f.t_ultimo_texto_original = t;
  }

  /** Reemplaza la cola sin confirmar del original. */
  textoOriginalProvisional(texto: string, t: number): void {
    const abierto = this.abiertoOriginal();
    if (!texto.trim()) {
      if (abierto) abierto.originalProvisional = "";
      return;
    }
    const f = abierto ?? this.nuevoFragmento(t);
    f.porPalabra = true;
    f.originalProvisional = f.original ? texto : texto.trimStart();
    f.t_primer_texto_original ??= t;
  }

  /** Reemplaza la cola sin confirmar de la traducción. */
  textoTraducidoProvisional(texto: string, t: number): void {
    const objetivo = this.objetivoTraduccion();
    if (!texto.trim()) {
      if (objetivo) objetivo.traduccionProvisional = "";
      return;
    }
    const f = objetivo ?? this.nuevoFragmento(t);
    f.porPalabra = true;
    f.traduccionProvisional = f.traduccion ? texto : texto.trimStart();
    f.t_primer_texto_traducido ??= t;
    this.ultimoTextoSalida = t;
  }

  textoTraducido(delta: string, t: number): void {
    if (!delta) return;
    const f = this.objetivoTraduccion() ?? this.nuevoFragmento(t);
    f.traduccion = f.traduccion ? f.traduccion + delta : delta.trimStart();
    f.t_primer_texto_traducido ??= t;
    this.ultimoTextoSalida = t;
    if (this.salidaSonando) f.t_primer_audio_traducido ??= t;
  }

  /** Cambio de actividad de la voz traducida (detector sobre la pista de salida). */
  audioSalida(sonando: boolean, t: number): void {
    this.salidaSonando = sonando;
    this.ultimoSonido = t;
    if (!sonando) return;
    const f = this.objetivoTraduccion() ?? this.abiertoOriginal();
    if (f && f.t_primer_audio_traducido === undefined) {
      f.t_primer_audio_traducido = t;
      f.arranqueLimpio = true;
    }
  }

  /** Revisa los plazos. Llamar seguido (cada ~100 ms). */
  tick(t: number): void {
    if (this.salidaSonando) this.ultimoSonido = t;
    for (const f of this.fragmentos) {
      if (!f.originalFinal && f.cierreEn !== undefined && t >= f.cierreEn) this.cerrarOriginal(f, t);
    }
    const f = this.objetivoTraduccion();
    if (!f || !f.originalFinal || f.t_fin_habla === undefined) return;
    const silencio = FIN_ORACION.test(f.traduccion.trim()) ? this.config.silencioSalidaMs : this.config.silencioSalidaLargoMs;
    const callada =
      !this.salidaSonando &&
      t - (this.ultimoSonido ?? -Infinity) >= silencio &&
      t - (this.ultimoTextoSalida ?? -Infinity) >= silencio;
    const habloDespues = (this.ultimoSonido ?? -Infinity) > f.t_fin_habla;
    if ((callada && habloDespues) || (callada && t - f.t_fin_habla >= this.config.esperaTraduccionMs)) {
      this.cerrarTraduccion(f);
    }
  }

  /** Cierra todo lo pendiente (al detener la sesión). */
  cerrarTodo(t: number): void {
    for (const f of this.fragmentos) {
      if (!f.originalFinal) {
        if (f.t_fin_habla === undefined) {
          // Se detuvo hablando: no hay pausa real, así que no hay cola medible.
          f.t_fin_habla = f.t_ultimo_texto_original ?? t;
          f.corteForzado = true;
        }
        this.cerrarOriginal(f, t);
      }
      if (!f.traduccionFinal) this.cerrarTraduccion(f);
    }
  }

  /**
   * Cuánto lleva sonando la voz traducida desde que la persona dejó de hablar
   * (SPEC 8.3). Mientras la persona habla no se puede saber, y vale 0.
   */
  retrasoAcumulado(t: number): number {
    const f = this.objetivoTraduccion();
    if (!f || this.vozActiva || f.t_fin_habla === undefined) return 0;
    return Math.max(0, t - f.t_fin_habla);
  }

  private marcarReinicio(t: number): void {
    // La persona vuelve a hablar mientras la traducción de lo anterior sigue pendiente.
    for (const f of this.fragmentos) {
      if (f.originalFinal || f.cierreEn !== undefined) {
        if (!f.traduccionFinal && f.t_fin_habla !== undefined && f.t_reinicio_habla === undefined && !f.corteForzado) {
          f.t_reinicio_habla = t;
          f.colaInterrumpida = true;
        }
      }
    }
  }

  private abiertoOriginal(): Fragmento | undefined {
    const ultimo = this.fragmentos.at(-1);
    return ultimo && !ultimo.originalFinal ? ultimo : undefined;
  }

  private objetivoTraduccion(): Fragmento | undefined {
    return this.fragmentos.find((f) => !f.traduccionFinal);
  }

  private nuevoFragmento(t: number): Fragmento {
    const f: Fragmento = {
      id: this.siguienteId++,
      hablante: this.config.hablante,
      original: "",
      traduccion: "",
      originalProvisional: "",
      traduccionProvisional: "",
      porPalabra: false,
      originalFinal: false,
      traduccionFinal: false,
      corteForzado: false,
      colaInterrumpida: false,
      arranqueLimpio: false,
      incluyeSiguientes: false,
      hora: this.relojPared(),
      t_inicio_habla: this.inicioVoz ?? t,
    };
    // El texto llegó cuando la voz ya había terminado: se cerrará con el plazo normal.
    if (!this.vozActiva) {
      const conVoz = this.inicioVoz !== undefined && this.finVoz !== undefined && this.finVoz >= this.inicioVoz;
      const fin = conVoz ? this.finVoz! : t;
      f.t_fin_habla = fin;
      f.cierreEn = Math.max(t, fin + this.config.pausaIntervencionMs);
    }
    this.inicioVoz = undefined;
    this.fragmentos.push(f);
    return f;
  }

  private cerrarOriginal(f: Fragmento, t: number): void {
    f.originalFinal = true;
    f.original = f.original.trim();
    f.originalProvisional = "";
    f.t_texto_original_final = t;
    f.cierreEn = undefined;
  }

  private cerrarTraduccion(f: Fragmento): void {
    f.traduccionFinal = true;
    f.traduccion = f.traduccion.trim();
    f.traduccionProvisional = "";
    if (f.t_primer_texto_traducido !== undefined) f.t_texto_traducido_final = this.ultimoTextoSalida;
    if (f.t_primer_audio_traducido !== undefined && this.ultimoSonido !== undefined) {
      f.t_fin_audio_traducido = Math.max(this.ultimoSonido, f.t_primer_audio_traducido);
    }
    this.unirSiguientes(f);
  }

  /**
   * Si llegó traducción a esta intervención después de que terminaran de hablarse las
   * siguientes, ese texto era de ellas (la voz siguió sin pausa). Se marcan como
   * traducidas aquí y la cola se mide en la última, contra el fin del audio.
   */
  private unirSiguientes(f: Fragmento): void {
    const ultimoTexto = f.t_texto_traducido_final;
    if (ultimoTexto === undefined) return;
    const unidas = this.fragmentos.filter(
      (g) => g.id > f.id && g.originalFinal && !g.traduccionFinal && !g.traduccion && g.t_fin_habla !== undefined && g.t_fin_habla < ultimoTexto,
    );
    if (!unidas.length) return;
    f.incluyeSiguientes = true;
    for (const g of unidas) {
      g.traduccionEn = f.id;
      g.traduccionFinal = true;
      g.traduccionProvisional = "";
    }
    const ultima = unidas.at(-1)!;
    if (f.t_fin_audio_traducido !== undefined) ultima.t_fin_audio_traducido = f.t_fin_audio_traducido;
    // Las intermedias no tienen cola propia: la persona siguió hablando.
    for (const g of unidas.slice(0, -1)) g.corteForzado = true;
  }
}
