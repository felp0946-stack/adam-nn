"""Adam code agent: reasoning runs on the server; the VS Code extension executes each tool locally with user permission."""
import json
import time
import uuid

from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, ToolCallReady, UserMessage

SESSIONS: dict = {}
MAX_STEPS = 60
TTL = 10800

SYSTEM = """Você é Adam, assistente de programação criado por Felipe Hudson (Belo Horizonte, Brasil), rodando dentro do VS Code do usuário.
Você tem acesso ao projeto aberto por meio de ferramentas executadas no computador do usuário. Ele aprova cada edição e cada comando.
Como trabalhar:
1. Entenda o pedido. Explore antes de agir: listar_arquivos, buscar_texto e ler_arquivo nos arquivos relevantes.
2. Para bugs, use ler_diagnosticos e leia o código ao redor do erro. Ache a causa raiz antes de corrigir.
3. Faça mudanças mínimas e focadas, seguindo o estilo do projeto. Prefira editar_arquivo (trecho exato, copiado do arquivo, incluindo espaços) a reescrever arquivos inteiros. Use escrever_arquivo para arquivos novos.
4. Quando útil, rode testes, lint ou build com executar_comando e corrija o que falhar. Nunca rode comandos destrutivos (rm -rf, git push --force, apagar banco) sem o usuário pedir.
5. Se uma ação for negada, não insista: siga outro caminho ou pergunte.
6. Ao terminar, responda SEM chamar ferramentas, em português, com um resumo curto em Markdown: o que encontrou, o que mudou (arquivos) e como testar.
Se o pedido for só uma pergunta, responda direto, lendo arquivos se precisar."""


def _fn(name: str, desc: str, props: dict, req: list) -> dict:
    return {"type": "function", "function": {"name": name, "description": desc,
            "parameters": {"type": "object", "properties": props, "required": req}}}


S = {"type": "string"}
I = {"type": "integer"}
TOOLS = [
    _fn("listar_arquivos", "Lista os arquivos do projeto (ou de uma pasta).", {"pasta": S}, []),
    _fn("ler_arquivo", "Lê um arquivo com números de linha. Use linha_inicio/linha_fim em arquivos grandes.",
        {"caminho": S, "linha_inicio": I, "linha_fim": I}, ["caminho"]),
    _fn("buscar_texto", "Busca um texto ou regex nos arquivos do projeto. glob opcional, ex: **/*.py",
        {"padrao": S, "glob": S}, ["padrao"]),
    _fn("ler_diagnosticos", "Lista erros e avisos do VS Code (TypeScript, ESLint, Python...). caminho opcional.", {"caminho": S}, []),
    _fn("escrever_arquivo", "Cria ou substitui um arquivo inteiro.", {"caminho": S, "conteudo": S}, ["caminho", "conteudo"]),
    _fn("editar_arquivo", "Substitui um trecho exato (que aparece uma única vez) de um arquivo.",
        {"caminho": S, "procurar": S, "substituir": S}, ["caminho", "procurar", "substituir"]),
    _fn("executar_comando", "Executa um comando de terminal na raiz do projeto e retorna a saída.", {"comando": S}, ["comando"]),
]


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
    return {"session_id": s["id"], "done": True, "message": message or "Pronto.", "step": s["steps"], "action": None}


async def start(api_key: str, model: tuple, user_id: str, task: str, context: str, session_id: str = None, extra: str = "") -> dict:
    _gc()
    s = SESSIONS.get(session_id or "")
    if not s or s["user_id"] != user_id or s["pending"]:
        sid = str(uuid.uuid4())
        chat = LlmChat(api_key=api_key, session_id=sid, system_message=SYSTEM + extra).with_model(*model).with_tools(TOOLS, tool_choice="auto")
        s = {"id": sid, "user_id": user_id, "chat": chat, "pending": [], "steps": 0, "created": time.time()}
        SESSIONS[sid] = s
    s["steps"] = 0
    text = f"{task}\n\n[Contexto do VS Code]\n{context}" if context else task
    return _next(s, await _advance(s, UserMessage(text=text)))


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
        content = f"Erro: {str(result['error'])[:2000]}"
    else:
        content = str(result.get("output", ""))[:40000] or "(sem saída)"
    s["chat"].add_tool_result(tc.id, content)
    if s["pending"]:
        return _next(s, "")
    if s["steps"] >= MAX_STEPS:
        s["pending"].clear()
        return {"session_id": sid, "done": True, "message": "Limite de passos atingido. Peça para eu continuar.", "step": s["steps"], "action": None}
    return _next(s, await _advance(s, None))


def stop(sid: str, user_id: str):
    s = SESSIONS.get(sid)
    if s and s["user_id"] == user_id:
        SESSIONS.pop(sid, None)
