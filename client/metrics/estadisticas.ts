/** Percentil con interpolación lineal (p entre 0 y 100). */
export function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const posicion = (p / 100) * (orden.length - 1);
  const abajo = Math.floor(posicion);
  const arriba = Math.ceil(posicion);
  return orden[abajo] + (orden[arriba] - orden[abajo]) * (posicion - abajo);
}

export interface Resumen {
  n: number;
  ultimo: number | null;
  p50: number | null;
  p95: number | null;
}

export function resumir(valores: number[]): Resumen {
  return {
    n: valores.length,
    ultimo: valores.at(-1) ?? null,
    p50: percentil(valores, 50),
    p95: percentil(valores, 95),
  };
}

/** "+0.9 s" / "−0.3 s" / "—" */
export function formatoSegundos(ms: number | null | undefined, conSigno = false): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const s = (ms / 1000).toFixed(1);
  if (!conSigno) return `${s} s`;
  return ms >= 0 ? `+${s} s` : `−${s.slice(1)} s`;
}
