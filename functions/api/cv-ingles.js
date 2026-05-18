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
    const { cvText, candidateName, sector, rol, analisis } = body;

    if (!cvText || cvText.length < 50) {
      return new Response(JSON.stringify({ error: "Se necesita el texto del CV para generar la versión en inglés" }), { status: 400, headers });
    }

    const systemPrompt = `You are a professional CV writer specializing in Anglo-Saxon markets (USA, UK, Canada, Australia). Your task is to rewrite CVs from Spanish-speaking professionals into polished, professional English CVs following Anglo-Saxon conventions.

ANGLO-SAXON CV RULES:
- No personal pronouns (no "I", "my", "me")
- Start bullet points with strong action verbs in past tense (Led, Managed, Developed, Implemented, Achieved, Reduced, Increased, Coordinated, Delivered, Built)
- Quantify achievements whenever possible (%, numbers, timeframes, team sizes)
- Use industry-standard keywords for ATS compatibility
- Professional Summary: 3-4 sentences, no first person, role + years + key skills + value proposition
- Job titles adapted to English equivalents (not literal translations)
- Keep it concise and impact-focused
- Soft skills shown through examples, not listed as traits

CRITICAL: This is a REWRITE, not a translation. Improve the content while staying true to the person's real experience. Never invent experience or achievements not present in the original.

Respond ONLY with a valid JSON object. No markdown, no preamble.`;

    const userPrompt = `Rewrite this CV into a professional English CV following Anglo-Saxon conventions.

CANDIDATE NAME: ${candidateName || 'Professional'}
${sector ? `SECTOR: ${sector}` : ''}
${rol ? `TARGET ROLE: ${rol}` : ''}

ORIGINAL CV (in Spanish):
${cvText.slice(0, 8000)}

${analisis ? `ADDITIONAL CONTEXT FROM CV ANALYSIS:
- Profile summary: ${analisis.resumenEjecutivo || ''}
- Key strengths: ${(analisis.fortalezas || []).slice(0,3).map(f => f.descripcion || f).join('; ')}
- Detected skills: ${(analisis.mapaHabilidades?.detectadas || []).slice(0,5).join(', ')}
` : ''}

Generate a complete, professional English CV with this exact JSON structure:

{
  "personalInfo": {
    "name": "${candidateName || 'Full Name'}",
    "title": "Professional title in English — concise, keyword-rich",
    "location": "City, Country (extracted from CV if available)",
    "linkedin": "LinkedIn URL if mentioned in CV"
  },
  "professionalSummary": "3-4 sentence professional summary. No first person. Strong opening with role + years of experience + key expertise + unique value proposition.",
  "workExperience": [
    {
      "jobTitle": "Job Title in English",
      "company": "Company Name",
      "location": "City, Country",
      "startDate": "Month Year or Year",
      "endDate": "Month Year or Present",
      "achievements": [
        "Led [action] that resulted in [outcome] — always start with strong verb, add metrics when available",
        "Developed/Managed/Implemented [what] for [context], achieving [result]",
        "Additional achievement with impact — minimum 2, maximum 5 per role"
      ]
    }
  ],
  "education": [
    {
      "degree": "Degree name in English",
      "institution": "Institution name",
      "location": "City, Country",
      "year": "Year or date range",
      "notes": "Honors, GPA if excellent, relevant coursework — only if adds value"
    }
  ],
  "skills": {
    "technical": ["Technical skill 1", "Technical skill 2", "Tool or software"],
    "languages": ["English — Professional/Fluent/Native", "Spanish — Native"],
    "core": ["Core competency shown through experience (not just listed as trait)"]
  },
  "certifications": [
    {
      "name": "Certification name in English",
      "issuer": "Issuing organization",
      "year": "Year"
    }
  ],
  "keyAchievements": [
    "Top achievement 1 with quantified result — cross-role highlights",
    "Top achievement 2",
    "Top achievement 3"
  ],
  "adaptationNotes": [
    "Specific tip for this profile to succeed in Anglo-Saxon job market",
    "Another actionable recommendation"
  ]
}`;

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
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.2,
            max_tokens: 3000,
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

    if (!result) throw new Error("No se pudo generar la versión en inglés");

    return new Response(JSON.stringify({ ok: true, cv: result }), { headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
