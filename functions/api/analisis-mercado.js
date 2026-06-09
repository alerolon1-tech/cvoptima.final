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

    // ── Extraer empleadores actuales del CV ───────────────────────────────────
    const empleadoresActuales = [];
    if (cvText) {
      const lineas = cvText.split('\n');
      lineas.forEach((linea, i) => {
        if (/present|actual|actualidad|2025|2026/i.test(linea)) {
          const contexto = lineas.slice(Math.max(0, i-2), i+2).join(' ');
          const matches = contexto.match(/([A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ+]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ+]*){0,3})/g) || [];
          matches.forEach(m => {
            if (m.length > 3 && !['Partner', 'Present', 'Current', 'Actual', 'April', 'March'].includes(m)) {
              empleadoresActuales.push(m.trim());
            }
          });
        }
      });
    }
    const empleadoresStr = [...new Set(empleadoresActuales)].slice(0, 5).join(', ');

    // ── Búsquedas Tavily — orientadas a organizaciones y datos concretos ─────
    // La clave: buscar información que el modelo NO puede inventar —
    // nombres de organizaciones reales, proyectos activos, datos de remuneración
    let datosMercado = {
      organizaciones: '',
      remuneracion: '',
      tendencias: '',
      canales: '',
    };

    if (env.TAVILY_API_KEY) {
      // Queries diseñadas para traer nombres de organizaciones y datos concretos
      const queriesOrg = [
        // Buscar consultoras que trabajen con investigación social en Argentina
        `consultoras Argentina "investigación social" OR "estudios cualitativos" OR "análisis territorial" site:linkedin.com OR site:infobae.com`,
        // Buscar organismos internacionales con proyectos activos en Argentina
        `BID CEPAL PNUD OIT "investigación social" OR "ciencias sociales" Argentina proyectos 2025 2026`,
        // Buscar empresas que contraten investigadores sociales aplicados
        `Argentina empresas "investigador social" OR "research consultant" OR "analista social" busca contrata 2026`,
      ];
      const queryRem = `honorarios consultor investigación cualitativa Argentina 2025 fee proyecto`;
      const queryTend = `"investigación social" OR "ciencias sociales aplicadas" Argentina mercado demanda tendencias 2025 2026`;

      try {
        const [orgResults, remResult, tendResult] = await Promise.all([
          Promise.all(queriesOrg.map(q =>
            fetch("https://api.tavily.com/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                api_key: env.TAVILY_API_KEY,
                query: q,
                search_depth: "advanced",
                max_results: 4,
                include_answer: false,
              }),
            }).then(r => r.json()).catch(() => ({ results: [] }))
          )),
          fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: env.TAVILY_API_KEY,
              query: queryRem,
              search_depth: "basic",
              max_results: 3,
              include_answer: true,
            }),
          }).then(r => r.json()).catch(() => ({ results: [], answer: "" })),
          fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: env.TAVILY_API_KEY,
              query: queryTend,
              search_depth: "basic",
              max_results: 3,
              include_answer: true,
            }),
          }).then(r => r.json()).catch(() => ({ results: [], answer: "" })),
        ]);

        // Organizaciones: extraer nombres y URLs de los resultados
        datosMercado.organizaciones = orgResults.flat()
          .flatMap(res => res.results || [])
          .slice(0, 10)
          .map(r => `- ${r.title} (${r.url}): ${(r.content || '').slice(0, 150)}`)
          .join('\n');

        // Remuneración: preservar el answer + snippets con URL
        datosMercado.remuneracion = [
          remResult.answer ? `Síntesis: ${remResult.answer}` : '',
          ...(remResult.results || []).slice(0, 2).map(r => `[${r.title}] (${r.url}): ${(r.content || '').slice(0, 200)}`),
        ].filter(Boolean).join('\n');

        // Tendencias
        datosMercado.tendencias = [
          tendResult.answer ? `Síntesis: ${tendResult.answer}` : '',
          ...(tendResult.results || []).slice(0, 2).map(r => `[${r.title}] (${r.url}): ${(r.content || '').slice(0, 200)}`),
        ].filter(Boolean).join('\n');

      } catch (e) {
        // continuar sin datos
      }
    }

    // ── Construir el contexto de mercado para el modelo ───────────────────────
    const contextoMercado = [
      datosMercado.organizaciones ? `ORGANIZACIONES ENCONTRADAS EN BÚSQUEDA REAL:\n${datosMercado.organizaciones}` : '',
      datosMercado.remuneracion ? `DATOS DE REMUNERACIÓN ENCONTRADOS:\n${datosMercado.remuneracion}` : '',
      datosMercado.tendencias ? `TENDENCIAS DEL SECTOR:\n${datosMercado.tendencias}` : '',
    ].filter(Boolean).join('\n\n') || 'Sin datos externos disponibles de Tavily.';

    // ── Prompt ────────────────────────────────────────────────────────────────
    const cvExtracto = cvText ? cvText.slice(0, 2000) : '';
    const canalesStr = canalesProhibidos.join(', ');

    const prompt = `Sos un consultor senior de empleabilidad para perfiles académicos y consultores altamente calificados en Argentina.

PERFIL DEL CANDIDATO:
Nombre: ${candidateName || 'Candidato'}
Rol buscado: ${rol} | Sector: ${sector} | Seniority: ${seniority || 'Senior'}
Ubicación: ${ubicacion || 'Buenos Aires, Argentina'} | Modalidad: ${modalidad || 'no especificado'}
Segmento: ${segmento}
${resumenPerfil ? 'Resumen: ' + resumenPerfil : ''}

CV (leé esto antes de todo — es la base de cualquier sugerencia):
${cvExtracto || 'No disponible'}

DATOS REALES DE MERCADO (resultados de búsquedas en tiempo real — son tu fuente):
${contextoMercado}

INSTRUCCIÓN CENTRAL:
Usá los datos de mercado de arriba como tu fuente principal. Para las organizaciones, trabajá con lo que encontraron las búsquedas. Si las búsquedas trajeron nombres de consultoras, organismos o empresas, usálos — citando la URL como fuente. Si no trajeron datos suficientes, completá con tu conocimiento pero marcá explícitamente qué es conocimiento propio y qué viene de las búsquedas.

REGLAS NO NEGOCIABLES:
1. EMPLEADORES EXCLUIDOS: ${empleadoresStr ? `"${empleadoresStr}" son empleadores actuales o recientes del candidato. NUNCA los sugerás como destino.` : 'Identificá en el CV las organizaciones actuales del candidato y excluílas.'}
2. REMUNERACIÓN: Si los datos de búsqueda tienen información de honorarios o fees, usala citando la fuente. Si no, escribí exactamente "Sin datos verificables disponibles" en el campo rango. No inventes números.
3. CANALES PROHIBIDOS: ${canalesStr} — nunca los menciones.
4. ORGANIZACIONES: Preferí las que aparecen en los resultados de búsqueda. Si agregás otras de tu conocimiento, marcálas como "(Conocimiento propio — verificar)".
5. RUTAS: Solo extensión natural de lo que el candidato ya hace según su CV. Sin cambios radicales de campo.
6. ALERTAS: Solo riesgos reales y específicos para este perfil. Nada genérico.

Respondé SOLO con JSON válido y completo:

{"demanda":{"nivel":"Alta|Media|Baja","diagnostico":"situación real de demanda — qué tipo de organizaciones contratan este perfil y con qué frecuencia","tendencia":"creciente|estable|decreciente|sin datos suficientes","justificacion":"fundamentación con fuente de los datos de búsqueda o aclaración de que es estimación propia"},"competencia":{"nivel":"Alta|Media|Baja","diagnostico":"quiénes compiten con este candidato exactamente en el mercado argentino","diferenciadores":["diferenciador genuino de este candidato basado en su CV real"]},"skillsRequeridos":{"criticos":["skill técnico real que demanda el mercado para este rol"],"deseables":["skill deseable concreto"],"emergentes":["skill emergente con evidencia"]},"remuneracion":{"rango":"dato de las búsquedas con URL — O exactamente: Sin datos verificables disponibles","modalidad":"estructura real de remuneración en este segmento (honorarios por proyecto, fee mensual, relación de dependencia)","nota":"URL de la fuente — O: Estimación sin fuente verificable, consultá con reclutadores especializados en el sector"},"canalesRecomendados":[{"canal":"canal específico y apropiado para este segmento","razon":"por qué este canal para este perfil exacto"}],"empresasOrganizaciones":[{"nombre":"nombre de la organización — preferentemente de los resultados de búsqueda","tipo":"consultora|organismo internacional|ONG|empresa|universidad|think tank","fuente":"URL de donde proviene este dato — O: Conocimiento propio — verificar","por_que":"conexión específica con la experiencia real del CV del candidato","como_aplicar":"canal concreto"}],"rutasPosibles":[{"ruta":"ruta basada en lo que ya hace el candidato según su CV","descripcion":"extensión natural de su trayectoria — sin reentrenamiento radical","organizaciones_tipo":"tipo específico de organizaciones","tiempo_estimado":"estimación realista","acciones":["acción concreta y específica"]}],"estrategiaRecomendada":{"acciones":["acción concreta y específica — no genérica"],"tiempoEstimado":"estimación realista para este perfil en este mercado","alertas":["riesgo real y específico"]},"resumenMercado":"síntesis de 4-5 oraciones honestas sobre el panorama real para este perfil — distinguiendo datos verificados de estimaciones propias"}`;

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
                content: "Sos un consultor senior de empleabilidad para perfiles académicos y altamente calificados en Argentina. Tu análisis se basa en los datos reales que te proveen las búsquedas — no inventás. NUNCA usás Computrabajo, Bumeran, ZonaJobs ni Indeed. NUNCA inventás remuneraciones sin fuente verificable. NUNCA sugerás como destino las organizaciones donde el candidato ya trabaja. Cuando no tenés datos verificables, lo decís explícitamente. Respondé SOLO con JSON válido y completo.",
              },
              { role: "user", content: prompt },
            ],
            temperature: 0.1,
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
