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

    // ── Clasificar segmento ──────────────────────────────────────────────────
    const perfilTexto = (resumenPerfil || '') + ' ' + (cvText || '');
    const esAcademico = /doctorado|phd|investigaci|universidad|antropolog|sociolog|ciencias sociales/i.test(perfilTexto);
    const esConsultor = /consultor|consultora|partner|socio|research|inteligencia|estrategia/i.test(perfilTexto);
    const esCorporativo = /gerente|manager|director|jefe de|rrhh|recursos humanos/i.test(perfilTexto);
    const segmento = esAcademico && esConsultor ? 'académico-consultor' : esCorporativo ? 'corporativo' : 'consultor';
    const canalesProhibidos = ['computrabajo', 'bumeran', 'zonajobs', 'indeed'];

    // ── Extraer empleadores actuales del CV para excluirlos ──────────────────
    // Busca líneas con "Present|Actual|actualidad|2024|2025|2026" cerca de nombres de empresa
    const empleadoresActuales = [];
    if (cvText) {
      const lineas = cvText.split('\n');
      lineas.forEach((linea, i) => {
        if (/present|actual|actualidad|2025|2026/i.test(linea)) {
          // Buscar el nombre de empresa en las líneas cercanas
          const contexto = lineas.slice(Math.max(0, i-2), i+2).join(' ');
          // Extraer palabras que parecen nombres de empresa (2+ palabras en mayúscula o con siglas)
          const matches = contexto.match(/([A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ+]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ+]*){0,3})/g) || [];
          matches.forEach(m => {
            if (m.length > 3 && !['Partner', 'Present', 'Current', 'Actual'].includes(m)) {
              empleadoresActuales.push(m.trim());
            }
          });
        }
      });
    }
    const empleadoresStr = [...new Set(empleadoresActuales)].slice(0, 5).join(', ');

    // ── Búsquedas Tavily ─────────────────────────────────────────────────────
    let contextoMercado = 'Sin datos externos disponibles.';
    if (env.TAVILY_API_KEY) {
      const queries = [
        `"${sector}" Argentina consultoras organizaciones contratan investigador 2026`,
        `"${rol}" OR "investigación social aplicada" Argentina mercado laboral demanda 2025 2026`,
        `consultor investigación social Argentina honorarios fee proyecto 2025`,
      ];

      try {
        const results = await Promise.all(
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

        const fragmentos = results.map((res, i) => {
          const answer = res.answer ? `Respuesta: ${res.answer}` : "";
          const snippets = (res.results || []).slice(0, 2).map(r =>
            `[${r.title}] (${r.url}): ${(r.content || '').slice(0, 200)}`
          ).join("\n");
          return `[Búsqueda: ${queries[i]}]\n${answer}\n${snippets}`;
        }).join("\n\n");

        if (fragmentos.trim().length > 50) contextoMercado = fragmentos.slice(0, 5000);
      } catch (e) {
        // continuar sin datos Tavily
      }
    }

    // ── Prompt ────────────────────────────────────────────────────────────────
    const cvExtracto = cvText ? cvText.slice(0, 2000) : '';
    const canalesStr = canalesProhibidos.join(', ');

    const prompt = `Sos un consultor senior de empleabilidad para perfiles académicos y consultores altamente calificados en Argentina.

PERFIL DEL CANDIDATO:
- Nombre: ${candidateName || 'Candidato'}
- Rol buscado: ${rol}
- Sector: ${sector}
- Seniority: ${seniority || 'Senior'}
- Ubicación: ${ubicacion || 'Buenos Aires, Argentina'}
- Modalidad: ${modalidad || 'no especificado'}
- Tipo empresa preferida: ${tipoEmpresa || 'no especificado'}
- Segmento: ${segmento}
${resumenPerfil ? '- Resumen: ' + resumenPerfil : ''}

CV COMPLETO (leé esto antes de sugerir cualquier organización o ruta):
${cvExtracto || 'No disponible'}

DATOS DE MERCADO (búsquedas en tiempo real):
${contextoMercado}

REGLAS — INCUMPLIRLAS INVALIDA EL ANÁLISIS:

REGLA 1 — EMPLEADORES ACTUALES EXCLUIDOS:
${empleadoresStr ? `Las siguientes organizaciones aparecen en el CV como empleadores actuales o recientes: ${empleadoresStr}. NUNCA las sugerás como destino de búsqueda. Son parte de la trayectoria del candidato, no opciones de postulación.` : 'Identificá en el CV las organizaciones donde trabaja actualmente y excluílas de las sugerencias.'}

REGLA 2 — REMUNERACIÓN SIN ALUCINACIÓN:
Si no tenés datos verificables con fuente concreta para la remuneración de este perfil exacto en Argentina, escribí en el campo "rango" exactamente: "Sin datos verificables disponibles". No inventes rangos. No uses promedios genéricos. Solo citá datos reales si tenés la fuente.

REGLA 3 — CANALES PROHIBIDOS:
Nunca menciones: ${canalesStr}. Son plataformas de empleo masivo inapropiadas para este segmento.

REGLA 4 — ORGANIZACIONES ESPECÍFICAS Y VERIFICABLES:
Solo sugerí organizaciones que existan en Argentina y que genuinamente contraten este tipo de perfil. Para cada organización indicá por qué ese candidato específico encaja (basándote en su experiencia real del CV, no en generalidades).

REGLA 5 — RUTAS ANCLADAS EN EL CV:
Las rutas posibles deben ser extensión directa de lo que el candidato ya hace. Nada que requiera reentrenamiento completo o cambio radical de campo.

REGLA 6 — HONESTIDAD SOBRE INCERTIDUMBRE:
Cuando no tenés datos verificables, decilo. Es mejor admitir incertidumbre que inventar.

Respondé SOLO con JSON válido y completo:

{"demanda":{"nivel":"Alta|Media|Baja","diagnostico":"situación real de demanda para este perfil — qué organizaciones contratan y con qué frecuencia, con fuente si la tenés","tendencia":"creciente|estable|decreciente|sin datos suficientes","justificacion":"por qué está así — con fuente o aclaración explícita de que es estimación"},"competencia":{"nivel":"Alta|Media|Baja","diagnostico":"quiénes son los candidatos que compiten con este perfil exacto","diferenciadores":["diferenciador genuino de este candidato basado en su CV real"]},"skillsRequeridos":{"criticos":["skill técnico real que demanda el mercado para este rol"],"deseables":["skill deseable concreto para este sector"],"emergentes":["skill emergente con evidencia de demanda"]},"remuneracion":{"rango":"Sin datos verificables disponibles — O rango real con fuente citada","modalidad":"cómo se estructura la remuneración en este segmento (honorarios por proyecto, fee mensual, etc.)","nota":"fuente del dato o: Estimación sin fuente verificable — consultá con reclutadores especializados"},"canalesRecomendados":[{"canal":"canal real apropiado para este segmento","razon":"por qué este canal específicamente para este perfil"}],"empresasOrganizaciones":[{"nombre":"organización real que contrata este perfil — NO los empleadores actuales del candidato","tipo":"consultora|organismo internacional|ONG|empresa|universidad|think tank","por_que":"conexión específica con la experiencia real del CV del candidato","como_aplicar":"canal concreto: LinkedIn directo a [persona/área], web, referido, etc."}],"rutasPosibles":[{"ruta":"ruta basada en lo que ya hace el candidato","descripcion":"extensión natural de su trayectoria actual — sin reentrenamiento radical","organizaciones_tipo":"tipo específico de organizaciones","tiempo_estimado":"estimación realista","acciones":["acción concreta y específica"]}],"estrategiaRecomendada":{"acciones":["acción concreta, específica, accionable — sin generalidades"],"tiempoEstimado":"estimación realista para este perfil en este mercado","alertas":["riesgo real y específico para este perfil"]},"resumenMercado":"síntesis de 4-5 oraciones honestas sobre el panorama real — distinguiendo qué es verificable y qué es estimación"}`;

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
                content: "Sos un consultor senior de empleabilidad para perfiles académicos y consultores altamente calificados en Argentina. Respondé SOLO con JSON válido y completo. NUNCA inventes remuneraciones sin fuente. NUNCA sugerás como destino de búsqueda las organizaciones donde el candidato ya trabaja. NUNCA uses Computrabajo, Bumeran, ZonaJobs ni Indeed para estos perfiles.",
              },
              { role: "user", content: prompt },
            ],
            temperature: 0.15,
            max_tokens: 2500,
          }),
        });

        if (!groqRes.ok) continue;
        const groqData = await groqRes.json();
        let raw = groqData.choices?.[0]?.message?.content || "";
        raw = raw.replace(/```json|```/g, "").trim();

        try {
          result = JSON.parse(raw);
        } catch (e) {
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) { try { result = JSON.parse(m[0]); } catch (e2) { continue; } }
          else continue;
        }

        // Post-procesamiento: filtrar canales prohibidos y empleadores actuales
        if (result.canalesRecomendados) {
          result.canalesRecomendados = result.canalesRecomendados.filter(c =>
            !canalesProhibidos.some(ci => (c.canal || '').toLowerCase().includes(ci))
          );
        }
        if (result.empresasOrganizaciones && empleadoresActuales.length > 0) {
          result.empresasOrganizaciones = result.empresasOrganizaciones.filter(o => {
            const nombre = (o.nombre || '').toLowerCase();
            return !empleadoresActuales.some(e => nombre.includes(e.toLowerCase().slice(0, 6)));
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
