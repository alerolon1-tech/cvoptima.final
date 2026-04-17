// ══════════════════════════════════════════════════════════════════════════════
// CVOptima — Worker (Cloudflare Pages Functions)
// Arquitectura de tiers: Starter / Diagnóstico / Pro / Professional
//
// El Worker siempre genera el JSON completo. La visibilidad la controla el
// frontend según el plan devuelto en el campo `_plan`.
//
// Tiers:
//   starter      → gratis / lead magnet
//   diagnostico  → pago básico
//   pro          → pago avanzado (auth via Supabase)
//   professional → pago premium
//
// El plan se resuelve en este orden de prioridad:
//   1. Token de Supabase válido en header Authorization → plan del usuario
//   2. Campo `plan` en FormData (para pruebas o Starter explícito)
//   3. Default: "starter"
// ══════════════════════════════════════════════════════════════════════════════

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

    // ── Resolver plan ────────────────────────────────────────────────────────
    let plan = fd.get("plan") || "starter";

    // Si hay token de Supabase, verificar plan real del usuario
    const authHeader = request.headers.get("Authorization") || "";
    if (authHeader.startsWith("Bearer ") && env.SUPABASE_URL && env.SUPABASE_KEY) {
      const token = authHeader.slice(7);
      const userPlan = await resolveUserPlan(env, token);
      if (userPlan) plan = userPlan;
    }

    // ── Validaciones por modo ────────────────────────────────────────────────
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

    // ── Llamada al modelo con fallback automático por rate limit ─────────────
    const prompt = buildPrompt(cvText, liText, modo, role, sector, seniority);

    const MODELS = [
      "llama-3.3-70b-versatile",   // Primario: más preciso
      "llama-3.1-8b-instant",      // Fallback 1
      "llama3-70b-8192",           // Fallback 2: límite independiente
      "llama3-8b-8192",            // Fallback 3: límite independiente
    ];

    let groqData = null;
    let modelUsed = null;
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
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 4000,
        }),
      });

      if (groqRes.ok) {
        groqData = await groqRes.json();
        modelUsed = model;
        break;
      }

      const errText = await groqRes.text();
      lastError = errText;

      // Solo hacer fallback en rate limit (429) — otros errores los propagamos
      let errJson;
      try { errJson = JSON.parse(errText); } catch { errJson = null; }
      const isRateLimit = groqRes.status === 429 ||
        (errJson?.error?.code === "rate_limit_exceeded") ||
        (errJson?.error?.type === "tokens") ||
        (errJson?.error?.code === "model_decommissioned");

      if (!isRateLimit) {
        throw new Error("Groq error: " + errText);
      }
      // Si es rate limit y hay más modelos, continuamos al siguiente
    }

    if (!groqData) {
      throw new Error("El servicio de análisis está temporalmente saturado. Intentá de nuevo en unos minutos o más tarde.");
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

    // ── Aplicar visibilidad según plan ───────────────────────────────────────
    const response = applyTierVisibility(result, plan, modo);

    // ── Guardar en Supabase (solo usuarios autenticados) ─────────────────────
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

// ══════════════════════════════════════════════════════════════════════════════
// TIERS — Visibilidad por plan
//
// Starter      → veredicto + 3 señales + 1 acción. Solo CV.
// Diagnóstico  → dashboard completo CV + LinkedIn por separado.
// Pro          → todo + coherencia CV↔LinkedIn + radar comparativo.
// Professional → todo lo anterior (sesión con Alejandra fuera del portal).
//
// La lógica: el JSON completo siempre se genera. Este filtro decide
// qué campos se envían al frontend. El frontend renderiza lo que recibe.
// ══════════════════════════════════════════════════════════════════════════════

function applyTierVisibility(data, plan, modo) {
  // Professional y Pro tienen acceso completo
  if (plan === "professional" || plan === "pro") {
    return { ...data, _plan: plan };
  }

  // Diagnóstico: CV + LinkedIn full, sin comparativa de coherencia
  if (plan === "diagnostico") {
    const d = { ...data, _plan: plan };
    // En modo ambos, el plan Diagnóstico no incluye el score de coherencia
    // ni el radar comparativo (eso es Pro). Sí incluye cada módulo por separado.
    if (modo === "ambos" && d.linkedin_analysis) {
      d.linkedin_analysis = {
        ...d.linkedin_analysis,
        // Ocultar coherencia entre documentos — disponible en Pro
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

  // Starter: veredicto completo + señales + acciones prioritarias + fortalezas y debilidades
  const recsAlta  = (data.recomendaciones || []).filter(r => r.prioridad === "Alta");
  const recsMedia = (data.recomendaciones || []).filter(r => r.prioridad === "Media").slice(0, 2);
  const starter = {
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
    _locked: {
      atsDetalle:           true,
      seccionesDetectadas:  true,
      analisisLogros:       true,
      verbosImpacto:        true,
      narrativaProfesional: true,
      mapaHabilidades:      true,
      rolesObjetivo:        true,
      recomendaciones_full: true,
      linkedin_analysis:    true,
    },
  };

  return starter;
}

// ══════════════════════════════════════════════════════════════════════════════
// Resolver plan de usuario desde Supabase Auth
// ══════════════════════════════════════════════════════════════════════════════

async function resolveUserPlan(env, token) {
  try {
    // Verificar el token con Supabase Auth
    const authRes = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
      headers: {
        "apikey": env.SUPABASE_KEY,
        "Authorization": "Bearer " + token,
      },
    });
    if (!authRes.ok) return null;

    const authData = await authRes.json();
    const userId = authData.id;
    if (!userId) return null;

    // Consultar plan del usuario en tabla `usuarios`
    const planRes = await fetch(
      env.SUPABASE_URL + "/rest/v1/usuarios?id=eq." + userId + "&select=plan",
      {
        headers: {
          "apikey": env.SUPABASE_KEY,
          "Authorization": "Bearer " + env.SUPABASE_KEY,
        },
      }
    );
    if (!planRes.ok) return null;

    const planData = await planRes.json();
    return planData?.[0]?.plan || "starter";
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Prompt builder — sin cambios de lógica respecto a versión anterior
// ══════════════════════════════════════════════════════════════════════════════

function liPromptDimensions() {
  return 'Incluye en tu respuesta el campo "linkedin_analysis" con esta estructura exacta (TODOS los campos obligatorios, no omitas ninguno):\n' +
    '{\n' +
    '  "coherencia_score": <numero 0-100 score general del perfil LinkedIn>,\n' +
    '  "coherencia_nivel": "Alta|Media|Baja",\n' +
    '  "coincidencias": ["fortaleza concreta 1", "fortaleza concreta 2", "fortaleza concreta 3"],\n' +
    '  "brechas": ["oportunidad de mejora 1", "oportunidad de mejora 2", "oportunidad de mejora 3"],\n' +
    '  "recomendaciones_linkedin": ["accion concreta 1", "accion concreta 2", "accion concreta 3", "accion concreta 4"],\n' +
    '  "resumen_coherencia": "3-4 oraciones de diagnostico del perfil como documento de empleabilidad digital",\n' +
    '  "titular_actual": "texto exacto del titular/headline actual",\n' +
    '  "titular_sugerido": "propuesta de titular mejorado con rol + propuesta de valor especifica",\n' +
    '  "extracto_diagnostico": "diagnostico: que comunica el extracto/about, que falta, tono, longitud, llamado a la accion",\n' +
    '  "completitud_perfil": <numero 0-100>,\n' +
    '  "dimensiones_li": {\n' +
    '    "titular": <0-100>,\n' +
    '    "extracto": <0-100>,\n' +
    '    "experiencias": <0-100>,\n' +
    '    "habilidades": <0-100>,\n' +
    '    "completitud": <0-100>,\n' +
    '    "narrativa": <0-100>\n' +
    '  }\n' +
    '}\n';
}

function buildPrompt(cvText, liText, modo, role, sector, seniority) {
  const ctx = [
    role      && "Rol objetivo: " + role,
    sector    && "Sector: " + sector,
    seniority && "Seniority: " + seniority,
  ].filter(Boolean).join(" | ");

  const intro =
    "Sos un experto senior en empleabilidad con enfoque en Empleabilidad en Clave Social.\n" +
    (ctx ? "Contexto: " + ctx + "\n" : "") +
    "\nREGLAS DE PERSONALIZACIÓN — obligatorias:\n" +
    "1. Usá el nombre real de la persona tal como aparece en el documento.\n" +
    "2. Mencioná su rol actual o más reciente con empresa y fechas exactas del documento.\n" +
    "3. Citá al menos un logro, proyecto, herramienta o dato concreto que figure textualmente.\n" +
    "4. Nunca uses frases genéricas sin especificar qué área, empresa o resultado concreto.\n" +
    "5. resumenEjecutivo: empezá con el nombre + situación profesional actual + diagnóstico específico.\n" +
    "6. Fortalezas y debilidades: referí a evidencia concreta del documento, no a categorías abstractas.\n";

  let cvBlock = "";
  if (cvText && cvText.length >= 30) {
    cvBlock =
      "\n\nCV:\n\"\"\"\n" + cvText.slice(0, 4500) + "\n\"\"\"\n" +
      "Analiza estructura, narrativa, logros cuantificados, verbos de impacto, habilidades, coherencia y compatibilidad ATS.\n";
  }

  let liBlock = "";
  if (liText && liText.length >= 30) {
    liBlock = "\n\nPERFIL LINKEDIN (exportado como PDF desde LinkedIn):\n\"\"\"\n" + liText.slice(0, 4500) + "\n\"\"\"\n";

    if (modo === "li") {
      liBlock += "\nIMPORTANTE: Este texto proviene de un PDF exportado desde LinkedIn. La estructura es diferente a un CV tradicional.\n";
      liBlock += "Analiza EN PROFUNDIDAD las siguientes secciones especificas de LinkedIn:\n";
      liBlock += "1. TITULAR (Headline): linea debajo del nombre. Evalua especificidad, propuesta de valor, keywords, diferenciacion.\n";
      liBlock += "2. EXTRACTO / ABOUT: presentacion personal. Evalua si comunica quien es, que valor aporta, a quien va dirigido, llamado a la accion.\n";
      liBlock += "3. EXPERIENCIAS: cada posicion. Evalua si tienen descripcion, verbos de accion, logros cuantificados.\n";
      liBlock += "4. APTITUDES / HABILIDADES: lista de skills. Evalua relevancia, validaciones, gaps.\n";
      liBlock += "5. FORMACION: titulos. Evalua si incluye descripcion o actividades relevantes.\n";
      liBlock += "6. COMPLETITUD: detecta ausencias (foto, banner, URL personalizada, recomendaciones de terceros, certificaciones).\n";
      liBlock += "7. NARRATIVA: coherencia entre titular, extracto y experiencias.\n";
      liBlock += "Para atsScore: calidad general del perfil LinkedIn como presencia digital.\n";
      liBlock += "Para atsDetalle: keywords=palabras clave en titular/aptitudes, verbosAccion=verbos en experiencias, metricas=logros cuantificados, estructura=completitud de secciones, densidadHabilidades=aptitudes declaradas, claridadRoles=claridad del titular.\n";
    } else {
      liBlock += "Analiza el perfil LinkedIn como documento de empleabilidad digital y su coherencia con el CV.\n" +
        "Usá el nombre real de la persona. Referite al titular actual concreto, al contenido específico del extracto y a las experiencias listadas.\n" +
        "Presta atencion a: titular, extracto/about, experiencias (descripcion y logros), aptitudes, completitud.\n";
    }

    liBlock += liPromptDimensions();
  }

  const modoInstr =
    modo === "li"    ? "ANALIZAS SOLO UN PERFIL DE LINKEDIN. Usas su contenido para todos los campos del JSON principal y para linkedin_analysis.\n\n" :
    modo === "ambos" ? "Analiza el CV (campos principales del JSON) Y el perfil LinkedIn (en linkedin_analysis con diagnostico profundo de cada seccion).\n\n" :
    "";

  return (
    intro + modoInstr + cvBlock + liBlock +
    '\nResponde SOLO con JSON valido en espanol rioplatense, sin texto extra, sin markdown:\n\n' +
    '{\n' +
    '  "candidateName": "nombre completo extraído del documento",\n' +
    '  "seniority": "Junior|Semi-Senior|Senior|Lead|Executive",\n' +
    '  "yearsExperience": "numero",\n' +
    '  "currentRole": "rol más reciente + empresa si figura",\n' +
    '  "atsScore": 0,\n' +
    '  "scorePotencial": 0,\n' +
    '  "impactDensityScore": 0,\n' +
    '  "impactDensityLabel": "Alto|Medio|Bajo",\n' +
    '  "impactDensityDiagnostico": "diagnóstico concreto con referencia a logros o ausencia de ellos en el documento",\n' +
    '  "resumenEjecutivo": "Comenzá con el nombre real. Describí su situación profesional actual con rol y empresa. Luego diagnóstico específico: qué funciona, qué no, con referencia a elementos concretos del documento. 3-4 oraciones.",\n' +
    '  "atsDetalle": { "keywords": 0, "verbosAccion": 0, "metricas": 0, "estructura": 0, "densidadHabilidades": 0, "claridadRoles": 0 },\n' +
    '  "seccionesDetectadas": { "perfilProfesional": false, "experienciaLaboral": false, "educacion": false, "habilidades": false, "logros": false, "herramientas": false, "idiomas": false },\n' +
    '  "seccionesFaltantes": [],\n' +
    '  "alertas": [{"tipo": "error|warning|info", "mensaje": "texto"}],\n' +
    '  "analisisLogros": {\n' +
    '    "logrosFuertes": [{"frase": "texto", "motivo": "explicacion"}],\n' +
    '    "logrosDebiles": [{"frase": "texto", "motivo": "explicacion", "sugerencia": "mejora"}],\n' +
    '    "responsabilidadesSinImpacto": [{"frase": "texto", "oportunidad": "como mejorar"}]\n' +
    '  },\n' +
    '  "verbosImpacto": { "detectados": [], "debiles": [{"verbo": "verbo", "contexto": "frase", "alternativas": []}] },\n' +
    '  "narrativaProfesional": { "tipo": "Consistente|En crecimiento|En transicion|Dispersa", "descripcion": "texto", "progresion": "texto", "oportunidades": [] },\n' +
    '  "mapaHabilidades": { "declaradas": [], "detectadas": [], "aIncorporar": [] },\n' +
    '  "areasProfesionales": [],\n' +
    '  "rolesObjetivo": [{"titulo": "rol", "matchPct": 0, "seniority": "nivel", "justificacion": "texto", "skills": []}],\n' +
    '  "fortalezas": [{"titulo": "titulo concreto referido al perfil", "detalle": "explicación con evidencia del documento: qué sección, qué logro, qué habilidad específica lo sostiene"}],\n' +
    '  "debilidades": [{"titulo": "titulo concreto referido al perfil", "detalle": "qué falta o qué está mal con referencia específica al documento", "accion": "acción concreta y realizable para este perfil puntual"}],\n' +
    '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "categoria", "titulo": "titulo", "detalle": "acción específica para este perfil, no genérica", "impactoScore": "+N puntos"}],\n' +
    '  "linkedin_analysis": null\n' +
    '}'
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Guardar en Supabase
// ══════════════════════════════════════════════════════════════════════════════

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
      user_id:        userId,
      cv_text:        cvText  ? cvText.slice(0, 8000)  : null,
      linkedin_text:  liText  ? liText.slice(0, 4000)  : null,
      resultado:      result,
      score:          result.atsScore,
      plan:           plan,
      created_at:     new Date().toISOString(),
    }),
  });
}
