# Investigación: cómo se logra una traducción simultánea natural

Oct 23, 2026. Contexto: con Soniox la traducción es buena, pero la voz sale a tirones. Este documento resume cómo lo resuelven los productos y la investigación actuales, por qué nuestra versión hace pausas y qué arquitectura conviene para llegar a un producto muy natural.

## 1. Resumen

- **Nadie traduce sin retraso.** Los intérpretes humanos profesionales van entre 2 y 5 s detrás del hablante (*ear-voice span*), y los mejores sistemas de IA están en un rango parecido. Google dice que Meet va "unos segundos" detrás. Lo que hace natural una interpretación no es el retraso cero, sino **una voz continua, con buena entonación, que no arranca y se detiene**.
- **Hay dos arquitecturas.**
  - **Modelos de voz a voz** (OpenAI `gpt-realtime-translate`, Google Gemini 3.5 Live Translate, Kyutai Hibiki, Meta Seamless): un solo modelo oye y habla. Aprende cuándo hablar como un intérprete y produce voz continua que conserva el tono de quien habla. Son lo más natural hoy.
  - **Cascadas** (transcripción → traducción → voz: Microsoft Teams Interpreter, DeepL Voice, Palabra, nuestra versión con Soniox): dan más control (glosario, voces), pero solo suenan naturales si **cada etapa trabaja palabra por palabra y la voz conserva la entonación entre pedazos**.
- **Nuestras pausas con Soniox no se arreglan con ajustes.** Hay dos causas:
  - Soniox entrega la traducción en tandas confirmadas cada 2–5 s, sin traducción provisional.
  - Su voz (`tts-rt-v2`) no puede continuar una frase con la misma entonación: espera más texto o hay que cerrarla en cada tanda, y entonces suena a pedazos.
- **Recomendación:**
  1. Probar ya **Gemini 3.5 Live Translate**, el modelo de Meet, que salió como API en junio de 2026.
  2. Volver a medir **OpenAI** con los diagnósticos nuevos.
  3. Solo si el glosario resulta crítico, construir una **cascada propia** (sección 5).

## 2. Cómo lo hacen otros

| Producto / modelo | Arquitectura | Qué lo hace natural | Retraso reportado | Fuente |
| --- | --- | --- | --- | --- |
| **Google Meet / Gemini 3.5 Live Translate** | Voz a voz, un solo modelo (sin texto intermedio) | Conserva entonación, ritmo y tono de quien habla. Espera solo lo necesario para que la frase tenga sentido. | "Unos segundos" (Google); ~2.9 s al primer audio según una medición independiente | [Ayuda de Meet](https://support.google.com/meet/answer/16221730?hl=en), [docs API](https://ai.google.dev/gemini-api/docs/live-api/live-translate), [LiveLingo](https://www.livelingo.io/guides/gemini-3-5-live-translate) |
| **OpenAI gpt-realtime-translate** | Voz a voz, entrenado con audio de intérpretes profesionales | Voz continua mientras se sigue hablando; adapta la voz al tono de quien habla | Mediana ~0.7 s al primer audio según una medición; en nuestras pruebas 3–5 s | [Guía oficial](https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide), [LiveLingo](https://www.livelingo.io/guides/gpt-live-translation) |
| **Kyutai Hibiki** (investigación, código abierto) | Voz a voz, decodificador único (como Moshi) | Acumula "solo el contexto necesario" y habla por pedazos de 80 ms; conserva la voz | Cercano a un intérprete humano (solo francés → inglés) | [Paper](https://arxiv.org/abs/2502.03382), [GitHub](https://github.com/kyutai-labs/hibiki) |
| **Meta SeamlessStreaming** (investigación) | Voz a voz con política EMMA | La política decide cuándo hay suficiente información para hablar; generador de voz expresivo que cuida ritmo y pausas | Bajo; advierte que muy poco retraso pierde contenido | [Paper](https://arxiv.org/abs/2312.05187), [blog](https://ai.meta.com/blog/seamless-communication/) |
| **Microsoft Teams Interpreter** | Cascada sobre Azure (transcripción → traducción → voz) | Clona la voz de quien habla (opcional); modo simultáneo y consecutivo | "Un pequeño retraso" | [Microsoft Inside Track](https://www.microsoft.com/insidetrack/blog/deploying-our-new-game-changing-interpreter-agent-in-our-meetings-at-microsoft/) |
| **DeepL Voice** | Cascada | Calidad de traducción; el propio fundador dice que el retraso es su problema principal | "Una o dos frases" | [Implicator](https://www.implicator.ai/deepl-adds-voice-translation-but-the-delay-is-the-product.md), [TNW](https://thenextweb.com/news/deepl-voice-to-voice-real-time-spoken-translation) |
| **Palabra.ai** | Cascada propia de punta a punta, con modelos predictivos por par de idiomas | Controla cada etapa; voces modeladas sobre intérpretes; clonación | < 1 s (dato del propio fabricante, sin verificar) | [API](https://www.palabra.ai/voice-translation-api) |

## 3. Por qué una cascada suena a pedazos (y cómo lo evita la investigación)

1. **Cuándo confirmar el texto.** Si se espera a la frase completa, hay demasiado retraso. Si se confirma cada palabra, el texto cambia y se dicen errores. Las técnicas que funcionan:
   - **LocalAgreement**: confirmar solo el prefijo que coincide entre dos actualizaciones seguidas ([Whisper-Streaming](https://alphaxiv.org/abs/2307.14743), ~3.3 s de retraso).
   - **wait-k** y **AlignAtt**: traducir apenas el modelo "ya sabe" lo que sigue. Los mejores sistemas de 2025–2026 combinan reconocimiento en streaming con un LLM que traduce prefijos ([IWSLT 2025](https://arxiv.org/abs/2506.18828), [AlignAtt4LLM](https://www.alphaxiv.org/abs/2606.03967)).
2. **La voz necesita contexto para entonar.** Sintetizar pedazos sueltos suena robótico. La voz necesita "ver" lo que sigue (*lookahead*), y esperar eso agrega retraso ([Ma et al., 2020](https://aclanthology.org/2020.findings-emnlp.346/)). Hay dos soluciones prácticas:
   - **Voces con continuación**: el texto se manda por pedazos dentro de un mismo contexto y la voz conserva la entonación sin esperar el final. Lo ofrecen [Cartesia (*contexts/continuations*)](https://docs.cartesia.ai/build-with-sonic/capability-guides/stream-inputs-using-continuations) y [ElevenLabs (*request stitching*)](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/request-stitching).
   - **Contexto futuro estimado** con un modelo de lenguaje ([pseudo-lookahead](https://arxiv.org/abs/2012.12612)).
3. **El ritmo de la voz.** Los sistemas de doblaje controlan la duración en tres puntos: qué tan larga es la traducción, dónde se ponen pausas y la velocidad de la voz ([Amazon](https://www.amazon.science/publications/duration-modeling-of-neural-tts-for-automatic-dubbing), [VideoDubber](https://arxiv.org/abs/2211.16934)). Los intérpretes humanos hacen lo mismo:
   - **Comprimen** cuando van atrasados ([Gerver, Chernov](https://www.enl.auth.gr/gramma/gramma11/Liontou.pdf)).
   - **Regulan su retraso**: ni muy pegados al hablante ni muy lejos ([EVS](https://translate.hicom-asia.com/area/ear-voice-span/)).
4. **Mezcla con el original** (*ducking*): el original de fondo y la voz traducida encima. Ya lo tenemos.

## 4. Diagnóstico de nuestra versión con Soniox (con datos de las pruebas)

| Síntoma | Causa medida | ¿Se arregla con ajustes? |
| --- | --- | --- |
| Silencios de 1–2.5 s entre frases | Soniox confirma la traducción en tandas cada 2–5 s y no manda traducción provisional (0 eventos `traduccion_provisional`) | No |
| Entonación que "reinicia" en cada tanda | La voz de Soniox no continúa una frase: o espera el siguiente texto (3.5–5.4 s, y error 408 si no llega) o se cierra en cada tanda | No |
| Puntos y frases cortadas al cortar en cada pausa | Soniox traduce cada pedazo por separado | No: es un intercambio entre fluidez y calidad |
| Voz genérica | Voces fijas, sin conservar el tono de quien habla | No |

Lo que sí resolvimos: la voz arranca 0.2–0.5 s después de cada tanda, el original de fondo con *ducking*, sin puntos falsos (con pausas largas), el glosario aplicado a la voz y la medición precisa.

## 5. Opciones para el producto

### Opción A: modelo de voz a voz de Google (recomendada para probar primero)

**Gemini 3.5 Live Translate** (`gemini-3.5-live-translate-preview`) es el modelo de Meet, publicado como API en junio de 2026:
- WebSocket con tokens efímeros para el navegador (mismo esquema que ya usamos).
- Más de 70 idiomas, detección automática del idioma de origen, audio PCM a 24 kHz y transcripciones opcionales.
- Conserva la entonación de quien habla.
- ~$0.037 por minuto, gratis durante la vista previa ([precios](https://cloudprice.net/models/google-gemini-3-5-live-translate)).
- Limitaciones: no acepta instrucciones ni glosario; está en vista previa, sin garantías de servicio.
- **Esfuerzo**: 1–2 días como tercer proveedor del probador.

### Opción B: volver a medir OpenAI

Una medición independiente da ~0.7 s al primer audio, y nosotros vimos 3–5 s. Puede ser por cómo medíamos entonces (antes de los diagnósticos) o por la configuración (reducción de ruido, modo archivo). Con la voz continua y la adaptación del tono, puede ser el más natural. **Esfuerzo**: horas (agregar diagnósticos de tiempo al adaptador de OpenAI).

### Opción C: cascada propia "de intérprete" (máximo control, más trabajo)

Para cuando el glosario o los nombres de clientes sean críticos y los modelos de voz a voz fallen con ellos:
1. **Reconocimiento**: Soniox (texto palabra por palabra, glosario, buen acento colombiano), sin su traducción.
2. **Traducción propia con un LLM**:
   - Confirmación por **LocalAgreement** sobre el texto en español.
   - El LLM traduce el prefijo nuevo "continuando" lo ya dicho, con el glosario en el prompt y la instrucción de mantener frases cortas y sin muletillas.
   - Control del largo de la traducción (compresión si se atrasa).
3. **Voz con continuación** (Cartesia o ElevenLabs): un contexto por intervención; cada pedazo se agrega con `continue: true`, así la entonación se conserva sin esperar el final. Clonación de voz opcional, con consentimiento.
4. **Controlador de ritmo**: apuntar a 2–3 s de retraso estable. Acelera o comprime si la cola crece; no deja silencios largos mientras la persona sigue hablando.

**Esfuerzo**: 2–3 semanas para una primera versión medible, con dos proveedores más y costos por minuto que sumar.

## 6. Plan recomendado

1. **Gemini 3.5 Live Translate como tercer proveedor** del probador. Comparar con la misma nota de voz y en vivo.
2. **Diagnósticos de tiempo en el adaptador de OpenAI** y volver a medirlo.
3. Elegir con números y de oído:
   - Si un modelo de voz a voz suena natural y su retraso es aceptable (≤ 3 s estable), **usarlo para la voz**. Sus fallas de glosario se corrigen en los subtítulos, como ya hacemos.
   - Si los nombres y siglas del negocio fallan demasiado, pasar a la **opción C**.
4. **Ajustar las metas del spec** (sección 9): con referencia a los intérpretes humanos, una meta realista de "natural" es **retraso estable de 2–3 s y voz continua**, más que p50 ≤ 1.5 s.

## 7. Advertencias sobre las fuentes

Varias cifras (retrasos de Gemini y OpenAI, "< 1 s" de Palabra) vienen de mediciones de terceros o del propio fabricante, no de pruebas controladas. Google y OpenAI no publican retrasos oficiales. Por eso el plan es **medir con nuestro probador** antes de decidir. Las webs de Google y OpenAI no fueron accesibles desde el entorno de esta investigación; los datos de Gemini salen de buscadores y de sitios que citan su documentación.
