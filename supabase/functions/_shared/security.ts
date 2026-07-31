// Shared security helpers for the public + admin Edge Functions. Files under
// _shared are not deployed as standalone functions; the CLI bundles them into
// each function that imports them.

// --- CORS: echo only our own origins, never a blanket "*" ---------------
const ALLOWED_ORIGINS = new Set([
  "https://wisdomindsbarberbraiders.ca",
  "https://www.wisdomindsbarberbraiders.ca",
]);
const DEFAULT_ORIGIN = "https://wisdomindsbarberbraiders.ca";

export function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers":
      "authorization, content-type, apikey, x-client-info, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

// --- Rate limiting ------------------------------------------------------
// DB-backed sliding window (table: public.rate_limit_hits), so the count is
// shared across all edge isolates — an in-memory Map isn't, and Supabase
// spreads requests across isolates, so it never reliably triggers. Uses the
// caller's service-role client (the table is service-role only via RLS).
// Returns true when the caller is OVER the limit and should be denied.
//
// Degrades open: if the table doesn't exist yet or the query errors, it
// returns false (allow), so deploying this never breaks the forms before the
// migration is applied.
export async function overRateLimit(
  // deno-lint-ignore no-explicit-any
  client: any,
  bucket: string,
  identifier: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const sinceIso = new Date(Date.now() - windowSeconds * 1000).toISOString();
    // Prune this identifier's expired rows first: keeps the window sliding and
    // stops the table growing without bound.
    await client
      .from("rate_limit_hits")
      .delete()
      .eq("bucket", bucket)
      .eq("identifier", identifier)
      .lt("created_at", sinceIso);
    const { count, error } = await client
      .from("rate_limit_hits")
      .select("*", { count: "exact", head: true })
      .eq("bucket", bucket)
      .eq("identifier", identifier);
    if (error) return false; // table missing / error → don't block anyone
    if ((count ?? 0) >= max) return true;
    await client.from("rate_limit_hits").insert({ bucket, identifier });
    return false;
  } catch {
    return false;
  }
}

// --- Cloudflare Turnstile (bot check) ----------------------------------
// Inert until TURNSTILE_SECRET_KEY is set as a function secret, so deploying
// this never breaks the live forms. Once configured, a missing/invalid token
// is rejected. Pair with the widget on the client (see the site key wiring in
// barber-booking.html / academy.html).
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY");

export async function turnstilePasses(
  token: string | undefined | null,
  ip: string,
): Promise<boolean> {
  if (!TURNSTILE_SECRET) return true; // not configured — don't block anyone
  if (!token) return false;
  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: TURNSTILE_SECRET,
          response: token,
          remoteip: ip,
        }),
      },
    );
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

// --- misc ---------------------------------------------------------------
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Local wall-clock parts for a Date in the shop's timezone: day-of-week
// (0=Sun), minutes-since-midnight, and YYYY-MM-DD. Used to check a requested
// slot against provider availability without a date library.
export function shopLocalParts(
  d: Date,
  timeZone: string,
): { dow: number; minutes: number; dateStr: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const wd: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0;
  return {
    dow: wd[map.weekday] ?? 0,
    minutes: hour * 60 + parseInt(map.minute, 10),
    dateStr: `${map.year}-${map.month}-${map.day}`,
  };
}
