// Public embed loader served at /embed.js. A customer drops
// <script src="https://ziplod.com/embed.js"></script> on any site (WordPress,
// Shopify, Webflow, plain HTML, React, …) and tags any form with
// data-ziplod-form="SOURCE_ID"; this wires that form to POST straight into
// the CRM. Endpoint origin is derived from where the script itself was
// loaded, so there's nothing else to configure. Long-cached, CORS-open (it's
// a static asset). Kept tiny and dependency-free so it loads instantly.
const SCRIPT = `(function(){
  var s = document.currentScript;
  var base = s ? new URL(s.src).origin : location.origin;
  function meta(){
    var p = new URLSearchParams(location.search);
    var tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(e){}
    return {
      utm_source:p.get("utm_source"), utm_medium:p.get("utm_medium"), utm_campaign:p.get("utm_campaign"),
      utm_term:p.get("utm_term"), utm_content:p.get("utm_content"),
      referrer: document.referrer || null, landingPage: location.href, timezone: tz
    };
  }
  function wire(form){
    if (form.__ziplod) return; form.__ziplod = true;
    var id = form.getAttribute("data-ziplod-form"); if(!id) return;
    // Auto-injected honeypot: bots fill it, humans never see it.
    var hp = document.createElement("input");
    hp.type="text"; hp.name="_gotcha"; hp.tabIndex=-1; hp.autocomplete="off"; hp.setAttribute("aria-hidden","true");
    hp.style.cssText="position:absolute!important;left:-9999px!important;top:auto!important;width:1px;height:1px;opacity:0";
    form.appendChild(hp);
    form.addEventListener("submit", function(e){
      e.preventDefault();
      var fd = new FormData(form), fields = {};
      fd.forEach(function(v,k){ if(typeof v==="string") fields[k]=v; });
      fields._meta = meta();
      var btn = form.querySelector("[type=submit],button:not([type=button])");
      if(btn) btn.disabled = true;
      fetch(base + "/api/forms/" + id, {
        method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(fields)
      }).then(function(r){ return r.json(); }).then(function(){
        var redirect = form.getAttribute("data-ziplod-redirect");
        if (redirect) { location.href = redirect; return; }
        var msg = form.getAttribute("data-ziplod-success") || "Thanks! We'll be in touch shortly.";
        form.innerHTML = '<div style="padding:14px;color:#065f46;font:14px system-ui,sans-serif">' + msg + '</div>';
      }).catch(function(){
        if(btn) btn.disabled = false;
        alert("Sorry, something went wrong. Please try again.");
      });
    });
  }
  function scan(){ var f = document.querySelectorAll("form[data-ziplod-form]"); for (var i=0;i<f.length;i++) wire(f[i]); }
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
