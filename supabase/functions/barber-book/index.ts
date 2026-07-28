import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Guest booking for the barbershop wizard. No account and no payment
// required: the visitor picks a Supabase service, a Supabase barber, and a
// time, enters name/email, and this function does everything server-side:
//   1. re-prices/re-names the service from Supabase (never trusts the client),
//   2. reserves the slot as a confirmed Supabase booking (DB no-overlap
//      constraint stops double-booking),
//   3. best-effort emails a confirmation via Resend.
// Payment happens in person at the shop — this never touches Square.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const BOOKING_EMAIL_FROM = Deno.env.get("BOOKING_EMAIL_FROM") ?? "Wisdominds Barbers <onboarding@resend.dev>";
const SHOP_TIMEZONE = "America/Toronto";
const SHOP_NAME = "Wisdominds Barbers & Braiders";
const SHOP_ADDRESS = "2400 Finch Ave W, Unit 5, North York, ON";
const SHOP_PHONE = "(416) 844-8287";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function isEmail(s: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: SHOP_TIMEZONE,
  }).format(d);
  const time = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric", minute: "2-digit", timeZone: SHOP_TIMEZONE,
  }).format(d);
  return `${date} at ${time}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const { providerId, serviceId, startAt, guestName, guestEmail } = body;
  if (!providerId || !serviceId || !startAt || !guestName || !guestEmail) {
    return jsonResponse({ error: "Missing required booking details." }, 400);
  }
  if (!isEmail(String(guestEmail))) {
    return jsonResponse({ error: "Please enter a valid email address." }, 400);
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Barber must be a real Supabase provider for this property.
  const { data: provider, error: providerError } = await adminClient
    .from("providers")
    .select("id, display_name, property")
    .eq("id", providerId)
    .single();
  if (providerError || !provider || provider.property !== "barbers") {
    return jsonResponse({ error: "That barber isn't available." }, 404);
  }

  // Re-price + re-name the service server-side so the client can't tamper
  // with what's shown/recorded.
  const { data: svc, error: svcError } = await adminClient
    .from("services")
    .select("name, price_cents, duration_minutes, property")
    .eq("id", serviceId)
    .single();
  if (svcError || !svc || svc.property !== "barbers") {
    return jsonResponse({ error: "That service is no longer available." }, 404);
  }
  const priceCents = svc.price_cents;
  const durationMin = svc.duration_minutes;
  const serviceName = svc.name;

  const startDate = new Date(startAt);
  if (isNaN(startDate.getTime())) {
    return jsonResponse({ error: "Invalid appointment time." }, 400);
  }
  const endDate = new Date(startDate.getTime() + durationMin * 60000);

  // Reserve the slot directly as confirmed — no payment step to gate on. The
  // bookings_no_overlap exclusion constraint rejects (Postgres 23P01) if this
  // provider already has an overlapping pending/confirmed booking, so two
  // people can't book the same slot.
  const { data: booking, error: bookingError } = await adminClient
    .from("bookings")
    .insert({
      provider_id: providerId,
      student_profile_id: null,
      service_id: serviceId,
      service_name: serviceName,
      service_price_cents: priceCents,
      guest_name: String(guestName).trim(),
      guest_email: String(guestEmail).trim(),
      slot_start: startDate.toISOString(),
      slot_end: endDate.toISOString(),
      status: "confirmed",
    })
    .select("id")
    .single();
  if (bookingError || !booking) {
    if (bookingError?.code === "23P01") {
      return jsonResponse({ error: "Sorry, that time was just booked. Please pick another." }, 409);
    }
    return jsonResponse({ error: "Couldn't hold that time. Please try again." }, 500);
  }

  // Best-effort confirmation email.
  let emailSent = false;
  if (RESEND_API_KEY) {
    try {
      const when = formatWhen(startDate.toISOString());
      const price = `$${(priceCents / 100).toFixed(2)} CAD`;
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: BOOKING_EMAIL_FROM,
          to: [String(guestEmail).trim()],
          subject: `Booking confirmed — ${serviceName} at ${SHOP_NAME}`,
          html: `
            <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1b2333">
              <h2 style="color:#0f172a">You're booked in 💈</h2>
              <p>Hi ${String(guestName).trim()}, your appointment at <strong>${SHOP_NAME}</strong> is confirmed.</p>
              <table style="width:100%;border-collapse:collapse;margin:20px 0">
                <tr><td style="padding:8px 0;color:#5b6478">Service</td><td style="padding:8px 0;text-align:right"><strong>${serviceName}</strong></td></tr>
                <tr><td style="padding:8px 0;color:#5b6478">Barber</td><td style="padding:8px 0;text-align:right">${provider.display_name}</td></tr>
                <tr><td style="padding:8px 0;color:#5b6478">When</td><td style="padding:8px 0;text-align:right">${when}</td></tr>
                <tr><td style="padding:8px 0;color:#5b6478">Price</td><td style="padding:8px 0;text-align:right"><strong>${price}</strong></td></tr>
              </table>
              <p style="color:#5b6478;font-size:14px">Payment is taken in person at the shop.</p>
              <p style="color:#5b6478;font-size:14px">${SHOP_ADDRESS} · ${SHOP_PHONE}</p>
              <p style="color:#5b6478;font-size:13px">Need to change or cancel? Give us a call and we'll sort it out.</p>
            </div>`,
        }),
      });
      emailSent = emailRes.ok;
    } catch {
      // Email is a courtesy; never fail the booking over it.
    }
  }

  return jsonResponse(
    {
      ok: true,
      booking: {
        id: booking.id,
        serviceName,
        providerName: provider.display_name,
        startAt: startDate.toISOString(),
        priceCents,
        durationMin,
        emailSent,
      },
    },
    200,
  );
});
