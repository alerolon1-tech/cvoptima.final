exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key no configurada en Netlify. Agregá GROQ_API_KEY en Environment Variables.' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Body inválido.' }) }; }

  const { cvText, role, sector, seniority } = body;
  if (!cvText || cvText.length < 80) {
    return { statusCode: 400, body: JSON.stringify({ error: 'CV demasiado corto para analizar.' }) };
  }

  const prompt = `Sos un experto en reclutamiento, ATS y empleabilidad con enfoque en "Empleabilidad en Clave Social": el CV no es solo marketing personal sino una narrativa de procesos, vínculos, decisiones y contextos laborales.

Analizá el siguiente CV${role ? ' para el rol de ' + role : ''}${sector ? ' en el sector ' + sector : ''}${seniority ? ' nivel ' + seniority : ''}.

Devolvé ÚNICAMENTE un JSON válido con esta estructura exacta (sin texto extra, sin backticks, sin comentarios):

{
  "candidateName": "nombre completo o 'Candidato'",
  "email": "email detectado o ''",
  "currentRole": "rol o título actual detectado o ''",
  "yearsExperience": número estimado,
  "seniority": "Junior / Semi-Senior / Senior / Lead / Executive",

  "atsScore": número 0-100,
  "atsScoreOptimizado": número siempre mayor,
  "calidadGeneral": número 0-100,

  "categorias": {
    "estructura": {"score": 0-100, "label": "Estructura del CV", "descripcion": "1 oración concreta"},
    "logros": {"score": 0-100, "label": "Logros y resultados", "descripcion": "1 oración concreta"},
    "verbosImpacto": {"score": 0-100, "label": "Verbos de impacto", "descripcion": "1 oración concreta"},
    "keywordsATS": {"score": 0-100, "label": "Keywords ATS", "descripcion": "1 oración concreta"},
    "cuantificacion": {"score": 0-100, "label": "Métricas y números", "descripcion": "1 oración concreta"},
    "claridad": {"score": 0-100, "label": "Claridad y síntesis", "descripcion": "1 oración concreta"}
  },

  "tareasVsLogros": {
    "tareasPct": número 0-100,
    "logrosPct": número 0-100,
    "frasesTareas": ["frase 1", "frase 2", "hasta 4"],
    "frasesLogros": ["frase 1", "hasta 4"],
    "conversiones": [
      {
        "original": "frase tarea original",
        "optimizada": "versión convertida en logro",
        "verboOriginal": "verbo débil",
        "verboSugerido": "verbo de impacto"
      }
    ]
  },

  "verbosDebiles": [
    {
      "verbo": "verbo débil",
      "contexto": "frase donde aparece",
      "sugerencia": "alternativa de impacto",
      "fraseMejorada": "frase reescrita"
    }
  ],

  "perfilProfesionalOptimizado": "perfil de 3-4 oraciones con lenguaje de impacto",

  "seccionesDetectadas": {
    "perfilProfesional": true,
    "experienciaLaboral": true,
    "educacion": true,
    "habilidades": true,
    "logros": false,
    "herramientas": false,
    "idiomas": false
  },

  "problemasEstructura": ["problema 1", "hasta 3"],

  "keywordsPresentes": ["hasta 10"],
  "keywordsFaltantes": ["hasta 8"],

  "alertas": [
    {"tipo": "error/warning/info", "mensaje": "descripción concreta"}
  ],

  "fortalezas": [
    {"titulo": "título corto", "detalle": "1-2 oraciones"}
  ],

  "brechas": [
    {"titulo": "título corto", "detalle": "explicación concreta", "accion": "qué hacer"}
  ],

  "rolesSugeridos": [
    {
      "titulo": "Título del rol",
      "seniority": "nivel",
      "matchPct": 0-100,
      "justificacion": "por qué encaja",
      "salarioRango": "rango estimado",
      "skills": ["skill1", "skill2", "skill3"]
    }
  ],

  "recomendaciones": [
    {
      "prioridad": "Alta/Media/Baja",
      "categoria": "categoría",
      "titulo": "qué hacer",
      "detalle": "cómo hacerlo exactamente",
      "impactoScore": "+X puntos"
    }
  ],

  "scorePotencial": 0-100,
  "resumenEjecutivo": "3-4 oraciones sobre el perfil, valor real y camino de mejora"
}

CV a analizar:
${cvText.substring(0, 12000)}`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Sos un experto en reclutamiento, ATS y empleabilidad. Respondés SIEMPRE con JSON válido y nada más. Nunca agregues texto fuera del JSON. Es crítico que el JSON esté completo y bien cerrado.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 4000
      })
    });

    if (!res.ok) {
      const ed = await res.json().catch(() => ({}));
      return { statusCode: res.status, body: JSON.stringify({ error: ed?.error?.message || 'Error ' + res.status }) };
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    if (!raw) return { statusCode: 500, body: JSON.stringify({ error: 'Respuesta vacía de la IA.' }) };

    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return { statusCode: 500, body: JSON.stringify({ error: 'No se pudo parsear la respuesta.' }) };

    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch(e) {
      return { statusCode: 500, body: JSON.stringify({ error: 'La respuesta de la IA quedó incompleta. Intentá de nuevo.' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Error interno.' }) };
  }
};
