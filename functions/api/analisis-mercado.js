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
    // Maneja dos patrones comunes:
    //   Patrón A: "Empresa Mes Año - Present"  (empresa + fecha en la misma línea)
    //   Patrón B: línea anterior a "Mes Año - Present" contiene la empresa
    const empleadoresActuales = [];
    if (cvText) {
      const lineas = cvText.split('\n').map(l => l.trim()).filter(Boolean);
      const meses = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December';
      const resFecha = new RegExp(`(?:Present|Actualidad|\\b202[4-9]\\b)`, 'i');
      const resMes = new RegExp(`\\b(${meses})\\b`, 'i');

      lineas.forEach((linea, i) => {
        if (!resFecha.test(linea) || !resMes.test(linea)) return;

        // Patrón A: la empresa está antes del mes en la misma línea
        // "Emic+ Consultora April 2024 - Present" → extraer "Emic+ Consultora"
        const sinFecha = linea.replace(new RegExp(`\\b(${meses})\\b.*`, 'i'), '').trim();
        if (sinFecha.length > 2 && sinFecha.length < 50) {
          const esCargo = /^(Partner|Manager|Director|Coordinator|Consultant|Researcher|Professor|Lecturer|Fellow|Analyst|Associate|Senior|Junior|Head|Chief|Lead)/i.test(sinFecha);
          if (!esCargo) {
            empleadoresActuales.push(sinFecha);
            return;
          }
        }

        // Patrón B: la empresa está en la línea anterior
        for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
          const candidata = lineas[j];
          const esCargo = /^(Partner|Manager|Director|Coordinator|Consultant|Researcher|Professor|Lecturer|Fellow|Analyst|Associate|Senior|Junior|Head|Chief|Lead)/i.test(candidata);
          const esSeccion = /^(EXPERIENCE|EDUCATION|SKILLS|WORK|EMPLOYMENT|PROFESSIONAL)/i.test(candidata);
          if (!esCargo && !esSeccion && candidata.length > 2 && candidata.length < 60) {
            empleadoresActuales.push(candidata.trim());
            break;
          }
        }
      });
    }
    const empleadoresUnicos = [...new Set(empleadoresActuales)];
    const empleadoresStr = empleadoresUnicos.join(', ');

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

{"demanda":{"nivel":"Alta|Media|Baja","diagnostico":"situación real de la demanda para este perfil específico — en segunda persona: 'Tu perfil...' o 'En tu sector...'","tendencia":"creciente|estable|decreciente|sin datos suficientes","justificacion":"por qué — con fuente o aclaración"},"competencia":{"nivel":"Alta|Media|Baja","diagnostico":"quiénes compiten con este candidato — en segunda persona: 'Tu competencia directa son...'","diferenciadores":["diferenciador real de este candidato basado en su CV"]},"skillsRequeridos":{"criticos":["skill técnico real que demanda el mercado para este rol"],"deseables":["skill deseable concreto"],"emergentes":["skill emergente verificable"]},"remuneracion":{"rango":"rango en ARS o USD con fuente — o exactamente: Sin datos verificables disponibles","modalidad":"estructura real de remuneración en este segmento (honorarios por proyecto, fee mensual, etc.)","nota":"fuente del dato o: Sin datos verificables — consultá con reclutadores del sector"},"canalesRecomendados":[{"canal":"canal específico y apropiado para este segmento — nunca Computrabajo, Bumeran, ZonaJobs ni Indeed","razon":"por qué este canal para este perfil exacto — en segunda persona"}],"empresasOrganizaciones":[{"nombre":"nombre real y específico de una organización en Argentina que contrate este perfil — NO genérico","tipo":"consultora|organismo internacional|ONG|empresa|universidad|think tank","fuente":"URL del resultado de búsqueda donde encontraste esta organización — o exactamente: Conocimiento propio — verificar","por_que":"conexión específica con la experiencia real del CV del candidato — en segunda persona: 'Tu experiencia en X te conecta con...'","como_aplicar":"canal concreto: LinkedIn directo, web de la organización, referido, etc."}],"rutasPosibles":[{"ruta":"ruta basada en lo que ya hace el candidato según su CV — no en el rol ingresado en el formulario si no condice con el perfil","descripcion":"extensión natural de su trayectoria actual — en segunda persona","organizaciones_tipo":"tipo específico de organizaciones","tiempo_estimado":"estimación realista","acciones":["acción concreta y específica — en segunda persona"]}],"estrategiaRecomendada":{"acciones":["acción concreta y accionable — en segunda persona, sin generalidades"],"tiempoEstimado":"estimación realista para este perfil en este mercado","alertas":["riesgo real y específico — en segunda persona"]},"resumenMercado":"síntesis de 3-4 oraciones en SEGUNDA PERSONA sobre el panorama real para este perfil — ejemplo: 'Tu perfil como investigador social aplicado tiene demanda en...' — nunca en tercera persona, nunca genérico"}`;

    // ── Llamar a Groq con manejo robusto de JSON ─────────────────────────────
    const models = [
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
    ];

    let result = null;
    for (const model of models) {
      try {
        const bodyReq = {
          model,
          messages: [
            {
              role: "system",
              content: "Sos un consultor senior de empleabilidad para perfiles altamente calificados en Argentina. Todo tu análisis va en SEGUNDA PERSONA — 'tu perfil', 'tu experiencia', 'tu sector' — nunca en tercera persona. Respondé SOLO con JSON válido y completo. Nunca uses canales masivos de empleo (Computrabajo, Bumeran, ZonaJobs, Indeed). Nunca inventes remuneraciones sin fuente verificable. Nunca sugerás como destino las organizaciones donde el candidato ya trabaja. Solo nombrá organizaciones reales y específicas que existan en Argentina.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 6000,
        };
        if (model.startsWith("openai/gpt-oss")) bodyReq.reasoning_effort = "medium";

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.GROQ_API_KEY}`,
          },
          body: JSON.stringify(bodyReq),
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

        // Post-procesamiento: filtrar canales prohibidos y empleadores actuales
        if (result.canalesRecomendados) {
          result.canalesRecomendados = result.canalesRecomendados.filter(c =>
            !canalesProhibidos.some(ci => (c.canal || '').toLowerCase().includes(ci))
          );
        }
        if (result.empresasOrganizaciones) {
          result.empresasOrganizaciones = result.empresasOrganizaciones.filter(o => {
            const nombre = (o.nombre || '').toLowerCase();
            // Filtrar canales masivos
            if (['staffing', 'bpo', 'reclutamiento masivo'].some(t => nombre.includes(t))) return false;
            // Filtrar empleadores actuales del candidato con matching mejorado
            if (empleadoresUnicos.some(e => {
              const emp = e.toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, ' ').trim();
              // Excluir palabras genéricas que no identifican una empresa específica
              const genericWords = new Set(['consultora','consulting','associates','partners','group','solutions','services','internacional','argentina','buenos','aires','universidad','national','business','equality','research','social','applied']);
              const palabras = emp.split(/\s+/).filter(p => p.length > 3 && !genericWords.has(p));
              return palabras.length > 0 && palabras.some(p => nombre.includes(p));
            })) return false;
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
