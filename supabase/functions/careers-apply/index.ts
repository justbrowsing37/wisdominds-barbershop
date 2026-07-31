// Careers application form on academy.html. No database write and no
// applicant account — this just relays the submission to the shop's inbox
// via Resend (same provider barber-book already uses for confirmations),
// so there's no new secret to provision beyond RESEND_API_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  clientIp,
  corsHeaders,
  overRateLimit,
  turnstilePasses,
} from "../_shared/security.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const BOOKING_EMAIL_FROM = Deno.env.get("BOOKING_EMAIL_FROM") ?? "Wisdominds Barbers <onboarding@resend.dev>";
const CAREERS_NOTIFY_EMAIL = Deno.env.get("CAREERS_NOTIFY_EMAIL") ?? "wisdomindscoop@gmail.com";

const VALID_ROLES = [
  "Full-Time Barber",
  "Hair Braider",
  "Apprentice",
  "Academy Instructor",
  "Other",
];

function isEmail(s: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const srv = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const ip = clientIp(req);
  if (await overRateLimit(srv, "careers:ip", ip, 5, 600)) {
    return json({ error: "Too many applications. Please wait a few minutes and try again." }, 429);
  }

  if (!RESEND_API_KEY) {
    return json({ error: "Applications aren't being accepted online right now — please call the shop instead." }, 503);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (!(await turnstilePasses(body?.turnstileToken, ip))) {
    return json({ error: "Verification failed. Please refresh and try again." }, 403);
  }

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const role = String(body.role ?? "").trim();
  const experience = String(body.experience ?? "").trim();
  const portfolio = String(body.portfolio ?? "").trim();
  const startDate = String(body.startDate ?? "").trim();
  const message = String(body.message ?? "").trim();

  if (!name || !email || !role) {
    return json({ error: "Name, email, and role are required." }, 400);
  }
  if (!isEmail(email)) {
    return json({ error: "Please enter a valid email address." }, 400);
  }
  if (!VALID_ROLES.includes(role)) {
    return json({ error: "Please choose a valid role." }, 400);
  }
  if (message.length > 4000) {
    return json({ error: "Message is too long." }, 400);
  }

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: BOOKING_EMAIL_FROM,
        to: [CAREERS_NOTIFY_EMAIL],
        reply_to: email,
        subject: `Careers application — ${role} — ${name}`,
        html: `
          <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1b2333">
            <h2 style="color:#0f172a">New Careers Application</h2>
            <table style="width:100%;border-collapse:collapse;margin:20px 0">
              <tr><td style="padding:8px 0;color:#5b6478">Name</td><td style="padding:8px 0;text-align:right"><strong>${escapeHtml(name)}</strong></td></tr>
              <tr><td style="padding:8px 0;color:#5b6478">Position</td><td style="padding:8px 0;text-align:right">${escapeHtml(role)}</td></tr>
              <tr><td style="padding:8px 0;color:#5b6478">Email</td><td style="padding:8px 0;text-align:right">${escapeHtml(email)}</td></tr>
              <tr><td style="padding:8px 0;color:#5b6478">Phone</td><td style="padding:8px 0;text-align:right">${escapeHtml(phone || "—")}</td></tr>
              <tr><td style="padding:8px 0;color:#5b6478">Experience</td><td style="padding:8px 0;text-align:right">${escapeHtml(experience || "—")}</td></tr>
              <tr><td style="padding:8px 0;color:#5b6478">Available From</td><td style="padding:8px 0;text-align:right">${escapeHtml(startDate || "—")}</td></tr>
              <tr><td style="padding:8px 0;color:#5b6478">Portfolio / Social</td><td style="padding:8px 0;text-align:right">${escapeHtml(portfolio || "—")}</td></tr>
            </table>
            ${message ? `<p style="color:#5b6478;font-size:14px;white-space:pre-wrap"><strong>Comments:</strong><br>${escapeHtml(message)}</p>` : ""}
          </div>`,
      }),
    });
    if (!emailRes.ok) {
      return json({ error: "Couldn't send your application. Please try again or email us directly." }, 502);
    }
  } catch {
    return json({ error: "Couldn't send your application. Please try again or email us directly." }, 502);
  }

  return json({ ok: true }, 200);
});
