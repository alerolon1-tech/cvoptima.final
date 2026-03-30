export async function onRequestPost(context) {
  const { request, env } = context;

  const GROQ_KEY = env.GROQ_API_KEY;
  if (!GROQ_KEY) {
    return new Response(JSON.stringify({ error: 'API key no configurada. Agregá GROQ_API_KEY en Cloudflare Pages → Settings → Environment variables.' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Body inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { cvText, role, sector, seniority } = body;
  if (!cvText || cvText.length < 80) {
    return new Response(JSON.stringify({ error: 'CV demasiado corto para analizar.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const prompt = `Sos un experto en reclutamiento, ATS y empleabilidad con enfoque en "Empleabilidad en Clave Social".

Analizá el siguiente CV${role ? ' para el rol de ' + role : ''}${sector ? ' en el sector ' + sector : ''}${seniority ? ' nivel ' + seniority : ''}.

Devolvé ÚNICAMENTE un JSON válido, completo y bien cerrado. Sin texto antes ni después. Sin backticks. Sin comentarios.
Sé conciso en todos los campos de texto para no cortar la respuesta.

{
  "candidateName": "nombre completo o Candidato",
  "email": "email detectado o vacio",
  "currentRole": "rol actual detectado o vacio",
  "yearsExperience": numero estimado,
  "seniority": "Junior o Semi-Senior o Senior o Lead o Executive",

  "atsScore": numero 0-100,
  "scorePotencial": numero 0-100 siempre mayor que atsScore,
  "impactDensityScore": numero 0-100,
  "impactDensityLabel": "Bajo o Medio o Alto",
  "impactDensityDiagnostico": "1 oracion explicando el nivel",

  "resumenEjecutivo": "3 oraciones que resumen el perfil y camino de mejora",

  "atsDetalle": {
    "keywords": numero 0-100,
    "verbosAccion": numero 0-100,
    "metricas": numero 0-100,
    "estructura": numero 0-100,
    "densidadHabilidades": numero 0-100,
    "claridadRoles": numero 0-100
  },

  "seccionesDetectadas": {
    "perfilProfesional": true,
    "experienciaLaboral": true,
    "educacion": true,
    "habilidades": true,
    "logros": false,
    "herramientas": false,
    "idiomas": false
  },

  "seccionesFaltantes": ["seccion faltante 1"],

  "alertas": [
    {"tipo": "error", "mensaje": "descripcion concreta"}
  ],

  "analisisLogros": {
    "logrosFuertes": [
      {"frase": "frase del CV", "motivo": "por que es un logro fuerte"}
    ],
    "logrosDebiles": [
      {"frase": "frase del CV", "motivo": "por que es debil", "sugerencia": "como mejorarlo"}
    ],
    "responsabilidadesSinImpacto": [
      {"frase": "frase del CV", "oportunidad": "como convertirla en logro"}
    ]
  },

  "verbosImpacto": {
    "detectados": ["verbo1", "verbo2"],
    "debiles": [
      {"verbo": "verbo debil", "contexto": "frase donde aparece", "alternativas": ["alternativa1", "alternativa2"]}
    ]
  },

  "narrativaProfesional": {
    "tipo": "Consistente",
    "descripcion": "2 oraciones describiendo la narrativa",
    "progresion": "1 oracion sobre la progresion de carrera",
    "oportunidades": ["oportunidad 1", "oportunidad 2"]
  },

  "mapaHabilidades": {
    "declaradas": ["habilidad1", "habilidad2"],
    "detectadas": ["habilidad1", "habilidad2"],
    "aIncorporar": ["habilidad1", "habilidad2"]
  },

  "areasProfesionales": ["area1", "area2", "area3"],

  "rolesObjetivo": [
    {
      "titulo": "Titulo del rol",
      "seniority": "nivel",
      "matchPct": 80,
      "justificacion": "2 oraciones",
      "skills": ["skill1", "skill2", "skill3"]
    }
  ],

  "fortalezas": [
    {"titulo": "titulo corto", "detalle": "1-2 oraciones"}
  ],

  "debilidades": [
    {"titulo": "titulo corto", "detalle": "1-2 oraciones", "accion": "que hacer"}
  ],

  "recomendaciones": [
    {
      "prioridad": "Alta",
      "categoria": "categoria",
      "titulo": "que hacer",
      "detalle": "como hacerlo",
      "impactoScore": "+5 puntos"
    }
  ]
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
          { role: 'system', content: 'Sos un experto en reclutamiento, ATS y empleabilidad. Respondés SIEMPRE con JSON válido, completo y bien cerrado. Nunca agregues texto fuera del JSON. Sé conciso para no cortar la respuesta.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 8000
      })
    });

    if (!res.ok) {
      const ed = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: ed?.error?.message || `Error ${res.status}` }), {
        status: res.status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    if (!raw) return new Response(JSON.stringify({ error: 'Respuesta vacía de la IA.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

    let clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const match = clean.match(/\{[\s\S]*/);
    if (!match) return new Response(JSON.stringify({ error: 'No se encontró JSON en la respuesta.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

    let jsonStr = match[0];

    try {
      JSON.parse(jsonStr);
    } catch(e) {
      let opens = 0, openBrackets = 0;
      for (const ch of jsonStr) {
        if (ch === '{') opens++;
        else if (ch === '}') opens--;
        else if (ch === '[') openBrackets++;
        else if (ch === ']') openBrackets--;
      }
      jsonStr = jsonStr.trimEnd().replace(/,\s*$/, '');
      for (let i = 0; i < openBrackets; i++) jsonStr += ']';
      for (let i = 0; i < opens; i++) jsonStr += '}';
      try { JSON.parse(jsonStr); }
      catch(e2) {
        return new Response(JSON.stringify({ error: 'La IA devolvió una respuesta incompleta. Intentá de nuevo.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    return new Response(jsonStr, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Error interno.' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
