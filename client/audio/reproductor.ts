// Cola de voz para proveedores que entregan audio en pedazos (SPEC.md 6 y 8.3).
// Reproduce PCM 16 bits en orden, sin huecos, y expone cuánto audio falta por
// sonar para que el adaptador pueda acelerar la voz o descartar lo pendiente.
// La salida es un MediaStream, igual que la pista de WebRTC de OpenAI, para que
// el resto de la app (silenciar, volumen, métricas) funcione igual.

export class ReproductorPcm {
  private readonly contexto: AudioContext;
  private readonly destino: MediaStreamAudioDestinationNode;
  private readonly fuentes = new Set<AudioBufferSourceNode>();
  private siguiente = 0;
  private sobrante: number | null = null;

  constructor(private readonly frecuencia: number) {
    this.contexto = new AudioContext();
    this.destino = this.contexto.createMediaStreamDestination();
  }

  get flujo(): MediaStream {
    return this.destino.stream;
  }

  async reanudar(): Promise<void> {
    if (this.contexto.state === "suspended") await this.contexto.resume();
  }

  /** Segundos de audio en cola que aún no han sonado. */
  get pendiente(): number {
    return Math.max(0, this.siguiente - this.contexto.currentTime);
  }

  /** Agrega un pedazo de PCM s16le mono. Un byte suelto se guarda para el siguiente pedazo. */
  agregar(bytes: Uint8Array): void {
    let datos = bytes;
    if (this.sobrante !== null) {
      datos = new Uint8Array(bytes.length + 1);
      datos[0] = this.sobrante;
      datos.set(bytes, 1);
      this.sobrante = null;
    }
    if (datos.length % 2 === 1) {
      this.sobrante = datos[datos.length - 1];
      datos = datos.subarray(0, datos.length - 1);
    }
    if (datos.length === 0) return;

    const vista = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
    const muestras = new Float32Array(datos.length / 2);
    for (let i = 0; i < muestras.length; i++) muestras[i] = vista.getInt16(i * 2, true) / 32768;

    const buffer = this.contexto.createBuffer(1, muestras.length, this.frecuencia);
    buffer.copyToChannel(muestras, 0);
    const fuente = this.contexto.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(this.destino);
    // Un margen de 20 ms evita cortes cuando la cola está vacía.
    const inicio = Math.max(this.contexto.currentTime + 0.02, this.siguiente);
    fuente.start(inicio);
    this.siguiente = inicio + buffer.duration;
    this.fuentes.add(fuente);
    fuente.onended = () => this.fuentes.delete(fuente);
  }

  /** Corta lo que está sonando y descarta todo lo pendiente. */
  vaciar(): void {
    for (const fuente of this.fuentes) {
      fuente.onended = null;
      fuente.stop();
    }
    this.fuentes.clear();
    this.siguiente = 0;
    this.sobrante = null;
  }

  cerrar(): void {
    this.vaciar();
    void this.contexto.close();
  }
}
