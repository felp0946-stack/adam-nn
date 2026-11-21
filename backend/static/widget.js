(function () {
  var script = document.currentScript;
  if (!script) return;
  var KEY = script.getAttribute("data-key");
  var SERVER = new URL(script.src).origin;
  var POS = script.getAttribute("data-position") === "left" ? "left" : "right";
  if (!KEY || window.__adamWidget) return;
  window.__adamWidget = true;
  var STORE = "adam-widget-" + KEY;
  var state = { open: false, busy: false, cid: localStorage.getItem(STORE) || null, cfg: { title: "Adam", greeting: "Olá! Como posso ajudar?", color: "#E07A5F" } };

  var host = document.createElement("div");
  host.style.cssText = "position:fixed;bottom:20px;" + POS + ":20px;z-index:2147483000;";
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });

  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function md(s) {
    return esc(s)
      .replace(/```([\s\S]*?)```/g, "<pre>$1</pre>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, "<br>");
  }

  function render() {
    var c = state.cfg.color;
    root.innerHTML =
      "<style>" +
      "*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,sans-serif}" +
      ".btn{width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:" + c + ";color:#fff;font:700 20px system-ui;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:transform .2s}" +
      ".btn:hover{transform:scale(1.06)}" +
      ".panel{position:absolute;bottom:72px;" + POS + ":0;width:min(370px,calc(100vw - 40px));height:min(540px,calc(100vh - 120px));background:#0f1017;color:#eee;border:1px solid rgba(255,255,255,.1);border-radius:18px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.5)}" +
      ".hd{padding:14px 16px;background:" + c + ";color:#fff;font-weight:600;display:flex;justify-content:space-between;align-items:center}" +
      ".hd small{display:block;font-weight:400;opacity:.85;font-size:11px}" +
      ".x{background:none;border:0;color:#fff;font-size:20px;cursor:pointer}" +
      ".msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;font-size:14px;line-height:1.5}" +
      ".m{max-width:85%;padding:9px 12px;border-radius:14px;word-wrap:break-word}" +
      ".u{align-self:flex-end;background:#232533}.a{align-self:flex-start;background:#181a24;border:1px solid rgba(255,255,255,.06)}" +
      ".a a{color:#F4A261}pre{white-space:pre-wrap;background:#0a0a0f;padding:8px;border-radius:8px;font-size:12px}" +
      "form{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,.08)}" +
      "input{flex:1;background:#181a24;border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#fff;padding:10px;font-size:14px;outline:none}" +
      ".send{background:" + c + ";border:0;color:#fff;border-radius:10px;padding:0 14px;cursor:pointer;font-weight:600}" +
      ".ft{text-align:center;font-size:10px;color:#666;padding:0 0 8px}" +
      "</style>" +
      (state.open
        ? '<div class="panel"><div class="hd"><div>' + esc(state.cfg.title) + "<small>Online agora</small></div><button class=\"x\" data-testid=\"adam-widget-close\">×</button></div>" +
          '<div class="msgs"></div><form><input placeholder="Digite sua mensagem…" data-testid="adam-widget-input"/><button class="send" data-testid="adam-widget-send">➤</button></form><div class="ft">Feito com Adam AI</div></div>'
        : "") +
      '<button class="btn" data-testid="adam-widget-launcher">' + (state.open ? "×" : "A") + "</button>";
    root.querySelector(".btn").onclick = function () { state.open = !state.open; render(); };
    if (!state.open) return;
    root.querySelector(".x").onclick = function () { state.open = false; render(); };
    var box = root.querySelector(".msgs");
    var hist = JSON.parse(localStorage.getItem(STORE + "-h") || "[]");
    if (!hist.length) hist = [{ r: "a", t: state.cfg.greeting }];
    hist.forEach(function (h) { add(h.r, h.t, false); });
    var input = root.querySelector("input");
    input.focus();
    root.querySelector("form").onsubmit = function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text || state.busy) return;
      input.value = "";
      add("u", text, true);
      var typing = add("a", "…", false);
      state.busy = true;
      fetch(SERVER + "/api/widget/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: KEY, message: text, conversation_id: state.cid }),
      }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.detail || "Erro"); return d; }); })
        .then(function (d) { state.cid = d.conversation_id; localStorage.setItem(STORE, d.conversation_id); typing.remove(); add("a", d.reply, true); })
        .catch(function (err) { typing.remove(); add("a", "Desculpe: " + err.message, false); })
        .finally(function () { state.busy = false; });
    };
    function add(r, t, save) {
      var el = document.createElement("div");
      el.className = "m " + r;
      el.innerHTML = r === "a" ? md(t) : esc(t);
      box.appendChild(el);
      box.scrollTop = box.scrollHeight;
      if (save) { var h = JSON.parse(localStorage.getItem(STORE + "-h") || "[]"); h.push({ r: r, t: t }); localStorage.setItem(STORE + "-h", JSON.stringify(h.slice(-40))); }
      return el;
    }
  }

  fetch(SERVER + "/api/widget/config/" + encodeURIComponent(KEY))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) { if (cfg) { state.cfg = cfg; render(); } });
})();
