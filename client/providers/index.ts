import { ProveedorGemini } from "./gemini";
import { ProveedorOpenAI } from "./openai";
import { ProveedorSoniox } from "./soniox";
import type { ProveedorTraduccion } from "./tipos";

/** Proveedores disponibles en el selector (RF-12). Para agregar uno, implementa ProveedorTraduccion. */
export const PROVEEDORES: Record<string, { nombre: string; crear: () => ProveedorTraduccion }> = {
  openai: { nombre: "OpenAI gpt-realtime-translate", crear: () => new ProveedorOpenAI() },
  soniox: { nombre: "Soniox (stt-rt-v5 + tts-rt-v2)", crear: () => new ProveedorSoniox() },
  gemini: { nombre: "Google Gemini Live Translate", crear: () => new ProveedorGemini() },
};
