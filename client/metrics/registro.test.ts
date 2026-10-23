import { describe, expect, it } from "vitest";
import { CONFIG_REGISTRO, latencias, RegistroSesion } from "./registro";

function registro() {
  return new RegistroSesion(CONFIG_REGISTRO, () => 0);
}

/** Avanza el reloj en pasos de 100 ms, como el temporizador de la página. */
function avanzar(r: RegistroSesion, desde: number, hasta: number) {
  for (let t = desde; t <= hasta; t += 100) r.tick(t);
}

describe("RegistroSesion", () => {
  it("mide la cola: cuánto sigue sonando la traducción tras dejar de hablar", () => {
    const r = registro();
    r.vozLocal(true, 0);
    r.textoOriginal("Hola a ", 800);
    r.textoOriginal("todos", 1200);
    r.vozLocal(false, 2000);
    r.audioSalida(true, 2300);
    r.textoTraducido("Hello ", 2200);
    r.textoTraducido("everyone.", 2600);
    r.audioSalida(false, 4500);
    avanzar(r, 2000, 6000);

    expect(r.fragmentos).toHaveLength(1);
    const [f] = r.fragmentos;
    expect(f.original).toBe("Hola a todos");
    expect(f.traduccion).toBe("Hello everyone.");
    expect(f.originalFinal && f.traduccionFinal).toBe(true);
    expect(latencias(f)).toEqual({ cola: 2500, arranque: 2300 });
  });

  it("las pausas cortas no parten la intervención", () => {
    const r = registro();
    r.vozLocal(true, 0);
    r.textoOriginal("Primero revisamos", 900);
    r.vozLocal(false, 1500);
    r.vozLocal(true, 2200); // pausa de 0.7 s
    r.textoOriginal(" los números", 2800);
    r.vozLocal(false, 3000);
    avanzar(r, 3000, 5000);
    expect(r.fragmentos).toHaveLength(1);
    expect(r.fragmentos[0].original).toBe("Primero revisamos los números");
    expect(r.fragmentos[0].t_fin_habla).toBe(3000);
  });

  it("la traducción atrasada se queda en su intervención aunque llegue tarde", () => {
    const r = registro();
    r.vozLocal(true, 0);
    r.textoOriginal("el país dejó de recibir visitantes", 1000);
    r.vozLocal(false, 2000);
    r.audioSalida(true, 2500);
    r.textoTraducido("The country stopped", 2400);
    r.vozLocal(true, 3800); // vuelve a hablar tras 1.8 s: nueva intervención
    r.textoOriginal("Chile y Perú", 4500);
    r.textoTraducido(" getting visitors.", 4000);
    r.audioSalida(false, 4800);
    avanzar(r, 3800, 5600);
    r.audioSalida(true, 6000);
    r.textoTraducido("Chile and Peru", 6100);

    const [a, b] = r.fragmentos;
    expect(a.traduccion).toBe("The country stopped getting visitors.");
    expect(a.colaInterrumpida).toBe(true);
    expect(latencias(a).cola).toBe(1800); // cota: volvió a hablar a los 1.8 s
    expect(b.original).toBe("Chile y Perú");
    expect(b.traduccion).toBe("Chile and Peru");
  });

  it("corta una intervención muy larga en la siguiente pausa y no le mide cola", () => {
    const r = registro();
    r.vozLocal(true, 0);
    r.textoOriginal("monólogo largo", 1000);
    r.vozLocal(false, 31000);
    r.vozLocal(true, 31600);
    r.textoOriginal("sigue", 32500);
    expect(r.fragmentos).toHaveLength(2);
    expect(r.fragmentos[0].corteForzado).toBe(true);
    expect(latencias(r.fragmentos[0]).cola).toBeUndefined();
  });

  it("acepta texto que llega después de que terminó la voz", () => {
    const r = registro();
    r.vozLocal(true, 0);
    r.vozLocal(false, 800);
    r.textoOriginal("Buenos días", 1100);
    const [f] = r.fragmentos;
    expect(f.t_inicio_habla).toBe(0);
    expect(f.t_fin_habla).toBe(800);
    avanzar(r, 1100, 2400);
    expect(f.originalFinal).toBe(true);
  });

  it("el retraso solo cuenta mientras la persona está callada", () => {
    const r = registro();
    r.vozLocal(true, 0);
    r.textoOriginal("Uno dos tres", 500);
    expect(r.retrasoAcumulado(1000)).toBe(0);
    r.vozLocal(false, 1000);
    r.audioSalida(true, 1200);
    expect(r.retrasoAcumulado(4000)).toBe(3000);
  });

  it("cerrarTodo deja todo final sin cola si se detuvo hablando", () => {
    const r = registro();
    r.vozLocal(true, 0);
    r.textoOriginal("Algo sin terminar", 500);
    r.cerrarTodo(900);
    const [f] = r.fragmentos;
    expect(f.originalFinal && f.traduccionFinal).toBe(true);
    expect(f.corteForzado).toBe(true);
    expect(latencias(f).cola).toBeUndefined();
  });

  it("guarda la cola provisional aparte y la reemplaza", () => {
    const r = registro();
    r.vozLocal(true, 0);
    r.textoOriginalProvisional("Hola a", 300);
    r.textoOriginal("Hola", 600);
    r.textoOriginalProvisional(" a todos", 600);
    r.textoTraducidoProvisional("Hello", 700);
    const [f] = r.fragmentos;
    expect(f.original).toBe("Hola");
    expect(f.originalProvisional).toBe(" a todos");
    expect(f.traduccionProvisional).toBe("Hello");
    expect(f.porPalabra).toBe(true);
    expect(f.t_primer_texto_original).toBe(300);
    r.textoOriginal(" a todos", 900);
    r.textoOriginalProvisional("", 900);
    expect(f.original).toBe("Hola a todos");
    expect(f.originalProvisional).toBe("");
  });
});
