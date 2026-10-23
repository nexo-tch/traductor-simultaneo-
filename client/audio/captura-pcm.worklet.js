// AudioWorklet de captura: manda cada bloque de audio al hilo principal (ver pcm.ts).
// Va en un archivo aparte porque la extensión de Chrome no permite cargarlo desde un Blob.
class Captura extends AudioWorkletProcessor {
  process(entradas) {
    const canal = entradas[0] && entradas[0][0];
    if (canal) this.port.postMessage(canal.slice(0));
    return true;
  }
}
registerProcessor("captura-pcm", Captura);
