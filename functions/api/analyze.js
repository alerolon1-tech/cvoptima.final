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

    const authHeader = request.headers.get("Authorization") || "";
    if (authHeader.startsWith("Bearer ") && env.SUPABASE_URL && env.SUPABASE_KEY) {
      const token = authHeader.slice(7);
      const userPlan = await resolveUserPlan(env, token);
      if (userPlan) plan = userPlan;
    }

    if (modo !== "li" && cvText.length < 30) {
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

    const systemPrompt =
      "Sos un experto senior en empleabilidad. Tu unica funcion es analizar el documento que el usuario te proporciona y devolver un JSON valido en espanol rioplatense.\n" +
      "REGLAS ABSOLUTAS:\n" +
      "1. Usa el nombre real de la persona tal como figura en el documento. NUNCA escribas 'No especificado'.\n" +
      "2. Cada campo debe mencionar datos concretos del documento: empresa, rol, herramienta, fecha o logro especifico.\n" +
      "3. NUNCA inventes datos que no figuren en el documento. Si algo no existe escribe 'No detectado en el documento'.\n" +
      "4. ANTES de generar brechas o recomendaciones, identifica mentalmente el rol, sector y habilidades principales del documento. Una brecha o recomendacion NUNCA puede referirse a algo que ya figura como presente en el documento. Por ejemplo: si la persona trabaja en impuestos, no recomiendes 'mejorar conocimientos en impuestos'. Si tiene habilidades de comunicacion declaradas, no recomiendes 'mejorar comunicacion'.\n" +
      "5. Si el documento esta en ingles, analizalo en ingles internamente pero escribe todo el JSON en espanol rioplatense.\n" +
      "6. Genera MINIMO 3 recomendaciones de prioridad Alta y 2 de prioridad Media. Cada recomendacion debe referirse a algo que FALTA o que podria MEJORARSE, nunca a algo que ya esta presente.\n" +
      "7. Todos los scores son numeros enteros entre 0 y 100. NUNCA uses escala 0-10.\n" +
      "8. NUNCA dejes atsScore, scorePotencial o impactDensityScore en 0.\n" +
      "9. Responde SOLO con el JSON. Sin texto extra, sin markdown, sin bloques de codigo.";

    const userPrompt = buildPrompt(cvText, liText, modo, role, sector, seniority, plan);

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
      // Limpiar bloques markdown si el modelo los incluye
      let clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/,'').trim();

      // Si el JSON está truncado, intentar cerrarlo
      const m = clean.match(/\{[\s\S]*/);
      if (m) {
        let jsonStr = m[0];
        // Contar llaves para detectar truncamiento
        let open = 0;
        for (const c of jsonStr) { if(c==='{') open++; else if(c==='}') open--; }
        if (open > 0) jsonStr += '}'.repeat(open); // cerrar llaves faltantes
        result = JSON.parse(jsonStr);
      } else {
        result = JSON.parse(clean);
      }
    } catch (e) {
      throw new Error("No se pudo parsear la respuesta del modelo: " + raw.slice(0, 300));
    }

    result.has_linkedin = liText.length > 30;
    result._modelUsed = groqData._modelUsed || 'unknown';
    if (!result.linkedin_analysis) result.linkedin_analysis = null;

    // Normalizar scores: si el modelo los devuelve en escala 0-10, convertir a 0-100
    const norm = (v) => (typeof v === "number" && v > 0 && v <= 10) ? Math.round(v * 10) : (v || 0);
    result.atsScore           = norm(result.atsScore);
    result.scorePotencial     = norm(result.scorePotencial);
    result.impactDensityScore = norm(result.impactDensityScore);

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
  if (plan === "professional" || plan === "pro") {
    return { ...data, _plan: plan };
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

function buildPrompt(cvText, liText, modo, role, sector, seniority, plan) {
  const ctx = [
    role      && "Rol objetivo: " + role,
    sector    && "Sector: " + sector,
    seniority && "Seniority: " + seniority,
  ].filter(Boolean).join(" | ");

  let docBlock = "";
  if (cvText && cvText.length >= 30) {
    docBlock += "=== CV A ANALIZAR ===\n" + cvText.slice(0, 4500) + "\n=== FIN CV ===\n\n";
  }
  if (liText && liText.length >= 30) {
    docBlock += "=== PERFIL LINKEDIN A ANALIZAR ===\n" + liText.slice(0, 4500) + "\n=== FIN LINKEDIN ===\n\n";
  }

  let instrBlock = "";
  if (ctx) instrBlock += "Contexto: " + ctx + "\n\n";

  instrBlock += "Calcula estos scores antes de escribir el JSON (escala 0-100, NUNCA dejes en 0):\n";
  instrBlock += "- atsScore: calidad global del documento principal como herramienta de empleabilidad\n";
  instrBlock += "- scorePotencial: score posible si implementa las mejoras (siempre mayor que atsScore)\n";
  instrBlock += "- impactDensityScore: cuenta cuantas experiencias tienen numeros, porcentajes o resultados medibles. Si ninguna los tiene, el score es menor a 20.\n\n";
  instrBlock += "CRITICO: antes de escribir cualquier campo de diagnostico, buscá la evidencia en el texto del documento. Si no la encontras, escribi 'No detectado en el documento' en lugar de inventar.\n\n";
  instrBlock += "Devuelve SOLO el siguiente JSON con datos reales del documento:\n\n";

  // ── MODO: Solo LinkedIn ────────────────────────────────────────────────────
  if (modo === "li") {
    return (
      docBlock + instrBlock +
      "MODO: Analiza EXCLUSIVAMENTE el perfil de LinkedIn. Evalua cada seccion especifica de LinkedIn.\n" +
      "PASO 1 (mental, no lo escribas): identifica el nombre, rol actual, sector, empresas y habilidades declaradas.\n" +
      "PASO 2: genera el JSON usando SOLO lo que encontraste en el PASO 1. Las brechas y recomendaciones deben referirse a lo que FALTA, nunca a lo que ya esta presente.\n\n" +
      "{\n" +
      '  "candidateName": "nombre del perfil",\n' +
      '  "seniority": "Junior|Semi-Senior|Senior|Lead|Executive",\n' +
      '  "yearsExperience": "numero",\n' +
      '  "currentRole": "titular actual + empresa si figura",\n' +
      '  "atsScore": 65,\n' +
      '  "scorePotencial": 80,\n' +
      '  "impactDensityScore": 55,\n' +
      '  "impactDensityLabel": "Alto|Medio|Bajo",\n' +
      '  "impactDensityDiagnostico": "cita textualmente 1-2 frases del documento que justifiquen el score. Si no hay logros cuantificados escribe: Sin logros cuantificados detectados",\n' +
      '  "resumenEjecutivo": "Nombre + titular actual + diagnostico especifico del perfil LinkedIn como herramienta de empleabilidad. 3-4 oraciones.",\n' +
      '  "alertas": [{"tipo": "error|warning|info", "mensaje": "texto especifico al perfil"}],\n' +
      '  "fortalezas": [{"titulo": "titulo concreto", "detalle": "evidencia especifica del perfil LinkedIn"}],\n' +
      '  "debilidades": [{"titulo": "titulo concreto", "detalle": "que falta en el perfil LinkedIn", "accion": "accion concreta"}],\n' +
      '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "categoria", "titulo": "titulo", "detalle": "accion especifica para mejorar el perfil LinkedIn", "impactoScore": "+N puntos"}],\n' +
      '  "perfilEmpleabilidad": {\n' +
      '    "visibilidad": {"score": 65, "label": "Alta|Media|Baja", "diagnostico": "1 oracion sobre visibilidad del perfil LinkedIn"},\n' +
      '    "coherencia":  {"score": 70, "label": "Alta|Media|Baja", "diagnostico": "1 oracion sobre coherencia narrativa entre secciones"},\n' +
      '    "movilidad":   {"score": 60, "label": "Alta|Media|Baja", "diagnostico": "1 oracion sobre si el perfil habilita transiciones"}\n' +
      '  },\n' +
      '  "atsDetalle": {\n' +
      '    "keywords": 60,\n' +
      '    "verbosAccion": 50,\n' +
      '    "metricas": 40,\n' +
      '    "estructura": 70,\n' +
      '    "densidadHabilidades": 55,\n' +
      '    "claridadRoles": 65\n' +
      '  },\n' +
      '  "linkedin_analysis": {\n' +
      '    "coherencia_score": 70,\n' +
      '    "coherencia_nivel": "Alta|Media|Baja",\n' +
      '    "completitud_perfil": 70,\n' +
      '    "titular_actual": "texto exacto del titular/headline del perfil",\n' +
      '    "titular_sugerido": "propuesta mejorada: rol especifico + propuesta de valor + keywords del sector",\n' +
      '    "extracto_diagnostico": "que comunica el extracto/about, que falta, tono, longitud, llamado a la accion",\n' +
      '    "experiencias_diagnostico": "evaluacion de las experiencias: tienen descripcion, verbos de accion, logros cuantificados",\n' +
      '    "aptitudes_diagnostico": "evaluacion de aptitudes/skills: relevancia, validaciones, gaps detectados",\n' +
      '    "completitud_diagnostico": "que secciones faltan o estan incompletas: foto, banner, URL, recomendaciones, certificaciones",\n' +
      '    "narrativa_diagnostico": "coherencia entre titular, extracto y experiencias: hay hilo conductor?",\n' +
      '    "coincidencias": ["fortaleza concreta 1", "fortaleza concreta 2", "fortaleza concreta 3"],\n' +
      '    "brechas": ["oportunidad de mejora 1", "oportunidad de mejora 2", "oportunidad de mejora 3"],\n' +
      '    "recomendaciones_linkedin": ["accion concreta 1", "accion concreta 2", "accion concreta 3", "accion concreta 4"],\n' +
      '    "resumen_coherencia": "diagnostico global del perfil como herramienta de empleabilidad digital. 3-4 oraciones.",\n' +
      '    "dimensiones_li": {\n' +
      '      "titular": 65,\n' +
      '      "extracto": 70,\n' +
      '      "experiencias": 60,\n' +
      '      "habilidades": 55,\n' +
      '      "completitud": 75,\n' +
      '      "narrativa": 65\n' +
      '    }\n' +
      '  }\n' +
      "}"
    );
  }

  // ── MODO: Solo CV (Starter o Diagnóstico) ─────────────────────────────────
  if (modo === "cv") {
    if (plan === "starter") {
      return (
        docBlock + instrBlock +
        "{\n" +
        '  "candidateName": "nombre completo del CV",\n' +
        '  "seniority": "Junior|Semi-Senior|Senior|Lead|Executive",\n' +
        '  "yearsExperience": "numero",\n' +
        '  "currentRole": "rol + empresa del CV",\n' +
        '  "atsScore": 65,\n' +
        '  "scorePotencial": 80,\n' +
        '  "impactDensityScore": 55,\n' +
        '  "impactDensityLabel": "Alto|Medio|Bajo",\n' +
        '  "impactDensityDiagnostico": "cita textualmente 1-2 frases del documento que justifiquen el score. Si no hay logros cuantificados escribe: Sin logros cuantificados detectados",\n' +
        '  "resumenEjecutivo": "Nombre + rol actual + empresa + diagnostico especifico del perfil. 3-4 oraciones.",\n' +
        '  "alertas": [{"tipo": "error|warning|info", "mensaje": "texto especifico al documento"}],\n' +
        '  "fortalezas": [{"titulo": "titulo concreto", "detalle": "evidencia del documento"}],\n' +
        '  "debilidades": [{"titulo": "titulo concreto", "detalle": "referencia al documento", "accion": "accion concreta"}],\n' +
        '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "categoria", "titulo": "titulo", "detalle": "accion especifica para este perfil", "impactoScore": "+N puntos"}],\n' +
        '  "perfilEmpleabilidad": {\n' +
        '    "visibilidad": {"score": 65, "label": "Alta|Media|Baja", "diagnostico": "1 oracion concreta"},\n' +
        '    "coherencia":  {"score": 70, "label": "Alta|Media|Baja", "diagnostico": "1 oracion concreta"},\n' +
        '    "movilidad":   {"score": 60, "label": "Alta|Media|Baja", "diagnostico": "1 oracion concreta"}\n' +
        '  },\n' +
        '  "atsDetalle": {"keywords": 60, "verbosAccion": 50, "metricas": 40, "estructura": 70, "densidadHabilidades": 55, "claridadRoles": 65},\n' +
        '  "linkedin_analysis": null\n' +
        "}"
      );
    }
    // Diagnóstico / Pro / Professional — CV completo
    return (
      docBlock + instrBlock +
      "{\n" +
      '  "candidateName": "nombre completo del CV",\n' +
      '  "seniority": "Junior|Semi-Senior|Senior|Lead|Executive",\n' +
      '  "yearsExperience": "numero",\n' +
      '  "currentRole": "rol + empresa del CV",\n' +
      '  "atsScore": 65,\n' +
      '  "scorePotencial": 80,\n' +
      '  "impactDensityScore": 55,\n' +
      '  "impactDensityLabel": "Alto|Medio|Bajo",\n' +
      '  "impactDensityDiagnostico": "cita textualmente 1-2 frases del documento que justifiquen el score. Si no hay logros cuantificados escribe: Sin logros cuantificados detectados",\n' +
      '  "resumenEjecutivo": "Nombre + rol actual + empresa + diagnostico especifico. 3-4 oraciones.",\n' +
      '  "atsDetalle": {"keywords": 60, "verbosAccion": 50, "metricas": 40, "estructura": 70, "densidadHabilidades": 55, "claridadRoles": 65},\n' +
      '  "seccionesDetectadas": {"perfilProfesional": false, "experienciaLaboral": false, "educacion": false, "habilidades": false, "logros": false, "herramientas": false, "idiomas": false},\n' +
      '  "seccionesFaltantes": [],\n' +
      '  "alertas": [{"tipo": "error|warning|info", "mensaje": "texto especifico"}],\n' +
      '  "analisisLogros": {\n' +
      '    "logrosFuertes": [{"frase": "frase exacta del CV", "motivo": "por que es fuerte"}],\n' +
      '    "logrosDebiles": [{"frase": "frase del CV", "motivo": "por que es debil", "sugerencia": "como mejorarlo"}],\n' +
      '    "responsabilidadesSinImpacto": [{"frase": "frase del CV", "oportunidad": "como convertirlo en logro"}]\n' +
      '  },\n' +
      '  "verbosImpacto": {"detectados": [], "debiles": [{"verbo": "verbo", "contexto": "frase", "alternativas": []}]},\n' +
      '  "narrativaProfesional": {"tipo": "Consistente|En crecimiento|En transicion|Dispersa", "descripcion": "texto", "progresion": "texto", "oportunidades": []},\n' +
      '  "mapaHabilidades": {"declaradas": [], "detectadas": [], "aIncorporar": []},\n' +
      '  "areasProfesionales": [],\n' +
      '  "rolesObjetivo": [{"titulo": "rol", "matchPct": 75, "seniority": "nivel", "justificacion": "texto", "skills": []}],\n' +
      '  "fortalezas": [{"titulo": "titulo concreto", "detalle": "evidencia del CV"}],\n' +
      '  "debilidades": [{"titulo": "titulo concreto", "detalle": "referencia al CV", "accion": "accion concreta"}],\n' +
      '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "categoria", "titulo": "titulo", "detalle": "accion especifica", "impactoScore": "+N puntos"}],\n' +
      '  "perfilEmpleabilidad": {\n' +
      '    "visibilidad": {"score": 65, "label": "Alta|Media|Baja", "diagnostico": "1 oracion concreta"},\n' +
      '    "coherencia":  {"score": 70, "label": "Alta|Media|Baja", "diagnostico": "1 oracion concreta"},\n' +
      '    "movilidad":   {"score": 60, "label": "Alta|Media|Baja", "diagnostico": "1 oracion concreta"}\n' +
      '  },\n' +
      '  "linkedin_analysis": null\n' +
      "}"
    );
  }

  // ── MODO: CV + LinkedIn — análisis combinado con comparativa ──────────────
  return (
    docBlock + instrBlock +
    "MODO: Analiza AMBOS documentos. Los campos principales reflejan el CV. linkedin_analysis refiere EXCLUSIVAMENTE al perfil LinkedIn y la comparativa entre ambos.\n\n" +
    "En linkedin_analysis, la comparativa debe responder:\n" +
    "1. El titular de LinkedIn refleja el rol y sector del CV?\n" +
    "2. Las experiencias en LinkedIn coinciden con las del CV en cargo, empresa y fechas?\n" +
    "3. El extracto/about conecta con la narrativa profesional del CV?\n" +
    "4. Las aptitudes de LinkedIn complementan las habilidades del CV?\n" +
    "5. Hay brechas o contradicciones entre ambos documentos?\n\n" +
    "{\n" +
    '  "candidateName": "nombre del CV",\n' +
    '  "seniority": "Junior|Semi-Senior|Senior|Lead|Executive",\n' +
    '  "yearsExperience": "numero",\n' +
    '  "currentRole": "rol + empresa del CV",\n' +
    '  "atsScore": 65,\n' +
    '  "scorePotencial": 80,\n' +
    '  "impactDensityScore": 55,\n' +
    '  "impactDensityLabel": "Alto|Medio|Bajo",\n' +
    '  "impactDensityDiagnostico": "cita textualmente 1-2 frases del documento que justifiquen el score. Si no hay logros cuantificados escribe: Sin logros cuantificados detectados",\n' +
    '  "resumenEjecutivo": "Nombre + rol actual + diagnostico del CV. 3-4 oraciones.",\n' +
    '  "atsDetalle": {"keywords": 60, "verbosAccion": 50, "metricas": 40, "estructura": 70, "densidadHabilidades": 55, "claridadRoles": 65},\n' +
    '  "seccionesDetectadas": {"perfilProfesional": false, "experienciaLaboral": false, "educacion": false, "habilidades": false, "logros": false, "herramientas": false, "idiomas": false},\n' +
    '  "seccionesFaltantes": [],\n' +
    '  "alertas": [{"tipo": "error|warning|info", "mensaje": "texto especifico"}],\n' +
    '  "analisisLogros": {\n' +
    '    "logrosFuertes": [{"frase": "frase exacta del CV", "motivo": "por que es fuerte"}],\n' +
    '    "logrosDebiles": [{"frase": "frase del CV", "motivo": "debil", "sugerencia": "mejora"}],\n' +
    '    "responsabilidadesSinImpacto": [{"frase": "frase del CV", "oportunidad": "como mejorar"}]\n' +
    '  },\n' +
    '  "verbosImpacto": {"detectados": [], "debiles": [{"verbo": "verbo", "contexto": "frase", "alternativas": []}]},\n' +
    '  "narrativaProfesional": {"tipo": "Consistente|En crecimiento|En transicion|Dispersa", "descripcion": "texto", "progresion": "texto", "oportunidades": []},\n' +
    '  "mapaHabilidades": {"declaradas": [], "detectadas": [], "aIncorporar": []},\n' +
    '  "areasProfesionales": [],\n' +
    '  "rolesObjetivo": [{"titulo": "rol", "matchPct": 75, "seniority": "nivel", "justificacion": "texto", "skills": []}],\n' +
    '  "fortalezas": [{"titulo": "titulo concreto", "detalle": "evidencia del CV"}],\n' +
    '  "debilidades": [{"titulo": "titulo concreto", "detalle": "referencia al CV", "accion": "accion concreta"}],\n' +
    '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "categoria", "titulo": "titulo", "detalle": "accion especifica", "impactoScore": "+N puntos"}],\n' +
    '  "perfilEmpleabilidad": {\n' +
    '    "visibilidad": {"score": 65, "label": "Alta|Media|Baja", "diagnostico": "1 oracion sobre el CV"},\n' +
    '    "coherencia":  {"score": 70, "label": "Alta|Media|Baja", "diagnostico": "1 oracion sobre el CV"},\n' +
    '    "movilidad":   {"score": 60, "label": "Alta|Media|Baja", "diagnostico": "1 oracion sobre el CV"}\n' +
    '  },\n' +
    '  "linkedin_analysis": {\n' +
    '    "coherencia_score": 70,\n' +
    '    "coherencia_nivel": "Alta|Media|Baja",\n' +
    '    "completitud_perfil": 70,\n' +
    '    "titular_actual": "texto exacto del titular de LinkedIn",\n' +
    '    "titular_sugerido": "propuesta mejorada alineada con el CV: rol + propuesta de valor + keywords",\n' +
    '    "extracto_diagnostico": "el extracto refleja la narrativa del CV? que falta? tono, longitud, llamado a la accion",\n' +
    '    "experiencias_diagnostico": "las experiencias en LinkedIn coinciden con el CV? hay gaps, cargos distintos o fechas inconsistentes?",\n' +
    '    "aptitudes_diagnostico": "las aptitudes de LinkedIn complementan las habilidades del CV? que falta validar?",\n' +
    '    "completitud_diagnostico": "que secciones faltan: foto, banner, URL personalizada, recomendaciones de terceros, certificaciones",\n' +
    '    "narrativa_diagnostico": "el titular, extracto y experiencias de LinkedIn cuentan la misma historia que el CV?",\n' +
    '    "coincidencias": ["punto de alineacion real entre CV y LinkedIn 1", "punto 2", "punto 3"],\n' +
    '    "brechas": ["contradiccion o brecha real entre CV y LinkedIn 1", "brecha 2", "brecha 3"],\n' +
    '    "recomendaciones_linkedin": ["accion concreta para alinear LinkedIn con el CV 1", "accion 2", "accion 3", "accion 4"],\n' +
    '    "resumen_coherencia": "diagnostico de coherencia entre CV y LinkedIn: que coincide, que contradice, que impacto tiene en la empleabilidad. 3-4 oraciones.",\n' +
    '    "dimensiones_li": {\n' +
    '      "titular": 65,\n' +
    '      "extracto": 70,\n' +
    '      "experiencias": 60,\n' +
    '      "habilidades": 55,\n' +
    '      "completitud": 75,\n' +
    '      "narrativa": 65\n' +
    '    }\n' +
    '  }\n' +
    "}"
  );
}

// ─── SUPABASE ─────────────────────────────────────────────────────────────────

async function resolveUserPlan(env, token) {
  try {
    const authRes = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
      headers: { "apikey": env.SUPABASE_KEY, "Authorization": "Bearer " + token },
    });
    if (!authRes.ok) return null;
    const authData = await authRes.json();
    if (!authData.id) return null;

    const planRes = await fetch(
      env.SUPABASE_URL + "/rest/v1/usuarios?id=eq." + authData.id + "&select=plan",
      { headers: { "apikey": env.SUPABASE_KEY, "Authorization": "Bearer " + env.SUPABASE_KEY } }
    );
    if (!planRes.ok) return null;
    const planData = await planRes.json();
    return planData?.[0]?.plan || "starter";
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
