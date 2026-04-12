export async function onRequestPost(context) {
  const GROQ_KEY = context.env.GROQ_API_KEY;

  if (!GROQ_KEY) {
    return new Response(
      JSON.stringify({ error: 'API key no configurada. Agregá GROQ_API_KEY en Cloudflare Pages → Settings → Environment Variables.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Body inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { cvText, role, sector, seniority } = body;
  if (!cvText || cvText.length < 80) {
    return new Response(JSON.stringify({ error: 'CV demasiado corto para analizar.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const prompt = `Sos un experto en reclutamiento, ATS y empleabilidad con enfoque en diagnóstico profesional de CVs.
Tu tarea es analizar el CV en profundidad y generar un diagnóstico completo.
NO reescribas el CV. Solo diagnosticás, identificás oportunidades y dás recomendaciones concretas.

Analizá el siguiente CV${role ? ' orientado al rol de ' + role : ''}${sector ? ' en el sector ' + sector : ''}${seniority ? ', nivel ' + seniority : ''}.

Devolvé ÚNICAMENTE un JSON válido con esta estructura exacta. Sin texto extra, sin backticks:

{
  "candidateName": "nombre completo detectado o 'Candidato'",
  "email": "email detectado o ''",
  "currentRole": "título o rol actual detectado o ''",
  "yearsExperience": número estimado de años de experiencia total,
  "seniority": "Junior / Semi-Senior / Senior / Lead / Executive",
  "areasProfesionales": ["área 1", "área 2", "área 3"],

  "atsScore": número 0-100 — Score de Empleabilidad general del CV (no solo ATS, sino empleabilidad integral),
  "atsDetalle": {
    "keywords": número 0-100 (palabras clave del sector y rol),
    "verbosAccion": número 0-100 (uso de verbos de acción e impacto),
    "metricas": número 0-100 (presencia de métricas y resultados medibles),
    "estructura": número 0-100 (organización y compatibilidad con lectura automática),
    "densidadHabilidades": número 0-100 (cantidad y relevancia de competencias),
    "claridadRoles": número 0-100 (claridad de funciones y responsabilidades por puesto)
  },

  "impactDensityScore": número 0-100,
  "impactDensityLabel": "Bajo / Medio / Alto",
  "impactDensityDiagnostico": "1-2 oraciones interpretando el resultado",

  "seccionesDetectadas": {
    "perfilProfesional": true o false,
    "experienciaLaboral": true o false,
    "educacion": true o false,
    "habilidades": true o false,
    "logros": true o false,
    "herramientas": true o false,
    "idiomas": true o false
  },
  "seccionesFaltantes": ["sección faltante 1", "sección faltante 2"],

  "analisisLogros": {
    "logrosFuertes": [
      {"frase": "frase exacta del CV", "motivo": "por qué es un logro fuerte"}
    ],
    "logrosDebiles": [
      {"frase": "frase exacta del CV", "motivo": "por qué es débil", "sugerencia": "cómo fortalecerlo sin reescribir"}
    ],
    "responsabilidadesSinImpacto": [
      {"frase": "frase exacta del CV", "oportunidad": "cómo podría convertirse en logro"}
    ]
  },

  "verbosImpacto": {
    "detectados": ["verbo1", "verbo2"],
    "debiles": [
      {"verbo": "verbo débil", "contexto": "frase donde aparece", "alternativas": ["verbo1", "verbo2"]}
    ]
  },

  "narrativaProfesional": {
    "tipo": "consistente / dispersa / en transición / en crecimiento",
    "descripcion": "2-3 oraciones describiendo la trayectoria laboral observada",
    "progresion": "descripción de si hay crecimiento visible en responsabilidades",
    "oportunidades": ["oportunidad narrativa 1", "oportunidad 2"]
  },

  "mapaHabilidades": {
    "declaradas": ["habilidad declarada 1", "habilidad 2"],
    "detectadas": ["habilidad inferida del texto 1", "habilidad 2"],
    "aIncorporar": ["habilidad que podría agregarse explícitamente 1", "habilidad 2"]
  },

  "rolesObjetivo": [
    {
      "titulo": "Título del rol",
      "seniority": "nivel",
      "matchPct": 0-100,
      "justificacion": "por qué encaja con este perfil, 2 oraciones",
      "skills": ["skill1", "skill2", "skill3"]
    }
  ],

  "fortalezas": [
    {"titulo": "título corto", "detalle": "explicación concreta 1-2 oraciones"}
  ],

  "debilidades": [
    {"titulo": "título corto", "detalle": "explicación concreta", "accion": "qué hacer exactamente"}
  ],

  "alertas": [
    {"tipo": "error/warning/info", "mensaje": "descripción concreta del problema detectado"}
  ],

  "recomendaciones": [
    {
      "prioridad": "Alta/Media/Baja",
      "categoria": "Logros / Estructura / Keywords / Narrativa / Habilidades",
      "titulo": "qué hacer",
      "detalle": "cómo hacerlo exactamente, concreto y accionable",
      "impactoScore": "+X puntos"
    }
  ],

  "scorePotencial": 0-100,
  "resumenEjecutivo": "3-4 oraciones que resumen el perfil real, su potencial y las principales oportunidades de mejora. Tono profesional y respetuoso."
}

CV a analizar:
${cvText.substring(0, 14000)}`;

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
          { role: 'system', content: 'Sos un experto en diagnóstico de CVs, ATS y empleabilidad. Analizás con profundidad real. NO reescribís CVs. Solo diagnosticás. Respondés SIEMPRE con JSON válido y nada más.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 6000
      })
    });

    if (!res.ok) {
      const ed = await res.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: ed?.error?.message || `Error ${res.status}` }),
        { status: res.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    if (!raw) return new Response(JSON.stringify({ error: 'Respuesta vacía de la IA.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return new Response(JSON.stringify({ error: 'No se pudo parsear la respuesta.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

    return new Response(match[0], {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Error interno.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
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
