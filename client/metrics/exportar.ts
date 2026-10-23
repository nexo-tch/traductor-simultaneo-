// Exportación de la sesión (RF-10): JSON completo o CSV para hoja de cálculo.
import { evaluarGlosario, type TerminoGlosario } from "../glosario/glosario";
import { resumir, type Resumen } from "./estadisticas";
import { latencias, type Fragmento } from "./registro";

const MARCAS = [
  "t_inicio_habla",
  "t_fin_habla",
  "t_primer_texto_original",
  "t_texto_original_final",
  "t_primer_texto_traducido",
  "t_texto_traducido_final",
  "t_primer_audio_traducido",
  "t_fin_audio_traducido",
] as const;

export interface DatosSesion {
  proveedor: string;
  direccion: string;
  fuente: string;
  /** performance.now() al empezar: las marcas se exportan relativas a este instante. */
  t0: number;
  inicio: number;
  fragmentos: Fragmento[];
  glosario: TerminoGlosario[];
  retrasoMaximoMs: number;
  config: Record<string, unknown>;
}

export interface ResumenSesion {
  fragmentos: number;
  latenciaVoz: Resumen;
  latenciaTexto: Resumen;
  retrasoCierre: Resumen;
  retrasoMaximoMs: number;
  glosario: { apariciones: number; correctas: number; porcentaje: number | null };
}

function conTexto(fragmentos: Fragmento[]): Fragmento[] {
  return fragmentos.filter((f) => f.original || f.traduccion);
}

export function resumirSesion(fragmentos: Fragmento[], glosario: TerminoGlosario[], retrasoMaximoMs = 0): ResumenSesion {
  const lista = conTexto(fragmentos).filter((f) => f.traduccionFinal);
  const valores = (clave: keyof ReturnType<typeof latencias>) =>
    lista.map((f) => latencias(f)[clave]).filter((v): v is number => v !== undefined);
  const evaluaciones = lista.flatMap((f) => evaluarGlosario(f.original, f.traduccion, glosario));
  const correctas = evaluaciones.filter((e) => e.correcto).length;
  return {
    fragmentos: lista.length,
    latenciaVoz: resumir(valores("voz")),
    latenciaTexto: resumir(valores("texto")),
    retrasoCierre: resumir(valores("cierre")),
    retrasoMaximoMs,
    glosario: {
      apariciones: evaluaciones.length,
      correctas,
      porcentaje: evaluaciones.length ? Math.round((correctas / evaluaciones.length) * 100) : null,
    },
  };
}

function relativos(f: Fragmento, t0: number): Record<string, number | null> {
  const fila: Record<string, number | null> = {};
  for (const marca of MARCAS) {
    const valor = f[marca];
    fila[marca] = valor === undefined ? null : Math.round(valor - t0);
  }
  return fila;
}

export function aJSON(datos: DatosSesion): string {
  const fragmentos = conTexto(datos.fragmentos).map((f) => {
    const l = latencias(f);
    return {
      id: f.id,
      hora: new Date(f.hora).toISOString(),
      hablante: f.hablante,
      original: f.original,
      traduccion: f.traduccion,
      fin_aproximado: f.finAproximado,
      latencia_voz_ms: l.voz === undefined ? null : Math.round(l.voz),
      latencia_texto_ms: l.texto === undefined ? null : Math.round(l.texto),
      retraso_cierre_ms: l.cierre === undefined ? null : Math.round(l.cierre),
      marcas_ms: relativos(f, datos.t0),
      glosario: evaluarGlosario(f.original, f.traduccion, datos.glosario),
    };
  });
  return JSON.stringify(
    {
      exportado: new Date().toISOString(),
      inicio: new Date(datos.inicio).toISOString(),
      proveedor: datos.proveedor,
      direccion: datos.direccion,
      fuente: datos.fuente,
      configuracion: datos.config,
      resumen: resumirSesion(datos.fragmentos, datos.glosario, datos.retrasoMaximoMs),
      glosario: datos.glosario,
      fragmentos,
    },
    null,
    2,
  );
}

function celda(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  return /[",\n;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function aCSV(datos: DatosSesion): string {
  const encabezado = [
    "id",
    "hora",
    "hablante",
    "original",
    "traduccion",
    "latencia_voz_ms",
    "latencia_texto_ms",
    "retraso_cierre_ms",
    "fin_aproximado",
    ...MARCAS.map((m) => `${m}_ms`),
    "glosario_correctos",
    "glosario_total",
  ];
  const filas = conTexto(datos.fragmentos).map((f) => {
    const l = latencias(f);
    const marcas = relativos(f, datos.t0);
    const glosario = evaluarGlosario(f.original, f.traduccion, datos.glosario);
    return [
      f.id,
      new Date(f.hora).toISOString(),
      f.hablante,
      f.original,
      f.traduccion,
      l.voz === undefined ? "" : Math.round(l.voz),
      l.texto === undefined ? "" : Math.round(l.texto),
      l.cierre === undefined ? "" : Math.round(l.cierre),
      f.finAproximado ? "si" : "no",
      ...MARCAS.map((m) => marcas[m]),
      glosario.filter((g) => g.correcto).length,
      glosario.length,
    ];
  });
  // BOM para que Excel abra bien las tildes.
  return "﻿" + [encabezado, ...filas].map((fila) => fila.map(celda).join(",")).join("\n");
}

export function descargar(nombre: string, contenido: string, tipo: string): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
