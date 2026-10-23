// Detector de actividad por energía (VAD sencillo) sobre un MediaStream.
// Se usa en la entrada (para saber cuándo termina de hablarse un fragmento) y
// en la salida (para saber cuándo empieza a sonar la voz traducida).

export interface ConfigDetector {
  /** Nivel RMS (0–1) mínimo a partir del cual hay voz. */
  umbral: number;
  /**
   * Sube el umbral solo si el ruido de fondo lo pide: queda en el doble del nivel
   * del percentil 20 de los últimos 6 s. Con una nota de WhatsApp ruidosa, el umbral
   * fijo quedaba al nivel del ruido y el detector creía que siempre había voz.
   */
  autoCalibrar?: boolean;
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
  /** Umbral que se está usando (el configurado o el calibrado con el ruido). */
  umbralEfectivo = 0;
  private readonly historial: number[] = [];

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
    this.calibrar();

    if (this.nivel >= this.umbralEfectivo) {
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

  private calibrar(): void {
    this.umbralEfectivo = this.config.umbral;
    if (!this.config.autoCalibrar) return;
    this.historial.push(this.nivel);
    if (this.historial.length > 300) this.historial.shift(); // 6 s a 20 ms
    if (this.historial.length < 50) return;
    const orden = [...this.historial].sort((a, b) => a - b);
    const ruido = orden[Math.floor(orden.length * 0.2)];
    this.umbralEfectivo = Math.max(this.config.umbral, ruido * 2);
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
