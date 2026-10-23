// Servicio de fondo: abre el panel lateral y empieza a capturar la pestaña cuando se
// hace clic en el ícono de la extensión. El audio vive en un documento oculto
// (offscreen), porque el servicio de fondo no puede usar audio.
import { enviar, guardarAjustes, leerAjustes, type AlFondo } from "./mensajes";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

chrome.action.onClicked.addListener((pestana) => {
  if (pestana.id === undefined) return;
  // Abrir el panel tiene que ir primero: Chrome solo lo permite en respuesta directa al clic.
  void chrome.sidePanel.open({ windowId: pestana.windowId });
  void iniciar(pestana.id);
});

chrome.runtime.onMessage.addListener((mensaje: AlFondo, _remitente, responder) => {
  if (mensaje.para !== "fondo") return;
  if (mensaje.tipo === "iniciar") {
    void pestanaElegida(mensaje.misma === true).then((id) => (id === undefined ? avisarSinPestana() : iniciar(id))).then(() => responder({}));
    return true;
  }
  if (mensaje.tipo === "detener") void enviar({ para: "documento", tipo: "detener" }).then(() => responder({}));
  return true;
});

chrome.commands.onCommand.addListener(async (comando) => {
  if (comando !== "alternar-voz") return;
  const ajustes = await leerAjustes();
  ajustes.vozEncendida = !ajustes.vozEncendida;
  await guardarAjustes(ajustes);
  await enviar({ para: "documento", tipo: "ajustes", ajustes });
  await enviar({ para: "panel", tipo: "ajustes", ajustes });
});

/**
 * Al pulsar Empezar se traduce la pestaña que se está viendo junto al panel. Al cambiar
 * de idioma se sigue con la que ya se traducía.
 */
async function pestanaElegida(misma: boolean): Promise<number | undefined> {
  const { pestana } = await chrome.storage.session.get("pestana");
  if (misma && typeof pestana === "number") {
    const existe = await chrome.tabs.get(pestana).catch(() => undefined);
    if (existe) return pestana;
  }
  const [activa] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return activa?.id;
}

async function avisarSinPestana(): Promise<void> {
  await enviar({ para: "panel", tipo: "aviso", nivel: "error", texto: "Abre la reunión de Meet y haz clic en el ícono de la extensión estando en esa pestaña." });
}

async function iniciar(idPestana: number): Promise<void> {
  try {
    await chrome.storage.session.set({ pestana: idPestana });
    await asegurarDocumento();
    // Si ya se estaba capturando, Chrome no deja pedir otra captura de la misma pestaña.
    await enviar({ para: "documento", tipo: "detener" });
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: idPestana });
    const ajustes = await leerAjustes();
    const { title: titulo = "" } = await chrome.tabs.get(idPestana);
    const respuesta = await enviar<{ error?: string }>({ para: "documento", tipo: "iniciar", streamId, ajustes, titulo });
    if (respuesta?.error) throw new Error(respuesta.error);
  } catch (error) {
    const texto = error instanceof Error ? error.message : String(error);
    const sinPermiso = /invoked|activeTab|permission/i.test(texto);
    await enviar({
      para: "panel",
      tipo: "aviso",
      nivel: "error",
      texto: sinPermiso
        ? "Chrome no dejó capturar la pestaña. Ve a la pestaña de Meet y haz clic en el ícono de la extensión."
        : `No se pudo empezar: ${texto}`,
    });
  }
}

async function asegurarDocumento(): Promise<void> {
  const existentes = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (existentes.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: "Capturar el audio de la reunión, traducirlo y reproducir la voz traducida.",
  });
}
