import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/security.ts";

// Returns the barbershop's bookable services for the guest wizard, from the
// Supabase `services` table (property = 'barbers'). No online payment —
// customers book a slot and get an email confirmation; price shown is just
// informational. Called from the browser with the Supabase anon key.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...cors },
    });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const db = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await db
    .from("services")
    .select("id, name, duration_minutes, price_cents, category")
    .eq("property", "barbers");

  if (error || !data || !data.length) {
    return json({ error: "No services are set up for online booking yet." }, 503);
  }

  const services = data
    .map((s: any) => ({
      serviceId: s.id,
      name: s.name,
      description: s.category ?? "",
      priceCents: s.price_cents,
      currency: "CAD",
      durationMin: s.duration_minutes,
      imageUrl: null,
    }))
    // Cheapest first feels natural for a services menu.
    .sort((a: any, b: any) => a.priceCents - b.priceCents);

  return json({ services }, 200);
});
