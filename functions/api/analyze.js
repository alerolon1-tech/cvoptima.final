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
    const formData = await request.formData();
    const cvText    = formData.get("cvText")    || "";
    const role      = formData.get("role")      || "";
    const sector    = formData.get("sector")    || "";
    const seniority = formData.get("seniority") || "";
    const modo      = formData.get("modo")      || "cv";
    const userId    = formData.get("userId")    || null;
    const liFile    = formData.get("linkedin")  || null;

    if (modo !== "li" && cvText.length < 80) {
      return new Response(JSON.stringify({ error: "No se recibio texto del CV" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    if ((modo === "li" || modo === "ambos") && !liFile) {
      return new Response(JSON.stringify({ error: "No se recibio el PDF de LinkedIn" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    var liText = null;
    if (liFile) {
      liText = await extractTextFromFile(liFile);
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

    result.has_linkedin = !!liText;
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

async function extractTextFromFile(file) {
  var arrayBuffer = await file.arrayBuffer();
  var uint8Array = new Uint8Array(arrayBuffer);
  var isPdf = uint8Array[0] === 0x25 && uint8Array[1] === 0x50 && uint8Array[2] === 0x44 && uint8Array[3] === 0x46;
  if (isPdf) return extractTextFromPdf(uint8Array);
  return new TextDecoder("utf-8", { fatal: false }).decode(uint8Array);
}

function extractTextFromPdf(uint8Array) {
  var raw = new TextDecoder("latin1").decode(uint8Array);
  var parts = [];
  var btEt = /BT([\s\S]*?)ET/g;
  var m;
  while ((m = btEt.exec(raw)) !== null) {
    var block = m[1];
    var strRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
    var s;
    while ((s = strRe.exec(block)) !== null) {
      var d = s[1]
        .replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\")
        .replace(/\\([0-7]{1,3})/g, function(_, o) { return String.fromCharCode(parseInt(o, 8)); });
      if (d.trim().length > 1) parts.push(d);
    }
    var tjRe = /\[([^\]]+)\]/g;
    var t;
    while ((t = tjRe.exec(block)) !== null) {
      var iRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      var i;
      while ((i = iRe.exec(t[1])) !== null) {
        if (i[1].trim().length > 1) parts.push(i[1]);
      }
    }
  }
  if (parts.length < 10) {
    var p = raw.replace(/[^\x20-\x7E\n\r\t]/g, " ");
    var words = p.match(/[A-Za-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00c1\u00c9\u00cd\u00d3\u00da\u00f1\u00d1\u00fc\u00dc,.:;@\-+()]{3,}/g) || [];
    return words.join(" ");
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function buildPrompt(cvText, liText, modo, role, sector, seniority) {
  var ctx = [
    role ? "Rol objetivo: " + role : "",
    sector ? "Sector: " + sector : "",
    seniority ? "Seniority: " + seniority : "",
  ].filter(Boolean).join(" | ");

  var liBlock = "";
  if (liText) {
    liBlock = "\n\nPERFIL DE LINKEDIN:\n\"\"\"\n" + liText.slice(0, 4000) + "\n\"\"\"\n";
    liBlock += "\nIncluye en tu respuesta el campo \"linkedin_analysis\":\n";
    liBlock += "{\n  \"coherencia_score\": <0-100>,\n  \"coherencia_nivel\": \"Alta|Media|Baja\",\n  \"coincidencias\": [\"hasta 4 puntos de alineacion\"],\n  \"brechas\": [\"hasta 4 discrepancias\"],\n  \"recomendaciones_linkedin\": [\"hasta 3 acciones concretas\"],\n  \"resumen_coherencia\": \"2-3 oraciones\"\n}\n";
  }

  var cvBlock = "";
  if (cvText && cvText.length >= 80) {
    cvBlock = "\n\nCV:\n\"\"\"\n" + cvText.slice(0, 5000) + "\n\"\"\"\n";
  }

  var modoDesc = modo === "li" ? "el perfil de LinkedIn" : modo === "ambos" ? "el CV y el perfil de LinkedIn" : "el CV";

  return "Sos un experto en empleabilidad con enfoque en Empleabilidad en Clave Social. Analiza " + modoDesc + " y devuelve UNICAMENTE un JSON valido, sin texto adicional, sin markdown.\n\n" +
    (ctx ? "Contexto: " + ctx + "\n" : "") +
    cvBlock +
    liBlock +
    "\nResponde en español rioplatense. JSON requerido:\n\n{\n  \"candidateName\": \"nombre\",\n  \"seniority\": \"Junior|Semi-Senior|Senior|Lead|Executive\",\n  \"yearsExperience\": \"numero\",\n  \"currentRole\": \"rol actual\",\n  \"atsScore\": 0,\n  \"scorePotencial\": 0,\n  \"impactDensityScore\": 0,\n  \"impactDensityLabel\": \"Alto|Medio|Bajo\",\n  \"impactDensityDiagnostico\": \"frase\",\n  \"resumenEjecutivo\": \"texto\",\n  \"atsDetalle\": { \"keywords\": 0, \"verbosAccion\": 0, \"metricas\": 0, \"estructura\": 0, \"densidadHabilidades\": 0, \"claridadRoles\": 0 },\n  \"seccionesDetectadas\": { \"perfilProfesional\": false, \"experienciaLaboral\": false, \"educacion\": false, \"habilidades\": false, \"logros\": false, \"herramientas\": false, \"idiomas\": false },\n  \"seccionesFaltantes\": [],\n  \"alertas\": [{\"tipo\": \"error|warning|info\", \"mensaje\": \"texto\"}],\n  \"analisisLogros\": {\n    \"logrosFuertes\": [{\"frase\": \"texto\", \"motivo\": \"explicacion\"}],\n    \"logrosDebiles\": [{\"frase\": \"texto\", \"motivo\": \"explicacion\", \"sugerencia\": \"mejora\"}],\n    \"responsabilidadesSinImpacto\": [{\"frase\": \"texto\", \"oportunidad\": \"como mejorar\"}]\n  },\n  \"verbosImpacto\": {\n    \"detectados\": [],\n    \"debiles\": [{\"verbo\": \"verbo\", \"contexto\": \"frase\", \"alternativas\": []}]\n  },\n  \"narrativaProfesional\": { \"tipo\": \"Consistente|En crecimiento|En transicion|Dispersa\", \"descripcion\": \"texto\", \"progresion\": \"texto\", \"oportunidades\": [] },\n  \"mapaHabilidades\": { \"declaradas\": [], \"detectadas\": [], \"aIncorporar\": [] },\n  \"areasProfesionales\": [],\n  \"rolesObjetivo\": [{\"titulo\": \"rol\", \"matchPct\": 0, \"seniority\": \"nivel\", \"justificacion\": \"texto\", \"skills\": []}],\n  \"fortalezas\": [{\"titulo\": \"titulo\", \"detalle\": \"texto\"}],\n  \"debilidades\": [{\"titulo\": \"titulo\", \"detalle\": \"texto\", \"accion\": \"que hacer\"}],\n  \"recomendaciones\": [{\"prioridad\": \"Alta|Media|Baja\", \"categoria\": \"categoria\", \"titulo\": \"titulo\", \"detalle\": \"texto\", \"impactoScore\": \"+N puntos\"}],\n  \"linkedin_analysis\": null\n}";
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
