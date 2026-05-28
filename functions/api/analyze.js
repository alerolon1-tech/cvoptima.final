export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Metodo no permitido" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const fd = await request.formData();
    const cvText    = fd.get("cvText")    || "";
    const liText    = fd.get("liText")    || "";
    const role      = fd.get("role")      || "";
    const sector    = fd.get("sector")    || "";
    const seniority = fd.get("seniority") || "";
    const modo      = fd.get("modo")      || "cv";
    const userId    = fd.get("userId")    || null;

    let plan = fd.get("plan") || "starter";
    const idioma = fd.get("idioma") || "es";
    const isEnglish = idioma === 'en';
    const pagoToken = fd.get("pagoToken") || "";

    // Verificar token de pago (post-pago inmediato)
    if (pagoToken && env.SUPABASE_URL && env.SUPABASE_KEY) {
      const tokenPlan = await verificarTokenPago(env, pagoToken);
      if (tokenPlan) plan = tokenPlan;
    }

    // Verificar email del usuario para asignar plan
    const userEmail = request.headers.get("X-User-Email") || "";
    if (userEmail && env.SUPABASE_URL && env.SUPABASE_KEY) {
      const userPlan = await resolveUserPlan(env, userEmail);
      if (userPlan) plan = userPlan;
    }

    if (modo !== "li" && modo !== "comparativa" && cvText.length < 30) {
      return new Response(JSON.stringify({ error: "No se recibio texto del CV" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    if ((modo === "li" || modo === "ambos") && liText.length < 30) {
      return new Response(JSON.stringify({ error: "No se recibio texto del perfil de LinkedIn" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    if (modo === "comparativa" && (cvText.length < 30 || liText.length < 30)) {
      return new Response(JSON.stringify({ error: "Se necesitan las dos versiones del CV para comparar" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const systemPrompt = isEnglish ? (
      "You are a senior employability expert. Your ONLY function is to analyze the document provided and return a valid JSON. ALL text fields MUST be in English. Never use Spanish.\n\n" +
      "MAIN RULE — READ THIS FIRST:\n" +
      "ALL text in the JSON must be in SECOND PERSON. Address the person directly.\n" +
      "CORRECT: 'Your profile shows...', 'Your achievements indicate...', 'Your narrative is...'\n" +
      "INCORRECT: 'The candidate shows...', 'Their achievements indicate...'\n\n" +
      "QUANTITATIVE vs QUALITATIVE ACHIEVEMENTS vs RESPONSIBILITIES:\n" +
      "- Quantitative achievement: has a number, percentage or measurable figure. Example: 'reduced delivery time by 30%'\n" +
      "- Qualitative achievement: has a conjugated verb describing a CONCRETE CHANGE or RESULT. Example: 'reorganized the customer service process improving team experience', 'led the implementation of a new tracking system'\n" +
      "- Responsibility without impact: describes a task, NOT a result. NEVER qualitative achievements: 'customer service', 'agenda management', 'cashier', 'stock control'. Any phrase without a conjugated verb in first person.\n" +
      "- Personality attribute: describes how the person IS, NOT what they achieved. NEVER qualitative achievements: 'responsible person', 'proactive', 'eager to grow'. These go to responsabilitiesWithoutImpact or are ignored.\n\n" +
      "ADDITIONAL RULES:\n" +
      "1. Use the person's real name as it appears in the document.\n" +
      "2. Every field must mention concrete data from the document: company, role, tool, date or specific achievement.\n" +
      "3. NEVER invent data not in the document. If something does not exist write 'Not detected in document'.\n" +
      "4. Generate MINIMUM 3 High priority and 2 Medium priority recommendations. Each must refer to concrete document improvements.\n" +
      "5. All scores are integers between 0 and 100. NEVER use 0-10 scale.\n" +
      "6. NEVER set atsScore, scorePotencial or impactDensityScore to 0.\n" +
      "7. NO LEADERSHIP recommendations unless the CV shows concrete evidence of managing people.\n" +
      "8. Respond ONLY with the JSON. No extra text, no markdown."
    ) : (
      "Sos un experto senior en empleabilidad. Tu unica funcion es analizar el documento que el usuario te proporciona y devolver un JSON valido en espanol rioplatense.\n\n" +
      "REGLA PRINCIPAL — LEE ESTO PRIMERO:\n" +
      "TODO el texto del JSON debe estar en SEGUNDA PERSONA. Hablale directamente a quien hizo el analisis.\n" +
      "CORRECTO: 'Tu perfil muestra...', 'Tus logros indican...', 'Tu narrativa es...'\n" +
      "INCORRECTO: 'El candidato muestra...', 'Sus logros indican...', 'La persona tiene...'\n" +
      "El resumenEjecutivo puede empezar con el nombre: 'Maria, tu perfil muestra...' — pero SIEMPRE en segunda persona despues.\n" +
      "Esta regla aplica a TODOS los campos de texto sin excepcion.\n\n" +
      "LOGROS CUANTITATIVOS vs CUALITATIVOS vs RESPONSABILIDADES — distincion obligatoria:\n" +
      "- Logro cuantitativo: tiene número, porcentaje o cifra medible. Ejemplo: 'reduje el tiempo de entrega un 30%'\n" +
      "- Logro cualitativo: tiene verbo conjugado EN PRIMERA PERSONA que describe un CAMBIO o RESULTADO concreto. Ejemplo: 'reorganicé el proceso de atención mejorando la experiencia del equipo', 'lideré la implementación de un nuevo sistema de seguimiento', 'implementé un protocolo que mejoró la coordinación'\n" +
      "- Responsabilidad sin impacto: describe una tarea o función, NO un resultado. NUNCA son logros cualitativos: 'atención al cliente', 'atención a empleados', 'atención a proveedores', 'gestión de agenda', 'coordinación de reuniones', 'manejo de caja', 'reposición de mercadería', 'control de stock', 'facturación', 'archivo', 'soporte', cualquier frase sin verbo conjugado en primera persona.\n" +
      "- Atributo de personalidad: describe cómo es la persona, NO qué logró. NUNCA son logros cualitativos: 'persona responsable', 'soy proactivo', 'tengo ganas de crecer', 'comprometida con el trabajo', 'con muchas ganas de aprender', 'buen manejo del equipo', cualquier descripción de valores, actitudes o rasgos personales. Estos van a responsabilidadesSinImpacto o se ignoran.\n" +
      "REGLA ESTRICTA: un logro cualitativo SIEMPRE tiene un verbo conjugado (reorganicé, lideré, implementé, desarrollé, mejoré, diseñé, creé) seguido de un resultado o cambio concreto. Si la frase NO tiene verbo conjugado en primera persona, es una RESPONSABILIDAD o ATRIBUTO, no un logro.\n\n" +
      "REGLAS ADICIONALES:\n" +
      "1. Usa el nombre real de la persona tal como figura en el documento. NUNCA escribas 'No especificado'.\n" +
      "2. Cada campo debe mencionar datos concretos del documento: empresa, rol, herramienta, fecha o logro especifico.\n" +
      "3. NUNCA inventes datos que no figuren en el documento. Si algo no existe escribe 'No detectado en el documento'.\n" +
      "4. ANTES de generar brechas o recomendaciones, identifica mentalmente el rol, sector y habilidades principales del documento. Una brecha o recomendacion NUNCA puede referirse a algo que ya figura como presente en el documento.\n" +
      "5. Si el documento esta en ingles, analizalo en ingles internamente pero escribe todo el JSON en espanol rioplatense.\n" +
      "6. Genera MINIMO 3 recomendaciones de prioridad Alta y 2 de prioridad Media. Cada recomendacion debe referirse a mejoras concretas del documento: redaccion, estructura, logros, keywords, secciones faltantes, verbos, formato. NUNCA recomiendes buscar empleo, cambiar de sector o aplicar a empresas. Si el CV no tiene titular, perfil profesional o logros cuantificados, esas DEBEN ser recomendaciones de prioridad Alta. REGLAS ESTRICTAS DE RECOMENDACIONES: (a) cada recomendacion debe ser sobre un tema DISTINTO — no repitas el mismo tema con diferente título ni diferente redacción; (b) el tema 'logros' solo puede aparecer UNA SOLA VEZ en todo el plan de acción — si el CV tiene logros cualitativos, reconocelos y recomendá cuantificarlos en lugar de decir que no hay logros; (c) NUNCA uses frases genéricas como 'mejorar la redacción' o 'mejorar el formato' sin especificar exactamente qué mejorar y cómo; (d) antes de escribir cada recomendacion verificá que no haya otra sobre el mismo tema.\n" +
      "7. Todos los scores son numeros enteros entre 0 y 100. NUNCA uses escala 0-10.\n" +
      "8. NUNCA dejes atsScore, scorePotencial o impactDensityScore en 0.\n" +
      "9. PROHIBICION ABSOLUTA — LIDERAZGO: NO recomiendes 'desarrollar capacidad de liderazgo' salvo que el CV muestre evidencia concreta de gestión de personas.\n" +
      "10. Responde SOLO con el JSON. Sin texto extra, sin markdown, sin bloques de codigo."
    );

    const userPrompt = buildPrompt(cvText, liText, modo, role, sector, seniority, plan, idioma);

    // Pre-calcular valores del radar desde el texto (no depender del modelo)
    const atsDetalleCalculado = modo !== 'li' ? calcularAtsDetalle(cvText) : calcularAtsDetalle(liText);

    const MODELS = [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "llama3-70b-8192",
      "llama3-8b-8192",
    ];

    // Starter usa menos tokens para reducir consumo y rate limit
    const maxTokens = plan === "starter" ? 3200 : 4000;

    let groqData = null;
    let lastError = null;

    for (let i = 0; i < MODELS.length; i++) {
      const model = MODELS[i];
      if (i > 0) await new Promise(r => setTimeout(r, 2000));

      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.GROQ_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt   },
          ],
          temperature: 0.2,
          max_tokens: maxTokens,
        }),
      });

      if (groqRes.ok) {
        groqData = await groqRes.json();
        groqData._modelUsed = model;
        break;
      }

      const errText = await groqRes.text();
      lastError = errText;

      let errJson;
      try { errJson = JSON.parse(errText); } catch { errJson = null; }
      const isRateLimit =
        groqRes.status === 429 ||
        errJson?.error?.code === "rate_limit_exceeded" ||
        errJson?.error?.type === "tokens" ||
        errJson?.error?.code === "model_decommissioned";

      if (!isRateLimit) throw new Error("Groq error: " + errText);
    }

    if (!groqData) {
      throw new Error("El servicio de analisis esta temporalmente saturado. Intenta de nuevo en unos minutos.");
    }

    const raw = groqData.choices[0].message.content;

    let result;
    try {
      // Limpiar bloques markdown — al principio Y en cualquier lugar
      let clean = raw
        .replace(/```(?:json)?\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();

      // Extraer desde la primera llave
      const m = clean.match(/\{[\s\S]*/);
      if (!m) throw new Error('no-json');
      let jsonStr = m[0];

      // Cerrar llaves faltantes si el JSON está truncado
      let open = 0;
      for (const c of jsonStr) {
        if (c === '{') open++;
        else if (c === '}') open--;
      }
      if (open > 0) jsonStr += '}'.repeat(open);

      result = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error("No se pudo parsear la respuesta del modelo: " + raw.slice(0, 300));
    }

    result.has_linkedin = liText.length > 30;
    result._modelUsed = groqData._modelUsed || 'unknown';
    result._modelUsed = groqData._modelUsed || 'unknown';
    result.atsDetalle = atsDetalleCalculado;
    if (!result.linkedin_analysis) result.linkedin_analysis = null;

    // Normalizar scores: si el modelo los devuelve en escala 0-10, convertir a 0-100
    const norm = (v) => (typeof v === "number" && v > 0 && v <= 10) ? Math.round(v * 10) : (v || 0);
    result.atsScore           = norm(result.atsScore);
    result.scorePotencial     = norm(result.scorePotencial);
    result.impactDensityScore = Math.min(85, norm(result.impactDensityScore));

    // Ajustar impactDensityScore según logros cualitativos y cuantitativos reales
    const logrosFuertes    = (result.analisisLogros?.logrosFuertes || []).length;
    const logrosCualitativos = (result.analisisLogros?.logrosCualitativos || []).length;
    const diagLower = (result.impactDensityDiagnostico || '').toLowerCase();

    if (logrosFuertes === 0 && logrosCualitativos === 0) {
      // Sin ningún logro — score muy bajo
      result.impactDensityScore = Math.min(result.impactDensityScore, 20);
      result.impactDensityDiagnostico = 'No se detectaron logros cuantitativos ni cualitativos en el documento. Las experiencias describen tareas pero no muestran resultados ni impacto.';
    } else if (logrosFuertes === 0 && logrosCualitativos > 0) {
      // Solo logros cualitativos — score medio, no penalizar como si no hubiera nada
      result.impactDensityScore = Math.max(result.impactDensityScore, 35);
      result.impactDensityScore = Math.min(result.impactDensityScore, 60);
      result.impactDensityDiagnostico = `Tu CV muestra ${logrosCualitativos} logro${logrosCualitativos > 1 ? 's' : ''} cualitativo${logrosCualitativos > 1 ? 's' : ''} — acciones concretas con verbos de impacto que comunican valor real. Para aumentar el score, podés sumar cifras a esos logros cuando sea posible.`;
    } else if (logrosFuertes > 0 && logrosCualitativos > 0) {
      // Tiene ambos tipos — score alto
      result.impactDensityScore = Math.max(result.impactDensityScore, 55);
    }

    // Calcular label desde el score
    if (result.impactDensityScore >= 65) result.impactDensityLabel = "Alto";
    else if (result.impactDensityScore >= 35) result.impactDensityLabel = "Medio";
    else result.impactDensityLabel = "Bajo";

    if (result.atsDetalle) {
      for (const k of Object.keys(result.atsDetalle)) {
        if (typeof result.atsDetalle[k] === "number") result.atsDetalle[k] = norm(result.atsDetalle[k]);
      }
    }
    if (result.perfilEmpleabilidad) {
      for (const k of ["visibilidad", "coherencia", "movilidad"]) {
        if (result.perfilEmpleabilidad[k]?.score !== undefined) {
          result.perfilEmpleabilidad[k].score = norm(result.perfilEmpleabilidad[k].score);
        }
      }
    }

    // Fallback: si los scores principales siguen en 0, estimarlos desde perfilEmpleabilidad
    if (result.atsScore === 0 && result.perfilEmpleabilidad) {
      const pe = result.perfilEmpleabilidad;
      const vis = pe.visibilidad?.score || 0;
      const coh = pe.coherencia?.score  || 0;
      const mov = pe.movilidad?.score   || 0;
      result.atsScore = Math.round((vis + coh + mov) / 3);
    }
    if (result.scorePotencial === 0) result.scorePotencial = Math.min(100, result.atsScore + 15);
    if (result.impactDensityScore === 0) result.impactDensityScore = 15; // bajo por defecto si no se detectaron logros

    // Registrar email aunque sea Starter (para llevar registro de usuarios)
    if (userEmail && env.SUPABASE_URL && env.SUPABASE_KEY) {
      await registrarEmail(env, userEmail, plan);
    }

    // Filtrar logrosCualitativos que son en realidad responsabilidades o atributos
    if (result.analisisLogros?.logrosCualitativos) {
      const iniciosResponsabilidad = ['coordinación', 'gestión', 'atención', 'manejo', 'control', 'soporte', 'apoyo', 'asistencia', 'administración', 'elaboración', 'ejecución', 'seguimiento', 'monitoreo', 'realización', 'preparación', 'supervisión', 'revisión'];
      const atributosPersonalidad = ['responsable', 'proactiv', 'comprometid', 'dedicad', 'apasionad', 'motivad', 'entusiasta', 'puntual', 'ordenad', 'organizado', 'creativ', 'innovador', 'flexibl', 'adaptabl', 'comunicativ', 'trabajo en equipo', 'ganas de crecer', 'ganas de aprender', 'con muchas ganas', 'deseos de', 'buen manejo', 'buena predisposición'];
      result.analisisLogros.logrosCualitativos = result.analisisLogros.logrosCualitativos.filter(l => {
        const frase = (l.frase || '').toLowerCase().trim();
        if (frase.split(' ').length < 5) return false;
        if (iniciosResponsabilidad.some(p => frase.startsWith(p))) return false;
        if (atributosPersonalidad.some(p => frase.includes(p))) return false;
        return true;
      });
    }

    // ── Filtro anti-duplicados en recomendaciones ──────────────────────────
    if (result.recomendaciones?.length) {
      const tieneLogrosCualitativos = (result.analisisLogros?.logrosCualitativos || []).length > 0;
      const tieneLogrosCuantitativos = (result.analisisLogros?.logrosFuertes || []).length > 0;

      // Palabras que identifican recomendaciones sobre logros
      const palabrasLogros = ['logro', 'cuantif', 'métric', 'resultado', 'impacto', 'incorporar', 'agreg', 'número'];

      // Separar recomendaciones de logros de las demás
      const recsLogros = result.recomendaciones.filter(r =>
        palabrasLogros.some(p => (r.titulo || '').toLowerCase().includes(p) || (r.detalle || '').toLowerCase().includes(p))
      );
      const recsOtras = result.recomendaciones.filter(r =>
        !palabrasLogros.some(p => (r.titulo || '').toLowerCase().includes(p) || (r.detalle || '').toLowerCase().includes(p))
      );

      // Construir UNA SOLA recomendación de logros
      let recLogro = null;
      if (recsLogros.length > 0) {
        if (tieneLogrosCualitativos && !tieneLogrosCuantitativos) {
          recLogro = {
            prioridad: 'Alta',
            categoria: 'Logros',
            titulo: 'Tus logros cualitativos comunican impacto — potenciá algunos con cifras',
            detalle: 'Tu CV ya muestra acciones concretas con verbos de impacto. Eso tiene valor real. Si podés recordar alguna cifra — cantidad de personas, tiempo, volumen, proyectos — sumársela a uno o dos logros va a reforzar aún más lo que ya comunicás. No es obligatorio, pero suma.',
            impactoScore: recsLogros[0]?.impactoScore || '+8 puntos'
          };
        } else if (!tieneLogrosCuantitativos) {
          const resps = (result.analisisLogros?.responsabilidadesSinImpacto || []).slice(0, 2);
          let ejemplos = resps.length > 0
            ? ' Por ejemplo, a partir de lo que figura en tu CV: ' + resps.map(r => '"' + (r.frase||'') + '" → sumale una cifra concreta o un verbo de impacto con resultado').join('; ')
            : ' Ejemplo: "Atendí 50 clientes por día" (cuantitativo) o "Mejoré la experiencia de atención implementando un nuevo proceso" (cualitativo).';
          recLogro = {
            prioridad: 'Alta',
            categoria: 'Logros',
            titulo: 'Incorporá logros en tus experiencias — cuantitativos o cualitativos',
            detalle: 'Tus experiencias describen tareas pero no muestran resultados. Podés agregar logros cuantitativos (con número, porcentaje o cifra) o cualitativos (con verbo de acción y resultado concreto).' + ejemplos,
            impactoScore: (recsLogros[0] && recsLogros[0].impactoScore) || '+15 puntos'
          };
        } else {
          recLogro = recsLogros[0]; // Ya tiene logros cuantitativos, usar la primera recomendación
        }
      }

      // Eliminar duplicados en las demás recomendaciones por palabras clave del título
      const temasVistos = new Set();
      const recsOtrasFiltradas = recsOtras.filter(r => {
        const palabrasClave = (r.titulo || '').toLowerCase().split(' ').filter(w => w.length > 4).slice(0, 3).join('-');
        if (temasVistos.has(palabrasClave)) return false;
        temasVistos.add(palabrasClave);
        return true;
      });

      // Reconstruir recomendaciones: logro primero (si hay), resto después
      result.recomendaciones = recLogro
        ? [recLogro, ...recsOtrasFiltradas]
        : recsOtrasFiltradas;
    }

    // Detectar secciones faltantes críticas y agregar recomendaciones automáticas
    const secciones = result.seccionesDetectadas || {};
    const recsAuto = [];
    if (!secciones.perfilProfesional) {
      recsAuto.push({
        prioridad: "Alta",
        categoria: "Estructura",
        titulo: "Agregar titular y perfil profesional",
        detalle: "Tu CV no tiene titular ni perfil profesional. Son las primeras secciones que lee un reclutador — sin ellas, tu perfil no comunica quién sos ni qué buscás. Agregá 2-3 líneas que resuman tu rol, experiencia y propuesta de valor.",
        impactoScore: "+12"
      });
    }
    if (!secciones.logros && result.impactDensityScore < 30) {
      recsAuto.push({
        prioridad: "Alta",
        categoria: "Logros",
        titulo: "Incorporar logros cuantificados en tus experiencias",
        detalle: "Tus experiencias describen responsabilidades pero no muestran resultados. Transformá al menos una tarea por puesto en un logro con número: cantidad de clientes atendidos, porcentaje de mejora, volumen gestionado.",
        impactoScore: "+15"
      });
    }
    if (recsAuto.length > 0) {
      result.recomendaciones = [...recsAuto, ...(result.recomendaciones || [])];
    }

    const response = applyTierVisibility(result, plan, modo);

    if (userId && env.SUPABASE_URL && env.SUPABASE_KEY) {
      await saveToSupabase(env, userId, cvText, liText, result, plan);
    }

    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}

// ─── TIERS ───────────────────────────────────────────────────────────────────

function applyTierVisibility(data, plan, modo) {
  if (modo === "comparativa") return { ...data, _plan: "comparativa" };
  if (plan === "professional" || plan === "pro") {
    return {
      ...data,
      _plan: plan,
      capitalRelacional: data.capitalRelacional || null,
      diagnosticoTrayectoria: data.diagnosticoTrayectoria || null,
      posicionamiento: data.posicionamiento || null,
      recomendacionesNarrativa: data.recomendacionesNarrativa || [],
      moduloEmpleabilidadClaveSocial: data.moduloEmpleabilidadClaveSocial || null,
      versionIngles: data.versionIngles || null,
    };
  }

  if (plan === "diagnostico") {
    const d = { ...data, _plan: plan };
    if (modo === "ambos" && d.linkedin_analysis) {
      d.linkedin_analysis = {
        ...d.linkedin_analysis,
        coherencia_score:   null,
        coherencia_nivel:   null,
        resumen_coherencia: null,
        coincidencias:      null,
        brechas:            null,
        _coherencia_locked: true,
      };
    }
    return d;
  }

  // Starter
  const recsAlta  = (data.recomendaciones || []).filter(r => r.prioridad === "Alta");
  const recsMedia = (data.recomendaciones || []).filter(r => r.prioridad === "Media").slice(0, 3);

  // Descripción textual del radar desde valores reales de atsDetalle
  const atsD = data.atsDetalle || {};
  const detLabels = {keywords:'Keywords',verbosAccion:'Verbos de acción',metricas:'Métricas',estructura:'Estructura',densidadHabilidades:'Densidad de habilidades',claridadRoles:'Claridad de roles'};
  const detEntries = Object.entries(detLabels)
    .map(([k,n]) => ({k, n, v: typeof atsD[k]==='number' ? atsD[k] : null}))
    .filter(e => e.v !== null)
    .sort((a,b) => b.v - a.v);
  let radarDescripcion = null;
  if(detEntries.length >= 2){
    const fuertes = detEntries.slice(0,2).map(e=>e.n);
    const debiles = detEntries.slice(-2).map(e=>e.n);
    radarDescripcion = 'Tu perfil muestra mayor solidez en ' + fuertes.join(' y ') + '. Las dimensiones con más oportunidad de mejora son ' + debiles.join(' y ') + '.';
  }

  // En modo ambos, mostrar anticipo de LinkedIn en Starter
  let liAnticipo = null;
  if (modo === "ambos" && data.linkedin_analysis) {
    const la = data.linkedin_analysis;
    liAnticipo = {
      _starter_preview: true,
      coherencia_score:    la.coherencia_score    || null,
      coherencia_nivel:    la.coherencia_nivel     || null,
      resumen_coherencia:  la.resumen_coherencia   || null,
      titular_actual:      la.titular_actual       || null,
      titular_sugerido:    la.titular_sugerido     || null,
      coincidencias:       (la.coincidencias || []).slice(0, 2),
      brechas:             (la.brechas      || []).slice(0, 2),
    };
  }

  return {
    _plan:               "starter",
    candidateName:       data.candidateName,
    seniority:           data.seniority,
    yearsExperience:     data.yearsExperience,
    currentRole:         data.currentRole,
    atsScore:            data.atsScore,
    scorePotencial:      data.scorePotencial,
    impactDensityScore:  data.impactDensityScore,
    impactDensityLabel:  data.impactDensityLabel,
    impactDensityDiagnostico: data.impactDensityDiagnostico,
    resumenEjecutivo:    data.resumenEjecutivo,
    has_linkedin:        data.has_linkedin,
    alertas:             data.alertas || [],
    recomendaciones:     [...recsAlta, ...recsMedia],
    fortalezas:          data.fortalezas || [],
    debilidades:         data.debilidades || [],
    perfilEmpleabilidad: data.perfilEmpleabilidad || null,
    linkedin_analysis:   liAnticipo,
    _preview: {
      radarDescripcion,
      narrativaTipo:       data.narrativaProfesional?.tipo || null,
      narrativaDescripcion: data.narrativaProfesional?.descripcion
        ? data.narrativaProfesional.descripcion.split('.')[0] + '.' : null,
      logrosFuertes:       (data.analisisLogros?.logrosFuertes || []).slice(0, 1),
      logrosCualitativos:  (data.analisisLogros?.logrosCualitativos || []).slice(0, 1),
      habilidadesDeclaradas: (data.mapaHabilidades?.declaradas || []).slice(0, 4),
    },
    atsDetalle: {
      keywords: null, verbosAccion: null, metricas: null,
      estructura: null, densidadHabilidades: null, claridadRoles: null,
      _locked: true,
    },
    _locked: {
      atsDetalle: true, seccionesDetectadas: true, analisisLogros: true,
      verbosImpacto: true, narrativaProfesional: true, mapaHabilidades: true,
      rolesObjetivo: true, recomendaciones_full: true, linkedin_analysis: true,
    },
  };
}

// ─── PROMPT ──────────────────────────────────────────────────────────────────

function calcularAtsDetalle(texto) {
  const t = texto.toLowerCase();

  // Métricas — números, porcentajes, cifras monetarias
  const metricasMatches = texto.match(/\d+\s*%|\$\s*\d+|\d+\s*(clientes|usuarios|proyectos|personas|ventas|productos|millones|mil)/gi) || [];
  const metricas = Math.min(90, metricasMatches.length === 0 ? 5 : Math.min(30 + metricasMatches.length * 15, 85));

  // Verbos de acción — verbos de impacto en primera persona
  const verbosAccion_list = ['gestion', 'coordin', 'implement', 'desarroll', 'lider', 'supervis', 'optimiz', 'increment', 'reduj', 'mejor', 'cre', 'diseñ', 'lanz', 'negoci', 'ejecut', 'planific', 'anali', 'elabor', 'organiz', 'direct'];
  const verbosCount = verbosAccion_list.filter(v => t.includes(v)).length;
  const verbosAccion = Math.min(90, verbosCount === 0 ? 10 : Math.min(20 + verbosCount * 8, 85));

  // Keywords — palabras clave profesionales relevantes
  const keywords_list = ['linkedin', 'excel', 'office', 'inglés', 'ingles', 'python', 'sql', 'crm', 'erp', 'agile', 'scrum', 'marketing', 'ventas', 'finanzas', 'rrhh', 'logística', 'operaciones', 'atención al cliente', 'gestión de proyectos'];
  const keywordsCount = keywords_list.filter(k => t.includes(k)).length;
  const keywords = Math.min(90, keywordsCount === 0 ? 15 : Math.min(25 + keywordsCount * 10, 85));

  // Estructura — secciones presentes
  const tieneTitular = /título|titular|objetivo|headline/i.test(texto) || texto.split('\n').slice(0,5).some(l => l.trim().length > 5 && l.trim().length < 80 && !l.includes('@'));
  const tienePerfilProfesional = /perfil|resumen|summary|sobre mí|acerca de/i.test(texto);
  const tieneExperiencia = /experiencia|trabajo|empleo|puesto|cargo/i.test(texto);
  const tieneEducacion = /educación|formación|universidad|instituto|licenciatura|técnico/i.test(texto);
  const tieneHabilidades = /habilidades|skills|competencias|conocimientos/i.test(texto);
  const seccionesPresentes = [tieneTitular, tienePerfilProfesional, tieneExperiencia, tieneEducacion, tieneHabilidades].filter(Boolean).length;
  const estructura = Math.min(90, Math.round(seccionesPresentes / 5 * 85));

  // Densidad de habilidades — cantidad de habilidades listadas
  const habilidadesMatch = texto.match(/·|•|\|/g) || [];
  const densidadHabilidades = Math.min(90, habilidadesMatch.length === 0 ? 10 : Math.min(20 + habilidadesMatch.length * 5, 80));

  // Claridad de roles — si cada experiencia tiene empresa, rol y fechas
  const tieneEmpresas = (texto.match(/\d{4}/g) || []).length >= 2; // al menos 2 años mencionados
  const claridadRoles = Math.min(90, tieneEmpresas ? Math.min(50 + verbosCount * 5, 80) : 25);

  return { keywords, verbosAccion, metricas, estructura, densidadHabilidades, claridadRoles };
}

function buildPrompt(cvText, liText, modo, role, sector, seniority, plan, idioma = 'es') {
  const isEnglish = idioma === 'en';
  return isEnglish
    ? buildPromptEN(cvText, liText, modo, role, sector, seniority, plan)
    : buildPromptES(cvText, liText, modo, role, sector, seniority, plan);
}

function buildPromptES(cvText, liText, modo, role, sector, seniority, plan) {
  const ctx = [
    role      && "Rol objetivo: " + role,
    sector    && "Sector: " + sector,
    seniority && "Seniority: " + seniority,
  ].filter(Boolean).join(" | ");

  let docBlock = "";
  if (cvText && cvText.length >= 30) docBlock += "=== CV A ANALIZAR ===\n" + cvText.slice(0, 4500) + "\n=== FIN CV ===\n\n";
  if (liText && liText.length >= 30) docBlock += "=== PERFIL LINKEDIN A ANALIZAR ===\n" + liText.slice(0, 4500) + "\n=== FIN LINKEDIN ===\n\n";

  let instrBlock = "";
  if (ctx) instrBlock += "Contexto: " + ctx + "\n\n";
  instrBlock += "Calcula estos scores antes de escribir el JSON (escala 0-100, NUNCA dejes en 0):\n";
  instrBlock += "- atsScore: calidad global del documento. Un CV sin titular, sin perfil profesional y sin logros NO puede superar 50.\n";
  instrBlock += "- scorePotencial: score posible si implementa las mejoras (siempre mayor que atsScore)\n";
  instrBlock += "- impactDensityScore: cuenta cuantas experiencias tienen numeros, porcentajes o resultados medibles. Si ninguna los tiene, el score es menor a 20.\n\n";
  instrBlock += "CRITICO: antes de escribir cualquier campo de diagnostico, buscá la evidencia en el texto. Si no la encontras, escribi 'No detectado en el documento'.\n\n";
  instrBlock += "ESTRUCTURA ÓPTIMA: (1) Titular específico, (2) Perfil profesional 3-4 líneas, (3) Experiencias con empresa/rol/fechas y logros cuantificados, (4) Educación con institución/título/año, (5) Habilidades, (6) Contacto completo.\n";
  instrBlock += "PENALIZACIÓN: sin titular → max 55. Sin perfil profesional → max 60. Sin logros cuantificados → max 50.\n\n";
  instrBlock += "SEGUNDA PERSONA: todo el texto en 'tu perfil', 'tus logros'. NUNCA tercera persona.\n";
  instrBlock += "IDIOMA: todo en español rioplatense.\n\n";
  instrBlock += "ROLES: mínimo 4, incluyendo roles similares y sectores compatibles.\n\n";
  instrBlock += "FORTALEZAS/OPORTUNIDADES: mínimo 4 cada una, específicas al documento.\n\n";
  instrBlock += "SIN LIDERAZGO: no recomendés liderazgo salvo que haya evidencia concreta de gestión de personas.\n\n";
  instrBlock += "Devuelve SOLO el siguiente JSON:\n\n";

  const proSchema = plan === "pro" || plan === "professional" ? (
    '  "capitalRelacional": {"score": 60, "diagnostico": "descripcion", "verbosRelacionales": [], "organizacionesVinculadas": [], "recomendaciones": []},\n' +
    '  "diagnosticoTrayectoria": {"tipo": "Consistente|En crecimiento|En transicion|Dispersa", "descripcion": "que comunica esta trayectoria hoy", "patrones": [], "oportunidades": [], "riesgos": []},\n' +
    '  "posicionamiento": {"movilidadVertical": {"posible": true, "diagnostico": "texto", "acciones": []}, "movilidadLateral": {"posible": true, "diagnostico": "texto", "acciones": []}, "transicionSector": {"posible": false, "diagnostico": "texto", "acciones": []}},\n' +
    '  "recomendacionesNarrativa": [{"tipo": "titular|perfil|experiencia|linkedin", "actual": "texto actual exacto", "sugerido": "texto reescrito listo para usar", "justificacion": "por que mejora el posicionamiento", "impacto": "Alto|Medio", "urgencia": "Inmediata|Proximo mes"}],\n' +
    '  "moduloEmpleabilidadClaveSocial": {"lectura": "4-5 oraciones concretas sobre este perfil", "dimensionEstructural": "impacto del mercado en este perfil", "dimensionRelacional": "redes y vinculos visibles", "dimensionSubjetiva": "identidad laboral que se infiere", "dimensionColectiva": "organizaciones aliadas para el desarrollo", "posicionamientoMercado": "posicion frente al mercado actual", "tensiones": []},\n' +
    '  "versionIngles": {"nota": "reescritura no traduccion", "titular": "Professional Title", "perfilProfesional": "Professional summary", "experiencias": [], "habilidades": {"tecnicas": [], "blandas": []}, "logrosDestacados": [], "sugerenciasAdaptacion": []}\n'
  ) : '';

  if (modo === "comparativa") {
    return (
      "=== CV VERSIÓN 1 ===\n" + cvText.slice(0, 4000) + "\n=== FIN VERSIÓN 1 ===\n\n" +
      "=== CV VERSIÓN 2 ===\n" + liText.slice(0, 4000) + "\n=== FIN VERSIÓN 2 ===\n\n" +
      (ctx ? "Contexto: " + ctx + "\n\n" : "") +
      "Devuelve SOLO este JSON:\n\n{\n" +
      '  "candidateName": "nombre", "atsScore": 0, "atsScoreV1": 0, "atsScoreV2": 0, "scorePotencial": 0,\n' +
      '  "mejora_global": "Alta|Media|Baja|Sin cambio",\n' +
      '  "resumenComparativo": "que mejoró, empeoró, quedó igual. 3-4 oraciones en segunda persona.",\n' +
      '  "mejoras": [{"aspecto": "aspecto", "v1": "antes", "v2": "después", "impacto": "Alto|Medio|Bajo"}],\n' +
      '  "retrocesos": [{"aspecto": "aspecto", "v1": "antes", "v2": "después", "recomendacion": "qué hacer"}],\n' +
      '  "sin_cambios": ["aspecto igual 1"],\n' +
      '  "recomendaciones_pendientes": [{"prioridad": "Alta|Media|Baja", "titulo": "titulo", "detalle": "qué falta"}],\n' +
      '  "veredicto": "vale la pena la versión 2 o necesita más trabajo?"\n' +
      "}"
    );
  }

  if (modo === "li") {
    return (
      docBlock + instrBlock +
      "{\n" +
      '  "candidateName": "nombre", "seniority": "nivel", "yearsExperience": "numero", "currentRole": "rol + empresa",\n' +
      '  "atsScore": 65, "scorePotencial": 80, "impactDensityScore": 55, "impactDensityLabel": "Alto|Medio|Bajo",\n' +
      '  "impactDensityDiagnostico": "cita 1-2 frases del documento",\n' +
      '  "resumenEjecutivo": "Nombre + titular + diagnóstico del LinkedIn como herramienta. 3-4 oraciones.",\n' +
      '  "alertas": [{"tipo": "error|warning|info", "mensaje": "texto específico"}],\n' +
      '  "fortalezas": [{"titulo": "aspecto específico del perfil", "detalle": "evidencia concreta del LinkedIn"}],\n' +
      '  "debilidades": [{"titulo": "aspecto débil o ausente", "detalle": "por qué afecta la empleabilidad", "accion": "acción concreta"}],\n' +
      '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "Titular|Extracto|Experiencias|Aptitudes|Completitud|Narrativa|Logros", "titulo": "mejora concreta del LinkedIn", "detalle": "cómo aplicarla a este perfil", "impactoScore": "+N"}],\n' +
      '  "perfilEmpleabilidad": {"visibilidad": {"score": 65, "label": "Alta|Media|Baja", "diagnostico": "1 oración"}, "coherencia": {"score": 70, "label": "Alta|Media|Baja", "diagnostico": "1 oración"}, "movilidad": {"score": 60, "label": "Alta|Media|Baja", "diagnostico": "1 oración"}},\n' +
      '  "atsDetalle": {"keywords": 60, "verbosAccion": 50, "metricas": 40, "estructura": 70, "densidadHabilidades": 55, "claridadRoles": 65},\n' +
      '  "linkedin_analysis": {"coherencia_score": 70, "coherencia_nivel": "Alta|Media|Baja", "completitud_perfil": 70,\n' +
      '    "titular_actual": "titular exacto del LinkedIn",\n' +
      '    "titular_sugerido": "propuesta mejorada: rol + valor + keywords",\n' +
      '    "extracto_diagnostico": "qué comunica, qué falta, tono y longitud",\n' +
      '    "experiencias_diagnostico": "coinciden con el CV? gaps, cargos distintos, fechas?",\n' +
      '    "aptitudes_diagnostico": "complementan las habilidades del CV? qué falta?",\n' +
      '    "completitud_diagnostico": "secciones faltantes: foto, banner, URL, recomendaciones",\n' +
      '    "narrativa_diagnostico": "hay hilo conductor entre titular, extracto y experiencias?",\n' +
      '    "coincidencias": ["alineación concreta 1", "2", "3"],\n' +
      '    "brechas": ["brecha concreta 1", "2", "3"],\n' +
      '    "recomendaciones_linkedin": ["acción concreta 1", "2", "3", "4"],\n' +
      '    "resumen_coherencia": "diagnóstico de coherencia CV↔LinkedIn. 3-4 oraciones.",\n' +
      '    "dimensiones_li": {"titular": 65, "extracto": 70, "experiencias": 60, "habilidades": 55, "completitud": 75, "narrativa": 65}\n' +
      '  }\n' +
      "}"
    );
  }

  if (modo === "cv") {
    if (plan === "starter") {
      return (
        docBlock + instrBlock +
        "{\n" +
        '  "candidateName": "nombre completo", "seniority": "nivel", "yearsExperience": "numero", "currentRole": "rol + empresa",\n' +
        '  "atsScore": 65, "scorePotencial": 80, "impactDensityScore": 55, "impactDensityLabel": "Alto|Medio|Bajo",\n' +
        '  "impactDensityDiagnostico": "cita 1-2 frases del documento",\n' +
        '  "resumenEjecutivo": "Nombre + rol + diagnóstico del CV. 3-4 oraciones.",\n' +
        '  "alertas": [{"tipo": "error|warning|info", "mensaje": "texto específico"}],\n' +
        '  "fortalezas": [{"titulo": "fortaleza específica con datos del documento", "detalle": "por qué es una fortaleza con evidencia"}],\n' +
        '  "debilidades": [{"titulo": "aspecto débil o ausente", "detalle": "por qué afecta la empleabilidad", "accion": "acción concreta"}],\n' +
        '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "Redaccion|Estructura|Logros|Keywords|Secciones|Verbos|Formato", "titulo": "mejora concreta del CV", "detalle": "cómo aplicarla en este documento — NUNCA sugerir buscar empleo", "impactoScore": "+N"}],\n' +
        '  "perfilEmpleabilidad": {"visibilidad": {"score": 65, "label": "Alta|Media|Baja", "diagnostico": "1 oración concreta"}, "coherencia": {"score": 70, "label": "Alta|Media|Baja", "diagnostico": "1 oración concreta"}, "movilidad": {"score": 60, "label": "Alta|Media|Baja", "diagnostico": "1 oración concreta"}},\n' +
        '  "atsDetalle": {"keywords": 60, "verbosAccion": 50, "metricas": 40, "estructura": 70, "densidadHabilidades": 55, "claridadRoles": 65},\n' +
        '  "analisisLogros": {\n' +
        '    "logrosFuertes": [{"frase": "frase textual del CV con número/porcentaje", "motivo": "por qué es un logro cuantitativo"}],\n' +
        '    "logrosCualitativos": [{"frase": "frase con verbo de acción y resultado concreto sin número", "motivo": "qué impacto o cambio refleja"}],\n' +
        '    "logrosDebiles": [], "responsabilidadesSinImpacto": []\n' +
        '  },\n' +
        '  "narrativaProfesional": {"tipo": "Consistente|En crecimiento|En transicion|Dispersa", "descripcion": "1 oración sobre el hilo conductor", "progresion": "", "oportunidades": []},\n' +
        '  "mapaHabilidades": {"declaradas": [], "detectadas": [], "aIncorporar": []},\n' +
        '  "linkedin_analysis": null\n' +
        "}"
      );
    }
    return (
      docBlock + instrBlock +
      "{\n" +
      '  "candidateName": "nombre completo", "seniority": "nivel", "yearsExperience": "numero", "currentRole": "rol + empresa",\n' +
      '  "atsScore": 65, "scorePotencial": 80, "impactDensityScore": 55, "impactDensityLabel": "Alto|Medio|Bajo",\n' +
      '  "impactDensityDiagnostico": "cita 1-2 frases del documento",\n' +
      '  "resumenEjecutivo": "Nombre + rol + empresa + diagnóstico específico. 3-4 oraciones.",\n' +
      '  "atsDetalle": {"keywords": 60, "verbosAccion": 50, "metricas": 40, "estructura": 70, "densidadHabilidades": 55, "claridadRoles": 65},\n' +
      '  "seccionesDetectadas": {"perfilProfesional": false, "experienciaLaboral": false, "educacion": false, "habilidades": false, "logros": false, "herramientas": false, "idiomas": false},\n' +
      '  "seccionesFaltantes": [],\n' +
      '  "alertas": [{"tipo": "error|warning|info", "mensaje": "texto específico"}],\n' +
      '  "analisisLogros": {\n' +
      '    "logrosFuertes": [{"frase": "frase textual del CV con número/porcentaje", "motivo": "por qué es un logro cuantitativo"}],\n' +
      '    "logrosCualitativos": [{"frase": "frase con verbo de acción y resultado concreto", "motivo": "qué impacto refleja"}],\n' +
      '    "logrosDebiles": [{"frase": "frase del CV", "motivo": "por qué es débil", "sugerencia": "cómo mejorarlo"}],\n' +
      '    "responsabilidadesSinImpacto": [{"frase": "frase del CV", "oportunidad": "cómo transformarla en logro"}]\n' +
      '  },\n' +
      '  "verbosImpacto": {"detectados": [], "debiles": [{"verbo": "verbo detectado", "contexto": "frase completa", "alternativas": []}]},\n' +
      '  "narrativaProfesional": {"tipo": "Consistente|En crecimiento|En transicion|Dispersa", "descripcion": "1 oración sobre el hilo conductor", "progresion": "1 oración sobre la progresión", "oportunidades": []},\n' +
      '  "mapaHabilidades": {"declaradas": [], "detectadas": [], "aIncorporar": []},\n' +
      '  "areasProfesionales": [],\n' +
      '  "rolesObjetivo": [{"titulo": "rol y roles similares/adyacentes", "matchPct": 75, "seniority": "nivel", "sector": "sector compatible", "justificacion": "por qué este rol y sector encajan con la trayectoria", "skills": ["skill que ya tiene", "skill a desarrollar"]}],\n' +
      '  "fortalezas": [{"titulo": "fortaleza específica con datos del documento", "detalle": "evidencia concreta del CV"}],\n' +
      '  "debilidades": [{"titulo": "aspecto débil o ausente", "detalle": "por qué afecta la empleabilidad", "accion": "acción concreta"}],\n' +
      '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "Redaccion|Estructura|Logros|Keywords|Secciones|Verbos|Formato", "titulo": "mejora concreta", "detalle": "cómo aplicarla en este documento específico — NUNCA sugerir buscar empleo", "impactoScore": "+N"}],\n' +
      '  "perfilEmpleabilidad": {"visibilidad": {"score": 65, "label": "Alta|Media|Baja", "diagnostico": "1 oración concreta"}, "coherencia": {"score": 70, "label": "Alta|Media|Baja", "diagnostico": "1 oración concreta"}, "movilidad": {"score": 60, "label": "Alta|Media|Baja", "diagnostico": "1 oración concreta"}},\n' +
      '  "linkedin_analysis": null\n' +
      (proSchema ? proSchema : '') +
      "}"
    );
  }

  // ambos
  return (
    docBlock + instrBlock +
    "MODO: Analiza AMBOS documentos. Los campos principales reflejan el CV. linkedin_analysis refiere al perfil LinkedIn y la comparativa.\n\n" +
    "{\n" +
    '  "candidateName": "nombre del CV", "seniority": "nivel", "yearsExperience": "numero", "currentRole": "rol + empresa",\n' +
    '  "atsScore": 65, "scorePotencial": 80, "impactDensityScore": 55, "impactDensityLabel": "Alto|Medio|Bajo",\n' +
    '  "impactDensityDiagnostico": "cita 1-2 frases del documento",\n' +
    '  "resumenEjecutivo": "Nombre + rol + empresa + diagnóstico. 3-4 oraciones.",\n' +
    '  "atsDetalle": {"keywords": 60, "verbosAccion": 50, "metricas": 40, "estructura": 70, "densidadHabilidades": 55, "claridadRoles": 65},\n' +
    '  "seccionesDetectadas": {"perfilProfesional": false, "experienciaLaboral": false, "educacion": false, "habilidades": false, "logros": false, "herramientas": false, "idiomas": false},\n' +
    '  "seccionesFaltantes": [],\n' +
    '  "alertas": [{"tipo": "error|warning|info", "mensaje": "texto específico"}],\n' +
    '  "analisisLogros": {"logrosFuertes": [], "logrosCualitativos": [], "logrosDebiles": [], "responsabilidadesSinImpacto": []},\n' +
    '  "verbosImpacto": {"detectados": [], "debiles": []},\n' +
    '  "narrativaProfesional": {"tipo": "Consistente|En crecimiento|En transicion|Dispersa", "descripcion": "1 oración", "progresion": "1 oración", "oportunidades": []},\n' +
    '  "mapaHabilidades": {"declaradas": [], "detectadas": [], "aIncorporar": []},\n' +
    '  "areasProfesionales": [],\n' +
    '  "rolesObjetivo": [{"titulo": "rol y similares/adyacentes", "matchPct": 75, "seniority": "nivel", "sector": "sector compatible", "justificacion": "por qué encaja con la trayectoria", "skills": []}],\n' +
    '  "fortalezas": [{"titulo": "fortaleza específica", "detalle": "evidencia del CV"}],\n' +
    '  "debilidades": [{"titulo": "aspecto débil", "detalle": "por qué afecta", "accion": "acción concreta"}],\n' +
    '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "Redaccion|Estructura|Logros|Keywords|Secciones|Verbos|Formato", "titulo": "mejora concreta", "detalle": "cómo aplicarla — NUNCA sugerir buscar empleo", "impactoScore": "+N"}],\n' +
    '  "perfilEmpleabilidad": {"visibilidad": {"score": 65, "label": "Alta|Media|Baja", "diagnostico": "1 oración"}, "coherencia": {"score": 70, "label": "Alta|Media|Baja", "diagnostico": "1 oración"}, "movilidad": {"score": 60, "label": "Alta|Media|Baja", "diagnostico": "1 oración"}},\n' +
    '  "linkedin_analysis": {\n' +
    '    "coherencia_score": 70, "coherencia_nivel": "Alta|Media|Baja", "completitud_perfil": 70,\n' +
    '    "titular_actual": "titular exacto del LinkedIn",\n' +
    '    "titular_sugerido": "propuesta mejorada: rol + valor + keywords",\n' +
    '    "extracto_diagnostico": "qué comunica, qué falta",\n' +
    '    "experiencias_diagnostico": "coinciden con el CV?",\n' +
    '    "aptitudes_diagnostico": "complementan el CV?",\n' +
    '    "completitud_diagnostico": "secciones faltantes",\n' +
    '    "narrativa_diagnostico": "hay hilo conductor?",\n' +
    '    "coincidencias": ["alineación 1", "2", "3"],\n' +
    '    "brechas": ["brecha 1", "2", "3"],\n' +
    '    "recomendaciones_linkedin": ["acción 1", "2", "3", "4"],\n' +
    '    "resumen_coherencia": "diagnóstico de coherencia. 3-4 oraciones.",\n' +
    '    "dimensiones_li": {"titular": 65, "extracto": 70, "experiencias": 60, "habilidades": 55, "completitud": 75, "narrativa": 65}\n' +
    '  }\n' +
    (proSchema ? proSchema : '') +
    "}"
  );
}

function buildPromptEN(cvText, liText, modo, role, sector, seniority, plan) {
  const ctx = [
    role      && "Target role: " + role,
    sector    && "Sector: " + sector,
    seniority && "Seniority: " + seniority,
  ].filter(Boolean).join(" | ");

  let docBlock = "";
  if (cvText && cvText.length >= 30) docBlock += "=== RESUME TO ANALYZE ===\n" + cvText.slice(0, 4500) + "\n=== END RESUME ===\n\n";
  if (liText && liText.length >= 30) docBlock += "=== LINKEDIN PROFILE TO ANALYZE ===\n" + liText.slice(0, 4500) + "\n=== END LINKEDIN ===\n\n";

  let instrBlock = "";
  if (ctx) instrBlock += "Context: " + ctx + "\n\n";
  instrBlock += "Calculate these scores before writing the JSON (scale 0-100, NEVER leave at 0):\n";
  instrBlock += "- atsScore: overall document quality. A resume without headline, professional summary and achievements CANNOT exceed 50.\n";
  instrBlock += "- scorePotencial: possible score if improvements are implemented (always higher than atsScore)\n";
  instrBlock += "- impactDensityScore: count how many experiences have numbers, percentages or measurable results. If none, score is below 20.\n\n";
  instrBlock += "CRITICAL: before writing any diagnostic field, look for evidence in the document. If not found, write 'Not detected in document'.\n\n";
  instrBlock += "OPTIMAL RESUME STRUCTURE: (1) Specific headline, (2) Professional summary 3-4 lines, (3) Experience with company/role/dates and quantified achievements, (4) Education with institution/degree/year, (5) Skills, (6) Complete contact info.\n";
  instrBlock += "SCORE PENALTY: no headline → max 55. No professional summary → max 60. No quantified achievements → max 50.\n\n";
  instrBlock += "SECOND PERSON: all text as 'your profile', 'your achievements'. NEVER third person.\n";
  instrBlock += "LANGUAGE: ALL text fields in English. Professional, clear language.\n\n";
  instrBlock += "TARGET ROLES: minimum 4, including similar and adjacent roles in compatible sectors.\n\n";
  instrBlock += "STRENGTHS/OPPORTUNITIES: minimum 4 each, specific to the document.\n\n";
  instrBlock += "NO LEADERSHIP: do not recommend leadership development unless there is concrete evidence of people management.\n\n";
  instrBlock += "IMPORTANT: The 'prioridad' field values MUST always be exactly 'Alta', 'Media', or 'Baja'.\n\n";
  instrBlock += "Return ONLY the following JSON:\n\n";

  const proSchema = plan === "pro" || plan === "professional" ? (
    '  "capitalRelacional": {"score": 60, "diagnostico": "how collaborative work is visible in the profile", "verbosRelacionales": [], "organizacionesVinculadas": [], "recomendaciones": []},\n' +
    '  "diagnosticoTrayectoria": {"tipo": "Consistente|En crecimiento|En transicion|Dispersa", "descripcion": "what this trajectory communicates to the market today", "patrones": [], "oportunidades": [], "riesgos": []},\n' +
    '  "posicionamiento": {"movilidadVertical": {"posible": true, "diagnostico": "text", "acciones": []}, "movilidadLateral": {"posible": true, "diagnostico": "text", "acciones": []}, "transicionSector": {"posible": false, "diagnostico": "text", "acciones": []}},\n' +
    '  "recomendacionesNarrativa": [{"tipo": "headline|profile|experience|linkedin", "actual": "current exact text", "sugerido": "rewritten text ready to use", "justificacion": "why this change improves positioning", "impacto": "Alto|Medio", "urgencia": "Inmediata|Proximo mes"}],\n' +
    '  "moduloEmpleabilidadClaveSocial": {"lectura": "4-5 concrete sentences about this specific profile", "dimensionEstructural": "market impact on this profile", "dimensionRelacional": "visible networks and connections", "dimensionSubjetiva": "work identity inferred from profile", "dimensionColectiva": "allied organizations for development", "posicionamientoMercado": "position vs current market", "tensiones": []},\n' +
    '  "versionIngles": {"nota": "rewrite not translation", "titular": "Professional Title", "perfilProfesional": "Professional summary", "experiencias": [], "habilidades": {"tecnicas": [], "blandas": []}, "logrosDestacados": [], "sugerenciasAdaptacion": []}\n'
  ) : '';

  if (modo === "comparativa") {
    return (
      "=== RESUME VERSION 1 ===\n" + cvText.slice(0, 4000) + "\n=== END VERSION 1 ===\n\n" +
      "=== RESUME VERSION 2 ===\n" + liText.slice(0, 4000) + "\n=== END VERSION 2 ===\n\n" +
      (ctx ? "Context: " + ctx + "\n\n" : "") +
      "Return ONLY this JSON:\n\n{\n" +
      '  "candidateName": "name", "atsScore": 0, "atsScoreV1": 0, "atsScoreV2": 0, "scorePotencial": 0,\n' +
      '  "mejora_global": "Alta|Media|Baja|Sin cambio",\n' +
      '  "resumenComparativo": "what improved, worsened, stayed the same. 3-4 sentences in second person.",\n' +
      '  "mejoras": [{"aspecto": "aspect", "v1": "before", "v2": "after", "impacto": "Alto|Medio|Bajo"}],\n' +
      '  "retrocesos": [{"aspecto": "aspect", "v1": "before", "v2": "after", "recomendacion": "what to do"}],\n' +
      '  "sin_cambios": ["unchanged aspect 1"],\n' +
      '  "recomendaciones_pendientes": [{"prioridad": "Alta|Media|Baja", "titulo": "title", "detalle": "what still needs improvement"}],\n' +
      '  "veredicto": "Is version 2 worth it or does it need more work?"\n' +
      "}"
    );
  }

  if (modo === "li") {
    return (
      docBlock + instrBlock +
      "{\n" +
      '  "candidateName": "name", "seniority": "level", "yearsExperience": "number", "currentRole": "role + company",\n' +
      '  "atsScore": 65, "scorePotencial": 80, "impactDensityScore": 55, "impactDensityLabel": "Alto|Medio|Bajo",\n' +
      '  "impactDensityDiagnostico": "quote 1-2 phrases justifying the score",\n' +
      '  "resumenEjecutivo": "Name + current headline + LinkedIn profile diagnosis as employability tool. 3-4 sentences.",\n' +
      '  "alertas": [{"tipo": "error|warning|info", "mensaje": "specific text about the profile"}],\n' +
      '  "fortalezas": [{"titulo": "specific aspect of the profile", "detalle": "concrete evidence from LinkedIn"}],\n' +
      '  "debilidades": [{"titulo": "specific weak or missing aspect", "detalle": "why it affects employability", "accion": "concrete action to improve"}],\n' +
      '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "Headline|Summary|Experience|Skills|Completeness|Narrative|Achievements", "titulo": "specific LinkedIn improvement", "detalle": "how to apply it to this profile", "impactoScore": "+N"}],\n' +
      '  "perfilEmpleabilidad": {"visibilidad": {"score": 65, "label": "Alta|Media|Baja", "diagnostico": "1 concrete sentence"}, "coherencia": {"score": 70, "label": "Alta|Media|Baja", "diagnostico": "1 concrete sentence"}, "movilidad": {"score": 60, "label": "Alta|Media|Baja", "diagnostico": "1 concrete sentence"}},\n' +
      '  "atsDetalle": {"keywords": 60, "verbosAccion": 50, "metricas": 40, "estructura": 70, "densidadHabilidades": 55, "claridadRoles": 65},\n' +
      '  "linkedin_analysis": {\n' +
      '    "coherencia_score": 70, "coherencia_nivel": "Alta|Media|Baja", "completitud_perfil": 70,\n' +
      '    "titular_actual": "exact LinkedIn headline text",\n' +
      '    "titular_sugerido": "improved proposal: role + value proposition + keywords",\n' +
      '    "extracto_diagnostico": "what the summary communicates, what is missing, tone and length",\n' +
      '    "experiencias_diagnostico": "do they match the resume? gaps, different titles, inconsistent dates?",\n' +
      '    "aptitudes_diagnostico": "do they complement the resume? what needs validation?",\n' +
      '    "completitud_diagnostico": "missing sections: photo, banner, custom URL, recommendations",\n' +
      '    "narrativa_diagnostico": "is there a consistent thread between headline, summary and experience?",\n' +
      '    "coincidencias": ["alignment point 1", "2", "3"],\n' +
      '    "brechas": ["gap or contradiction 1", "2", "3"],\n' +
      '    "recomendaciones_linkedin": ["concrete action 1", "2", "3", "4"],\n' +
      '    "resumen_coherencia": "coherence diagnosis. 3-4 sentences.",\n' +
      '    "dimensiones_li": {"titular": 65, "extracto": 70, "experiencias": 60, "habilidades": 55, "completitud": 75, "narrativa": 65}\n' +
      '  }\n' +
      "}"
    );
  }

  if (modo === "cv") {
    if (plan === "starter") {
      return (
        docBlock + instrBlock +
        "{\n" +
        '  "candidateName": "full name", "seniority": "level", "yearsExperience": "number", "currentRole": "role + company",\n' +
        '  "atsScore": 65, "scorePotencial": 80, "impactDensityScore": 55, "impactDensityLabel": "Alto|Medio|Bajo",\n' +
        '  "impactDensityDiagnostico": "quote 1-2 phrases from the document justifying the score",\n' +
        '  "resumenEjecutivo": "Name + current role + company + specific diagnosis. 3-4 sentences in English.",\n' +
        '  "alertas": [{"tipo": "error|warning|info", "mensaje": "specific text about the document"}],\n' +
        '  "fortalezas": [{"titulo": "specific strength with data from the document", "detalle": "why it is a strength with concrete evidence"}],\n' +
        '  "debilidades": [{"titulo": "weak or missing aspect", "detalle": "why it affects employability", "accion": "concrete action to improve"}],\n' +
        '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "Headline|Structure|Achievements|Keywords|Sections|Verbs|Format", "titulo": "specific improvement", "detalle": "how to apply it to this specific document — NEVER suggest job hunting", "impactoScore": "+N"}],\n' +
        '  "perfilEmpleabilidad": {"visibilidad": {"score": 65, "label": "Alta|Media|Baja", "diagnostico": "1 concrete sentence"}, "coherencia": {"score": 70, "label": "Alta|Media|Baja", "diagnostico": "1 concrete sentence"}, "movilidad": {"score": 60, "label": "Alta|Media|Baja", "diagnostico": "1 concrete sentence"}},\n' +
        '  "atsDetalle": {"keywords": 60, "verbosAccion": 50, "metricas": 40, "estructura": 70, "densidadHabilidades": 55, "claridadRoles": 65},\n' +
        '  "analisisLogros": {\n' +
        '    "logrosFuertes": [{"frase": "exact phrase from the resume with number/percentage", "motivo": "why it is a quantitative achievement"}],\n' +
        '    "logrosCualitativos": [{"frase": "phrase with action verb and concrete result without number", "motivo": "what impact or change it reflects"}],\n' +
        '    "logrosDebiles": [], "responsabilidadesSinImpacto": []\n' +
        '  },\n' +
        '  "narrativaProfesional": {"tipo": "Consistente|En crecimiento|En transicion|Dispersa", "descripcion": "1 sentence about the profile thread", "progresion": "", "oportunidades": []},\n' +
        '  "mapaHabilidades": {"declaradas": [], "detectadas": [], "aIncorporar": []},\n' +
        '  "linkedin_analysis": null\n' +
        "}"
      );
    }
    return (
      docBlock + instrBlock +
      "{\n" +
      '  "candidateName": "full name", "seniority": "level", "yearsExperience": "number", "currentRole": "role + company",\n' +
      '  "atsScore": 65, "scorePotencial": 80, "impactDensityScore": 55, "impactDensityLabel": "Alto|Medio|Bajo",\n' +
      '  "impactDensityDiagnostico": "quote 1-2 phrases from the document justifying the score",\n' +
      '  "resumenEjecutivo": "Name + current role + company + specific diagnosis. 3-4 sentences in English.",\n' +
      '  "atsDetalle": {"keywords": 60, "verbosAccion": 50, "metricas": 40, "estructura": 70, "densidadHabilidades": 55, "claridadRoles": 65},\n' +
      '  "seccionesDetectadas": {"perfilProfesional": false, "experienciaLaboral": false, "educacion": false, "habilidades": false, "logros": false, "herramientas": false, "idiomas": false},\n' +
      '  "seccionesFaltantes": [],\n' +
      '  "alertas": [{"tipo": "error|warning|info", "mensaje": "specific text about the document"}],\n' +
      '  "analisisLogros": {\n' +
      '    "logrosFuertes": [{"frase": "exact phrase from resume with number/percentage", "motivo": "why it is a quantitative achievement"}],\n' +
      '    "logrosCualitativos": [{"frase": "phrase with action verb and concrete result without number", "motivo": "what impact it reflects"}],\n' +
      '    "logrosDebiles": [{"frase": "phrase from resume", "motivo": "why it is weak", "sugerencia": "how to improve it"}],\n' +
      '    "responsabilidadesSinImpacto": [{"frase": "phrase from resume", "oportunidad": "how to turn it into an achievement"}]\n' +
      '  },\n' +
      '  "verbosImpacto": {"detectados": [], "debiles": [{"verbo": "detected verb", "contexto": "full phrase", "alternativas": []}]},\n' +
      '  "narrativaProfesional": {"tipo": "Consistente|En crecimiento|En transicion|Dispersa", "descripcion": "1 sentence about the profile thread", "progresion": "1 sentence about progression", "oportunidades": []},\n' +
      '  "mapaHabilidades": {"declaradas": [], "detectadas": [], "aIncorporar": []},\n' +
      '  "areasProfesionales": [],\n' +
      '  "rolesObjetivo": [{"titulo": "exact role and similar/adjacent roles", "matchPct": 75, "seniority": "level", "sector": "compatible sector", "justificacion": "why this role and sector fit the trajectory", "skills": ["existing skill", "skill to develop"]}],\n' +
      '  "fortalezas": [{"titulo": "specific strength with data from the document", "detalle": "concrete evidence from the resume"}],\n' +
      '  "debilidades": [{"titulo": "weak or missing aspect", "detalle": "why it affects employability", "accion": "concrete action to improve"}],\n' +
      '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "Headline|Structure|Achievements|Keywords|Sections|Verbs|Format", "titulo": "specific improvement", "detalle": "how to apply it to this specific document — NEVER suggest job hunting", "impactoScore": "+N"}],\n' +
      '  "perfilEmpleabilidad": {"visibilidad": {"score": 65, "label": "Alta|Media|Baja", "diagnostico": "1 concrete sentence"}, "coherencia": {"score": 70, "label": "Alta|Media|Baja", "diagnostico": "1 concrete sentence"}, "movilidad": {"score": 60, "label": "Alta|Media|Baja", "diagnostico": "1 concrete sentence"}},\n' +
      '  "linkedin_analysis": null\n' +
      (proSchema ? proSchema : '') +
      "}"
    );
  }

  // ambos
  return (
    docBlock + instrBlock +
    "MODE: Analyze BOTH documents. Main fields reflect the resume. linkedin_analysis refers to the LinkedIn profile and comparison.\n\n" +
    "{\n" +
    '  "candidateName": "name", "seniority": "level", "yearsExperience": "number", "currentRole": "role + company",\n' +
    '  "atsScore": 65, "scorePotencial": 80, "impactDensityScore": 55, "impactDensityLabel": "Alto|Medio|Bajo",\n' +
    '  "impactDensityDiagnostico": "quote 1-2 phrases from the document justifying the score",\n' +
    '  "resumenEjecutivo": "Name + current role + company + specific diagnosis. 3-4 sentences in English.",\n' +
    '  "atsDetalle": {"keywords": 60, "verbosAccion": 50, "metricas": 40, "estructura": 70, "densidadHabilidades": 55, "claridadRoles": 65},\n' +
    '  "seccionesDetectadas": {"perfilProfesional": false, "experienciaLaboral": false, "educacion": false, "habilidades": false, "logros": false, "herramientas": false, "idiomas": false},\n' +
    '  "seccionesFaltantes": [],\n' +
    '  "alertas": [{"tipo": "error|warning|info", "mensaje": "specific text"}],\n' +
    '  "analisisLogros": {"logrosFuertes": [], "logrosCualitativos": [], "logrosDebiles": [], "responsabilidadesSinImpacto": []},\n' +
    '  "verbosImpacto": {"detectados": [], "debiles": []},\n' +
    '  "narrativaProfesional": {"tipo": "Consistente|En crecimiento|En transicion|Dispersa", "descripcion": "1 sentence", "progresion": "1 sentence", "oportunidades": []},\n' +
    '  "mapaHabilidades": {"declaradas": [], "detectadas": [], "aIncorporar": []},\n' +
    '  "areasProfesionales": [],\n' +
    '  "rolesObjetivo": [{"titulo": "role and similar/adjacent roles", "matchPct": 75, "seniority": "level", "sector": "compatible sector", "justificacion": "why it fits the trajectory", "skills": []}],\n' +
    '  "fortalezas": [{"titulo": "specific strength", "detalle": "evidence from the resume"}],\n' +
    '  "debilidades": [{"titulo": "weak aspect", "detalle": "why it affects employability", "accion": "concrete action"}],\n' +
    '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "Headline|Structure|Achievements|Keywords|Sections|Verbs|Format", "titulo": "specific improvement", "detalle": "how to apply it — NEVER suggest job hunting", "impactoScore": "+N"}],\n' +
    '  "perfilEmpleabilidad": {"visibilidad": {"score": 65, "label": "Alta|Media|Baja", "diagnostico": "1 sentence"}, "coherencia": {"score": 70, "label": "Alta|Media|Baja", "diagnostico": "1 sentence"}, "movilidad": {"score": 60, "label": "Alta|Media|Baja", "diagnostico": "1 sentence"}},\n' +
    '  "linkedin_analysis": {\n' +
    '    "coherencia_score": 70, "coherencia_nivel": "Alta|Media|Baja", "completitud_perfil": 70,\n' +
    '    "titular_actual": "exact LinkedIn headline",\n' +
    '    "titular_sugerido": "improved: role + value + keywords",\n' +
    '    "extracto_diagnostico": "what communicates, what is missing",\n' +
    '    "experiencias_diagnostico": "match with resume?",\n' +
    '    "aptitudes_diagnostico": "complement the resume?",\n' +
    '    "completitud_diagnostico": "missing sections",\n' +
    '    "narrativa_diagnostico": "consistent thread?",\n' +
    '    "coincidencias": ["alignment 1", "2", "3"],\n' +
    '    "brechas": ["gap 1", "2", "3"],\n' +
    '    "recomendaciones_linkedin": ["action 1", "2", "3", "4"],\n' +
    '    "resumen_coherencia": "coherence diagnosis. 3-4 sentences.",\n' +
    '    "dimensiones_li": {"titular": 65, "extracto": 70, "experiencias": 60, "habilidades": 55, "completitud": 75, "narrativa": 65}\n' +
    '  }\n' +
    (proSchema ? proSchema : '') +
    "}"
  );
}


// ─── SUPABASE ─────────────────────────────────────────────────────────────────

async function verificarTokenPago(env, token) {
  try {
    const res = await fetch(
      env.SUPABASE_URL + "/rest/v1/tokens_diagnostico?token=eq." + encodeURIComponent(token) + "&usado=eq.false&select=token,email",
      {
        headers: {
          "apikey": env.SUPABASE_KEY,
          "Authorization": "Bearer " + env.SUPABASE_KEY,
        }
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.[0]) return null;

    // Marcar token como usado
    await fetch(
      env.SUPABASE_URL + "/rest/v1/tokens_diagnostico?token=eq." + encodeURIComponent(token),
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": env.SUPABASE_KEY,
          "Authorization": "Bearer " + env.SUPABASE_KEY,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({ usado: true }),
      }
    );

    return "diagnostico";
  } catch {
    return null;
  }
}

async function registrarEmail(env, email, plan) {
  try {
    // Upsert — si ya existe el email, no lo duplica
    await fetch(env.SUPABASE_URL + "/rest/v1/usuarios", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": env.SUPABASE_KEY,
        "Authorization": "Bearer " + env.SUPABASE_KEY,
        "Prefer": "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({ email, plan: plan === "starter" ? "starter" : plan }),
    });
  } catch { /* silencioso */ }
}

async function resolveUserPlan(env, token) {
  try {
    // token es el email del usuario
    const res = await fetch(
      env.SUPABASE_URL + "/rest/v1/usuarios?email=eq." + encodeURIComponent(token) + "&select=plan",
      {
        headers: {
          "apikey": env.SUPABASE_KEY,
          "Authorization": "Bearer " + env.SUPABASE_KEY,
        }
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.[0]?.plan || null;
  } catch {
    return null;
  }
}

async function saveToSupabase(env, userId, cvText, liText, result, plan) {
  await fetch(env.SUPABASE_URL + "/rest/v1/diagnosticos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": env.SUPABASE_KEY,
      "Authorization": "Bearer " + env.SUPABASE_KEY,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      user_id:       userId,
      cv_text:       cvText ? cvText.slice(0, 8000) : null,
      linkedin_text: liText ? liText.slice(0, 4000) : null,
      resultado:     result,
      score:         result.atsScore,
      plan:          plan,
      created_at:    new Date().toISOString(),
    }),
  });
}
