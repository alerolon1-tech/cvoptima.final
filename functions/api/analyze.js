export async function onRequestPost(context) {
  const { request, env } = context;

  const GROQ_KEY = env.GROQ_API_KEY;
  const SUPABASE_URL = env.SUPABASE_URL || 'https://hpzekeqqvfsxjwiiztoh.supabase.co';
  const SUPABASE_KEY = env.SUPABASE_ANON_KEY;

  if (!GROQ_KEY) {
    return new Response(JSON.stringify({ error: 'API key no configurada.' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Body inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { cvText, role, sector, seniority, userId } = body;
  if (!cvText || cvText.length < 80) {
    return new Response(JSON.stringify({ error: 'CV demasiado corto para analizar.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const prompt = `Sos un experto en empleabilidad y desarrollo profesional con enfoque en "Empleabilidad en Clave Social": el CV no es solo un documento técnico sino la forma en que una trayectoria profesional se vuelve visible en un mercado laboral en transformación.

Analizá el siguiente CV${role ? ' para el rol de ' + role : ''}${sector ? ' en el sector ' + sector : ''}${seniority ? ' nivel ' + seniority : ''}.

El Score de Empleabilidad es el indicador principal integrador. No es un puntaje ATS puro: refleja la calidad general del CV como documento de empleabilidad considerando cuatro dimensiones simultáneas:
- Compatibilidad técnica con sistemas de selección automática
- Impacto narrativo: logros cuantificables vs. mera descripción de tareas
- Claridad profesional: coherencia, foco y legibilidad de la trayectoria
- Calidad documental: estructura, secciones y presentación del perfil

Devolvé ÚNICAMENTE un JSON válido, completo y bien cerrado. Sin texto antes ni después. Sin backticks. Sin comentarios.
Sé conciso en todos los campos de texto para no cortar la respuesta.

{
  "candidateName": "nombre completo o Candidato",
  "email": "email detectado o vacio",
  "currentRole": "rol actual detectado o vacio",
  "yearsExperience": numero estimado,
  "seniority": "Junior o Semi-Senior o Senior o Lead o Executive",

  "atsScore": numero 0-100 (Score de Empleabilidad integral: compatibilidad tecnica + impacto narrativo + claridad profesional + calidad documental),
  "scorePotencial": numero 0-100 siempre mayor que atsScore (nivel alcanzable con las mejoras sugeridas),
  "impactDensityScore": numero 0-100 (proporcion de logros cuantificables vs tareas descritas),
  "impactDensityLabel": "Bajo o Medio o Alto",
  "impactDensityDiagnostico": "1 oracion explicando el nivel de impact density",

  "resumenEjecutivo": "3 oraciones que resumen el perfil y camino de mejora",

  "atsDetalle": {
    "keywords": numero 0-100 (keywords del sector presentes en el CV),
    "verbosAccion": numero 0-100 (uso de verbos de accion e impacto),
    "metricas": numero 0-100 (presencia de metricas y resultados cuantificables),
    "estructura": numero 0-100 (estructura y calidad documental),
    "densidadHabilidades": numero 0-100 (densidad y relevancia de habilidades declaradas),
    "claridadRoles": numero 0-100 (claridad y coherencia de roles y trayectoria)
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

  "alertas": [{"tipo": "error", "mensaje": "descripcion concreta"}],

  "analisisLogros": {
    "logrosFuertes": [{"frase": "frase del CV", "motivo": "por que es un logro fuerte"}],
    "logrosDebiles": [{"frase": "frase del CV", "motivo": "por que es debil", "sugerencia": "como mejorarlo"}],
    "responsabilidadesSinImpacto": [{"frase": "frase del CV", "oportunidad": "como convertirla en logro"}]
  },

  "verbosImpacto": {
    "detectados": ["verbo1", "verbo2"],
    "debiles": [{"verbo": "verbo debil", "contexto": "frase donde aparece", "alternativas": ["alternativa1", "alternativa2"]}]
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

  "rolesObjetivo": [{"titulo": "Titulo del rol", "seniority": "nivel", "matchPct": 80, "justificacion": "2 oraciones", "skills": ["skill1", "skill2", "skill3"]}],

  "fortalezas": [{"titulo": "titulo corto", "detalle": "1-2 oraciones"}],

  "debilidades": [{"titulo": "titulo corto", "detalle": "1-2 oraciones", "accion": "que hacer"}],

  "recomendaciones": [{"prioridad": "Alta", "categoria": "categoria", "titulo": "que hacer", "detalle": "como hacerlo", "impactoScore": "+5 puntos"}]
}

CV a analizar:
${cvText.substring(0, 8000)}`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Sos un experto en empleabilidad y desarrollo profesional. El Score de Empleabilidad es un indicador integral que considera compatibilidad técnica, impacto narrativo, claridad profesional y calidad documental. Respondés SIEMPRE con JSON válido, completo y bien cerrado. Nunca agregues texto fuera del JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 4000
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
    try { JSON.parse(jsonStr); }
    catch(e) {
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

    if (userId && SUPABASE_URL && SUPABASE_KEY) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/diagnosticos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            user_id: userId,
            cv_text: cvText.substring(0, 5000),
            resultado: JSON.parse(jsonStr),
            puesto_objetivo: role || '',
            sector: sector || ''
          })
        });
      } catch(dbErr) {
        console.error('Error guardando en Supabase:', dbErr);
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
