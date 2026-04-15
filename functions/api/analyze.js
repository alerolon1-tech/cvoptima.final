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
    return new Response(JSON.stringify({ error: "Método no permitido" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const contentType = request.headers.get("content-type") || "";
    let cvText = "", role = "", sector = "", seniority = "", userId = null;
    let linkedinFile = null;

    if (contentType.includes("multipart/form-data")) {
      // FormData — incluye LinkedIn
      const formData = await request.formData();
      cvText    = formData.get("cvText")    || "";
      role      = formData.get("role")      || "";
      sector    = formData.get("sector")    || "";
      seniority = formData.get("seniority") || "";
      userId    = formData.get("userId")    || null;
      linkedinFile = formData.get("linkedin") || null;
    } else {
      // JSON — sin LinkedIn (flujo original)
      const body = await request.json();
      cvText    = body.cvText    || "";
      role      = body.role      || "";
      sector    = body.sector    || "";
      seniority = body.seniority || "";
      userId    = body.userId    || null;
    }

    if (!cvText || cvText.length < 80) {
      return new Response(JSON.stringify({ error: "No se recibió texto del CV" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Extraer texto del PDF de LinkedIn si fue enviado
    let linkedinText = null;
    let linkedinCoherenceBlock = "";
    if (linkedinFile) {
      linkedinText = await extractTextFromFile(linkedinFile);
      if (linkedinText && linkedinText.length > 50) {
        linkedinCoherenceBlock = buildLinkedinCoherencePrompt(linkedinText);
      }
    }

    const prompt = buildPrompt(cvText, role, sector, seniority, linkedinCoherenceBlock);

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 3500,
      }),
    });

    if (!groqResponse.ok) {
      const err = await groqResponse.text();
      throw new Error(`Groq error: ${err}`);
    }

    const groqData = await groqResponse.json();
    const rawContent = groqData.choices[0].message.content;

    let result;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
    } catch {
      throw new Error("No se pudo parsear la respuesta del modelo");
    }

    // Adjuntar indicadores LinkedIn
    result.has_linkedin = !!linkedinText;
    if (!result.linkedin_analysis) result.linkedin_analysis = null;

    // Guardar en Supabase si hay userId (versión PRO)
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

// ─── Extracción de texto PDF ───────────────────────────────────────────────

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
  const textParts = [];

  const btEtRegex = /BT([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(raw)) !== null) {
    const block = match[1];
    const strRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
    let strMatch;
    while ((strMatch = strRegex.exec(block)) !== null) {
      const decoded = strMatch[1]
        .replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\")
        .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
      if (decoded.trim().length > 1) textParts.push(decoded);
    }
    const tjRegex = /\[([^\]]+)\]/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      const innerStr = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      let is;
      while ((is = innerStr.exec(tjMatch[1])) !== null) {
        if (is[1].trim().length > 1) textParts.push(is[1]);
      }
    }
  }

  if (textParts.length < 10) {
    const printable = raw.replace(/[^\x20-\x7E\n\r\t]/g, " ");
    const words = printable.match(/[A-Za-záéíóúÁÉÍÓÚñÑüÜ,.:;@\-+()]{3,}/g) || [];
    return words.join(" ");
  }

  return textParts.join(" ").replace(/\s+/g, " ").trim();
}

// ─── Prompt LinkedIn ───────────────────────────────────────────────────────

function buildLinkedinCoherencePrompt(linkedinText) {
  return `

## ANÁLISIS ADICIONAL: COHERENCIA CV ↔ LINKEDIN

Analizá también el siguiente texto extraído del perfil de LinkedIn del candidato y evaluá la coherencia entre el CV y el perfil LinkedIn.

Texto del perfil LinkedIn:
"""
${linkedinText.slice(0, 4000)}
"""

Incluí en tu respuesta JSON un campo "linkedin_analysis" con esta estructura exacta:
{
  "coherencia_score": <número 0-100>,
  "coherencia_nivel": <"Alta" | "Media" | "Baja">,
  "coincidencias": [<lista de hasta 4 puntos de alineación entre CV y LinkedIn>],
  "brechas": [<lista de hasta 4 discrepancias: cargos, fechas, logros, habilidades>],
  "recomendaciones_linkedin": [<lista de hasta 3 acciones concretas para mejorar el perfil LinkedIn>],
  "resumen_coherencia": "<2-3 oraciones sobre la coherencia general entre ambos documentos>"
}

Evalúa: consistencia de fechas y cargos, habilidades declaradas vs. evidenciadas, tono narrativo, logros cuantificados, completitud del perfil LinkedIn respecto al CV.
`;
}

// ─── Prompt principal ──────────────────────────────────────────────────────

function buildPrompt(cvText, role, sector, seniority, linkedinBlock) {
  const roleCtx = [role && `Rol objetivo: ${role}`, sector && `Sector: ${sector}`, seniority && `Seniority: ${seniority}`].filter(Boolean).join(" | ");

  return `Sos un experto en empleabilidad con enfoque en Empleabilidad en Clave Social. Analizá el siguiente CV y devolvé ÚNICAMENTE un JSON válido, sin texto adicional, sin markdown.

${roleCtx ? `Contexto del candidato: ${roleCtx}\n` : ""}
CV:
"""
${cvText.slice(0, 5000)}
"""
${linkedinBlock}

Respondé en español rioplatense. Devolvé este JSON con todos los campos:

{
  "candidateName": "<nombre del candidato detectado>",
  "seniority": "<Junior|Semi-Senior|Senior|Lead|Executive>",
  "yearsExperience": "<número>",
  "currentRole": "<rol actual o más reciente>",
  "atsScore": <0-100>,
  "scorePotencial": <0-100>,
  "impactDensityScore": <0-100>,
  "impactDensityLabel": "<Alto|Medio|Bajo>",
  "impactDensityDiagnostico": "<frase breve>",
  "resumenEjecutivo": "<2-3 oraciones>",
  "atsDetalle": {
    "keywords": <0-100>,
    "verbosAccion": <0-100>,
    "metricas": <0-100>,
    "estructura": <0-100>,
    "densidadHabilidades": <0-100>,
    "claridadRoles": <0-100>
  },
  "seccionesDetectadas": {
    "perfilProfesional": <true|false>,
    "experienciaLaboral": <true|false>,
    "educacion": <true|false>,
    "habilidades": <true|false>,
    "logros": <true|false>,
    "herramientas": <true|false>,
    "idiomas": <true|false>
  },
  "seccionesFaltantes": ["<item>"],
  "alertas": [{"tipo": "<error|warning|info>", "mensaje": "<texto>"}],
  "analisisLogros": {
    "logrosFuertes": [{"frase": "<texto>", "motivo": "<explicación>"}],
    "logrosDebiles": [{"frase": "<texto>", "motivo": "<explicación>", "sugerencia": "<mejora>"}],
    "responsabilidadesSinImpacto": [{"frase": "<texto>", "oportunidad": "<cómo mejorar>"}]
  },
  "verbosImpacto": {
    "detectados": ["<verbo>"],
    "debiles": [{"verbo": "<verbo>", "contexto": "<frase>", "alternativas": ["<verbo fuerte>"]}]
  },
  "narrativaProfesional": {
    "tipo": "<Consistente|En crecimiento|En transición|Dispersa>",
    "descripcion": "<texto>",
    "progresion": "<texto>",
    "oportunidades": ["<texto>"]
  },
  "mapaHabilidades": {
    "declaradas": ["<habilidad>"],
    "detectadas": ["<habilidad>"],
    "aIncorporar": ["<habilidad>"]
  },
  "areasProfesionales": ["<área>"],
  "rolesObjetivo": [{"titulo": "<rol>", "matchPct": <0-100>, "seniority": "<nivel>", "justificacion": "<texto>", "skills": ["<skill>"]}],
  "fortalezas": [{"titulo": "<título>", "detalle": "<texto>"}],
  "debilidades": [{"titulo": "<título>", "detalle": "<texto>", "accion": "<qué hacer>"}],
  "recomendaciones": [{"prioridad": "<Alta|Media|Baja>", "categoria": "<categoría>", "titulo": "<título>", "detalle": "<texto>", "impactoScore": "+<N> puntos"}],
  "linkedin_analysis": null
}`;
}

// ─── Supabase ──────────────────────────────────────────────────────────────

async function saveToSupabase(env, userId, cvText, result, linkedinText) {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

  await supabase.from("diagnosticos").insert({
    user_id: userId,
    cv_text: cvText.slice(0, 8000),
    linkedin_text: linkedinText ? linkedinText.slice(0, 4000) : null,
    resultado: result,
    score: result.atsScore,
    created_at: new Date().toISOString(),
  });
}

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
    return new Response(JSON.stringify({ error: "Método no permitido" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const formData = await request.formData();
    const cvFile = formData.get("cv");
    const linkedinFile = formData.get("linkedin");
    const userId = formData.get("userId") || null;
    const language = formData.get("language") || "es";

    if (!cvFile) {
      return new Response(JSON.stringify({ error: "No se recibió el CV" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const cvText = await extractTextFromFile(cvFile);

    let linkedinText = null;
    let linkedinCoherenceBlock = "";
    if (linkedinFile) {
      linkedinText = await extractTextFromFile(linkedinFile);
      linkedinCoherenceBlock = buildLinkedinCoherencePrompt(linkedinText);
    }

    const prompt = buildPrompt(cvText, language, linkedinCoherenceBlock);

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 3000,
      }),
    });

    if (!groqResponse.ok) {
      const err = await groqResponse.text();
      throw new Error(`Groq error: ${err}`);
    }

    const groqData = await groqResponse.json();
    const rawContent = groqData.choices[0].message.content;

    let result;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
    } catch {
      throw new Error("No se pudo parsear la respuesta del modelo");
    }

    if (linkedinText) {
      result.linkedin_analysis = result.linkedin_analysis || null;
      result.has_linkedin = true;
    } else {
      result.has_linkedin = false;
    }

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

// ─── Extracción de texto ───────────────────────────────────────────────────

async function extractTextFromFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  const isPdf =
    uint8Array[0] === 0x25 &&
    uint8Array[1] === 0x50 &&
    uint8Array[2] === 0x44 &&
    uint8Array[3] === 0x46;

  if (isPdf) {
    return extractTextFromPdf(uint8Array);
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(uint8Array);
}

function extractTextFromPdf(uint8Array) {
  const raw = new TextDecoder("latin1").decode(uint8Array);
  const textParts = [];

  const btEtRegex = /BT([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(raw)) !== null) {
    const block = match[1];

    const strRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
    let strMatch;
    while ((strMatch = strRegex.exec(block)) !== null) {
      const decoded = strMatch[1]
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\")
        .replace(/\\([0-7]{1,3})/g, (_, oct) =>
          String.fromCharCode(parseInt(oct, 8))
        );
      if (decoded.trim().length > 1) textParts.push(decoded);
    }

    const tjRegex = /\[([^\]]+)\]/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      const inner = tjMatch[1];
      const innerStr = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      let is;
      while ((is = innerStr.exec(inner)) !== null) {
        if (is[1].trim().length > 1) textParts.push(is[1]);
      }
    }
  }

  if (textParts.length < 10) {
    const printable = raw.replace(/[^\x20-\x7E\n\r\t]/g, " ");
    const words = printable.match(/[A-Za-záéíóúÁÉÍÓÚñÑüÜ,.:;@\-+()]{3,}/g) || [];
    return words.join(" ");
  }

  return textParts.join(" ").replace(/\s+/g, " ").trim();
}

// ─── Prompt builders ───────────────────────────────────────────────────────

function buildLinkedinCoherencePrompt(linkedinText) {
  return `
## ANÁLISIS DE COHERENCIA CV ↔ LINKEDIN

Además del análisis estándar del CV, analizá el PDF del perfil de LinkedIn adjunto y evaluá la coherencia entre ambos documentos.

Texto extraído del perfil LinkedIn:
"""
${linkedinText.slice(0, 4000)}
"""

Incluí en tu respuesta JSON un campo adicional "linkedin_analysis" con la siguiente estructura:
{
  "coherencia_score": <número 0-100>,
  "coherencia_nivel": <"Alta" | "Media" | "Baja">,
  "coincidencias": [<lista de hasta 4 puntos fuertes de alineación>],
  "brechas": [<lista de hasta 4 discrepancias relevantes: cargos, fechas, logros, habilidades>],
  "recomendaciones_linkedin": [<lista de hasta 3 acciones concretas para mejorar el perfil LinkedIn>],
  "resumen_coherencia": "<párrafo breve de 2-3 oraciones sobre la coherencia general>"
}

La coherencia evalúa: consistencia de fechas y cargos, habilidades declaradas vs. evidenciadas, tono narrativo, presencia de logros cuantificados, y completitud del perfil LinkedIn vs. CV.
`;
}

function buildPrompt(cvText, language, linkedinBlock) {
  const lang = language === "en" ? "English" : "español argentino";

  return `Sos un experto en empleabilidad con enfoque en Empleabilidad en Clave Social. Analizá el siguiente CV y devolvé ÚNICAMENTE un JSON válido, sin texto adicional, sin markdown, sin explicaciones fuera del JSON.

CV a analizar:
"""
${cvText.slice(0, 5000)}
"""

${linkedinBlock}

Respondé en ${lang}. Devolvé este JSON exacto con todos los campos completos:

{
  "score_empleabilidad": <número 0-100>,
  "score_potencial": <número 0-100>,
  "impact_density": <número 0-100>,
  "nivel_general": <"Básico" | "Intermedio" | "Avanzado" | "Experto">,
  "resumen_ejecutivo": "<2-3 oraciones sobre el perfil>",
  "dimensiones": {
    "keywords_sector": {
      "score": <0-100>,
      "observacion": "<texto>",
      "sugerencias": ["<item>", "<item>"]
    },
    "verbos_accion": {
      "score": <0-100>,
      "observacion": "<texto>",
      "sugerencias": ["<item>", "<item>"]
    },
    "metricas_resultados": {
      "score": <0-100>,
      "observacion": "<texto>",
      "sugerencias": ["<item>", "<item>"]
    },
    "estructura_documento": {
      "score": <0-100>,
      "observacion": "<texto>",
      "sugerencias": ["<item>", "<item>"]
    },
    "densidad_habilidades": {
      "score": <0-100>,
      "observacion": "<texto>",
      "sugerencias": ["<item>", "<item>"]
    },
    "claridad_roles": {
      "score": <0-100>,
      "observacion": "<texto>",
      "sugerencias": ["<item>", "<item>"]
    }
  },
  "fortalezas": ["<item>", "<item>", "<item>"],
  "oportunidades_mejora": ["<item>", "<item>", "<item>"],
  "linkedin_analysis": null
}`;
}

// ─── Supabase ──────────────────────────────────────────────────────────────

async function saveToSupabase(env, userId, cvText, result, linkedinText) {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

  await supabase.from("diagnosticos").insert({
    user_id: userId,
    cv_text: cvText.slice(0, 8000),
    linkedin_text: linkedinText ? linkedinText.slice(0, 4000) : null,
    resultado: result,
    score: result.score_empleabilidad,
    created_at: new Date().toISOString(),
  });
}
