/* global ADAM_SERVER, chrome, importScripts */
importScripts("config.js");
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

let task = null;
let approvalResolver = null;
let keepAlive = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LABELS = {
  clicar: (a) => `Clicar no elemento [${a.indice}]`,
  digitar: (a) => `Digitar "${a.texto}" no campo [${a.indice}]${a.enviar ? " e enviar" : ""}`,
  navegar: (a) => `Abrir ${a.url}`,
  rolar: (a) => `Rolar para ${a.direcao}`,
  voltar: () => "Voltar à página anterior",
  ler_pagina: () => "Ler a página",
  aguardar: (a) => `Aguardar ${a.segundos}s`,
};

function publish() {
  chrome.storage.session.set({ task });
  chrome.runtime.sendMessage({ type: "state", task }).catch(() => {});
}

function log(text, cls = "adam") {
  task.log.push({ text, cls, at: Date.now() });
  publish();
}

function notify(id, title, message, extra = {}) {
  chrome.notifications.create(id, { type: "basic", iconUrl: "icon.png", title, message: message.slice(0, 250), priority: 2, ...extra });
}

function snapshotInPage() {
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[onclick],[contenteditable=true]';
  document.querySelectorAll("[data-adam-idx]").forEach((e) => e.removeAttribute("data-adam-idx"));
  const els = [];
  let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === "hidden" || st.display === "none") continue;
    if (r.bottom < -200 || r.top > innerHeight * 2.5) continue;
    el.setAttribute("data-adam-idx", String(i));
    const label = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "").trim().replace(/\s+/g, " ");
    els.push({ i, tag: el.tagName.toLowerCase(), type: el.getAttribute("type") || "", label: label.slice(0, 100), href: el.getAttribute("href") || "" });
    if (++i >= 120) break;
  }
  return { url: location.href, title: document.title, text: (document.body?.innerText || "").slice(0, 4000), elements: els };
}

function actInPage(name, args) {
  const el = args.indice !== undefined ? document.querySelector(`[data-adam-idx="${args.indice}"]`) : null;
  if ((name === "clicar" || name === "digitar") && !el) return { error: `Elemento [${args.indice}] não encontrado` };
  if (el) {
    el.scrollIntoView({ block: "center" });
    el.style.outline = "3px solid #F4A261";
    setTimeout(() => (el.style.outline = ""), 1200);
  }
  if (name === "clicar") el.click();
  if (name === "digitar") {
    el.focus();
    if (el.isContentEditable) el.textContent = args.texto;
    else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, args.texto);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (args.enviar) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
      if (el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
    }
  }
  if (name === "rolar") window.scrollBy({ top: (args.direcao === "cima" ? -1 : 1) * innerHeight * 0.8, behavior: "smooth" });
  return { ok: true };
}

async function waitLoad(tabId) {
  for (let i = 0; i < 60; i++) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === "complete") return;
    await sleep(250);
  }
}

async function snapshot(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: snapshotInPage });
    return res.result;
  } catch (e) {
    const t = await chrome.tabs.get(tabId).catch(() => ({}));
    return { url: t.url, title: t.title, text: "(Não é possível ler esta página — páginas internas do Chrome são protegidas.)", elements: [] };
  }
}

async function execute(tabId, { name, args }) {
  try {
    if (name === "navegar") {
      await chrome.tabs.update(tabId, { url: /^https?:\/\//.test(args.url) ? args.url : `https://${args.url}` });
      await sleep(600);
      await waitLoad(tabId);
    } else if (name === "voltar") {
      await chrome.tabs.goBack(tabId);
      await sleep(600);
      await waitLoad(tabId);
    } else if (name === "aguardar") {
      await sleep(Math.min(30, Math.max(1, args.segundos || 3)) * 1000);
    } else if (name !== "ler_pagina") {
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: actInPage, args: [name, args] });
      if (res.result?.error) return { error: res.result.error, page: await snapshot(tabId) };
      await sleep(1200);
      await waitLoad(tabId);
    }
    return { page: await snapshot(tabId) };
  } catch (e) {
    return { error: String(e.message || e), page: await snapshot(tabId) };
  }
}

function askPermission(desc) {
  task.pendingApproval = desc;
  publish();
  notify(`adam-approve-${Date.now()}`, "Adam precisa da sua permissão", desc,
    { buttons: [{ title: "Permitir" }, { title: "Negar" }], requireInteraction: true });
  return new Promise((resolve) => { approvalResolver = resolve; });
}

function answerApproval(ok, all = false) {
  if (!approvalResolver) return;
  if (all) task.allowAll = true;
  task.pendingApproval = null;
  const r = approvalResolver;
  approvalResolver = null;
  chrome.notifications.getAll((ns) => Object.keys(ns).filter((k) => k.startsWith("adam-approve")).forEach((k) => chrome.notifications.clear(k)));
  publish();
  r(ok);
}

async function api(path, body) {
  const { apiKey } = await chrome.storage.local.get({ apiKey: "" });
  const r = await fetch(`${ADAM_SERVER}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || `Erro ${r.status}`);
  return d;
}

async function runTask(text, askEach) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  task = { id: Date.now(), text, tabId: tab.id, status: "running", log: [], allowAll: !askEach, pendingApproval: null, stopped: false, steps: 0, summary: "" };
  log(text, "user");
  keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  try {
    let res = await api("/v1/agent/start", { task: text, page: await snapshot(tab.id) });
    task.session = res.session_id;
    while (!task.stopped) {
      if (res.message) { log(res.message); task.summary = res.message; }
      if (res.done || !res.action) break;
      const desc = (LABELS[res.action.name] || (() => res.action.name))(res.action.args || {});
      const auto = task.allowAll || ["ler_pagina", "aguardar", "rolar"].includes(res.action.name);
      const ok = auto || (await askPermission(desc));
      if (task.stopped) break;
      task.steps += 1;
      log(`${ok ? "▶" : "✕"} ${desc}`, "step");
      const result = ok ? await execute(tab.id, res.action) : { denied: true, page: await snapshot(tab.id) };
      res = await api(`/v1/agent/${task.session}/step`, { tool_call_id: res.action.id, result });
    }
    task.status = task.stopped ? "stopped" : "done";
    if (!task.stopped) notify(`adam-done-${task.id}`, "✅ Adam concluiu a tarefa", task.summary || "Tarefa concluída.", { requireInteraction: true });
  } catch (e) {
    task.status = "error";
    log(`Erro: ${e.message}`, "adam err");
    notify(`adam-done-${task.id}`, "⚠️ Adam não conseguiu concluir", e.message);
  } finally {
    clearInterval(keepAlive);
    task.pendingApproval = null;
    publish();
  }
}

chrome.notifications.onButtonClicked.addListener((id, idx) => {
  if (id.startsWith("adam-approve")) answerApproval(idx === 0);
});
chrome.notifications.onClicked.addListener((id) => {
  if (task?.tabId && (id.startsWith("adam-done") || id.startsWith("adam-approve"))) {
    chrome.tabs.update(task.tabId, { active: true }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "get") reply({ task });
  if (msg.type === "run") {
    if (task?.status === "running") reply({ error: "Já existe uma tarefa em andamento." });
    else { runTask(msg.text, msg.askEach); reply({ ok: true }); }
  }
  if (msg.type === "approve") { answerApproval(msg.ok, msg.all); reply({ ok: true }); }
  if (msg.type === "stop" && task) {
    task.stopped = true;
    answerApproval(false);
    if (task.session) api(`/v1/agent/${task.session}/stop`, {}).catch(() => {});
    log("Tarefa interrompida.", "adam err");
    reply({ ok: true });
  }
  return false;
});
