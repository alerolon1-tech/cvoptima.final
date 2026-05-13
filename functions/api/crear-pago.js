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
    const { metodo, email } = body;

    if (!metodo || !email) {
      return new Response(JSON.stringify({ error: "Faltan datos" }), { status: 400, headers });
    }

    const origin = new URL(request.url).origin;

    // ── MercadoPago ──────────────────────────────────────────────
    if (metodo === "mp") {
      const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.MP_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          items: [{
            title: "CVOptima — Plan Diagnóstico",
            quantity: 1,
            unit_price: 6000,
            currency_id: "ARS",
          }],
          payer: { email },
          back_urls: {
            success: `${origin}/?pago=ok&metodo=mp&email=${encodeURIComponent(email)}`,
            failure: `${origin}/?pago=error`,
            pending: `${origin}/?pago=pendiente`,
          },
          auto_return: "approved",
          external_reference: email,
          notification_url: `${origin}/api/webhook-pago`,
        }),
      });

      const mpData = await mpRes.json();
      if (!mpRes.ok) throw new Error(mpData.message || "Error MercadoPago");

      return new Response(JSON.stringify({
        url: mpData.init_point,
        id: mpData.id,
      }), { headers });
    }

    // ── PayPal ───────────────────────────────────────────────────
    if (metodo === "paypal") {
      // Obtener token de acceso PayPal
      const authRes = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_SECRET)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      const authData = await authRes.json();
      const accessToken = authData.access_token;

      // Crear orden PayPal
      const orderRes = await fetch("https://api-m.sandbox.paypal.com/v2/checkout/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [{
            amount: { currency_code: "USD", value: "5.00" },
            description: "CVOptima — Plan Diagnóstico",
            custom_id: email,
          }],
          application_context: {
            return_url: `${origin}/?pago=ok&metodo=paypal&email=${encodeURIComponent(email)}`,
            cancel_url: `${origin}/?pago=error`,
          },
        }),
      });

      const orderData = await orderRes.json();
      if (!orderRes.ok) throw new Error(orderData.message || "Error PayPal");

      const approveLink = orderData.links.find(l => l.rel === "approve");
      return new Response(JSON.stringify({
        url: approveLink.href,
        id: orderData.id,
      }), { headers });
    }

    return new Response(JSON.stringify({ error: "Método no válido" }), { status: 400, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
