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
    const liText = fd.get("liText") || "";
    const idioma = fd.get("idioma") || "es";

    if (!liText || liText.length < 30) {
      return new Response(JSON.stringify({ error: "Se necesita el texto del perfil de LinkedIn" }), { status: 400, headers });
    }

    const isEnglish = idioma === "en";
    const liSlice = liText.slice(0, 2500);

    const userPrompt = isEnglish
      ? "You are a senior LinkedIn profile strategist. Rewrite and optimize this specific LinkedIn profile — every suggestion must be based on THIS document's real content, never generic filler.\n\n" +
        "=== LINKEDIN PROFILE ===\n" + liSlice + "\n=== END PROFILE ===\n\n" +
        "CRITICAL: base every rewrite on the real roles, achievements and sector visible in THIS profile. Never invent experience that isn't there. Respond ONLY with this JSON:\n\n{\n" +
        '  "titulares_sugeridos": ["headline option 1: role + value + keywords, ready to paste", "option 2, different angle", "option 3", "option 4"],\n' +
        '  "acerca_de_actual_diagnostico": "1-2 sentences on what the current About section communicates and what it lacks",\n' +
        '  "acerca_de_reescrito": "full rewritten About section, ready to paste — first person, concrete, based on real achievements and roles from this profile, 3-4 short paragraphs",\n' +
        '  "destacados_sugeridos": [{"titulo": "what to feature", "razon": "why this strengthens the profile, based on their real experience"}],\n' +
        '  "banner_sugerencia": "concrete guidance for the header banner image, specific to this person\'s sector and positioning",\n' +
        '  "mejoras_rapidas": [{"donde": "section name", "texto_actual": "short quote of what it says now, or empty if missing", "texto_sugerido": "exact ready-to-paste replacement text"}]\n' +
        "}\nRespond ONLY with the JSON, no extra text, no markdown."
      : "Sos un/a estratega senior de perfiles de LinkedIn. Reescribí y optimizá este perfil específico — cada sugerencia tiene que basarse en el contenido real de ESTE documento, nunca genérica.\n\n" +
        "=== PERFIL DE LINKEDIN ===\n" + liSlice + "\n=== FIN PERFIL ===\n\n" +
        "CRITICO: basá cada reescritura en los roles, logros y sector reales visibles en ESTE perfil. Nunca inventes experiencia que no está. Respondé SOLO con este JSON:\n\n{\n" +
        '  "titulares_sugeridos": ["opción de titular 1: rol + valor + keywords, lista para pegar", "opción 2, ángulo distinto", "opción 3", "opción 4"],\n' +
        '  "acerca_de_actual_diagnostico": "1-2 oraciones sobre qué comunica hoy el Acerca de y qué le falta",\n' +
        '  "acerca_de_reescrito": "Acerca de reescrito completo, listo para pegar — primera persona, concreto, basado en logros y roles reales de este perfil, 3-4 párrafos cortos",\n' +
        '  "destacados_sugeridos": [{"titulo": "qué destacar", "razon": "por qué esto fortalece el perfil, basado en su experiencia real"}],\n' +
        '  "banner_sugerencia": "sugerencia concreta para la imagen de portada, específica al sector y posicionamiento de esta persona",\n' +
        '  "mejoras_rapidas": [{"donde": "nombre de la sección", "texto_actual": "cita corta de lo que dice hoy, o vacío si falta", "texto_sugerido": "texto de reemplazo exacto, listo para pegar"}]\n' +
        "}\nRespondé SOLO con el JSON, sin texto extra, sin markdown.";

    const systemPrompt = isEnglish
      ? "You are a senior LinkedIn profile strategist. Return ONLY valid JSON, no extra text, no markdown."
      : "Sos un/a estratega senior de perfiles de LinkedIn. Respondé SOLO con JSON válido, sin texto extra, sin markdown.";

    const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
    let result = null;
    let lastErr = null;

    async function intentar(model) {
      const bodyReq = {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2200,
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
        // Groq indica en su propio mensaje cuánto hay que esperar
        // (ej: "Please try again in 22.8s") — usamos ese dato exacto
        // en vez de una espera fija pensada para el peor caso.
        const m = errText.match(/try again in ([\d.]+)s/i);
        const waitSeconds = m ? parseFloat(m[1]) : null;
        return { ok: false, errText, waitSeconds };
      }
      const groqData = await groqRes.json();
      let raw = groqData.choices?.[0]?.message?.content || "";
      raw = raw.replace(/```json|```/g, "").trim();
      try {
        return { ok: true, result: JSON.parse(raw) };
      } catch {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { return { ok: true, result: JSON.parse(jsonMatch[0]) }; }
          catch { return { ok: false, errText: "JSON invalido: " + raw.slice(0,200), waitSeconds: null }; }
        }
        return { ok: false, errText: "Sin JSON en la respuesta: " + raw.slice(0,200), waitSeconds: null };
      }
    }

    for (const model of models) {
      let intentos = 0;
      while (intentos < 2) {
        intentos++;
        try {
          const r = await intentar(model);
          if (r.ok) { result = r.result; break; }
          lastErr = r.errText;
          console.error(`Groq falló con ${model} (intento ${intentos}):`, r.errText);
          if (r.waitSeconds && r.waitSeconds < 40 && intentos < 2) {
            await new Promise(res => setTimeout(res, (r.waitSeconds + 1) * 1000));
            continue; // reintenta el mismo modelo
          }
          break; // sin tiempo de espera indicado, o ya se reintentó — pasar al siguiente modelo
        } catch (e) {
          lastErr = e.message;
          await new Promise(res => setTimeout(res, 800));
          break;
        }
      }
      if (result) break;
    }

    if (!result) throw new Error("No se pudo generar la optimización de LinkedIn. Detalle: " + (lastErr || "sin detalle"));

    return new Response(JSON.stringify({ ok: true, ...result }), { headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
