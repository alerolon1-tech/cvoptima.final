import { createHash, randomBytes } from "crypto";

export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const url = new URL(request.url);
    const metodo = url.searchParams.get("metodo") || "mp";
    const email = decodeURIComponent(url.searchParams.get("email") || "");

    // Generar token único de acceso
    const token = generateToken();

    // Guardar token en Supabase
    if (env.SUPABASE_URL && env.SUPABASE_KEY && email) {
      await fetch(env.SUPABASE_URL + "/rest/v1/tokens_diagnostico", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": env.SUPABASE_KEY,
          "Authorization": "Bearer " + env.SUPABASE_KEY,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({ token, email, usado: false }),
      });

      // También registrar email con plan diagnostico en tabla usuarios
      await fetch(env.SUPABASE_URL + "/rest/v1/usuarios", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": env.SUPABASE_KEY,
          "Authorization": "Bearer " + env.SUPABASE_KEY,
          "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({ email, plan: "diagnostico" }),
      });
    }

    return new Response(JSON.stringify({ token, ok: true }), { headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}

function generateToken() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}
