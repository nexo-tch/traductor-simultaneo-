# Traductor simultáneo ES ↔ EN

Probador de fluidez (Fase 1) y extensión de Chrome para Google Meet (ver [Extensión para Google Meet](#extensión-para-google-meet)).

## Probador de fluidez (Fase 1)

Página local para validar si la traducción simultánea español ↔ inglés es lo bastante rápida y fluida para usarla en reuniones. Hablas al micrófono (o cargas un audio de prueba), ves lo que dijiste con la traducción debajo, escuchas la voz traducida en tus audífonos y la página mide la latencia de cada fragmento.

La especificación completa está en [`SPEC.md`](SPEC.md). Hay dos proveedores, que se eligen en el selector de la página:

| Proveedor | Cómo funciona | Glosario | Cuándo usarlo |
| --- | --- | --- | --- |
| **OpenAI `gpt-realtime-translate`** | Un solo modelo de voz a voz por WebRTC. Espera a tener la idea completa antes de hablar (en las pruebas, unos 3–5 s). | No lo acepta: solo corrige subtítulos. | Traducción más pulida; presentaciones largas. |
| **Google Gemini Live Translate** (`gemini-3.5-live-translate-preview`) | El modelo de traducción de Google Meet, de voz a voz por WebSocket. Conserva la entonación de quien habla. En vista previa. | No lo acepta: solo corrige subtítulos. | Candidato a la voz más natural (ver `docs/INVESTIGACION.md`). |
| **Soniox** (`stt-rt-v5` + `tts-rt-v2`) | Transcribe y traduce palabra por palabra; cada pedazo traducido se manda a la voz apenas se confirma. | Sí: se envía como términos de traducción. | Conversación más simultánea. |

## Instalación (menos de 10 minutos)

Necesitas Node.js 20 o superior, Google Chrome, audífonos y la API key de al menos un proveedor: OpenAI (con $5–10 de saldo alcanza para todas las pruebas), Soniox o Google (Gemini).

```bash
git clone https://github.com/nexo-tch/traductor-simultaneo-.git
cd traductor-simultaneo-
npm install
cp .env.example .env        # en Windows: copy .env.example .env
```

Abre `.env` (en la Mac: `open -e .env`) y pega tus keys después de `OPENAI_API_KEY=`, `SONIOX_API_KEY=` y/o `GEMINI_API_KEY=` (de aistudio.google.com). Las keys se quedan en tu computador: el navegador nunca las ve; solo recibe llaves temporales. `PROVIDER` elige el proveedor que aparece seleccionado al abrir la página.

```bash
npm run dev
```

Abre <http://localhost:5173> en Chrome, conecta los audífonos y pulsa **Empezar**. La primera vez Chrome pide permiso para usar el micrófono.

## Uso

| Control | Qué hace |
| --- | --- |
| **Empezar / Detener** | Abre el micrófono y conecta con el proveedor. |
| **Dirección** | Español → Inglés o Inglés → Español. |
| **Voz traducida: encendida/apagada** | Corta la voz al instante; los subtítulos siguen. |
| **Barra espaciadora** (mantener) | Silencia la voz mientras la mantienes presionada (fuera de campos de texto). |
| **Volumen de la voz** | Volumen de la voz traducida. |
| **Fuente → Audio de prueba** | Procesa un WAV, MP3, OGG (notas de voz de WhatsApp) o M4A como si fuera el micrófono, para comparar con exactamente el mismo audio. |
| **Vista** | Original + traducción, solo traducción o solo original. |
| **Glosario** | Términos del negocio (ver más abajo). |
| **Exportar JSON / CSV** | Descarga la sesión con textos, marcas de tiempo, latencias y aciertos del glosario. |
| **Ajustes** | Nombre de quien habla, sensibilidad del detector de voz, silencio que cierra un fragmento, salto de voz atrasada. |

### Cómo leer las métricas

Cada entrada del panel es una **intervención**: lo que dices hasta que haces una pausa de 1.5 s o más (ajustable en *Ajustes*). La traducción se asigna a la intervención hasta que la voz traducida se calla.

- **Retraso tras terminar de hablar** (la medida principal; *Último*, *p50* y *p95*): cuánto **sigue sonando** la traducción después de que terminas una intervención. Es lo que espera quien escucha antes de poder responder. Cada entrada lo muestra en pequeño (por ejemplo, "+2.4 s").
- Si vuelves a hablar antes de que termine la traducción, la entrada muestra "≥" y ese valor es solo un mínimo. Esas no entran en p50/p95; el JSON las cuenta aparte en `colasInterrumpidas`.
- **Arranque** (pasa el mouse sobre la latencia de una entrada): cuánto tarda la traducción en empezar a sonar desde que empiezas a hablar.
- **Ahora**: cuánto lleva sonando la traducción desde que te callaste. Si pasa del umbral de *Ajustes* (5 s por defecto), la voz se salta hasta alcanzarte; los subtítulos conservan todo. Mientras hablas vale 0, porque no se puede saber cuánto falta.

Los colores siguen la meta del spec: ámbar por encima de 1.5 s y rojo por encima de 2.5 s.

Las intervenciones de más de 30 s sin una pausa larga se cortan en la siguiente pausa corta. Esas no tienen retraso medible y en el JSON salen con `corte_forzado: true`.

### Glosario

Con **Soniox**, el glosario se envía al empezar como términos de traducción (`translation_terms`) y como palabras a reconocer (`terms`): corrige la voz y los subtítulos.

Con **OpenAI**, `gpt-realtime-translate` **no acepta glosario ni instrucciones** (lo dice la guía oficial).

Con los dos proveedores, el glosario además sirve para:

1. **Medir**: para cada término que aparece en el original, revisa si la traducción del modelo trae la forma esperada. El porcentaje sale en el panel del glosario y en el resumen del JSON. Es el criterio del 90%.
2. **Corregir los subtítulos**: en *Variantes a corregir* pones las formas erróneas que ves (por ejemplo `Nexus`), y en pantalla se reemplazan por la forma correcta. **La voz no se corrige.**

*Traducción deseada* vacía significa "no traducir". El glosario se guarda en el navegador; *Guardar archivo* y *Cargar archivo* lo llevan a un JSON.

### Plan de pruebas (SPEC.md, 11.2)

1. **Grabaciones de referencia**: guarda 3–5 audios de 1–2 minutos en `test-audio/`; esa carpeta no se sube al repositorio.
2. **Audio de prueba**: elige *Fuente → Audio de prueba*, carga el archivo, pulsa *Empezar* y exporta al final.
3. **En vivo**: habla 5 minutos seguidos y revisa p50, p95 y que el *Retraso* no pase de 5 s.
4. **En Meet**: en la reunión, *Presentar → Una pestaña*, elige esta pestaña y deja activado **Compartir audio de la pestaña**. Tu colega oye la voz traducida y ve los subtítulos.
5. **Glosario**: carga los 10–20 términos, lee un texto que los use todos y revisa el porcentaje.

## Extensión para Google Meet

Una extensión de Chrome que traduce lo que se dice en la reunión y lo pone en un panel lateral, junto a Meet. Escucha el audio de la pestaña de Meet y te traduce a tu idioma lo que se diga en el otro. Gemini calla lo que ya está en tu idioma: si eliges *Traducir a: Español*, solo oyes voz traducida cuando alguien habla en inglés. Cada persona que necesita traducción instala la extensión en su Chrome. Quien habla no necesita nada.

**Instalar (una vez):**

1. `npm install` y `npm run build:extension`. Crea la carpeta `dist/extension`.
2. En Chrome abre `chrome://extensions`, activa **Modo de desarrollador** (arriba a la derecha) y pulsa **Cargar descomprimida**. Elige la carpeta `dist/extension`.
3. Fija el ícono: en la barra de Chrome, pieza de rompecabezas → pin junto a "Traductor simultáneo para Meet".

**Usar en una reunión:**

1. Deja corriendo `npm run dev`: la extensión le pide los tokens de Gemini a ese servidor local (`http://127.0.0.1:5173`), que es el único que conoce la key.
2. Ponte **audífonos**. Si la voz traducida sale por los parlantes, tu micrófono la capta y los demás la oyen.
3. Entra a la reunión de Meet y haz clic en el ícono de la extensión. Se abre el panel lateral y empieza a traducir.
4. En el panel:
   - **Traducir a**: tu idioma.
   - **Voz traducida**: encender o apagar. Atajo: `Alt+Shift+T`, funciona aunque estés en Meet.
   - **Volumen y vista**: volumen de la voz y de la reunión, y si la reunión baja mientras suena la traducción.
5. **Detener** para terminar. **Empezar** traduce la pestaña que estás viendo junto al panel; cambiar *Traducir a* sigue con la misma pestaña. Si la pestaña no suena en 10 s, el panel avisa (puede estar en pausa o ser otra pestaña).

Al capturar la pestaña, Chrome la silencia; la extensión vuelve a reproducir el audio de la reunión por su cuenta, más bajo mientras suena la traducción. Funciona con cualquier pestaña con audio (por ejemplo, un video en inglés de YouTube), útil para probarla sin reunión.

Tras cambiar el código de la extensión: `npm run build:extension` (o `npm run dev:extension`, que reconstruye solo) y en `chrome://extensions` el botón de recargar de la extensión.

## Compartir con otras personas

Para que otros usen la extensión con tu API key, el servidor que guarda la key tiene que estar en internet. La key se escribe solo en el panel del servidor: nunca en el repositorio, en la extensión ni en el chat. Quien usa la extensión recibe tokens temporales de un solo uso.

**1. Publicar el servidor en Railway** (una vez):

1. Crea una cuenta en [railway.com](https://railway.com) entrando con GitHub.
2. **New Project → Deploy from GitHub repo** y elige `nexo-tch/traductor-simultaneo-` (si no aparece, dale acceso a Railway en GitHub). Railway lee `railway.json`: construye con `npm run build` y arranca con `npm start`.
3. En el servicio, pestaña **Variables**, agrega:
   - `HOST` = `0.0.0.0`
   - `GEMINI_API_KEY`: tu key de Google AI Studio.
   - `CODIGO_ACCESO`: una clave larga que inventes (por ejemplo, 20 letras y números al azar). Es lo que les darás a tus colegas.
4. Pestaña **Settings**:
   - **Region**: la de la costa este de EE. UU. (Virginia), por la latencia desde Colombia (SPEC 9.1).
   - **Networking → Generate Domain**: crea la dirección pública, algo como `https://traductor-simultaneo-production.up.railway.app`.
5. Abre esa dirección con `/api/config` al final: debe responder con `"gemini": true`.

Protecciones del servidor publicado (`server/acceso.ts`): sin `CODIGO_ACCESO` no arranca; pedir un token exige el código; máximo 20 pedidos por minuto por IP; solo la extensión puede llamarlo desde un navegador (CORS).

En Google AI Studio (o en la facturación de Google Cloud) ponle un **límite de gasto** a tu key: cada persona que usa la extensión es una sesión de Gemini durante toda la reunión, pagada con tu cuenta.

**2. Construir la extensión con esa dirección:**

```bash
VITE_SERVIDOR=https://TU-DIRECCION.up.railway.app npm run zip:extension
```

Crea `dist/traductor-extension.zip`, que ya apunta a tu servidor.

**3. Mandar a cada colega:** el .zip y el código de acceso (por un canal privado). Cada uno:

1. Descomprime el .zip en una carpeta que no vaya a borrar.
2. En Chrome: `chrome://extensions` → **Modo de desarrollador** → **Cargar descomprimida** → esa carpeta.
3. Fija el ícono, abre una reunión de Meet, haz clic en el ícono y en el panel abre **Conexión** y pega el código.

Más adelante se puede publicar en la Chrome Web Store como "no listada" (pago único de USD 5) para que se instale con un botón y se actualice sola.

## Comandos

| Comando | Para qué |
| --- | --- |
| `npm run dev` | Servidor local con recarga automática (lo normal). |
| `npm test` | Pruebas unitarias (fragmentos, métricas, glosario). |
| `npm run typecheck` | Revisión de tipos. |
| `npm run build` y `npm start` | Versión compilada, sin recarga automática. |
| `npm run build:extension` | Construye la extensión de Chrome en `dist/extension`. |
| `npm run dev:extension` | Igual, y la reconstruye con cada cambio. |
| `npm run zip:extension` | Construye la extensión y la empaqueta en `dist/traductor-extension.zip` para compartirla. |

## Estructura

```
server/          servidor local: guarda la key, emite tokens efímeros, sirve la página
client/
  providers/     interfaz común (tipos.ts) y un adaptador por proveedor (openai.ts)
  audio/         micrófono o archivo, detector de voz, reproducción de la voz traducida
  metrics/       registro de fragmentos y marcas de tiempo, p50/p95, exportación
  glosario/      lógica del glosario (corrección y medición)
  ui/            panel bilingüe y panel del glosario
  main.ts        une todo
extension/       extensión de Chrome para Meet (reutiliza client/providers y client/audio)
  background.ts  clic en el ícono: abre el panel y captura la pestaña
  offscreen.ts   audio: captura, Gemini, mezcla de la reunión y la voz traducida
  panel.*        panel lateral: controles y transcripción
  transcripcion.ts  entradas por idioma y pausas
test-audio/      grabaciones de referencia (no se suben)
```

Para agregar un proveedor, implementa `ProveedorTraduccion` (`client/providers/tipos.ts`) y regístralo en `client/providers/index.ts`; aparece solo en el selector.

## Decisiones

Desviaciones de `SPEC.md` y su motivo:

1. **Con OpenAI, el glosario solo corrige subtítulos y mide aciertos** (RF-08). El modelo no acepta glosario, instrucciones ni guías de pronunciación. Por eso, y porque espera de 3 a 5 s antes de hablar, se agregó Soniox como segundo proveedor (paso 10 del spec).
2. **WebRTC directo, sin acelerar la voz** (RF-14, 8.3). Con WebRTC la voz llega como pista en vivo y no hay cola que se pueda acelerar. El "descarte" de la 8.3 se hace silenciando la voz hasta que la traducción alcanza lo más reciente. Si las pruebas muestran que el retraso sí se acumula, la opción es recibir el audio por WebSocket a través del servidor, a cambio de un salto extra de red.
3. **La unidad es la intervención y la medida principal es el retraso tras terminar de hablar** (`client/metrics/registro.ts`). El proveedor manda el texto como un flujo continuo, sin identificador de fragmento, y la traducción va unos segundos detrás. En la primera prueba real, emparejar frases cortas con su traducción asignaba cada traducción a la frase siguiente, y la latencia del spec ("fin del fragmento → empieza a sonar su traducción") salía con valores negativos sin sentido. Por eso:
   - El panel agrupa por intervenciones (pausas de 1.5 s o más), donde el original y la traducción sí coinciden.
   - La medida principal es cuánto sigue sonando la traducción después de que la persona se calla. No depende de emparejar textos y es lo que espera quien escucha. Se compara con las mismas metas del spec (p50 ≤ 1.5 s, p95 ≤ 2.5 s).
   - El modelo a veces se calla a mitad de frase esperando contexto. Si la traducción no termina en punto, se espera un silencio de 2 s (en vez de 0.6 s) antes de darla por terminada.
4. **El idioma de origen lo detecta el modelo.** El selector de dirección solo fija el idioma de destino. Si alguien habla en el idioma de destino, el modelo no lo traduce y la voz queda en silencio en ese tramo.
5. **La voz no se puede elegir**: el modelo imita el tono de quien habla.
6. **Métrica adicional**: el *arranque* (inicio del habla → primer audio traducido). Las marcas de tiempo del spec (11.1) se exportan completas por intervención.
7. **Columna extra en el glosario**: *Variantes a corregir*, para poder corregir los subtítulos.
8. **Express en vez de Fastify**, con Vite como middleware: un solo proceso y un solo comando (`npm run dev`).
9. **Reducción de ruido `near_field`** en la sesión de OpenAI (micrófono cerca de la boca), igual que en la guía oficial.
10. **El primer audio se mide sobre la pista recibida**, aunque la voz esté silenciada. Si apagas la voz, la métrica dice cuándo *habría* sonado.

11. **Soniox va en dos piezas** (`client/providers/soniox.ts`): transcripción con traducción en streaming (`stt-rt-v5`, traducción `one_way`) y voz en streaming (`tts-rt-v2`). Detalles:
    - Las palabras traducidas que Soniox confirma se mandan a la voz apenas llegan. Cada frase es un stream de voz que se cierra en un punto final, cuando Soniox detecta el fin del habla, o tras 1.2 s sin texto nuevo.
    - El audio de la voz pasa por una cola propia (`client/audio/reproductor.ts`). Si la cola pasa de 2 s, las frases nuevas se generan a 1.2× (RF-14). Si pasa de 5 s, se descarta lo pendiente (8.3).
    - El audio del micrófono se manda en pedazos de 100 ms en WebM/Opus (lo que graba Chrome), sin convertir.
    - Se usa el SDK oficial `@soniox/client` 2.4.0 para no reimplementar su protocolo. Su web no era accesible al construirlo; la referencia fueron los tipos y ejemplos del SDK.
    - Voz por defecto: `Adrian` (la del ejemplo oficial). Se cambia en *Ajustes → Voz traducida* (la lista viene de Soniox) o con `SONIOX_VOICE` en `.env`.
    - *Ajustes → Voz traducida* controla la velocidad base (1.05× por defecto; se acelera un 15% extra si la voz se atrasa, hasta 1.3×), si se acortan las pausas entre palabras (`reduce_silence`), si una tanda muy corta (1–2 palabras) espera hasta 0.6 s para juntarse con la siguiente, y los cortes de frase (abajo). Los cambios se guardan en el navegador.
    - **Cortes de frase y puntos falsos.** Con la detección de pausas de Soniox activada (`enable_endpoint_detection`), Soniox cierra una frase en cada micro-pausa y le pone punto, tanto al español como a la traducción. En una prueba real: *"con respecto a el. Modelo de suscripciones. Mi. Idea…"* → *"a solution that. Allows me to. Make…"*. Por eso viene apagada por defecto ("Solo en pausas largas"). Además:
      - Con la detección apagada, un punto que llega mientras la persona sigue hablando se lee como coma en la voz. Los subtítulos muestran el texto tal como lo entrega Soniox.
      - Sin cortes por pausa, Soniox deja las últimas palabras sin confirmar hasta que se vuelve a hablar: en una prueba, el final del audio nunca se tradujo. Por eso, si la cola sin confirmar no cambia en 1.6 s, se le pide a Soniox que la confirme (`finalize`). Con 0.9 s volvían los puntos falsos: algunas pausas a mitad de frase duran eso.
13. **Cada tanda confirmada es una frase de voz cerrada.** En una prueba real, la voz de Soniox (`tts-rt-v2`) no hablaba un texto hasta recibir el siguiente o el cierre de la frase: esperaba de 3.5 a 5.4 s, y con la frase abierta sin producir audio Soniox la cortaba (error 408, *«output audio rate below minimum»*). Por eso cada tanda que confirma Soniox (6–9 palabras en las pruebas, frases naturales) se manda como frase propia y se cierra en el acto; las frases suenan en orden. Si la persona sigue hablando, un punto al final de la tanda se lee como coma (*Ajustes*) para que la voz no baje la entonación como en un final de oración.
    - Se probó también hablar las palabras provisionales antes de la confirmación (prefijo estable, SPEC 8.2), pero Soniox no manda traducción provisional: solo tandas confirmadas. Se quitó la opción.
17. **Gemini Live Translate** (`client/providers/gemini.ts`, `server/gemini.ts`), con el SDK oficial `@google/genai` 2.28.0 (la versión más reciente con más de dos semanas). Detalles:
    - El servidor crea un token efímero de un solo uso (`authTokens.create`, API `v1alpha`), con la configuración bloqueada: modelo, `translationConfig.targetLanguageCode`, transcripción de entrada y de salida.
    - El navegador manda PCM de 16 kHz en pedazos de 100 ms (`client/audio/pcm.ts`, con un `AudioWorklet`) y recibe voz en PCM de 24 kHz, que suena por la misma cola que Soniox.
    - El modelo se cambia con `GEMINI_TRANSLATE_MODEL` en `.env`.
    - Como el modelo está en vista previa y su web no era accesible al construirlo, el JSON registra la primera aparición de cada campo que manda Google (`gemini_campo:…`) y cada vez que la voz retoma tras un hueco (`gemini_voz_retoma`), para ajustar con datos reales.
    - La captura arranca antes de abrir la sesión, y lo dicho mientras Google confirma (unos 2 s) se manda apenas está lista (`gemini_audio_en_espera`). En la primera prueba real se perdía el comienzo del audio.
    - Gemini traduce sin pausas, así que la traducción de una intervención puede seguir llegando cuando ya terminó la siguiente. En ese caso se unen: el texto queda en la primera, y la cola se mide en la última (`traduccion_en` en el JSON).
    - **Ponerse al día.** En una prueba, Google tardó hasta ~30 s en reconocer el audio, aunque la voz traducida sonaba sin cola. El adaptador mide dos atrasos. Uno es el audio que espera subir en el navegador (`bufferedAmount` del WebSocket). El otro es una cota inferior del atraso de Google: si sigue transcribiendo cuando ya pasaron más de 1,5 s sin voz en lo enviado, va atrasado al menos ese tiempo. La suma va al medidor *Ahora*. Si pasa de 6 s, abre una sesión nueva y descarta lo pendiente (`gemini_puesta_al_dia`): en una reunión es mejor saltar unos segundos que quedar cada vez más atrás. Solo se puede medir en las pausas.
    - **Fin del audio en cada pausa** (*Ajustes → Gemini*, activado por defecto). Con la nota de prueba, Google entregaba el final de la transcripción ~1,4 s después de que terminaba el habla, y la voz terminaba ~3,9 s después. Tras 700 ms de silencio se manda `audioStreamEnd`, que según el SDK indica que el flujo de audio terminó y se reabre al mandar audio. Así Google traduce lo pendiente sin esperar más audio. El silencio se sigue mandando (`gemini_fin_de_audio` en el JSON). Una primera versión dejaba de mandar audio durante la pausa, y en una prueba Google no entregó las últimas palabras de la nota. Es un experimento: la documentación no dice cómo lo trata el modelo de traducción.
18. **Extensión para Meet: escucha la reunión en vez de capturar el micrófono de cada hablante** (se aparta de SPEC 10.2). El SPEC elige una extensión que captura el micrófono de cada hablante y reenvía la traducción por un servidor en la nube (Fases 2 y 3). Se hizo primero una extensión del *oyente*: captura el audio de la pestaña de Meet (`chrome.tabCapture` + documento `offscreen`) y le traduce a cada persona lo que se dice en el otro idioma. Motivos:
    - Gemini Live Translate con `echoTargetLanguage: false` ya resuelve la reunión bilingüe: traduce el otro idioma y calla lo que está en el del oyente.
    - Sale en ambas direcciones sin servidor de reenvío ni despliegue, y quien habla no instala nada.
    - El panel lateral (`chrome.sidePanel`) cubre el panel de la Fase 3.

    Costos aceptados: suma el viaje del audio por Meet (~0,2–0,5 s), el audio llega mezclado (las entradas del panel se separan por idioma y pausas, no por persona) y cada oyente paga su propia sesión de Gemini. Para usarla en el Mac del usuario, la extensión pide los tokens al servidor local; para colegas habrá que desplegar ese servidor.
19. **Servidor publicado con código de acceso** (no estaba en el SPEC para esta etapa). Para que colegas usen la API key del usuario sin verla, el mismo servidor se despliega en Railway (`railway.json`; región de la costa este por SPEC 9.1). Se protege con un código compartido (`CODIGO_ACCESO`) y un límite por IP, en vez de inicio de sesión con Google: es lo más rápido para probar con pocas personas. Si se abre a más gente, conviene cambiarlo por inicio de sesión con cuentas de la empresa.
15. **El detector de voz se calibra con el ruido de fondo**: el umbral es el mayor entre la sensibilidad de *Ajustes* y el doble del ruido medido (percentil 20 de los últimos 6 s). Con la nota de WhatsApp, el umbral fijo quedaba al nivel del ruido y no se detectaba ninguna pausa.
16. **Diagnóstico de la voz** en `eventos` del JSON: cuándo crece la traducción provisional (`traduccion_provisional`), qué texto va a la voz y cuándo (`a_la_voz#N`), cuándo empieza a sonar cada frase de voz y cuánto audio había en cola (`voz_primer_audio#N`) y cuándo termina (`voz_fin#N`).
14. **Original de fondo con *ducking*** (SPEC 8.1), solo en el modo audio de prueba: el original suena al volumen de *Ajustes* (45% por defecto) y baja al 40% de ese valor (~18%) mientras suena la traducción, con transiciones de 60 ms. Así se oye como lo oiría quien escucha la interpretación. Con micrófono no aplica: quien habla oye su propia voz.
12. **Texto provisional**: Soniox manda palabras sin confirmar que luego puede corregir. Se muestran en gris al final del texto confirmado, y no se exportan.

Fuentes técnicas: [guía oficial de gpt-realtime-translate (OpenAI Cookbook)](https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide) y su [demo de navegador](https://github.com/openai/openai-cookbook/tree/main/examples/voice_solutions/realtime_translation_guide/browser-translation-demo). Solo se usan los eventos documentados ahí (`session.input_transcript.delta`, `session.output_transcript.delta`, `error`); los demás se anotan una vez en la consola del navegador para revisarlos.

## Estado frente a los criterios de aceptación (SPEC.md, 11.3)

| Criterio | Estado |
| --- | --- |
| Requisitos **Debe** de la sección 4 | Implementados. RF-08 con la salvedad de la decisión 1. |
| Latencia p50 ≤ 1.5 s y p95 ≤ 2.5 s | **Pendiente**. Primera prueba real (2.5 min, medida a mano): la traducción sigue sonando unos 3–3.5 s después de cada intervención. |
| 5 minutos seguidos sin que el retraso pase de 5 s | **Pendiente**. En la primera prueba el retraso no creció con el tiempo. Se mide con *Ahora* y `retrasoMaximoMs` en el JSON. |
| Interruptor de voz en menos de 150 ms | Silencia el elemento de audio de inmediato. Falta confirmarlo de oído. |
| 90% de términos del glosario correctos | **Pendiente**: se mide en el panel del glosario. |
| El colega entiende la prueba en Meet | **Pendiente**. |
| La key no aparece en el navegador, el repositorio ni los logs | Cumplido: la key solo vive en `.env`, ignorado por git, y el servidor no la registra. |
| README para correrlo en menos de 10 minutos | Este documento. |
