export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
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
    var formData = await request.formData();
    var cvText    = formData.get("cvText")    || "";
    var liText    = formData.get("liText")    || "";
    var role      = formData.get("role")      || "";
    var sector    = formData.get("sector")    || "";
    var seniority = formData.get("seniority") || "";
    var modo      = formData.get("modo")      || "cv";
    var userId    = formData.get("userId")    || null;

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

    var prompt = buildPrompt(cvText, liText, modo, role, sector, seniority);

    var groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.GROQ_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 3500,
      }),
    });

    if (!groqRes.ok) {
      var errTxt = await groqRes.text();
      throw new Error("Groq error: " + errTxt);
    }

    var groqData = await groqRes.json();
    var raw = groqData.choices[0].message.content;

    var result;
    try {
      var match = raw.match(/\{[\s\S]*\}/);
      result = JSON.parse(match ? match[0] : raw);
    } catch (e) {
      throw new Error("No se pudo parsear la respuesta del modelo");
    }

    result.has_linkedin = liText.length > 30;
    if (!result.linkedin_analysis) result.linkedin_analysis = null;

    if (userId && env.SUPABASE_URL && env.SUPABASE_KEY) {
      await saveToSupabase(env, userId, cvText, liText, result);
    }

    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}

function buildPrompt(cvText, liText, modo, role, sector, seniority) {
  var ctx = [
    role ? "Rol objetivo: " + role : "",
    sector ? "Sector: " + sector : "",
    seniority ? "Seniority: " + seniority : "",
  ].filter(Boolean).join(" | ");

  var intro = "Sos un experto en empleabilidad con enfoque en Empleabilidad en Clave Social.\n";
  intro += (ctx ? "Contexto del analisis: " + ctx + "\n" : "");

  var cvBlock = "";
  if (cvText && cvText.length >= 30) {
    cvBlock = "\n\nCV DE LA PERSONA:\n\"\"\"\n" + cvText.slice(0, 5000) + "\n\"\"\"\n";
    cvBlock += "Analiza este CV evaluando: estructura, narrativa profesional, logros, verbos de impacto, habilidades, coherencia del perfil y compatibilidad con sistemas ATS.\n";
  }

  var liBlock = "";
  if (liText && liText.length >= 30) {
    liBlock = "\n\nPERFIL DE LINKEDIN DE LA PERSONA:\n\"\"\"\n" + liText.slice(0, 5000) + "\n\"\"\"\n";
    if (modo === "li") {
      liBlock += "Analiza ESTE PERFIL DE LINKEDIN como documento principal. Evalua: completitud del perfil, claridad del titular y extracto, narrativa de la experiencia, habilidades declaradas, coherencia entre los roles, impacto de los logros descritos, y calidad general del perfil como herramienta de empleabilidad. NO lo trates como un CV tradicional: un perfil de LinkedIn tiene su propia logica y estructura. Identifica el sector y rol real de la persona a partir del contenido.\n";
    } else {
      liBlock += "Analiza tambien el perfil de LinkedIn e incluye el campo linkedin_analysis evaluando la coherencia entre el CV y el perfil.\n";
    }

    if (modo === "li" || modo === "ambos") {
      liBlock += "\nIncluye en tu respuesta el campo \"linkedin_analysis\" con esta estructura exacta:\n";
      liBlock += "{\n";
      liBlock += "  \"coherencia_score\": <0-100, si es modo li poner 100>,\n";
      liBlock += "  \"coherencia_nivel\": \"Alta|Media|Baja\",\n";
      liBlock += "  \"coincidencias\": [\"punto de alineacion 1\", \"punto de alineacion 2\"],\n";
      liBlock += "  \"brechas\": [\"discrepancia 1\", \"discrepancia 2\"],\n";
      liBlock += "  \"recomendaciones_linkedin\": [\"accion concreta 1\", \"accion concreta 2\"],\n";
      liBlock += "  \"resumen_coherencia\": \"descripcion de 2-3 oraciones\"\n";
      liBlock += "}\n";
    }
  }

  var modoInstr = "";
  if (modo === "li") {
    modoInstr = "IMPORTANTE: Estas analizando UNICAMENTE un perfil de LinkedIn, no un CV. Usa los datos del perfil de LinkedIn para completar TODOS los campos del JSON. El candidateName, currentRole, seniority, yearsExperience y resumenEjecutivo deben extraerse del perfil de LinkedIn. Los scores deben reflejar la calidad del perfil de LinkedIn como herramienta de empleabilidad.\n\n";
  } else if (modo === "ambos") {
    modoInstr = "Analiza tanto el CV como el perfil de LinkedIn. Los scores principales reflejan el CV. El campo linkedin_analysis refleja la coherencia entre ambos.\n\n";
  }

  return intro + modoInstr + cvBlock + liBlock +
    "\nResponde UNICAMENTE con un JSON valido en español rioplatense, sin texto adicional, sin markdown:\n\n" +
    "{\n" +
    "  \"candidateName\": \"nombre completo de la persona\",\n" +
    "  \"seniority\": \"Junior|Semi-Senior|Senior|Lead|Executive\",\n" +
    "  \"yearsExperience\": \"numero aproximado\",\n" +
    "  \"currentRole\": \"rol o cargo mas reciente\",\n" +
    "  \"atsScore\": 0,\n" +
    "  \"scorePotencial\": 0,\n" +
    "  \"impactDensityScore\": 0,\n" +
    "  \"impactDensityLabel\": \"Alto|Medio|Bajo\",\n" +
    "  \"impactDensityDiagnostico\": \"frase diagnostica\",\n" +
    "  \"resumenEjecutivo\": \"2-3 oraciones sobre el perfil profesional real de la persona\",\n" +
    "  \"atsDetalle\": { \"keywords\": 0, \"verbosAccion\": 0, \"metricas\": 0, \"estructura\": 0, \"densidadHabilidades\": 0, \"claridadRoles\": 0 },\n" +
    "  \"seccionesDetectadas\": { \"perfilProfesional\": false, \"experienciaLaboral\": false, \"educacion\": false, \"habilidades\": false, \"logros\": false, \"herramientas\": false, \"idiomas\": false },\n" +
    "  \"seccionesFaltantes\": [],\n" +
    "  \"alertas\": [{\"tipo\": \"error|warning|info\", \"mensaje\": \"texto\"}],\n" +
    "  \"analisisLogros\": {\n" +
    "    \"logrosFuertes\": [{\"frase\": \"texto\", \"motivo\": \"explicacion\"}],\n" +
    "    \"logrosDebiles\": [{\"frase\": \"texto\", \"motivo\": \"explicacion\", \"sugerencia\": \"mejora\"}],\n" +
    "    \"responsabilidadesSinImpacto\": [{\"frase\": \"texto\", \"oportunidad\": \"como mejorar\"}]\n" +
    "  },\n" +
    "  \"verbosImpacto\": { \"detectados\": [], \"debiles\": [{\"verbo\": \"verbo\", \"contexto\": \"frase\", \"alternativas\": []}] },\n" +
    "  \"narrativaProfesional\": { \"tipo\": \"Consistente|En crecimiento|En transicion|Dispersa\", \"descripcion\": \"texto\", \"progresion\": \"texto\", \"oportunidades\": [] },\n" +
    "  \"mapaHabilidades\": { \"declaradas\": [], \"detectadas\": [], \"aIncorporar\": [] },\n" +
    "  \"areasProfesionales\": [],\n" +
    "  \"rolesObjetivo\": [{\"titulo\": \"rol\", \"matchPct\": 0, \"seniority\": \"nivel\", \"justificacion\": \"texto\", \"skills\": []}],\n" +
    "  \"fortalezas\": [{\"titulo\": \"titulo\", \"detalle\": \"texto\"}],\n" +
    "  \"debilidades\": [{\"titulo\": \"titulo\", \"detalle\": \"texto\", \"accion\": \"que hacer\"}],\n" +
    "  \"recomendaciones\": [{\"prioridad\": \"Alta|Media|Baja\", \"categoria\": \"categoria\", \"titulo\": \"titulo\", \"detalle\": \"texto\", \"impactoScore\": \"+N puntos\"}],\n" +
    "  \"linkedin_analysis\": null\n" +
    "}";
}

async function saveToSupabase(env, userId, cvText, liText, result) {
  await fetch(env.SUPABASE_URL + "/rest/v1/diagnosticos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": env.SUPABASE_KEY,
      "Authorization": "Bearer " + env.SUPABASE_KEY,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      user_id: userId,
      cv_text: cvText ? cvText.slice(0, 8000) : null,
      linkedin_text: liText ? liText.slice(0, 4000) : null,
      resultado: result,
      score: result.atsScore,
      created_at: new Date().toISOString(),
    }),
  });
}
