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
    const { rol, sector, seniority, ubicacion, tipoEmpresa, modalidad, candidateName, resumenPerfil } = body;

    if (!rol || !sector) {
      return new Response(JSON.stringify({ error: "Rol y sector son obligatorios" }), { status: 400, headers });
    }

    // ── 1. Búsqueda en tiempo real con Tavily ─────────────────────────────
    const queries = [
      `demanda laboral ${rol} ${sector} Argentina 2026`,
      `skills requeridos ${rol} ${sector} mercado laboral actual`,
      `salario ${rol} ${sector} ${ubicacion || 'Argentina'} 2026`,
      `tendencias ${sector} empleo ${tipoEmpresa || ''} 2026`,
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
    const prompt = `Sos un experto en mercado laboral y empleabilidad. Analizá la situación del mercado para el siguiente perfil y generá recomendaciones estratégicas de búsqueda.

PERFIL:
- Nombre: ${candidateName || 'Candidato'}
- Rol buscado: ${rol}
- Sector: ${sector}
- Seniority: ${seniority || 'No especificado'}
- Ubicación / modalidad: ${ubicacion || 'Argentina'} — ${modalidad || 'Presencial/Híbrido/Remoto'}
- Tipo de empresa preferida: ${tipoEmpresa || 'No especificado'}
${resumenPerfil ? `- Resumen del perfil: ${resumenPerfil}` : ''}

DATOS DEL MERCADO EN TIEMPO REAL:
${contextoMercado || 'No se encontraron datos específicos. Usá tu conocimiento del mercado laboral actual.'}

Devolvé SOLO este JSON en español rioplatense, en segunda persona:

{
  "demanda": {
    "nivel": "Alta|Media|Baja",
    "diagnostico": "cómo está la demanda para este rol y sector hoy",
    "tendencia": "creciente|estable|decreciente",
    "justificacion": "por qué está así la demanda"
  },
  "competencia": {
    "nivel": "Alta|Media|Baja",
    "diagnostico": "cuánta oferta de candidatos hay para este perfil",
    "diferenciadores": ["qué te diferencia o qué necesitás desarrollar para diferenciarte"]
  },
  "skillsRequeridos": {
    "criticos": ["skill crítico 1", "skill crítico 2"],
    "deseables": ["skill deseable 1", "skill deseable 2"],
    "emergentes": ["skill emergente 1"]
  },
  "remuneracion": {
    "rango": "rango estimado en ARS o USD según corresponda",
    "modalidad": "cómo se suele pagar en este sector",
    "nota": "aclaración sobre la variabilidad o fuente"
  },
  "canalesRecomendados": [
    {"canal": "nombre del canal", "razon": "por qué este canal es efectivo para este perfil"}
  ],
  "estrategiaRecomendada": {
    "acciones": ["acción concreta 1", "acción concreta 2", "acción concreta 3"],
    "tiempoEstimado": "estimación realista del tiempo de búsqueda",
    "alertas": ["riesgo o desafío específico para este perfil en este mercado"]
  },
  "resumenMercado": "síntesis de 3-4 oraciones sobre el panorama real para este perfil hoy"
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
              { role: "system", content: "Sos un experto en mercado laboral. Respondé SOLO con el JSON solicitado, sin texto adicional ni markdown." },
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
