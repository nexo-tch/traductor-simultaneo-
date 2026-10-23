// Reproducción de la voz traducida (RF-05, RF-06, RF-11, sección 8.3).
//
// Con WebRTC la voz llega como pista en vivo: silenciarla es inmediato, pero
// no hay una cola que se pueda acelerar. El "descarte" de la sección 8.3 se
// hace silenciando la voz hasta que la traducción alcanza lo más reciente.

export type MotivoSilencio = "apagada" | "mantenida" | "descarte";

export class VozTraducida {
  private readonly elemento: HTMLAudioElement;
  private readonly motivos = new Set<MotivoSilencio>();

  constructor() {
    this.elemento = new Audio();
    this.elemento.autoplay = true;
  }

  conectar(flujo: MediaStream): void {
    this.elemento.srcObject = flujo;
    void this.elemento.play().catch(() => {
      // Chrome permite reproducir porque la sesión empieza con un clic; si falla, se reintenta al siguiente.
    });
  }

  desconectar(): void {
    this.elemento.srcObject = null;
  }

  set volumen(valor: number) {
    this.elemento.volume = Math.min(1, Math.max(0, valor));
  }

  silenciar(motivo: MotivoSilencio, activo: boolean): void {
    if (activo) this.motivos.add(motivo);
    else this.motivos.delete(motivo);
    // `muted` corta la salida en el siguiente bloque de audio (unos ms), muy por debajo de 150 ms.
    this.elemento.muted = this.motivos.size > 0;
  }

  estaSilenciada(motivo?: MotivoSilencio): boolean {
    return motivo ? this.motivos.has(motivo) : this.motivos.size > 0;
  }
}
