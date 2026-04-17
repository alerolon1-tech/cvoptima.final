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
      "1. Usa el nombre real de la persona tal como figura en el documento. Si no esta claro, inferilo del encabezado o firma. NUNCA escribas 'No especificado'.\n" +
      "2. Cada campo de analisis debe mencionar datos concretos del documento: empresa, rol, herramienta, fecha, logro o habilidad especifica.\n" +
      "3. NUNCA uses frases genericas sin especificar empresa, rol o resultado concreto del documento analizado.\n" +
      "4. En recomendaciones genera MINIMO 3 de prioridad Alta y 2 de prioridad Media, cada una con detalle especifico al perfil.\n" +
      "5. Responde SOLO con el JSON. Sin texto extra, sin markdown, sin bloques de codigo.";

    const userPrompt = buildPrompt(cvText, liText, modo, role, sector, seniority);

    const MODELS = [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "llama3-70b-8192",
      "llama3-8b-8192",
    ];

    let groqData = null;
    let lastError = null;

    for (const model of MODELS) {
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
          max_tokens: 4000,
        }),
      });

      if (groqRes.ok) {
        groqData = await groqRes.json();
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
      const m = raw.match(/\{[\s\S]*\}/);
      result = JSON.parse(m ? m[0] : raw);
    } catch (e) {
      throw new Error("No se pudo parsear la respuesta del modelo: " + raw.slice(0, 300));
    }

    result.has_linkedin = liText.length > 30;
    if (!result.linkedin_analysis) result.linkedin_analysis = null;

    // Normalizar scores: si el modelo los devuelve en escala 0-10, convertir a 0-100
    const normalizeScore = (v) => (typeof v === 'number' && v <= 10 && v > 0) ? Math.round(v * 10) : (v || 0);
    result.atsScore           = normalizeScore(result.atsScore);
    result.scorePotencial     = normalizeScore(result.scorePotencial);
    result.impactDensityScore = normalizeScore(result.impactDensityScore);

    // Fallback: si los scores principales siguen en 0, estimarlos desde perfilEmpleabilidad
    if (result.atsScore === 0 && result.perfilEmpleabilidad) {
      const pe = result.perfilEmpleabilidad;
      const vis = pe.visibilidad?.score || 0;
      const coh = pe.coherencia?.score  || 0;
      const mov = pe.movilidad?.score   || 0;
      result.atsScore       = Math.round((vis + coh + mov) / 3);
      result.scorePotencial = Math.min(100, result.atsScore + 15);
    }
    if (result.impactDensityScore === 0) {
      result.impactDensityScore = result.atsScore ? Math.round(result.atsScore * 0.85) : 50;
    }
    if (result.atsDetalle) {
      for (const k of Object.keys(result.atsDetalle)) {
        if (typeof result.atsDetalle[k] === 'number') result.atsDetalle[k] = normalizeScore(result.atsDetalle[k]);
      }
    }
    if (result.perfilEmpleabilidad) {
      for (const k of ['visibilidad','coherencia','movilidad']) {
        if (result.perfilEmpleabilidad[k]) result.perfilEmpleabilidad[k].score = normalizeScore(result.perfilEmpleabilidad[k].score);
      }
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

function buildPrompt(cvText, liText, modo, role, sector, seniority) {
  const ctx = [
    role      && "Rol objetivo: " + role,
    sector    && "Sector: " + sector,
    seniority && "Seniority: " + seniority,
  ].filter(Boolean).join(" | ");

  // El documento va PRIMERO para que el modelo lo procese con maxima atencion
  let docBlock = "";

  if (cvText && cvText.length >= 30) {
    docBlock += "=== DOCUMENTO A ANALIZAR: CV ===\n" + cvText.slice(0, 4500) + "\n=== FIN DEL CV ===\n\n";
  }

  if (liText && liText.length >= 30) {
    docBlock += "=== DOCUMENTO A ANALIZAR: PERFIL LINKEDIN ===\n" + liText.slice(0, 4500) + "\n=== FIN DEL PERFIL LINKEDIN ===\n\n";
  }

  let instrBlock = "";

  if (ctx) instrBlock += "Contexto del analisis: " + ctx + "\n\n";

  if (modo === "li") {
    instrBlock += "MODO: Analiza SOLO el perfil de LinkedIn. Usa su contenido para todos los campos del JSON.\n";
    instrBlock += "Analiza en profundidad: Titular/Headline, Extracto/About, Experiencias, Aptitudes, Formacion, Completitud, Narrativa entre secciones.\n";
  } else if (modo === "ambos") {
    instrBlock += "MODO: Analiza el CV (campos principales del JSON) Y el perfil LinkedIn (en linkedin_analysis).\n";
  } else {
    instrBlock += "MODO: Analiza el CV.\n";
  }

  instrBlock += "\nANTES de escribir el JSON, calcula mentalmente estos valores para el documento analizado:\n";
  instrBlock += "- atsScore: puntuacion global del CV como documento (0-100, siendo 100 perfecto para ATS)\n";
  instrBlock += "- scorePotencial: puntuacion del perfil si implementa las mejoras sugeridas (siempre mayor que atsScore)\n";
  instrBlock += "- impactDensityScore: porcentaje de experiencias que tienen logros cuantificados (0-100)\n";
  instrBlock += "Usa esos valores calculados en el JSON. NUNCA dejes estos tres campos en 0.\n\n";
  instrBlock += "Devuelve SOLO este JSON con los datos reales del documento. Todos los campos son obligatorios:\n\n";

  const liDims = liText && liText.length >= 30
    ? '"linkedin_analysis": {\n' +
      '  "coherencia_score": 0,\n' +
      '  "coherencia_nivel": "Alta|Media|Baja",\n' +
      '  "coincidencias": ["fortaleza 1", "fortaleza 2", "fortaleza 3"],\n' +
      '  "brechas": ["oportunidad 1", "oportunidad 2", "oportunidad 3"],\n' +
      '  "recomendaciones_linkedin": ["accion 1", "accion 2", "accion 3", "accion 4"],\n' +
      '  "resumen_coherencia": "3-4 oraciones de diagnostico del perfil como documento de empleabilidad digital",\n' +
      '  "titular_actual": "texto exacto del titular actual",\n' +
      '  "titular_sugerido": "propuesta de titular mejorado con rol + propuesta de valor",\n' +
      '  "extracto_diagnostico": "que comunica el extracto, que falta, tono, longitud, llamado a la accion",\n' +
      '  "completitud_perfil": 0,\n' +
      '  "dimensiones_li": { "titular": 0, "extracto": 0, "experiencias": 0, "habilidades": 0, "completitud": 0, "narrativa": 0 }\n' +
      '}'
    : '"linkedin_analysis": null';

  return (
    docBlock +
    instrBlock +
    "{\n" +
    '  "candidateName": "nombre completo extraido del documento",\n' +
    '  "seniority": "Junior|Semi-Senior|Senior|Lead|Executive",\n' +
    '  "yearsExperience": "numero entero",\n' +
    '  "currentRole": "rol mas reciente + empresa si figura",\n' +
    '  "atsScore": 65,\n' +
    '  "scorePotencial": 80,\n' +
    '  "impactDensityScore": 55,\n' +
    '  "impactDensityLabel": "Alto|Medio|Bajo",\n' +
    '  "impactDensityDiagnostico": "diagnostico concreto con referencia a logros o ausencia de ellos en el documento",\n' +
    '  "resumenEjecutivo": "Empieza con el nombre real de la persona. Describe su situacion profesional actual con rol y empresa. Luego diagnostico especifico: que funciona, que no, con referencia a elementos concretos del documento. 3-4 oraciones.",\n' +
    '  "atsDetalle": { "keywords": 60, "verbosAccion": 50, "metricas": 40, "estructura": 70, "densidadHabilidades": 55, "claridadRoles": 65 },\n' +
    '  "seccionesDetectadas": { "perfilProfesional": false, "experienciaLaboral": false, "educacion": false, "habilidades": false, "logros": false, "herramientas": false, "idiomas": false },\n' +
    '  "seccionesFaltantes": [],\n' +
    '  "alertas": [{"tipo": "error|warning|info", "mensaje": "texto especifico al documento"}],\n' +
    '  "analisisLogros": {\n' +
    '    "logrosFuertes": [{"frase": "frase exacta del documento", "motivo": "por que es un logro fuerte"}],\n' +
    '    "logrosDebiles": [{"frase": "frase del documento", "motivo": "por que es debil", "sugerencia": "como mejorarlo"}],\n' +
    '    "responsabilidadesSinImpacto": [{"frase": "frase del documento", "oportunidad": "como convertirlo en logro"}]\n' +
    '  },\n' +
    '  "verbosImpacto": { "detectados": [], "debiles": [{"verbo": "verbo", "contexto": "frase donde aparece", "alternativas": []}] },\n' +
    '  "narrativaProfesional": { "tipo": "Consistente|En crecimiento|En transicion|Dispersa", "descripcion": "texto", "progresion": "texto", "oportunidades": [] },\n' +
    '  "mapaHabilidades": { "declaradas": [], "detectadas": [], "aIncorporar": [] },\n' +
    '  "areasProfesionales": [],\n' +
    '  "rolesObjetivo": [{"titulo": "rol", "matchPct": 75, "seniority": "nivel", "justificacion": "texto", "skills": []}],\n' +
    '  "fortalezas": [{"titulo": "titulo concreto referido al perfil", "detalle": "evidencia especifica del documento: seccion, logro, habilidad o empresa concreta"}],\n' +
    '  "debilidades": [{"titulo": "titulo concreto referido al perfil", "detalle": "que falta o esta mal con referencia especifica al documento", "accion": "accion concreta y realizable para este perfil"}],\n' +
    '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "categoria", "titulo": "titulo concreto", "detalle": "accion especifica para este perfil, no generica", "impactoScore": "+N puntos"}],\n' +
    '  "perfilEmpleabilidad": {\n' +
    '    "visibilidad": { "score": 65, "label": "Alta|Media|Baja", "diagnostico": "1 oracion concreta sobre que tan legible y encontrable es el perfil" },\n' +
    '    "coherencia": { "score": 70, "label": "Alta|Media|Baja", "diagnostico": "1 oracion concreta sobre si el relato profesional tiene hilo conductor" },\n' +
    '    "movilidad": { "score": 60, "label": "Alta|Media|Baja", "diagnostico": "1 oracion concreta sobre si el perfil habilita transiciones o esta encerrado en un solo rol" }\n' +
    '  },\n' +
    '  IMPORTANTE: todos los campos numericos de score son enteros entre 0 y 100. NO uses escala 0-10.\n' +
    liDims + "\n" +
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
