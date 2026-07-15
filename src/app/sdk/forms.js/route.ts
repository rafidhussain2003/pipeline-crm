// Website Forms SDK, served at /sdk/forms.js (Phase 8). A customer pastes ONE
// line — <script src="https://ziplod.com/sdk/forms.js" data-key="PUBLIC_KEY">
// — and every lead-shaped form on their site (any framework) starts creating
// CRM leads. No per-form attributes needed: it AUTO-DETECTS forms that have an
// email or phone field (skipping login/search forms and anything tagged
// data-ziplod-ignore). Each submission carries a nonce + timestamp so the
// endpoint can reject replays, and the browser's Origin/Referer let the
// endpoint enforce the connection's allowed-domains list.
//
// Dependency-free, tiny, long-cached. Superset of the older /embed.js (which
// still works for explicitly-tagged forms).
const SCRIPT = `(function(){
  var s = document.currentScript;
  var key = s ? s.getAttribute("data-key") : null;
  var base = s ? new URL(s.src).origin : location.origin;
  if (!key) { return; }
  function uuid(){ try { return crypto.randomUUID(); } catch(e){ return Date.now().toString(36)+Math.random().toString(36).slice(2); } }
  function meta(){
    var p = new URLSearchParams(location.search); var tz="";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(e){}
    return {
      utm_source:p.get("utm_source"), utm_medium:p.get("utm_medium"), utm_campaign:p.get("utm_campaign"),
      utm_term:p.get("utm_term"), utm_content:p.get("utm_content"),
      referrer: document.referrer || null, landingPage: location.href, timezone: tz,
      nonce: uuid(), ts: Date.now(), origin: location.origin
    };
  }
  function isLeadForm(form){
    if (form.hasAttribute("data-ziplod-ignore")) return false;
    if ((form.getAttribute("method")||"post").toLowerCase() === "get") return false;      // search boxes
    if (form.querySelector("input[type=password]")) return false;                          // login/signup
    return !!(form.querySelector("input[type=email]") || form.querySelector("input[type=tel]")
      || form.querySelector("input[name*='email' i]") || form.querySelector("input[name*='phone' i]"));
  }
  function wire(form){
    if (form.__ziplod) return;
    var explicit = form.hasAttribute("data-ziplod-form");
    if (!explicit && !isLeadForm(form)) return;
    form.__ziplod = true;
    var hp = document.createElement("input");
    hp.type="text"; hp.name="_gotcha"; hp.tabIndex=-1; hp.autocomplete="off"; hp.setAttribute("aria-hidden","true");
    hp.style.cssText="position:absolute!important;left:-9999px!important;top:auto!important;width:1px;height:1px;opacity:0";
    form.appendChild(hp);
    form.addEventListener("submit", function(e){
      e.preventDefault();
      var fd = new FormData(form), fields = {};
      fd.forEach(function(v,k){ if(typeof v==="string") fields[k]=v; });
      fields._meta = meta();
      var id = form.getAttribute("data-ziplod-form") || key;
      var btn = form.querySelector("[type=submit],button:not([type=button])");
      if(btn) btn.disabled = true;
      fetch(base + "/api/forms/" + id, {
        method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(fields)
      }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); }).then(function(res){
        if (!res.ok) { if(btn) btn.disabled=false; return; }
        var redirect = form.getAttribute("data-ziplod-redirect");
        if (redirect) { location.href = redirect; return; }
        var msg = form.getAttribute("data-ziplod-success") || "Thanks! We'll be in touch shortly.";
        form.innerHTML = '<div style="padding:14px;color:#065f46;font:14px system-ui,sans-serif">' + msg + '</div>';
      }).catch(function(){ if(btn) btn.disabled = false; });
    });
  }
  function scan(){ var f = document.querySelectorAll("form"); for (var i=0;i<f.length;i++) wire(f[i]); }
  if (document.readyState !== "loading") scan(); else document.addEventListener("DOMContentLoaded", scan);
  try { new MutationObserver(scan).observe(document.documentElement, { childList:true, subtree:true }); } catch(e){}
})();`;

export function GET() {
  return new Response(SCRIPT, {
    status: 200,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
