"""Adam browser agent: server-side reasoning loop; the Chrome extension executes each action with user permission."""
import json
import time
import uuid

from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, ToolCallReady, UserMessage

SESSIONS: dict = {}
MAX_STEPS = 80
TTL = 10800

SYSTEM = """Você é Adam, agente de navegador criado por Felipe Hudson (Belo Horizonte, Brasil). Você controla o navegador Chrome do usuário, com a permissão dele, para cumprir tarefas.
A cada passo você recebe o estado da aba: URL, título, texto visível e a lista de elementos interativos numerados [i].
Regras:
- Use UMA ferramenta por vez e sempre os índices da lista mais recente.
- Para pesquisar, navegue para https://www.google.com/search?q=termos
- Pense passo a passo: planeje, aja, observe o resultado e ajuste.
- Nunca digite senhas, dados de cartão, nem finalize compras, pagamentos, envios de formulários sensíveis ou exclusões sem que a tarefa do usuário peça isso explicitamente.
- Se uma ação for negada pelo usuário, não insista: siga outro caminho ou pergunte.
- Tarefas longas: trabalhe com calma, um passo por vez, até concluir. O usuário pode estar em outra aba; você controla apenas a aba da tarefa.
- Quando terminar (ou se não for possível), responda SEM chamar ferramentas, com um resumo claro em português do que fez e do que encontrou."""

BROWSER_TOOLS = [
    {"type": "function", "function": {"name": "clicar", "description": "Clica no elemento de índice informado.",
        "parameters": {"type": "object", "properties": {"indice": {"type": "integer"}}, "required": ["indice"]}}},
    {"type": "function", "function": {"name": "digitar", "description": "Digita texto em um campo. enviar=true pressiona Enter.",
        "parameters": {"type": "object", "properties": {"indice": {"type": "integer"}, "texto": {"type": "string"}, "enviar": {"type": "boolean"}},
                       "required": ["indice", "texto"]}}},
    {"type": "function", "function": {"name": "navegar", "description": "Abre uma URL na aba atual.",
        "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}}},
    {"type": "function", "function": {"name": "rolar", "description": "Rola a página.",
        "parameters": {"type": "object", "properties": {"direcao": {"type": "string", "enum": ["baixo", "cima"]}}, "required": ["direcao"]}}},
    {"type": "function", "function": {"name": "voltar", "description": "Volta para a página anterior.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "ler_pagina", "description": "Lê novamente o estado atual da página.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "aguardar", "description": "Espera alguns segundos (carregamentos lentos, processos longos).",
        "parameters": {"type": "object", "properties": {"segundos": {"type": "integer", "description": "1 a 30"}}, "required": ["segundos"]}}},
]


def page_to_text(p: dict) -> str:
    els = []
    for e in (p.get("elements") or [])[:120]:
        line = f"[{e.get('i')}] <{e.get('tag', '')}{' type=' + e['type'] if e.get('type') else ''}> {str(e.get('label', ''))[:80]}"
        if e.get("href"):
            line += f" -> {str(e['href'])[:90]}"
        els.append(line)
    return (f"URL: {p.get('url', '')}\nTítulo: {p.get('title', '')}\n\nTexto visível:\n{str(p.get('text') or '')[:3500]}"
            f"\n\nElementos interativos:\n{chr(10).join(els) or '(nenhum)'}")


def _gc():
    limit = time.time() - TTL
    for sid in [k for k, s in SESSIONS.items() if s["created"] < limit]:
        SESSIONS.pop(sid, None)


async def _advance(s: dict, msg) -> str:
    text = []
    async for ev in s["chat"].stream_message(msg):
        if isinstance(ev, TextDelta):
            text.append(ev.content)
        elif isinstance(ev, ToolCallReady):
            s["pending"].append(ev.tool_call)
        elif isinstance(ev, StreamDone):
            break
    return "".join(text).strip()


def _next(s: dict, message: str) -> dict:
    if s["pending"]:
        tc = s["pending"][0]
        args = tc.arguments if isinstance(tc.arguments, dict) else json.loads(tc.arguments or "{}")
        return {"session_id": s["id"], "done": False, "message": message, "step": s["steps"],
                "action": {"id": tc.id, "name": tc.name, "args": args}}
    SESSIONS.pop(s["id"], None)
    return {"session_id": s["id"], "done": True, "message": message or "Tarefa concluída.", "step": s["steps"], "action": None}


async def start(api_key: str, model: tuple, user_id: str, task: str, page: dict, context: str = "") -> dict:
    _gc()
    sid = str(uuid.uuid4())
    chat = LlmChat(api_key=api_key, session_id=sid, system_message=SYSTEM + context).with_model(*model).with_tools(BROWSER_TOOLS, tool_choice="auto")
    s = {"id": sid, "user_id": user_id, "chat": chat, "pending": [], "steps": 0, "created": time.time()}
    SESSIONS[sid] = s
    msg = await _advance(s, UserMessage(text=f"Tarefa: {task}\n\nEstado atual da página:\n{page_to_text(page)}"))
    return _next(s, msg)


async def step(sid: str, user_id: str, tool_call_id: str, result: dict) -> dict:
    s = SESSIONS.get(sid)
    if not s or s["user_id"] != user_id:
        raise KeyError("Sessão não encontrada ou expirada")
    if not s["pending"] or s["pending"][0].id != tool_call_id:
        raise KeyError("Ação inesperada")
    tc = s["pending"].pop(0)
    s["steps"] += 1
    if result.get("denied"):
        content = "O usuário NEGOU esta ação. Não repita; siga outro caminho ou explique."
    elif result.get("error"):
        content = f"Erro ao executar: {str(result['error'])[:300]}" + (f"\n\nEstado atual:\n{page_to_text(result['page'])}" if result.get("page") else "")
    else:
        content = "Ação executada.\n\nNovo estado da página:\n" + page_to_text(result.get("page") or {})
    s["chat"].add_tool_result(tc.id, content)
    if s["pending"]:
        return _next(s, "")
    if s["steps"] >= MAX_STEPS:
        SESSIONS.pop(sid, None)
        return {"session_id": sid, "done": True, "message": "Limite de passos atingido. Divida a tarefa em partes menores.", "step": s["steps"], "action": None}
    return _next(s, await _advance(s, None))


def stop(sid: str, user_id: str):
    s = SESSIONS.get(sid)
    if s and s["user_id"] == user_id:
        SESSIONS.pop(sid, None)
