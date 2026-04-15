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
    const contentType = request.headers.get("content-type") || "";
    let cvText = "", role = "", sector = "", seniority = "", userId = null;
    let linkedinFile = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      cvText       = formData.get("cvText")    || "";
      role         = formData.get("role")      || "";
      sector       = formData.get("sector")    || "";
      seniority    = formData.get("seniority") || "";
      userId       = formData.get("userId")    || null;
      linkedinFile = formData.get("linkedin")  || null;
    } else {
      const body = await request.json();
      cvText    = body.cvText    || "";
      role      = body.role      || "";
      sector    = body.sector    || "";
      seniority = body.seniority || "";
      userId    = body.userId    || null;
    }

    if (!cvText || cvText.length < 80) {
      return new Response(JSON.stringify({ error: "No se recibio texto del CV" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    let linkedinText = null;
    let linkedinBlock = "";
    if (linkedinFile) {
      linkedinText = await extractTextFromFile(linkedinFile);
      if (linkedinText && linkedinText.length > 50) {
        linkedinBlock = buildLinkedinBlock(linkedinText);
      }
    }

    const prompt = buildPrompt(cvText, role, sector, seniority, linkedinBlock);

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
      const err = await groqRes.text();
      throw new Error("Groq error: " + err);
    }

    const groqData = await groqRes.json();
    const raw = groqData.choices[0].message.content;

    let result;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      result = JSON.parse(match ? match[0] : raw);
    } catch (e) {
      throw new Error("No se pudo parsear la respuesta del modelo");
    }

    result.has_linkedin = !!linkedinText;
    if (!result.linkedin_analysis) result.linkedin_analysis = null;

    if (userId && env.SUPABASE_URL && env.SUPABASE_KEY) {
      await saveToSupabase(env, userId, cvText, result, linkedinText);
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

async function extractTextFromFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const isPdf =
    uint8Array[0] === 0x25 && uint8Array[1] === 0x50 &&
    uint8Array[2] === 0x44 && uint8Array[3] === 0x46;
  if (isPdf) return extractTextFromPdf(uint8Array);
  return new TextDecoder("utf-8", { fatal: false }).decode(uint8Array);
}

function extractTextFromPdf(uint8Array) {
  const raw = new TextDecoder("latin1").decode(uint8Array);
  const parts = [];
  const btEt = /BT([\s\S]*?)ET/g;
  let m;
  while ((m = btEt.exec(raw)) !== null) {
    const block = m[1];
    const strRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
    let s;
    while ((s = strRe.exec(block)) !== null) {
      const d = s[1]
        .replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\")
        .replace(/\\([0-7]{1,3})/g, function(_, o) { return String.fromCharCode(parseInt(o, 8)); });
      if (d.trim().length > 1) parts.push(d);
    }
    const tjRe = /\[([^\]]+)\]/g;
    let t;
    while ((t = tjRe.exec(block)) !== null) {
      const iRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      let i;
      while ((i = iRe.exec(t[1])) !== null) {
        if (i[1].trim().length > 1) parts.push(i[1]);
      }
    }
  }
  if (parts.length < 10) {
    const p = raw.replace(/[^\x20-\x7E\n\r\t]/g, " ");
    var words = p.match(/[A-Za-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00c1\u00c9\u00cd\u00d3\u00da\u00f1\u00d1\u00fc\u00dc,.:;@\-+()]{3,}/g) || [];
    return words.join(" ");
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function buildLinkedinBlock(linkedinText) {
  var snippet = linkedinText.slice(0, 4000);
  return "\n\n## ANALISIS ADICIONAL: COHERENCIA CV vs LINKEDIN\n\nAnaliza el texto del perfil de LinkedIn y evalua la coherencia con el CV.\n\nTexto LinkedIn:\n\"\"\"\n" + snippet + "\n\"\"\"\n\nIncluye en tu respuesta el campo \"linkedin_analysis\":\n{\n  \"coherencia_score\": <0-100>,\n  \"coherencia_nivel\": \"Alta|Media|Baja\",\n  \"coincidencias\": [\"hasta 4 puntos de alineacion\"],\n  \"brechas\": [\"hasta 4 discrepancias\"],\n  \"recomendaciones_linkedin\": [\"hasta 3 acciones concretas\"],\n  \"resumen_coherencia\": \"2-3 oraciones\"\n}\n";
}

function buildPrompt(cvText, role, sector, seniority, linkedinBlock) {
  var ctx = [
    role ? "Rol objetivo: " + role : "",
    sector ? "Sector: " + sector : "",
    seniority ? "Seniority: " + seniority : "",
  ].filter(Boolean).join(" | ");

  return "Sos un experto en empleabilidad con enfoque en Empleabilidad en Clave Social. Analiza el CV y devuelve UNICAMENTE un JSON valido, sin texto adicional, sin markdown.\n\n" +
    (ctx ? "Contexto: " + ctx + "\n" : "") +
    "CV:\n\"\"\"\n" + cvText.slice(0, 5000) + "\n\"\"\"\n" +
    linkedinBlock +
    "\n\nResponde en español rioplatense. JSON requerido:\n\n{\n  \"candidateName\": \"nombre\",\n  \"seniority\": \"Junior|Semi-Senior|Senior|Lead|Executive\",\n  \"yearsExperience\": \"numero\",\n  \"currentRole\": \"rol actual\",\n  \"atsScore\": 0,\n  \"scorePotencial\": 0,\n  \"impactDensityScore\": 0,\n  \"impactDensityLabel\": \"Alto|Medio|Bajo\",\n  \"impactDensityDiagnostico\": \"frase\",\n  \"resumenEjecutivo\": \"texto\",\n  \"atsDetalle\": { \"keywords\": 0, \"verbosAccion\": 0, \"metricas\": 0, \"estructura\": 0, \"densidadHabilidades\": 0, \"claridadRoles\": 0 },\n  \"seccionesDetectadas\": { \"perfilProfesional\": false, \"experienciaLaboral\": false, \"educacion\": false, \"habilidades\": false, \"logros\": false, \"herramientas\": false, \"idiomas\": false },\n  \"seccionesFaltantes\": [],\n  \"alertas\": [{\"tipo\": \"error|warning|info\", \"mensaje\": \"texto\"}],\n  \"analisisLogros\": {\n    \"logrosFuertes\": [{\"frase\": \"texto\", \"motivo\": \"explicacion\"}],\n    \"logrosDebiles\": [{\"frase\": \"texto\", \"motivo\": \"explicacion\", \"sugerencia\": \"mejora\"}],\n    \"responsabilidadesSinImpacto\": [{\"frase\": \"texto\", \"oportunidad\": \"como mejorar\"}]\n  },\n  \"verbosImpacto\": {\n    \"detectados\": [],\n    \"debiles\": [{\"verbo\": \"verbo\", \"contexto\": \"frase\", \"alternativas\": [\"alternativa\"]}]\n  },\n  \"narrativaProfesional\": { \"tipo\": \"Consistente|En crecimiento|En transicion|Dispersa\", \"descripcion\": \"texto\", \"progresion\": \"texto\", \"oportunidades\": [] },\n  \"mapaHabilidades\": { \"declaradas\": [], \"detectadas\": [], \"aIncorporar\": [] },\n  \"areasProfesionales\": [],\n  \"rolesObjetivo\": [{\"titulo\": \"rol\", \"matchPct\": 0, \"seniority\": \"nivel\", \"justificacion\": \"texto\", \"skills\": []}],\n  \"fortalezas\": [{\"titulo\": \"titulo\", \"detalle\": \"texto\"}],\n  \"debilidades\": [{\"titulo\": \"titulo\", \"detalle\": \"texto\", \"accion\": \"que hacer\"}],\n  \"recomendaciones\": [{\"prioridad\": \"Alta|Media|Baja\", \"categoria\": \"categoria\", \"titulo\": \"titulo\", \"detalle\": \"texto\", \"impactoScore\": \"+N puntos\"}],\n  \"linkedin_analysis\": null\n}";
}

async function saveToSupabase(env, userId, cvText, result, linkedinText) {
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
      cv_text: cvText.slice(0, 8000),
      linkedin_text: linkedinText ? linkedinText.slice(0, 4000) : null,
      resultado: result,
      score: result.atsScore,
      created_at: new Date().toISOString(),
    }),
  });
}
