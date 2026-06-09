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
    const perfilTexto = (resumenPerfil || '') + ' ' + (cvText || '');
    const esPerfilAcademico = /doctorado|phd|investigaci|universidad|antropolog|sociolog|ciencias sociales|academia/i.test(perfilTexto);
    const esPerfilConsultor = /consultor|consultora|partner|socio|research|inteligencia|estrategia/i.test(perfilTexto);
    const esPerfilCorporativo = /gerente|manager|director|jefe de|rrhh|recursos humanos/i.test(perfilTexto);
    const segmento = esPerfilAcademico && esPerfilConsultor
      ? 'académico-consultor'
      : esPerfilCorporativo ? 'corporativo' : 'consultor';

    // Canales NO apropiados para perfiles académico-consultores
    const canalesInapropiados = ['computrabajo', 'bumeran', 'zonajobs', 'indeed'];

    // ── Búsquedas estratificadas con Tavily ──────────────────────────────────
    const queries = [
      `"investigación social" OR "ciencias sociales" OR "social research" Argentina consultoras proyectos 2025 2026`,
      `"investigación aplicada" OR "análisis social" OR "market research" Argentina organizaciones contratan 2026`,
      `consultor investigación social Argentina honorarios tarifas sueldo 2025 2026`,
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
    const contextoCandidato = [
      `PERFIL DETALLADO DEL CANDIDATO:`,
      `- Nombre: ${candidateName || 'Candidato'}`,
      `- Rol buscado: ${rol}`,
      `- Sector: ${sector}`,
      `- Seniority: ${seniority || 'Senior'}`,
      `- Ubicación / modalidad: ${ubicacion || 'Buenos Aires, Argentina'} — ${modalidad || 'no especificado'}`,
      `- Tipo de empresa preferida: ${tipoEmpresa || 'no especificado'}`,
      `- Segmento de mercado detectado: ${segmento}`,
      resumenPerfil ? `- Resumen del perfil: ${resumenPerfil}` : '',
      cvText ? `- Extracto del CV: ${cvText.slice(0, 2000)}` : '',
      ``,
      `RESTRICCIÓN CRÍTICA DE CANALES:`,
      `Este perfil es de segmento ${segmento}. Los siguientes canales NO son apropiados y no deben mencionarse: ${canalesInapropiados.join(', ')}.`,
      `Los canales apropiados para este segmento son: LinkedIn (búsqueda activa y networking), redes académicas y profesionales especializadas, postulación directa a consultoras, organismos internacionales (BID, CEPAL, OIT, PNUD, Banco Mundial), fundaciones, think tanks, universidades, y referidos profesionales.`,
    ].filter(Boolean).join('\n');

    // ── Prompt con razonamiento estructurado ─────────────────────────────────
    const prompt = `${contextoCandidato}

DATOS DEL MERCADO (búsquedas en tiempo real):
${contextoMercado || 'Las búsquedas no arrojaron resultados específicos. Trabajá con conocimiento del mercado argentino actual.'}

INSTRUCCIONES:

PASO 1 — Antes de escribir el JSON, analizá internamente:
- ¿En qué segmento exacto del mercado laboral argentino opera este candidato?
- ¿Qué organizaciones en Argentina realmente contratan este perfil (específicas, no genéricas)?
- ¿Cuáles son los canales reales por donde circulan estas oportunidades?
- ¿Qué información de los resultados de búsqueda es relevante y cuál es ruido?

PASO 2 — Generá el JSON. Cada campo debe pasar este test: "¿Esto aplica específicamente a este candidato o podría aplicar a cualquier persona?" Si aplica a cualquier persona, reescribilo.

REGLAS NO NEGOCIABLES:
1. CANALES: Solo canales apropiados para este segmento. ${canalesInapropiados.map(c => '"' + c + '"').join(', ')} están PROHIBIDOS.
2. EMPRESAS: Solo organizaciones que genuinamente contratan este tipo de perfil. Verificá que el puesto/rol de esa organización sea coherente con la especialización del candidato. Si no estás seguro, aclaralo.
3. ALERTAS: Solo riesgos reales y específicos — no genéricos como "la competencia puede ser alta".
4. FUENTES: Cuando uses datos de las búsquedas, indicá la URL o fuente. Cuando sea estimación propia, aclaralo.
5. HONESTIDAD: Si no tenés datos verificables, decilo explícitamente.

Respondé SOLO con este JSON en español rioplatense, en segunda persona:

{
  "demanda": {
    "nivel": "Alta|Media|Baja",
    "diagnostico": "situación real de la demanda para este perfil específico — qué tipo de organizaciones contratan y con qué frecuencia",
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
    "rango": "rango en ARS o USD según la modalidad del sector — o 'Sin datos verificables disponibles'",
    "modalidad": "cómo se estructura la remuneración en este segmento",
    "nota": "fuente del dato o limitaciones de la estimación"
  },
  "canalesRecomendados": [
    {
      "canal": "nombre específico del canal — solo canales apropiados para este segmento",
      "razon": "por qué este canal específicamente para este perfil"
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

    // ── Llamar a Groq ─────────────────────────────────────────────────────────
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
                content: "Sos un consultor senior de empleabilidad especializado en el mercado laboral argentino para perfiles altamente calificados — investigadores, consultores, académicos, y profesionales con formación de posgrado. Tu análisis debe ser de nivel profesional: específico, honesto sobre la incertidumbre, y orientado a rutas concretas. Nunca usés frases genéricas. Nunca recomendés canales masivos de empleo (Computrabajo, Bumeran, ZonaJobs, Indeed) para perfiles de este segmento. Respondé SOLO con el JSON solicitado, sin texto adicional ni markdown.",
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
            return !['staffing', 'bpo', 'reclutamiento masivo'].some(t => nombre.includes(t));
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
