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

    // ── Clasificar segmento de mercado ───────────────────────────────────────
    const perfilTexto = (resumenPerfil || '') + ' ' + (cvText || '');
    const esAcademico = /doctorado|phd|investigaci|universidad|antropolog|sociolog|ciencias sociales/i.test(perfilTexto);
    const esConsultor = /consultor|consultora|partner|socio|research|inteligencia|estrategia/i.test(perfilTexto);
    const esCorporativo = /gerente|manager|director|jefe de|rrhh|recursos humanos/i.test(perfilTexto);
    const segmento = esAcademico && esConsultor ? 'académico-consultor' : esCorporativo ? 'corporativo' : 'consultor';
    const canalesProhibidos = ['computrabajo', 'bumeran', 'zonajobs', 'indeed'];

    // ── Extraer empleadores actuales del CV para excluirlos de sugerencias ────
    const empleadoresActuales = [];
    if (cvText) {
      cvText.split('\n').forEach((linea, i, arr) => {
        if (/present|actual|actualidad|2025|2026/i.test(linea)) {
          const contexto = arr.slice(Math.max(0, i-2), i+2).join(' ');
          (contexto.match(/([A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ+]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ+]*){0,3})/g) || [])
            .forEach(m => {
              if (m.length > 3 && !['Partner','Present','Current','Actual','April','March','October'].includes(m))
                empleadoresActuales.push(m.trim());
            });
        }
      });
    }
    const empleadoresStr = [...new Set(empleadoresActuales)].slice(0, 5).join(', ');

    // ── Búsquedas Tavily ─────────────────────────────────────────────────────
    let contextoMercado = '';
    if (env.TAVILY_API_KEY) {
      const queries = [
        `"${rol}" "${sector}" Argentina consultoras organizaciones contratan 2026`,
        `"${sector}" Argentina investigación social mercado laboral tendencias 2025 2026`,
        `consultor investigación social Argentina honorarios remuneración 2025`,
      ];

      try {
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

        contextoMercado = tavilyResults
          .map((res, i) => {
            const answer = res.answer ? `Síntesis: ${res.answer}` : "";
            const snippets = (res.results || []).slice(0, 2).map(r =>
              `[${r.title || ''}] (${r.url || ''}): ${(r.content || '').slice(0, 250)}`
            ).join("\n");
            return `=== ${queries[i]} ===\n${answer}\n${snippets}`;
          })
          .join("\n\n")
          .slice(0, 5000);
      } catch (e) {
        contextoMercado = '';
      }
    }

    // ── Construir contexto del candidato ─────────────────────────────────────
    const cvResumen = cvText ? cvText.slice(0, 1500) : '';
    const contextoCandidato = `CANDIDATO: ${candidateName || 'Candidato'}
ROL BUSCADO: ${rol}
SECTOR: ${sector}
SENIORITY: ${seniority || 'Senior'}
UBICACIÓN: ${ubicacion || 'Buenos Aires, Argentina'}
MODALIDAD: ${modalidad || 'no especificado'}
TIPO EMPRESA: ${tipoEmpresa || 'no especificado'}
SEGMENTO DETECTADO: ${segmento}
${resumenPerfil ? 'RESUMEN: ' + resumenPerfil : ''}
${cvResumen ? 'CV (extracto):\n' + cvResumen : ''}`;

    // ── Prompt ────────────────────────────────────────────────────────────────
    const canalesProhibidosStr = canalesProhibidos.join(', ');
    const prompt = `Sos un consultor senior de empleabilidad especializado en el mercado laboral argentino para perfiles altamente calificados.

${contextoCandidato}

DATOS DE MERCADO EN TIEMPO REAL:
${contextoMercado || 'Sin datos externos disponibles. Usá tu conocimiento actualizado del mercado argentino.'}

REGLAS OBLIGATORIAS:
1. SEGUNDA PERSONA: todo el análisis en segunda persona — "tu perfil", "tu experiencia", "tu sector". Nunca tercera persona ("el candidato", "Joaquín tiene", "su perfil").
2. ROL: el rol ingresado en el formulario es una referencia, no una definición. Si no condice con el CV real, usá el CV como base y reencuadrá el análisis hacia lo que el candidato realmente hace. Aclaralo en resumenMercado.
3. Leé el CV completo antes de sugerir cualquier organización o ruta. Las sugerencias deben basarse EXCLUSIVAMENTE en la experiencia real del candidato.
4. Canales PROHIBIDOS: ${canalesProhibidosStr}. No los menciones bajo ninguna circunstancia.
5. Organizaciones: nombrá organizaciones REALES y ESPECÍFICAS que existan en Argentina y que genuinamente contraten este tipo de perfil. No uses nombres genéricos ni inventados.${empleadoresStr ? ` Las siguientes organizaciones son empleadores actuales o recientes del candidato y NUNCA deben sugerirse como destino: ${empleadoresStr}.` : ''}
6. Rutas: solo extensión natural de lo que ya hace el candidato según su CV.
7. Alertas: solo riesgos reales y específicos. Nada genérico.
8. REMUNERACIÓN: si no tenés datos verificables con fuente concreta, escribí exactamente "Sin datos verificables disponibles". No inventes rangos.

Respondé SOLO con JSON válido, sin texto adicional ni markdown:

{"demanda":{"nivel":"Alta|Media|Baja","diagnostico":"situación real de la demanda para este perfil específico — en segunda persona: 'Tu perfil...' o 'En tu sector...'","tendencia":"creciente|estable|decreciente|sin datos suficientes","justificacion":"por qué — con fuente o aclaración"},"competencia":{"nivel":"Alta|Media|Baja","diagnostico":"quiénes compiten con este candidato — en segunda persona: 'Tu competencia directa son...'","diferenciadores":["diferenciador real de este candidato basado en su CV"]},"skillsRequeridos":{"criticos":["skill técnico real que demanda el mercado para este rol"],"deseables":["skill deseable concreto"],"emergentes":["skill emergente verificable"]},"remuneracion":{"rango":"rango en ARS o USD con fuente — o exactamente: Sin datos verificables disponibles","modalidad":"estructura real de remuneración en este segmento (honorarios por proyecto, fee mensual, etc.)","nota":"fuente del dato o: Sin datos verificables — consultá con reclutadores del sector"},"canalesRecomendados":[{"canal":"canal específico y apropiado para este segmento — nunca Computrabajo, Bumeran, ZonaJobs ni Indeed","razon":"por qué este canal para este perfil exacto — en segunda persona"}],"empresasOrganizaciones":[{"nombre":"nombre real y específico de una organización en Argentina que contrate este perfil — NO genérico","tipo":"consultora|organismo internacional|ONG|empresa|universidad|think tank","por_que":"conexión específica con la experiencia real del CV del candidato — en segunda persona: 'Tu experiencia en X te conecta con...'","como_aplicar":"canal concreto: LinkedIn directo, web de la organización, referido, etc."}],"rutasPosibles":[{"ruta":"ruta basada en lo que ya hace el candidato según su CV — no en el rol ingresado en el formulario si no condice con el perfil","descripcion":"extensión natural de su trayectoria actual — en segunda persona","organizaciones_tipo":"tipo específico de organizaciones","tiempo_estimado":"estimación realista","acciones":["acción concreta y específica — en segunda persona"]}],"estrategiaRecomendada":{"acciones":["acción concreta y accionable — en segunda persona, sin generalidades"],"tiempoEstimado":"estimación realista para este perfil en este mercado","alertas":["riesgo real y específico — en segunda persona"]},"resumenMercado":"síntesis de 3-4 oraciones en SEGUNDA PERSONA sobre el panorama real para este perfil — ejemplo: 'Tu perfil como investigador social aplicado tiene demanda en...' — nunca en tercera persona, nunca genérico"}`;

    // ── Llamar a Groq con manejo robusto de JSON ─────────────────────────────
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
                content: "Sos un consultor senior de empleabilidad para perfiles altamente calificados en Argentina. Todo tu análisis va en SEGUNDA PERSONA — 'tu perfil', 'tu experiencia', 'tu sector' — nunca en tercera persona. Respondé SOLO con JSON válido y completo. Nunca uses canales masivos de empleo (Computrabajo, Bumeran, ZonaJobs, Indeed). Nunca inventes remuneraciones sin fuente verificable. Nunca sugerás como destino las organizaciones donde el candidato ya trabaja. Solo nombrá organizaciones reales y específicas que existan en Argentina.",
              },
              { role: "user", content: prompt },
            ],
            temperature: 0.2,
            max_tokens: 2500,
          }),
        });

        if (!groqRes.ok) continue;
        const groqData = await groqRes.json();
        let raw = groqData.choices?.[0]?.message?.content || "";
        raw = raw.replace(/```json|```/g, "").trim();

        // Intentar parsear — si falla, intentar extraer el JSON válido del string
        try {
          result = JSON.parse(raw);
        } catch (parseErr) {
          // Intentar extraer el primer objeto JSON válido del string
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              result = JSON.parse(jsonMatch[0]);
            } catch (e2) {
              continue; // Seguir con el siguiente modelo
            }
          } else {
            continue;
          }
        }

        // Post-procesamiento: filtrar canales y organizaciones inapropiadas
        if (result.canalesRecomendados) {
          result.canalesRecomendados = result.canalesRecomendados.filter(c =>
            !canalesProhibidos.some(ci => (c.canal || '').toLowerCase().includes(ci))
          );
        }
        if (result.empresasOrganizaciones) {
          result.empresasOrganizaciones = result.empresasOrganizaciones.filter(o => {
            const nombre = (o.nombre || '').toLowerCase();
            // Filtrar staffing genérico
            if (['staffing', 'bpo', 'reclutamiento masivo'].some(t => nombre.includes(t))) return false;
            // Filtrar empleadores actuales del candidato
            if (empleadoresActuales.length > 0 &&
                empleadoresActuales.some(e => nombre.includes(e.toLowerCase().slice(0, 6)))) return false;
            return true;
          });
        }

        break;
      } catch (e) {
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
    }

    if (!result) throw new Error("No se pudo generar el análisis del mercado");

    return new Response(JSON.stringify({ ok: true, analisis: result }), { headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
