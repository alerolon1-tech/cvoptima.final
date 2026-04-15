export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Metodo no permitido" }), { status: 405, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
  try {
    var fd = await request.formData();
    var cvText    = fd.get("cvText")    || "";
    var liText    = fd.get("liText")    || "";
    var role      = fd.get("role")      || "";
    var sector    = fd.get("sector")    || "";
    var seniority = fd.get("seniority") || "";
    var modo      = fd.get("modo")      || "cv";
    var userId    = fd.get("userId")    || null;

    if (modo !== "li" && cvText.length < 30) {
      return new Response(JSON.stringify({ error: "No se recibio texto del CV" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if ((modo === "li" || modo === "ambos") && liText.length < 30) {
      return new Response(JSON.stringify({ error: "No se recibio texto del perfil de LinkedIn" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    var prompt = buildPrompt(cvText, liText, modo, role, sector, seniority);
    var groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.GROQ_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 4000 }),
    });
    if (!groqRes.ok) throw new Error("Groq error: " + await groqRes.text());

    var groqData = await groqRes.json();
    var raw = groqData.choices[0].message.content;
    var result;
    try { var m = raw.match(/\{[\s\S]*\}/); result = JSON.parse(m ? m[0] : raw); }
    catch (e) { throw new Error("No se pudo parsear la respuesta del modelo"); }

    result.has_linkedin = liText.length > 30;
    if (!result.linkedin_analysis) result.linkedin_analysis = null;

    if (userId && env.SUPABASE_URL && env.SUPABASE_KEY) {
      await saveToSupabase(env, userId, cvText, liText, result);
    }
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
}

function liPromptDimensions() {
  return 'Incluye en tu respuesta el campo "linkedin_analysis" con esta estructura exacta (todos los campos son obligatorios):\n{\n  "coherencia_score": <numero 0-100>,\n  "coherencia_nivel": "Alta|Media|Baja",\n  "coincidencias": ["hasta 5 puntos especificos de alineacion"],\n  "brechas": ["hasta 5 gaps o discrepancias especificas"],\n  "recomendaciones_linkedin": ["hasta 5 acciones concretas y especificas"],\n  "resumen_coherencia": "3-4 oraciones de diagnostico",\n  "titular_actual": "texto del titular actual del perfil",\n  "titular_sugerido": "propuesta de titular mejorado especifico para esta persona",\n  "extracto_diagnostico": "diagnostico detallado del extracto/about: que comunica, que falta, como mejorarlo",\n  "completitud_perfil": <numero 0-100>,\n  "dimensiones_li": {\n    "titular": <0-100>,\n    "extracto": <0-100>,\n    "experiencias": <0-100>,\n    "habilidades": <0-100>,\n    "completitud": <0-100>,\n    "narrativa": <0-100>\n  }\n}\n';
}

function buildPrompt(cvText, liText, modo, role, sector, seniority) {
  var ctx = [role && "Rol objetivo: " + role, sector && "Sector: " + sector, seniority && "Seniority: " + seniority].filter(Boolean).join(" | ");
  var intro = "Sos un experto senior en empleabilidad con enfoque en Empleabilidad en Clave Social.\n" + (ctx ? "Contexto: " + ctx + "\n" : "");

  var cvBlock = "";
  if (cvText && cvText.length >= 30) {
    cvBlock = "\n\nCV:\n\"\"\"\n" + cvText.slice(0, 5000) + "\n\"\"\"\nAnaliza estructura, narrativa, logros cuantificados, verbos de impacto, habilidades, coherencia y compatibilidad ATS.\n";
  }

  var liBlock = "";
  if (liText && liText.length >= 30) {
    liBlock = "\n\nPERFIL LINKEDIN:\n\"\"\"\n" + liText.slice(0, 5000) + "\n\"\"\"\n";
    if (modo === "li") {
      liBlock += "\nAnaliza EN PROFUNDIDAD este perfil de LinkedIn como documento principal. CRITICO:\n";
      liBlock += "- Determina sector y rol EXCLUSIVAMENTE desde el contenido (cargos, descripciones, habilidades). NO uses nombre de archivo ni suposiciones.\n";
      liBlock += "- Evalua el titular (headline): especificidad, propuesta de valor, diferenciacion.\n";
      liBlock += "- Evalua el extracto/about: narrativa, propuesta de valor, llamado a la accion.\n";
      liBlock += "- Analiza cada experiencia: logros cuantificados, verbos de impacto, valor comunicado.\n";
      liBlock += "- Evalua habilidades: relevancia, validacion, gaps.\n";
      liBlock += "- Evalua completitud: foto, banner, recomendaciones, formacion, certificaciones, URL.\n";
      liBlock += "- Para scores: atsScore = calidad general del perfil LinkedIn. atsDetalle mide dimensiones del perfil: keywords=palabras clave para busquedas, verbosAccion=verbos en experiencias, metricas=logros cuantificados, estructura=completitud y organizacion, densidadHabilidades=skills, claridadRoles=titular y descripcion de roles.\n";
    } else {
      liBlock += "Analiza el LinkedIn y su coherencia con el CV.\n";
    }
    liBlock += liPromptDimensions();
  }

  var modoInstr = modo === "li"
    ? "ANALIZAS SOLO UN PERFIL LINKEDIN. Usa su contenido para todos los campos JSON.\n\n"
    : modo === "ambos"
    ? "Analiza CV (scores principales) y LinkedIn (linkedin_analysis = coherencia + diagnostico LinkedIn).\n\n"
    : "";

  return intro + modoInstr + cvBlock + liBlock +
    '\nResponde SOLO con JSON valido en espanol rioplatense, sin texto extra, sin markdown:\n\n' +
    '{\n' +
    '  "candidateName": "nombre completo",\n' +
    '  "seniority": "Junior|Semi-Senior|Senior|Lead|Executive",\n' +
    '  "yearsExperience": "numero",\n' +
    '  "currentRole": "rol mas reciente",\n' +
    '  "atsScore": 0,\n' +
    '  "scorePotencial": 0,\n' +
    '  "impactDensityScore": 0,\n' +
    '  "impactDensityLabel": "Alto|Medio|Bajo",\n' +
    '  "impactDensityDiagnostico": "frase diagnostica",\n' +
    '  "resumenEjecutivo": "3-4 oraciones de diagnostico real de la persona",\n' +
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
    '  "fortalezas": [{"titulo": "titulo", "detalle": "texto"}],\n' +
    '  "debilidades": [{"titulo": "titulo", "detalle": "texto", "accion": "que hacer"}],\n' +
    '  "recomendaciones": [{"prioridad": "Alta|Media|Baja", "categoria": "categoria", "titulo": "titulo", "detalle": "texto", "impactoScore": "+N puntos"}],\n' +
    '  "linkedin_analysis": null\n' +
    '}';
}

async function saveToSupabase(env, userId, cvText, liText, result) {
  await fetch(env.SUPABASE_URL + "/rest/v1/diagnosticos", {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": env.SUPABASE_KEY, "Authorization": "Bearer " + env.SUPABASE_KEY, "Prefer": "return=minimal" },
    body: JSON.stringify({ user_id: userId, cv_text: cvText ? cvText.slice(0, 8000) : null, linkedin_text: liText ? liText.slice(0, 4000) : null, resultado: result, score: result.atsScore, created_at: new Date().toISOString() }),
  });
}
