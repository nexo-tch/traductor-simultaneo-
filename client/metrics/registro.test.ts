import { describe, expect, it } from "vitest";
import { CONFIG_REGISTRO, latencias, RegistroSesion } from "./registro";

function registro() {
  return new RegistroSesion(CONFIG_REGISTRO, () => 0);
}

describe("RegistroSesion", () => {
  it("arma un fragmento con pausa y mide la latencia de voz", () => {
    const r = registro();
    r.vozLocal(true, 0);
    r.textoOriginal("Hola a ", 300);
    r.textoOriginal("todos", 600);
    r.vozLocal(false, 1000);
    r.textoTraducido("Hello ", 1400);
    r.audioSalida(true, 1500);
    r.textoTraducido("everyone.", 1800);
    r.tick(2600); // pasa la espera de transcripción
    r.audioSalida(false, 2700);
    r.tick(3500);

    expect(r.fragmentos).toHaveLength(1);
    const [f] = r.fragmentos;
    expect(f.original).toBe("Hola a todos");
    expect(f.traduccion).toBe("Hello everyone.");
    expect(f.originalFinal && f.traduccionFinal).toBe(true);
    expect(latencias(f)).toEqual({ voz: 500, texto: 400, cierre: 1700 });
  });

  it("corta el habla continua por puntuación y reparte la traducción en orden", () => {
    const r = registro();
    r.vozLocal(true, 0);
    r.textoOriginal("Primero revisamos los números.", 2000);
    r.textoOriginal(" Después hablamos del cliente", 3000);
    r.audioSalida(true, 2300);
    r.textoTraducido("First we review the numbers.", 2400);
    r.textoTraducido(" Then we talk", 3500);

    expect(r.fragmentos).toHaveLength(2);
    const [a, b] = r.fragmentos;
    expect(a.finAproximado).toBe(true);
    expect(a.t_fin_habla).toBe(2000);
    expect(a.traduccion).toBe("First we review the numbers.");
    expect(a.traduccionFinal).toBe(true);
    expect(b.original).toBe("Después hablamos del cliente");
    expect(b.traduccion).toBe("Then we talk");
    expect(b.t_inicio_habla).toBe(2000);
  });

  it("acepta texto que llega después de que terminó la voz", () => {
    const r = registro();
    r.vozLocal(true, 0);
    r.vozLocal(false, 800);
    r.textoOriginal("Buenos días", 1100);
    const [f] = r.fragmentos;
    expect(f.t_inicio_habla).toBe(0);
    expect(f.t_fin_habla).toBe(800);
    r.tick(2400);
    expect(f.originalFinal).toBe(true);
  });

  it("una traducción que llega antes que el original crea el fragmento", () => {
    const r = registro();
    r.vozLocal(true, 0);
    r.textoTraducido("Good", 500);
    r.textoOriginal("Buenas", 700);
    expect(r.fragmentos).toHaveLength(1);
    expect(r.fragmentos[0].original).toBe("Buenas");
    expect(r.fragmentos[0].traduccion).toBe("Good");
  });

  it("mide el retraso acumulado desde el fragmento pendiente más antiguo", () => {
    const r = registro();
    r.vozLocal(true, 0);
    r.textoOriginal("Uno dos tres cuatro.", 1000);
    r.textoOriginal(" Cinco seis siete ocho.", 2000);
    expect(r.retrasoAcumulado(4500)).toBe(3500);
    expect(r.pendientes()).toBe(2);
  });

  it("cerrarTodo deja todo final", () => {
    const r = registro();
    r.vozLocal(true, 0);
    r.textoOriginal("Algo sin terminar", 500);
    r.cerrarTodo(900);
    expect(r.fragmentos[0].originalFinal && r.fragmentos[0].traduccionFinal).toBe(true);
    expect(r.fragmentos[0].t_fin_habla).toBe(500);
    expect(r.fragmentos[0].finAproximado).toBe(true);
  });
});
