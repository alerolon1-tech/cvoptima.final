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
