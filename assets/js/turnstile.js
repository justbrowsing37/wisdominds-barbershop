// Optional Cloudflare Turnstile bot check for the public forms (booking +
// careers). INERT until you set TURNSTILE_SITE_KEY below to your Turnstile
// site key AND set the matching TURNSTILE_SECRET_KEY as a Supabase function
// secret. With the key empty, no external script loads, no widget renders,
// and no token is sent — the forms behave exactly as they do today.
//
// To enable:
//   1. Create a Turnstile widget at https://dash.cloudflare.com (Turnstile).
//   2. Put the *site* key in TURNSTILE_SITE_KEY below.
//   3. Set the *secret* key on the functions:
//        supabase secrets set TURNSTILE_SECRET_KEY=xxx --project-ref <ref>
//   4. Place <div class="cf-turnstile-slot"></div> in each form (already added).
var TURNSTILE_SITE_KEY = "";

(function () {
  var widgetId = null;

  if (TURNSTILE_SITE_KEY) {
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = function () {
      var slot = document.querySelector(".cf-turnstile-slot");
      if (slot && window.turnstile) {
        widgetId = window.turnstile.render(slot, { sitekey: TURNSTILE_SITE_KEY });
      }
    };
    document.head.appendChild(s);
  }

  // Current token, or undefined when Turnstile isn't configured/ready. The
  // server treats "no token" as a pass while TURNSTILE_SECRET_KEY is unset,
  // so this is safe to call unconditionally from the form handlers.
  window.turnstileToken = function () {
    if (!TURNSTILE_SITE_KEY || !window.turnstile || widgetId === null) return undefined;
    try { return window.turnstile.getResponse(widgetId); } catch (e) { return undefined; }
  };

  window.turnstileReset = function () {
    if (TURNSTILE_SITE_KEY && window.turnstile && widgetId !== null) {
      try { window.turnstile.reset(widgetId); } catch (e) { /* noop */ }
    }
  };
})();
