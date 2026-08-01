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
    const fd = await request.formData();
    const cvText = fd.get("cvText") || "";
    const idioma = fd.get("idioma") || "es";
    const situacion = fd.get("situacion") || "";

    if (!cvText || cvText.length < 30) {
      return new Response(JSON.stringify({ error: "Se necesita el texto del CV" }), { status: 400, headers });
    }

    const isEnglish = idioma === "en";
    const cvSlice = cvText.slice(0, 1500);

    const userPrompt = isEnglish
      ? "You are a senior employability expert analyzing this specific resume for a Pro-tier deep dive.\n\n" +
        "=== RESUME ===\n" + cvSlice + "\n=== END RESUME ===\n\n" +
        "CRITICAL: base every field on THIS document's real content — never generic. Respond ONLY with this JSON:\n\n{\n" +
        '  "capitalRelacional": {"score": 60, "diagnostico": "specific diagnosis about visibility of collaborative work in THIS resume — mention specific verbs and organizations from the document", "verbosRelacionales": [], "organizacionesVinculadas": [], "recomendaciones": ["specific action based on this profile, not generic"]},\n' +
        '  "diagnosticoTrayectoria": {"tipo": "Consistent|Growing|In transition|Scattered", "descripcion": "what this specific trajectory communicates today — using the real roles and companies from the resume", "patrones": ["real pattern detected in the resume"], "oportunidades": ["concrete opportunity based on this specific trajectory"], "riesgos": ["real risk detected"]},\n' +
        '  "posicionamiento": {\n' +
        '    "movilidadVertical": {"posible": true, "diagnostico": "concrete diagnosis about vertical mobility for THIS specific profile — what senior role is reachable and why, based on the real experience in the resume. NEVER mention leadership or team management unless the resume shows concrete evidence of managing people.", "acciones": ["concrete and specific action for this profile"]},\n' +
        '    "movilidadLateral": {"posible": true, "diagnostico": "concrete diagnosis about lateral mobility — which sectors or equivalent roles are accessible for THIS specific profile and why. NEVER mention leadership or team management unless the resume shows concrete evidence of managing people.", "acciones": ["concrete and specific action"]},\n' +
        '    "transicionSector": {"posible": false, "diagnostico": "concrete diagnosis about sector transition for this profile — which sectors are reachable and which are not, based on the real skills in the resume. NEVER mention leadership or team management unless the resume shows concrete evidence.", "acciones": ["concrete and specific action"]}},\n' +
        '  "recomendacionesNarrativa": [{"tipo": "headline|profile|experience|linkedin", "actual": "exact current text from the resume — copy it literally", "sugerido": "rewritten text ready to use — concrete and specific", "justificacion": "why this rewrite improves positioning for this specific profile", "impacto": "Alto|Medio", "urgencia": "Inmediata|Proximo mes"}],\n' +
        '  "moduloEmpleabilidadClaveSocial": {\n' +
        '    "lectura": "4-5 concrete sentences about this specific profile — using their real experiences, sectors and achievements",\n' +
        '    "dimensionEstructural": "market impact on this specific profile — mention the sector, real demand and specific context of this candidate",\n' +
        '    "dimensionRelacional": "networks and connections visible in THIS resume — organizations, clients, institutions explicitly mentioned",\n' +
        '    "dimensionSubjetiva": "work identity inferred from THIS specific resume — how they position themselves, what work values they communicate",\n' +
        '    "dimensionColectiva": "organizations, sectors or movements where this profile can generate collective impact — based on their real experience",\n' +
        '    "posicionamientoMercado": "positioning vs current market — specific for this profile, sector and moment in time",\n' +
        '    "tensiones": ["real and specific tension this profile faces — not generic"]}\n' +
        "}\nRespond ONLY with the JSON, no extra text, no markdown."
      : "Sos un experto senior en empleabilidad analizando este CV específico para el módulo profundo de Pro.\n\n" +
        "=== CV ===\n" + cvSlice + "\n=== FIN CV ===\n\n" +
        "CRITICO: basá cada campo en el contenido real de ESTE documento — nunca genérico. Respondé SOLO con este JSON:\n\n{\n" +
        '  "capitalRelacional": {"score": 60, "diagnostico": "diagnóstico concreto sobre visibilidad del trabajo colaborativo en este CV — mencioná verbos y organizaciones específicas del documento", "verbosRelacionales": [], "organizacionesVinculadas": [], "recomendaciones": ["acción específica basada en este perfil, no genérica"]},\n' +
        '  "diagnosticoTrayectoria": {"tipo": "Consistente|En crecimiento|En transicion|Dispersa", "descripcion": "qué comunica esta trayectoria específica hoy — usando los roles y empresas reales del CV", "patrones": ["patrón real detectado en el CV"], "oportunidades": ["oportunidad concreta basada en esta trayectoria"], "riesgos": ["riesgo real detectado"]},\n' +
        '  "posicionamiento": {\n' +
        '    "movilidadVertical": {"posible": true, "diagnostico": "diagnóstico concreto sobre movilidad vertical para ESTE perfil — qué rol superior es alcanzable y por qué, basándote en la experiencia real del CV. NUNCA menciones liderazgo o gestión de equipos salvo que el CV muestre evidencia concreta de gestión de personas.", "acciones": ["acción concreta y específica para este perfil"]},\n' +
        '    "movilidadLateral": {"posible": true, "diagnostico": "diagnóstico concreto sobre movilidad lateral — qué sectores o roles equivalentes son accesibles para ESTE perfil específico y por qué. NUNCA menciones liderazgo o gestión de equipos salvo que el CV muestre evidencia concreta de gestión de personas.", "acciones": ["acción concreta y específica"]},\n' +
        '    "transicionSector": {"posible": false, "diagnostico": "diagnóstico concreto sobre transición sectorial para este perfil — qué sectores son alcanzables y cuáles no, basándote en las habilidades reales del CV. NUNCA menciones liderazgo o gestión de equipos salvo que el CV muestre evidencia concreta.", "acciones": ["acción concreta y específica"]}},\n' +
        '  "recomendacionesNarrativa": [{"tipo": "titular|perfil|experiencia|linkedin", "actual": "texto actual exacto del CV — copialo literalmente", "sugerido": "texto reescrito listo para usar — concreto y específico", "justificacion": "por qué esta reescritura mejora el posicionamiento de este perfil", "impacto": "Alto|Medio", "urgencia": "Inmediata|Proximo mes"}],\n' +
        '  "moduloEmpleabilidadClaveSocial": {\n' +
        '    "lectura": "4-5 oraciones concretas sobre este perfil específico — usando sus experiencias, sectores y logros reales",\n' +
        '    "dimensionEstructural": "impacto del mercado en este perfil concreto — mencioná el sector, la demanda real y el contexto específico de este candidato",\n' +
        '    "dimensionRelacional": "redes y vínculos visibles en este CV — organizaciones, clientes, instituciones mencionadas explícitamente",\n' +
        '    "dimensionSubjetiva": "identidad laboral que se infiere de este CV específico — cómo se posiciona, qué valores laborales comunica",\n' +
        '    "dimensionColectiva": "organizaciones, sectores o movimientos donde este perfil puede generar impacto colectivo — basado en su experiencia real",\n' +
        '    "posicionamientoMercado": "posición frente al mercado actual — específica para este perfil, sector y momento",\n' +
        '    "tensiones": ["tensión real y específica que enfrenta este perfil — no genérica"]}\n' +
        "}\nRespondé SOLO con el JSON, sin texto extra, sin markdown.";

    const systemPrompt = isEnglish
      ? "You are a senior employability expert. Return ONLY valid JSON, no extra text, no markdown."
      : "Sos un experto senior en empleabilidad. Respondé SOLO con JSON válido, sin texto extra, sin markdown.";

    const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
    let result = null;

    for (const model of models) {
      try {
        const bodyReq = {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 2400,
        };
        if (model.startsWith("openai/gpt-oss")) bodyReq.reasoning_effort = "low";

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.GROQ_API_KEY}`,
          },
          body: JSON.stringify(bodyReq),
        });

        if (!groqRes.ok) {
          const errText = await groqRes.text();
          console.error(`Groq falló con ${model}:`, errText);
          continue;
        }
        const groqData = await groqRes.json();
        let raw = groqData.choices?.[0]?.message?.content || "";
        raw = raw.replace(/```json|```/g, "").trim();

        try {
          result = JSON.parse(raw);
        } catch {
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try { result = JSON.parse(jsonMatch[0]); } catch { continue; }
          } else continue;
        }
        break;
      } catch (e) {
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
    }

    if (!result) throw new Error("No se pudieron generar los módulos Pro por ahora — probá de nuevo en un minuto.");

    return new Response(JSON.stringify({ ok: true, ...result }), { headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
