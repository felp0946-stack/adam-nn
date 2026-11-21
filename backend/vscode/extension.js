const vscode = require("vscode");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const SYSTEM = `Você é Adam, assistente de programação criado por Felipe Hudson (Belo Horizonte, Brasil), rodando dentro do VS Code do usuário.
Você tem acesso ao projeto aberto por meio de ferramentas. O usuário aprova cada edição e cada comando.
Como trabalhar:
1. Entenda o pedido. Explore antes de agir: listar_arquivos, buscar_texto e ler_arquivo.
2. Para bugs, use ler_diagnosticos e leia o código ao redor do erro. Ache a causa raiz.
3. Faça mudanças mínimas. Prefira editar_arquivo (trecho exato copiado do arquivo) a reescrever arquivos. Use escrever_arquivo para arquivos novos.
4. Quando útil, rode testes ou build com executar_comando. Nunca rode comandos destrutivos sem o usuário pedir.
5. Se uma ação for negada, não insista.
6. Ao terminar, responda sem ferramentas, em português, com um resumo curto: o que encontrou, o que mudou e como testar.`;

const fn = (name, description, properties, required) => ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });
const S = { type: "string" }, I = { type: "integer" };
const TOOLS = [
  fn("listar_arquivos", "Lista os arquivos do projeto (ou de uma pasta).", { pasta: S }, []),
  fn("ler_arquivo", "Lê um arquivo com números de linha.", { caminho: S, linha_inicio: I, linha_fim: I }, ["caminho"]),
  fn("buscar_texto", "Busca texto ou regex nos arquivos. glob opcional.", { padrao: S, glob: S }, ["padrao"]),
  fn("ler_diagnosticos", "Lista erros e avisos do VS Code.", { caminho: S }, []),
  fn("escrever_arquivo", "Cria ou substitui um arquivo inteiro.", { caminho: S, conteudo: S }, ["caminho", "conteudo"]),
  fn("editar_arquivo", "Substitui um trecho exato (único) de um arquivo.", { caminho: S, procurar: S, substituir: S }, ["caminho", "procurar", "substituir"]),
  fn("executar_comando", "Executa um comando na raiz do projeto.", { comando: S }, ["comando"]),
];
const SKIP = "**/{node_modules,.git,dist,build,.next,out,venv,.venv,__pycache__,coverage,.cache}/**";

let ext, view, out, busy = false, stopFlag = false, serverSession = null, localHistory = null;
const proposed = new Map();
const pendingAsk = new Map();

const cfg = () => vscode.workspace.getConfiguration("adam");
const post = (msg) => view && view.webview.postMessage(msg);
const root = () => vscode.workspace.workspaceFolders?.[0]?.uri;
const rel = (uri) => vscode.workspace.asRelativePath(uri, false);

function resolvePath(p) {
  const r = root();
  if (!r) throw new Error("Abra uma pasta de projeto no VS Code.");
  const abs = path.resolve(r.fsPath, p || ".");
  if (abs !== r.fsPath && !abs.startsWith(r.fsPath + path.sep)) throw new Error("Caminho fora do projeto.");
  return vscode.Uri.file(abs);
}

async function docText(uri) {
  try { return (await vscode.workspace.openTextDocument(uri)).getText(); }
  catch { return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8"); }
}

async function listFiles(a) {
  const pattern = a.pasta ? new vscode.RelativePattern(resolvePath(a.pasta), "**/*") : "**/*";
  const uris = await vscode.workspace.findFiles(pattern, SKIP, 800);
  return uris.map(rel).sort().join("\n") || "(vazio)";
}

async function readFile(a) {
  const uri = resolvePath(a.caminho);
  const lines = (await docText(uri)).split("\n");
  const s = Math.max(1, a.linha_inicio || 1), e = Math.min(lines.length, a.linha_fim || lines.length);
  return `${rel(uri)} (${lines.length} linhas)\n` + lines.slice(s - 1, e).map((l, i) => `${s + i}| ${l}`).join("\n").slice(0, 60000);
}

async function searchText(a) {
  let rx;
  try { rx = new RegExp(a.padrao, "i"); } catch { rx = new RegExp(a.padrao.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
  const hits = [];
  for (const u of await vscode.workspace.findFiles(a.glob || "**/*", SKIP, 3000)) {
    if (hits.length >= 150) break;
    let b;
    try { b = await vscode.workspace.fs.readFile(u); } catch { continue; }
    if (b.length > 1e6 || b.includes(0)) continue;
    Buffer.from(b).toString("utf8").split("\n").forEach((l, i) => {
      if (hits.length < 150 && rx.test(l)) hits.push(`${rel(u)}:${i + 1}: ${l.trim().slice(0, 200)}`);
    });
  }
  return hits.join("\n") || "Nenhum resultado.";
}

function diagnostics(a) {
  const sev = ["Erro", "Aviso"];
  const res = [];
  for (const [uri, ds] of vscode.languages.getDiagnostics()) {
    if (a.caminho && rel(uri) !== a.caminho) continue;
    for (const d of ds) if (d.severity <= 1) res.push(`${rel(uri)}:${d.range.start.line + 1}: [${sev[d.severity]}] ${d.message}`);
  }
  return res.slice(0, 200).join("\n") || "Nenhum erro ou aviso.";
}

function ask(text, okLabel, detail) {
  return new Promise((resolve) => {
    const id = crypto.randomBytes(4).toString("hex");
    let done = false;
    const finish = (v) => { if (done) return; done = true; pendingAsk.delete(id); post({ type: "askDone", id, ok: v }); resolve(v); };
    pendingAsk.set(id, finish);
    post({ type: "ask", id, text, detail, okLabel });
    vscode.window.showInformationMessage(text, okLabel, "Negar").then((c) => c && finish(c === okLabel));
  });
}

async function proposeChange(uri, newText) {
  let exists = true;
  try { await vscode.workspace.fs.stat(uri); } catch { exists = false; }
  const key = crypto.randomBytes(6).toString("hex");
  proposed.set(key, newText);
  const right = vscode.Uri.parse(`adam-proposed:/${rel(uri)}?${key}`);
  const left = exists ? uri : vscode.Uri.parse("adam-proposed:/novo-arquivo?empty");
  await vscode.commands.executeCommand("vscode.diff", left, right, `Adam ↔ ${rel(uri)}`, { preview: true });
  const ok = await ask(`O Adam quer ${exists ? "alterar" : "criar"} ${rel(uri)}. Veja a diferença no editor.`, "Aplicar");
  if (vscode.window.activeTextEditor?.document.uri.scheme === "adam-proposed") await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  proposed.delete(key);
  if (!ok) return { denied: true };
  const we = new vscode.WorkspaceEdit();
  if (exists) {
    const doc = await vscode.workspace.openTextDocument(uri);
    we.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), newText);
  } else {
    we.createFile(uri, { ignoreIfExists: true });
    we.insert(uri, new vscode.Position(0, 0), newText);
  }
  await vscode.workspace.applyEdit(we);
  await (await vscode.workspace.openTextDocument(uri)).save();
  post({ type: "tool", text: `${exists ? "Alterou" : "Criou"} ${rel(uri)}`, ok: true });
  return { output: `Arquivo ${rel(uri)} salvo.` };
}

async function editFile(a) {
  const uri = resolvePath(a.caminho);
  const text = await docText(uri);
  const n = a.procurar ? text.split(a.procurar).length - 1 : 0;
  if (n === 0) return { error: "Trecho não encontrado. Leia o arquivo de novo e copie o trecho exato, com espaços e quebras de linha." };
  if (n > 1) return { error: `O trecho aparece ${n} vezes. Inclua mais linhas de contexto para ficar único.` };
  return proposeChange(uri, text.replace(a.procurar, () => a.substituir));
}

async function runCommand(a) {
  const ok = await ask("O Adam quer executar um comando no terminal:", "Executar", a.comando);
  if (!ok) return { denied: true };
  out.appendLine(`\n$ ${a.comando}`);
  out.show(true);
  return new Promise((res) => {
    cp.exec(a.comando, { cwd: root().fsPath, timeout: 180000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (err.killed ? "tempo esgotado" : err.code ?? 1) : 0;
      out.append(stdout + stderr);
      post({ type: "tool", text: `Executou: ${a.comando} (saída ${code})`, ok: code === 0 });
      res({ output: `código de saída: ${code}\n${stdout}\n${stderr}`.slice(-15000) });
    });
  });
}

const LABELS = { listar_arquivos: (a) => `Listando ${a.pasta || "projeto"}`, ler_arquivo: (a) => `Lendo ${a.caminho}`, buscar_texto: (a) => `Buscando “${a.padrao}”`, ler_diagnosticos: () => "Lendo erros do VS Code" };

async function execTool(name, args) {
  args = args || {};
  if (LABELS[name]) post({ type: "tool", text: LABELS[name](args) });
  try {
    switch (name) {
      case "listar_arquivos": return { output: await listFiles(args) };
      case "ler_arquivo": return { output: await readFile(args) };
      case "buscar_texto": return { output: await searchText(args) };
      case "ler_diagnosticos": return { output: diagnostics(args) };
      case "escrever_arquivo": return await proposeChange(resolvePath(args.caminho), args.conteudo || "");
      case "editar_arquivo": return await editFile(args);
      case "executar_comando": return await runCommand(args);
      default: return { error: `Ferramenta desconhecida: ${name}` };
    }
  } catch (e) { return { error: e.message }; }
}

async function gatherContext(full) {
  const lines = [];
  if (root()) {
    lines.push(`Projeto: ${vscode.workspace.name}`);
    if (full) lines.push("Arquivos (parcial):\n" + (await vscode.workspace.findFiles("**/*", SKIP, 300)).map(rel).sort().join("\n"));
  } else lines.push("Nenhuma pasta aberta no VS Code.");
  const ed = vscode.window.activeTextEditor;
  if (ed && ed.document.uri.scheme === "file") {
    lines.push(`Arquivo aberto: ${rel(ed.document.uri)} (cursor na linha ${ed.selection.active.line + 1})`);
    if (!ed.selection.isEmpty) lines.push("Seleção:\n```\n" + ed.document.getText(ed.selection).slice(0, 8000) + "\n```");
  }
  return lines.join("\n\n");
}

async function serverCall(route, body) {
  const key = await ext.secrets.get("adam.apiKey");
  const server = (cfg().get("server") || "").replace(/\/$/, "");
  if (!key || !server) throw new Error("Chave de API do Adam não configurada");
  const r = await fetch(`${server}/api/v1/code${route}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `Servidor respondeu ${r.status}`);
  return data;
}

async function runServer(task) {
  let res = await serverCall("/start", { task, context: await gatherContext(!serverSession), session_id: serverSession });
  serverSession = res.session_id;
  while (true) {
    if (res.message) post({ type: "assistant", text: res.message, engine: "Adam Pro" });
    if (res.done || !res.action) return;
    if (stopFlag) { await serverCall(`/${res.session_id}/stop`, {}).catch(() => {}); serverSession = null; return; }
    const result = await execTool(res.action.name, res.action.args);
    res = await serverCall(`/${res.session_id}/step`, { tool_call_id: res.action.id, result });
  }
}

async function ollama(messages) {
  const url = (cfg().get("ollamaUrl") || "http://localhost:11434").replace(/\/$/, "");
  let r;
  try {
    r = await fetch(`${url}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: cfg().get("ollamaModel") || "qwen2.5", messages, tools: TOOLS, stream: false }) });
  } catch { throw new Error(`Não consegui falar com o Ollama em ${url}. Ele está rodando (ollama serve)?`); }
  if (!r.ok) throw new Error(`Ollama respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).message || {};
}

async function runLocal(task) {
  if (!localHistory) localHistory = [{ role: "system", content: SYSTEM }];
  localHistory.push({ role: "user", content: `${task}\n\n[Contexto do VS Code]\n${await gatherContext(localHistory.length === 1)}` });
  const label = `Ollama · ${cfg().get("ollamaModel")}`;
  for (let i = 0; i < 40 && !stopFlag; i++) {
    const msg = await ollama(localHistory);
    localHistory.push(msg);
    if (msg.content) post({ type: "assistant", text: msg.content, engine: label });
    if (!msg.tool_calls?.length) return;
    for (const tc of msg.tool_calls) {
      let args = tc.function?.arguments || {};
      if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
      const res = await execTool(tc.function?.name, args);
      const content = res.denied ? "O usuário NEGOU esta ação. Não repita." : res.error ? `Erro: ${res.error}` : String(res.output).slice(0, 30000);
      localHistory.push({ role: "tool", content, tool_name: tc.function?.name });
    }
  }
}

async function handleTask(task) {
  if (busy || !task.trim()) return;
  busy = true; stopFlag = false;
  post({ type: "user", text: task });
  post({ type: "busy", value: true });
  const engine = cfg().get("engine");
  try {
    if (engine === "local") await runLocal(task);
    else {
      try { await runServer(task); }
      catch (e) {
        if (engine === "pro" || stopFlag) throw e;
        serverSession = null;
        post({ type: "notice", text: `Adam Pro indisponível (${e.message}). Usando o Ollama local…` });
        await runLocal(task);
      }
    }
    if (stopFlag) post({ type: "notice", text: "Tarefa interrompida." });
  } catch (e) { post({ type: "error", text: e.message }); }
  busy = false;
  post({ type: "busy", value: false });
}

function stopAll() {
  stopFlag = true;
  for (const finish of [...pendingAsk.values()]) finish(false);
}

async function setApiKey() {
  const v = await vscode.window.showInputBox({ prompt: "Cole sua chave de API do Adam (Adam → API & Chaves)", password: true, ignoreFocusOut: true, placeHolder: "adam_live_..." });
  if (v === undefined) return;
  await ext.secrets.store("adam.apiKey", v.trim());
  sendState();
  vscode.window.showInformationMessage("Chave do Adam salva.");
}

async function sendState() {
  post({ type: "state", hasKey: !!(await ext.secrets.get("adam.apiKey")), engine: cfg().get("engine"), model: cfg().get("ollamaModel") });
}

function newChat() { stopAll(); serverSession = null; localHistory = null; post({ type: "clear" }); }

class ChatView {
  resolveWebviewView(v) {
    view = v;
    const media = vscode.Uri.joinPath(ext.extensionUri, "media");
    v.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = crypto.randomBytes(12).toString("hex");
    v.webview.html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${v.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${v.webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.css"))}"></head>
<body><div id="app"></div><script nonce="${nonce}" src="${v.webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.js"))}"></script></body></html>`;
    v.webview.onDidReceiveMessage((m) => {
      if (m.type === "task") handleTask(m.text);
      else if (m.type === "stop") stopAll();
      else if (m.type === "answer") pendingAsk.get(m.id)?.(m.ok);
      else if (m.type === "new") newChat();
      else if (m.type === "setKey") setApiKey();
      else if (m.type === "settings") vscode.commands.executeCommand("workbench.action.openSettings", "adam.");
      else if (m.type === "engine") cfg().update("engine", m.value, vscode.ConfigurationTarget.Global).then(sendState);
      else if (m.type === "ready") sendState();
    });
  }
}

async function focusAndRun(task) {
  await vscode.commands.executeCommand("workbench.view.extension.adam");
  setTimeout(() => handleTask(task), view ? 0 : 800);
}

function activate(context) {
  ext = context;
  out = vscode.window.createOutputChannel("Adam");
  context.subscriptions.push(
    out,
    vscode.window.registerWebviewViewProvider("adam.chat", new ChatView(), { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.registerTextDocumentContentProvider("adam-proposed", { provideTextDocumentContent: (u) => (u.query === "empty" ? "" : proposed.get(u.query) || "") }),
    vscode.commands.registerCommand("adam.setApiKey", setApiKey),
    vscode.commands.registerCommand("adam.newChat", newChat),
    vscode.commands.registerCommand("adam.askSelection", () => focusAndRun("Explique o código selecionado e aponte bugs ou melhorias.")),
    vscode.commands.registerCommand("adam.fixProblems", () => focusAndRun("Use ler_diagnosticos no arquivo aberto e corrija os erros encontrados.")),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("adam") && sendState()),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
