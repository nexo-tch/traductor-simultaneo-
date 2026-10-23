// Convierte un MediaStream en pedazos de PCM 16 bits mono a la frecuencia pedida,
// para proveedores que reciben audio crudo (Gemini Live: 16 kHz).
// Usa un AudioWorklet: corre en el hilo de audio, sin cortes aunque la pestaña esté en segundo plano.

const CODIGO_WORKLET = `
class Captura extends AudioWorkletProcessor {
  process(entradas) {
    const canal = entradas[0] && entradas[0][0];
    if (canal) this.port.postMessage(canal.slice(0));
    return true;
  }
}
registerProcessor("captura-pcm", Captura);
`;

export interface CapturaPcm {
  detener(): void;
}

/**
 * Llama a `alPedazo` con ~`pedazoMs` de audio cada vez. Chrome remuestrea el
 * MediaStream a la frecuencia del AudioContext.
 */
export async function capturarPcm(
  flujo: MediaStream,
  frecuencia: number,
  pedazoMs: number,
  alPedazo: (pcm: Int16Array) => void,
): Promise<CapturaPcm> {
  const contexto = new AudioContext({ sampleRate: frecuencia });
  const url = URL.createObjectURL(new Blob([CODIGO_WORKLET], { type: "application/javascript" }));
  try {
    await contexto.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const fuente = contexto.createMediaStreamSource(flujo);
  const nodo = new AudioWorkletNode(contexto, "captura-pcm");
  const porPedazo = Math.round((frecuencia * pedazoMs) / 1000);
  let acumulado = new Float32Array(porPedazo);
  let lleno = 0;

  nodo.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
    let desde = 0;
    while (desde < data.length) {
      const n = Math.min(data.length - desde, porPedazo - lleno);
      acumulado.set(data.subarray(desde, desde + n), lleno);
      lleno += n;
      desde += n;
      if (lleno === porPedazo) {
        const pcm = new Int16Array(porPedazo);
        for (let i = 0; i < porPedazo; i++) pcm[i] = Math.max(-1, Math.min(1, acumulado[i])) * 0x7fff;
        alPedazo(pcm);
        acumulado = new Float32Array(porPedazo);
        lleno = 0;
      }
    }
  };
  fuente.connect(nodo);
  await contexto.resume();

  return {
    detener: () => {
      nodo.port.onmessage = null;
      fuente.disconnect();
      nodo.disconnect();
      void contexto.close();
    },
  };
}

export function aBase64(bytes: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

export function deBase64(texto: string): Uint8Array {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
