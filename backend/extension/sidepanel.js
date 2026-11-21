/* global chrome */
const $ = (id) => document.getElementById(id);

function render(task) {
  const box = $("log");
  box.innerHTML = "";
  const intro = document.createElement("div");
  intro.className = "msg adam";
  intro.innerHTML = "Olá! Eu sou o Adam. Diga o que devo fazer nesta aba. Posso trabalhar em <b>segundo plano</b>: feche este painel ou mude de aba que eu continuo e te aviso com uma notificação quando terminar.";
  box.appendChild(intro);
  (task?.log || []).forEach((l) => {
    const el = document.createElement("div");
    el.className = `msg ${l.cls}`;
    el.textContent = l.text;
    box.appendChild(el);
  });
  box.scrollTop = box.scrollHeight;
  const running = task?.status === "running";
  $("run").disabled = running;
  $("stop").classList.toggle("hidden", !running);
  $("status").textContent = running ? `Trabalhando… ${task.steps} passos` : task?.status === "done" ? "Concluído" : "";
  $("approval").classList.toggle("hidden", !task?.pendingApproval);
  if (task?.pendingApproval) $("approvalText").textContent = `O Adam quer: ${task.pendingApproval}`;
}

chrome.runtime.onMessage.addListener((msg) => { if (msg.type === "state") render(msg.task); });
chrome.runtime.sendMessage({ type: "get" }, (r) => render(r?.task));

async function run() {
  const text = $("task").value.trim();
  const { apiKey, askEach } = await chrome.storage.local.get({ apiKey: "", askEach: true });
  if (!text) return;
  if (!apiKey) { $("cfg").classList.remove("hidden"); return; }
  $("task").value = "";
  chrome.runtime.sendMessage({ type: "run", text, askEach }, (r) => { if (r?.error) alert(r.error); });
}

$("run").onclick = run;
$("task").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } });
$("stop").onclick = () => chrome.runtime.sendMessage({ type: "stop" });
$("allow").onclick = () => chrome.runtime.sendMessage({ type: "approve", ok: true });
$("allowAll").onclick = () => chrome.runtime.sendMessage({ type: "approve", ok: true, all: true });
$("deny").onclick = () => chrome.runtime.sendMessage({ type: "approve", ok: false });
$("cfgBtn").onclick = () => $("cfg").classList.toggle("hidden");
$("saveCfg").onclick = async () => {
  await chrome.storage.local.set({ apiKey: $("apiKey").value.trim(), askEach: $("askEach").checked });
  $("cfg").classList.add("hidden");
};
chrome.storage.local.get({ apiKey: "", askEach: true }).then((c) => {
  $("apiKey").value = c.apiKey;
  $("askEach").checked = c.askEach;
  if (!c.apiKey) $("cfg").classList.remove("hidden");
});
