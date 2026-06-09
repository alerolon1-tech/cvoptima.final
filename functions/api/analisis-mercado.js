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
1. Leé el CV completo antes de sugerir cualquier rol o ruta. Las sugerencias deben basarse EXCLUSIVAMENTE en la experiencia real del candidato.
2. Canales PROHIBIDOS para este segmento: ${canalesProhibidosStr}. No los menciones bajo ninguna circunstancia.
3. Organizaciones: solo nombrá organizaciones que genuinamente contraten este tipo de perfil exacto. Verificá que el tipo de organización sea coherente con la especialización real del candidato.${empleadoresStr ? ` Las siguientes organizaciones son empleadores actuales o recientes del candidato y NUNCA deben sugerirse como destino de búsqueda: ${empleadoresStr}.` : ''}
4. Rutas: solo rutas que sean extensión natural de lo que ya hace el candidato. Nada que requiera formación completamente nueva.
5. Alertas: solo riesgos específicos y reales para este perfil. Nada genérico.
6. REMUNERACIÓN: si no tenés datos verificables con fuente concreta, escribí exactamente "Sin datos verificables disponibles" en el campo rango. No inventes rangos ni promedios genéricos.

Respondé SOLO con JSON válido, sin texto adicional ni markdown:

{"demanda":{"nivel":"Alta|Media|Baja","diagnostico":"situación real de la demanda para este perfil específico","tendencia":"creciente|estable|decreciente|sin datos suficientes","justificacion":"por qué — con fuente o aclaración"},"competencia":{"nivel":"Alta|Media|Baja","diagnostico":"quiénes compiten con este candidato exactamente","diferenciadores":["diferenciador real de este candidato"]},"skillsRequeridos":{"criticos":["skill técnico real para este rol"],"deseables":["skill deseable concreto"],"emergentes":["skill emergente verificable"]},"remuneracion":{"rango":"rango en ARS o USD o Sin datos verificables","modalidad":"estructura real de remuneración en este segmento","nota":"fuente o limitación del dato"},"canalesRecomendados":[{"canal":"canal apropiado para este segmento","razon":"por qué este canal para este perfil"}],"empresasOrganizaciones":[{"nombre":"organización real en Argentina","tipo":"consultora|organismo internacional|ONG|empresa|universidad|think tank","por_que":"conexión específica con la experiencia real del candidato","como_aplicar":"canal concreto"}],"rutasPosibles":[{"ruta":"ruta laboral basada en lo que ya hace el candidato","descripcion":"extensión natural de su experiencia actual","organizaciones_tipo":"tipo de organizaciones","tiempo_estimado":"estimación realista","acciones":["acción concreta"]}],"estrategiaRecomendada":{"acciones":["acción concreta y específica para este perfil"],"tiempoEstimado":"estimación realista","alertas":["riesgo real y específico"]},"resumenMercado":"síntesis honesta de 3-4 oraciones sobre el panorama real para este perfil"}`;

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
                content: "Sos un consultor senior de empleabilidad para perfiles altamente calificados en Argentina. Respondé SOLO con JSON válido y completo. Nunca uses canales masivos de empleo (Computrabajo, Bumeran, ZonaJobs, Indeed) para estos perfiles. Nunca sugierás roles que el candidato no pueda alcanzar con su experiencia actual.",
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
