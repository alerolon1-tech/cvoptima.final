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

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const body = await request.json();
    const { rol, sector, seniority, ubicacion, tipoEmpresa, modalidad, candidateName, resumenPerfil, cvText } = body;

    if (!rol || !sector) {
      return new Response(JSON.stringify({ error: "Rol y sector son obligatorios" }), { status: 400, headers });
    }

    // ── Clasificar el perfil para determinar el segmento de mercado ──────────
    // Esto determina qué canales son válidos y cuáles no
    const perfilTexto = (resumenPerfil || '') + ' ' + (cvText || '');
    const esPerfilAcademico = /doctorado|phd|investigaci|universidad|antropolog|sociolog|ciencias sociales|academia/i.test(perfilTexto);
    const esPerfilConsultor = /consultor|consultora|partner|socio|research|inteligencia|estrategia/i.test(perfilTexto);
    const esPerfilCorporativo = /gerente|manager|director|jefe de|rrhh|recursos humanos/i.test(perfilTexto);
    const segmento = esPerfilAcademico && esPerfilConsultor ? 'académico-consultor' : esPerfilCorporativo ? 'corporativo' : 'consultor';

    // Canales NO apropiados para perfiles académico-consultores
    const canalesInapropiados = ['computrabajo', 'bumeran', 'zonajobs', 'indeed'];

    // ── Búsquedas estratificadas con Tavily ──────────────────────────────────
    // Cada búsqueda apunta a un tipo de información distinto
    const queries = [
      // 1. Demanda real y proyectos activos
      `"investigación social" OR "ciencias sociales" OR "social research" Argentina consultoras proyectos 2025 2026`,
      // 2. Organizaciones que contratan este perfil específico
      `"investigación aplicada" OR "análisis social" OR "market research" Argentina organizaciones contratan 2026`,
      // 3. Remuneración y condiciones en el segmento real
      `consultor investigación social Argentina honorarios tarifas sueldo 2025 2026`,
      // 4. Tendencias del sector específico
      `"inteligencia territorial" OR "estudios socioterritoriales" OR "investigación cualitativa corporativa" Argentina tendencias`,
    ];

    const tavilyResults = await Promise.all(
      queries.map(q =>
        fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: env.TAVILY_API_KEY,
            query: q,
            search_depth: "advanced",
            max_results: 4,
            include_answer: true,
            include_domains: ["linkedin.com", "infobae.com", "lanacion.com.ar", "cronista.com", "ambito.com", "clarin.com", "conicet.gov.ar", "unsam.edu.ar"],
          }),
        }).then(r => r.json()).catch(() => ({ results: [], answer: "" }))
      )
    );

    // Consolidar resultados preservando URLs y fuentes
    const contextoMercado = tavilyResults
      .map((res, i) => {
        const answer = res.answer ? `Respuesta directa: ${res.answer}` : "";
        const snippets = (res.results || []).slice(0, 3).map(r =>
          `[${r.title || 'Sin título'}] (${r.url || 'sin URL'}): ${(r.content || '').slice(0, 300)}`
        ).join("\n");
        return `=== BÚSQUEDA ${i+1}: ${queries[i]} ===\n${answer}\n${snippets}`;
      })
      .join("\n\n")
      .slice(0, 8000);

    // ── Construir contexto del candidato estructurado ────────────────────────
    const contextoCandidato = `
PERFIL DETALLADO DEL CANDIDATO:
- Nombre: ${candidateName || 'Candidato'}
- Rol buscado: ${rol}
- Sector: ${sector}
- Seniority: ${seniority || 'Senior'}
- Ubicación / modalidad: ${ubicacion || 'Buenos Aires, Argentina'} — ${modalidad || 'no especificado'}
- Tipo de empresa preferida: ${tipoEmpresa || 'no especificado'}
- Segmento de mercado detectado: ${segmento}
${resumenPerfil ? `- Resumen del perfil: ${resumenPerfil}` : ''}
${cvText ? `- Extracto del CV (primeros 2000 caracteres): ${cvText.slice(0, 2000)}` : ''}

RESTRICCIÓN CRÍTICA DE CANALES:
Este perfil es de segmento ${segmento}. Los siguientes canales NO son apropiados para este perfil y no deben mencionarse bajo ninguna circunstancia: ${canalesInapropiados.join(', ')}.
Los canales apropiados para este segmento son: LinkedIn (búsqueda activa y networking), redes académicas y profesionales especializadas, postulación directa a consultoras, organismos internacionales (BID, CEPAL, OIT, PNUD, Banco Mundial), fundaciones, think tanks, universidades, y referidos profesionales.`.trim();

    // ── Prompt con razonamiento en dos pasos ─────────────────────────────────
    const prompt = `${contextoCandidato}

DATOS DEL MERCADO (resultado de búsquedas en tiempo real):
${contextoMercado || 'Las búsquedas no arrojaron resultados específicos. Trabajá con conocimiento del mercado argentino actual.'}

INSTRUCCIONES DE ANÁLISIS — SEGUILAS EN ORDEN:

PASO 1 — ANÁLISIS DEL PERFIL:
Antes de responder, analizá internamente:
- ¿En qué segmento exacto del mercado laboral argentino opera este candidato?
- ¿Qué organizaciones en Argentina realmente contratan este perfil (no genéricas — específicas)?
- ¿Cuáles son los canales reales por donde circulan estas oportunidades?
- ¿Qué información de los resultados de búsqueda es relevante y cuál es ruido?

PASO 2 — GENERACIÓN DEL ANÁLISIS:
Con ese análisis en mente, generá el JSON. Cada campo debe pasar este test: "¿Esto aplica específicamente a este candidato o podría aplicar a cualquier persona?"
Si la respuesta es "cualquier persona", reescribilo hasta que sea específico.

REGLAS NO NEGOCIABLES:
1. CANALES: Solo canales apropiados para este segmento. ${canalesInapropiados.map(c => `"${c}"`).join(', ')} están PROHIBIDOS.
2. EMPRESAS: Solo organizaciones que genuinamente contratan este tipo de perfil en Argentina. Verificá que el tipo de organización sea coherente con el seniority y la especialización del candidato. Si no estás seguro, indicalo.
3. ALERTAS: Solo riesgos reales y específicos para este perfil — no genéricos como "la competencia puede ser alta".
4. FUENTES: Cuando uses datos de las búsquedas, indicá la URL o fuente. Cuando sea estimación propia, aclaralo.
5. HONESTIDAD: Si no tenés datos verificables para un campo, decilo explícitamente en lugar de inventar.

Respondé SOLO con este JSON en español rioplatense, en segunda persona:

{
  "demanda": {
    "nivel": "Alta|Media|Baja",
    "diagnostico": "situación real de la demanda para este perfil específico hoy — qué tipo de organizaciones contratan y con qué frecuencia",
    "tendencia": "creciente|estable|decreciente|sin datos suficientes",
    "justificacion": "por qué la demanda está así — con fuente o aclaración de estimación"
  },
  "competencia": {
    "nivel": "Alta|Media|Baja",
    "diagnostico": "descripción del mercado de candidatos para este perfil — quiénes compiten con este candidato",
    "diferenciadores": ["diferenciador genuino y específico de este candidato frente a otros perfiles similares"]
  },
  "skillsRequeridos": {
    "criticos": ["skill técnico o metodológico concreto que busca el mercado para este rol exacto"],
    "deseables": ["skill deseable concreto para este sector y seniority"],
    "emergentes": ["skill emergente con evidencia de demanda creciente en este campo"]
  },
  "remuneracion": {
    "rango": "rango en ARS o USD por proyecto/mes/año según la modalidad del sector — o 'Sin datos verificables disponibles'",
    "modalidad": "cómo se estructura la remuneración en este segmento (honorarios por proyecto, fee mensual, relación de dependencia, etc.)",
    "nota": "fuente del dato o limitaciones de la estimación"
  },
  "canalesRecomendados": [
    {
      "canal": "nombre específico del canal — solo canales apropiados para este segmento",
      "razon": "por qué este canal específicamente para este perfil — no genérico"
    }
  ],
  "empresasOrganizaciones": [
    {
      "nombre": "nombre real de organización en Argentina que genuinamente contrata este tipo de perfil",
      "tipo": "consultora|organismo internacional|ONG|empresa|universidad|think tank",
      "por_que": "por qué este candidato específico encaja — vinculado a su experiencia real",
      "como_aplicar": "canal específico: LinkedIn directo, web de la organización, referido, etc."
    }
  ],
  "rutasPosibles": [
    {
      "ruta": "nombre de la ruta laboral",
      "descripcion": "descripción concreta de cómo este perfil puede desarrollarse en esta dirección",
      "organizaciones_tipo": "tipo de organizaciones donde se da esta ruta",
      "tiempo_estimado": "estimación realista",
      "acciones": ["acción concreta y específica"]
    }
  ],
  "estrategiaRecomendada": {
    "acciones": ["acción concreta, específica y accionable — no genérica"],
    "tiempoEstimado": "estimación realista para este perfil en este mercado",
    "alertas": ["riesgo real y específico para este perfil — no genérico"]
  },
  "resumenMercado": "síntesis de 4-5 oraciones sobre el panorama real para este perfil hoy — honesta sobre qué es verificable y qué es estimación, orientada a rutas concretas"
}`;

    const models = [
      "llama-3.3-70b-versatile",
      "llama-3.1-70b-versatile",
      "llama3-70b-8192",
      "llama3-8b-8192",
    ];

    let result = null;
    for (const model of models) {
      try {
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content: `Sos un consultor senior de empleabilidad especializado en el mercado laboral argentino para perfiles altamente calificados — investigadores, consultores, académicos, y profesionales con formación de posgrado. Tu análisis debe ser de nivel profesional: específico, honesto sobre la incertidumbre, y orientado a rutas concretas. Nunca usés frases genéricas. Nunca recomendés canales masivos de empleo (Computrabajo, Bumeran, ZonaJobs, Indeed) para perfiles de este segmento. Respondé SOLO con el JSON solicitado, sin texto adicional ni markdown.`
              },
              { role: "user", content: prompt },
            ],
            temperature: 0.2,
            max_tokens: 3500,
          }),
        });

        if (!groqRes.ok) continue;
        const groqData = await groqRes.json();
        const raw = groqData.choices?.[0]?.message?.content || "";
        const clean = raw.replace(/```json|```/g, "").trim();
        result = JSON.parse(clean);

        // ── Post-procesamiento: filtrar canales y organizaciones inapropiadas ──
        if (result.canalesRecomendados) {
          result.canalesRecomendados = result.canalesRecomendados.filter(c =>
            !canalesInapropiados.some(ci => (c.canal || '').toLowerCase().includes(ci))
          );
        }
        if (result.empresasOrganizaciones) {
          result.empresasOrganizaciones = result.empresasOrganizaciones.filter(o => {
            const nombre = (o.nombre || '').toLowerCase();
            // Filtrar si el nombre sugiere un puesto corporativo genérico o una empresa de staffing masivo
            return !['staffing', 'talento', 'reclutamiento masivo', 'bpo'].some(t => nombre.includes(t));
          });
        }

        break;
      } catch (e) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
    }

    if (!result) throw new Error("No se pudo generar el análisis del mercado");

    return new Response(JSON.stringify({ ok: true, analisis: result }), { headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
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

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const body = await request.json();
    const { rol, sector, seniority, ubicacion, tipoEmpresa, modalidad, candidateName, resumenPerfil } = body;

    if (!rol || !sector) {
      return new Response(JSON.stringify({ error: "Rol y sector son obligatorios" }), { status: 400, headers });
    }

    // ── 1. Búsqueda en tiempo real con Tavily ─────────────────────────────
    const queries = [
      `"${rol}" "${sector}" Argentina empleo demanda 2026`,
      `"${rol}" OR "${sector}" consultoras empresas contratan Argentina 2026`,
      `salario sueldo "${rol}" "${sector}" Argentina 2025 2026`,
      `"${sector}" Argentina tendencias mercado laboral oportunidades 2026`,
    ];

    const tavilyResults = await Promise.all(
      queries.map(q =>
        fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: env.TAVILY_API_KEY,
            query: q,
            search_depth: "basic",
            max_results: 3,
            include_answer: true,
          }),
        }).then(r => r.json()).catch(() => ({ results: [], answer: "" }))
      )
    );

    // Consolidar resultados de Tavily
    const contextoMercado = tavilyResults
      .map((res, i) => {
        const answer = res.answer || "";
        const snippets = (res.results || []).slice(0, 2).map(r => r.content || "").join(" ");
        return `[Búsqueda: ${queries[i]}]\n${answer}\n${snippets}`;
      })
      .join("\n\n---\n\n")
      .slice(0, 6000); // Limitar contexto

    // ── 2. Generar análisis con el modelo ─────────────────────────────────
    const prompt = `Sos un experto en mercado laboral con conocimiento profundo del mercado argentino. Analizá la situación real del mercado para el siguiente perfil y generá recomendaciones estratégicas concretas y verificables.

PERFIL:
- Nombre: ${candidateName || 'Candidato'}
- Rol buscado: ${rol}
- Sector: ${sector}
- Seniority: ${seniority || 'No especificado'}
- Ubicación / modalidad: ${ubicacion || 'Argentina'} — ${modalidad || 'Presencial/Híbrido/Remoto'}
- Tipo de empresa preferida: ${tipoEmpresa || 'No especificado'}
${resumenPerfil ? `- Resumen del perfil: ${resumenPerfil}` : ''}

DATOS DEL MERCADO EN TIEMPO REAL:
${contextoMercado || 'No se encontraron datos específicos de fuentes externas.'}

REGLAS CRÍTICAS — INCUMPLIRLAS INVALIDA EL ANÁLISIS:
1. ESPECIFICIDAD OBLIGATORIA: Cada campo debe ser específico para este perfil exacto. Prohibido usar frases genéricas como "el mercado es competitivo", "debes desarrollar habilidades en liderazgo", "hay oportunidades para destacarse". Si no tenés datos específicos, decilo explícitamente.
2. FUENTES: En cada campo donde uses datos de las búsquedas, indicá la fuente entre paréntesis — por ejemplo "(Fuente: LinkedIn Jobs Argentina, junio 2026)" o "(Fuente: estimación basada en mercado regional)". Si es conocimiento propio, escribí "(Estimación del modelo, verificar con fuentes actuales)".
3. EMPRESAS CONCRETAS: En canalesRecomendados y estrategiaRecomendada, nombrá empresas, consultoras, organizaciones o plataformas específicas donde este perfil puede aplicar. No uses nombres genéricos.
4. REMUNERACIÓN: Si no tenés datos concretos de remuneración para este rol en Argentina, escribilo explícitamente en el campo "nota". No inventes rangos.
5. SKILLS: Los skills críticos deben ser los que realmente busca el mercado para este rol específico — no skills genéricos de "comunicación" o "trabajo en equipo".
6. TENDENCIA: Solo escribí "creciente", "estable" o "decreciente" si podés justificarlo con datos de las búsquedas. Si no, escribí "sin datos suficientes".

Devolvé SOLO este JSON en español rioplatense, en segunda persona:

{
  "demanda": {
    "nivel": "Alta|Media|Baja",
    "diagnostico": "situación real de demanda para este rol y sector específico hoy — con datos concretos o aclaración de incertidumbre",
    "tendencia": "creciente|estable|decreciente|sin datos suficientes",
    "justificacion": "por qué está así la demanda — con fuente o estimación explícita"
  },
  "competencia": {
    "nivel": "Alta|Media|Baja",
    "diagnostico": "cuánta oferta de candidatos hay para este perfil específico",
    "diferenciadores": ["diferenciador concreto y específico para este perfil"]
  },
  "skillsRequeridos": {
    "criticos": ["skill técnico o metodológico real que busca el mercado para este rol"],
    "deseables": ["skill deseable concreto para este sector"],
    "emergentes": ["skill emergente con evidencia de demanda creciente"]
  },
  "remuneracion": {
    "rango": "rango estimado en ARS o USD — o 'Sin datos confiables disponibles' si no tenés información verificable",
    "modalidad": "cómo se suele pagar en este sector",
    "nota": "aclaración sobre la fuente, variabilidad o limitaciones del dato"
  },
  "canalesRecomendados": [
    {"canal": "nombre específico del canal, empresa o plataforma", "razon": "por qué este canal es efectivo para este perfil concreto"}
  ],
  "empresasOrganizaciones": [
    {"nombre": "nombre real de empresa, consultora u organización en Argentina", "por_que": "por qué este perfil encaja con esta organización", "como_aplicar": "LinkedIn, web, referido, etc."}
  ],
  "estrategiaRecomendada": {
    "acciones": ["acción concreta, específica y verificable para este perfil"],
    "tiempoEstimado": "estimación realista del tiempo de búsqueda para este perfil en este mercado",
    "alertas": ["riesgo o desafío específico y real para este perfil en este mercado"]
  },
  "resumenMercado": "síntesis de 3-4 oraciones sobre el panorama real para este perfil hoy — con honestidad sobre qué es verificable y qué es estimación"
}`;

    // Llamar a Groq
    const models = [
      "llama-3.3-70b-versatile",
      "llama-3.1-70b-versatile",
      "llama3-70b-8192",
      "llama3-8b-8192",
    ];

    let result = null;
    for (const model of models) {
      try {
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: "Sos un experto en mercado laboral argentino. Respondé SOLO con el JSON solicitado, sin texto adicional ni markdown. Sé específico, honesto sobre la incertidumbre, y citá fuentes cuando uses datos externos. Nunca uses frases genéricas ni inventes datos." },
              { role: "user", content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 2000,
          }),
        });

        if (!groqRes.ok) continue;
        const groqData = await groqRes.json();
        const raw = groqData.choices?.[0]?.message?.content || "";
        const clean = raw.replace(/```json|```/g, "").trim();
        result = JSON.parse(clean);
        break;
      } catch (e) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
    }

    if (!result) throw new Error("No se pudo generar el análisis del mercado");

    return new Response(JSON.stringify({ ok: true, analisis: result }), { headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
