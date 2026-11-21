(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  app.innerHTML = `
    <header>
      <span class="brand"><i></i>ADAM</span>
      <select id="engine" title="Cérebro">
        <option value="auto">Pro + Ollama reserva</option>
        <option value="pro">Só Adam Pro</option>
        <option value="local">Só Ollama local</option>
      </select>
      <button id="new" title="Nova conversa">＋</button>
      <button id="cfg" title="Configurações">⚙</button>
    </header>
    <div id="keyWarn" class="warn hidden">Configure sua chave de API do Adam para usar o Adam Pro. <a id="setKey">Configurar chave</a></div>
    <main id="log"><div class="empty">Peça algo sobre seu projeto:<br><em>“Corrija o erro de build”</em>, <em>“Adicione validação no formulário de login”</em>, <em>“Explique como funciona a autenticação”</em>.</div></main>
    <footer>
      <textarea id="input" rows="3" placeholder="O que o Adam deve fazer? (Enter envia, Shift+Enter quebra linha)"></textarea>
      <div class="row"><span id="status"></span><button id="stop" class="hidden">Parar</button><button id="send" class="primary">Enviar</button></div>
    </footer>`;
  const $ = (id) => document.getElementById(id);
  const log = $("log"), input = $("input");

  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function md(text) {
    const parts = text.split(/```[\w-]*\n?/);
    return parts.map((p, i) => (i % 2 ? `<pre><code>${esc(p.replace(/\n$/, ""))}</code></pre>` :
      esc(p).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/^#{1,4} (.*)$/gm, "<b>$1</b>").replace(/\n/g, "<br>"))).join("");
  }
  function add(cls, html) {
    log.querySelector(".empty")?.remove();
    const d = document.createElement("div");
    d.className = `msg ${cls}`;
    d.innerHTML = html;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  function send() {
    const t = input.value.trim();
    if (!t) return;
    vscode.postMessage({ type: "task", text: t });
    input.value = "";
  }

  $("send").onclick = send;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  $("stop").onclick = () => vscode.postMessage({ type: "stop" });
  $("new").onclick = () => vscode.postMessage({ type: "new" });
  $("cfg").onclick = () => vscode.postMessage({ type: "settings" });
  $("setKey").onclick = () => vscode.postMessage({ type: "setKey" });
  $("engine").onchange = (e) => vscode.postMessage({ type: "engine", value: e.target.value });

  window.addEventListener("message", ({ data: m }) => {
    if (m.type === "user") add("user", esc(m.text).replace(/\n/g, "<br>"));
    else if (m.type === "assistant") add("assistant", `<div class="who">Adam · ${esc(m.engine || "")}</div>${md(m.text)}`);
    else if (m.type === "tool") add(`tool ${m.ok === false ? "bad" : ""}`, `› ${esc(m.text)}`);
    else if (m.type === "notice") add("notice", esc(m.text));
    else if (m.type === "error") add("error", esc(m.text));
    else if (m.type === "clear") log.innerHTML = "";
    else if (m.type === "busy") { $("stop").classList.toggle("hidden", !m.value); $("send").disabled = m.value; $("status").textContent = m.value ? "Adam trabalhando…" : ""; }
    else if (m.type === "state") { $("engine").value = m.engine; $("keyWarn").classList.toggle("hidden", m.hasKey || m.engine === "local"); }
    else if (m.type === "ask") {
      const d = add("ask", `<div>${esc(m.text)}</div>${m.detail ? `<pre><code>${esc(m.detail)}</code></pre>` : ""}<div class="row"><button class="primary" data-ok="1">${esc(m.okLabel)}</button><button data-ok="0">Negar</button></div>`);
      d.id = `ask-${m.id}`;
      d.querySelectorAll("button").forEach((b) => (b.onclick = () => vscode.postMessage({ type: "answer", id: m.id, ok: b.dataset.ok === "1" })));
    } else if (m.type === "askDone") {
      const d = $(`ask-${m.id}`);
      if (d) d.querySelector(".row").outerHTML = `<div class="answered">${m.ok ? "✓ Aprovado" : "✕ Negado"}</div>`;
    }
  });
  vscode.postMessage({ type: "ready" });
})();
