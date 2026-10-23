// Detector de actividad por energía (VAD sencillo) sobre un MediaStream.
// Se usa en la entrada (para saber cuándo termina de hablarse un fragmento) y
// en la salida (para saber cuándo empieza a sonar la voz traducida).

export interface ConfigDetector {
  /** Nivel RMS (0–1) a partir del cual hay voz. */
  umbral: number;
  /** Silencio continuo necesario para dar la voz por terminada. */
  silencioMs: number;
}

export class DetectorActividad {
  private readonly analizador: AnalyserNode;
  private readonly fuente: MediaStreamAudioSourceNode;
  private readonly muestras: Float32Array<ArrayBuffer>;
  private intervalo: number | undefined;
  private activa = false;
  private ultimaVoz = 0;
  /** Último nivel medido, para el medidor de la interfaz. */
  nivel = 0;

  constructor(
    contexto: AudioContext,
    flujo: MediaStream,
    public config: ConfigDetector,
    private readonly alCambiar: (activa: boolean, t: number) => void,
  ) {
    this.fuente = contexto.createMediaStreamSource(flujo);
    this.analizador = contexto.createAnalyser();
    this.analizador.fftSize = 1024;
    this.muestras = new Float32Array(this.analizador.fftSize);
    this.fuente.connect(this.analizador);
    // Cada 20 ms. Chrome no frena los temporizadores de una pestaña que reproduce audio.
    this.intervalo = window.setInterval(() => this.medir(), 20);
  }

  private medir(): void {
    this.analizador.getFloatTimeDomainData(this.muestras);
    let suma = 0;
    for (const m of this.muestras) suma += m * m;
    this.nivel = Math.sqrt(suma / this.muestras.length);
    const ahora = performance.now();

    if (this.nivel >= this.config.umbral) {
      this.ultimaVoz = ahora;
      if (!this.activa) {
        this.activa = true;
        this.alCambiar(true, ahora);
      }
    } else if (this.activa && ahora - this.ultimaVoz >= this.config.silencioMs) {
      this.activa = false;
      // El fin real fue cuando se oyó voz por última vez, no cuando se confirmó el silencio.
      this.alCambiar(false, this.ultimaVoz);
    }
  }

  detener(): void {
    window.clearInterval(this.intervalo);
    this.fuente.disconnect();
    if (this.activa) {
      this.activa = false;
      this.alCambiar(false, this.ultimaVoz);
    }
  }
}
