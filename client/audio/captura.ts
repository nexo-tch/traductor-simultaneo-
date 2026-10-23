// Fuentes de audio: micrófono (RF-01) o archivo de prueba (RF-13).

export class ErrorCaptura extends Error {
  constructor(
    mensaje: string,
    readonly codigo: "sin_permiso" | "sin_microfono" | "archivo_invalido" | "otro",
  ) {
    super(mensaje);
  }
}

export interface Fuente {
  flujo: MediaStream;
  detener(): void;
  /** Solo en archivos: se llama cuando el archivo termina de sonar. */
  alTerminar?: (cb: () => void) => void;
  /** Solo en archivos: volumen del original en los audífonos (0–1), con una transición corta. */
  volumenOriginal?: (valor: number) => void;
}

export async function microfono(): Promise<Fuente> {
  let flujo: MediaStream;
  try {
    flujo = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (error) {
    const nombre = error instanceof DOMException ? error.name : "";
    if (nombre === "NotAllowedError" || nombre === "SecurityError") {
      throw new ErrorCaptura("No hay permiso para usar el micrófono.", "sin_permiso");
    }
    if (nombre === "NotFoundError" || nombre === "OverconstrainedError") {
      throw new ErrorCaptura("No se encontró ningún micrófono. Conecta uno y vuelve a intentar.", "sin_microfono");
    }
    throw new ErrorCaptura(`No se pudo abrir el micrófono: ${error instanceof Error ? error.message : error}`, "otro");
  }
  return { flujo, detener: () => flujo.getTracks().forEach((p) => p.stop()) };
}

/**
 * Reproduce un archivo como si fuera el micrófono. `monitor` es el volumen al
 * que se oye el original por los audífonos (0 = no se oye).
 */
export async function archivoDePrueba(contexto: AudioContext, archivo: File, monitor: number): Promise<Fuente> {
  let buffer: AudioBuffer;
  try {
    buffer = await contexto.decodeAudioData(await archivo.arrayBuffer());
  } catch {
    throw new ErrorCaptura(`No se pudo leer «${archivo.name}». Usa un WAV, MP3, OGG o M4A.`, "archivo_invalido");
  }
  const origen = contexto.createBufferSource();
  origen.buffer = buffer;
  const destino = contexto.createMediaStreamDestination();
  destino.channelCount = 1;
  origen.connect(destino);

  const volumen = contexto.createGain();
  volumen.gain.value = monitor;
  origen.connect(volumen).connect(contexto.destination);

  origen.start();
  let terminado = false;
  const esperando: (() => void)[] = [];
  origen.onended = () => {
    terminado = true;
    esperando.forEach((cb) => cb());
  };

  return {
    flujo: destino.stream,
    detener: () => {
      origen.onended = null;
      if (!terminado) origen.stop();
      origen.disconnect();
      volumen.disconnect();
      destino.stream.getTracks().forEach((p) => p.stop());
    },
    alTerminar: (cb) => (terminado ? cb() : esperando.push(cb)),
    // 60 ms para bajar o subir: sin golpes de volumen, y muy por debajo de lo que se percibe como retraso.
    volumenOriginal: (valor) => volumen.gain.setTargetAtTime(valor, contexto.currentTime, 0.06),
  };
}
