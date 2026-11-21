import asyncio
import base64
import hashlib
import json
import logging
import os
import secrets
import uuid
from contextlib import suppress
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import httpx
from bson import Binary
from emergentintegrations.llm.chat import ImageContent, LlmChat, StreamDone, TextDelta, ToolCallReady, ToolCallStart, UserMessage
from emergentintegrations.llm.openai import OpenAISpeechToText, OpenAITextToSpeech
from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, TEXT, IndexModel
from starlette.middleware.cors import CORSMiddleware

try:
    from backend.clerk_auth import clerk_router, require_user
    from backend import storage, files_util, web_tools, browser_agent
    from backend.neural import engine as neural
except ModuleNotFoundError:
    from clerk_auth import clerk_router, require_user
    import storage
    import files_util
    import web_tools
    import browser_agent
    from neural import engine as neural

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]
LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
PRO_MODEL = ("anthropic", "claude-sonnet-4-5-20250929")
IMAGE_MODEL = "gemini-3.1-flash-image-preview"
logger = logging.getLogger("adam")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

INDEXES: dict = {
    "conversations": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                      IndexModel([("user_id", ASCENDING), ("updated_at", DESCENDING)], name="user_updated")],
    "messages": [IndexModel([("conversation_id", ASCENDING), ("created_at", ASCENDING)], name="conv_created")],
    "files": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "memories": [IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created")],
    "api_keys": [IndexModel([("hash", ASCENDING)], name="hash", unique=True),
                 IndexModel([("user_id", ASCENDING)], name="user")],
    "settings": [IndexModel([("user_id", ASCENDING)], name="user", unique=True)],
    "kb_chunks": [IndexModel([("text", TEXT)], name="text_pt", default_language="portuguese"),
                  IndexModel([("user_id", ASCENDING), ("doc_id", ASCENDING)], name="user_doc")],
    "kb_docs": [IndexModel([("user_id", ASCENDING), ("created_at", DESCENDING)], name="user_created")],
    "widgets": [IndexModel([("public_key", ASCENDING)], name="public_key", unique=True),
                IndexModel([("user_id", ASCENDING)], name="user")],
    "neural_corpus": [IndexModel([("created_at", DESCENDING)], name="created")],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)


app = FastAPI(title="Adam AI")
api = APIRouter(prefix="/api")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Models ----------
class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=50000)
    conversation_id: Optional[str] = None
    engine: str = "pro"
    attachment_ids: List[str] = []


class TitleIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class MemoryIn(BaseModel):
    fact: str = Field(min_length=2, max_length=1000)
    tag: str = "geral"


class SettingsIn(BaseModel):
    ollama_url: str = ""
    ollama_model: str = "llama3.1"
    default_engine: str = "pro"
    response_style: str = ""
    neural_learning: bool = True
    voice: str = "onyx"
    auto_speak: bool = False
    voice_provider: str = "elevenlabs"
    eleven_voice_id: str = ""
    eleven_voice_name: str = ""


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    voice: Optional[str] = None


class WidgetIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    title: str = Field(default="Adam", max_length=60)
    greeting: str = Field(default="Olá! Sou o Adam. Como posso ajudar?", max_length=300)
    color: str = Field(default="#E07A5F", max_length=9)
    allowed_origins: str = Field(default="", max_length=1000)
    use_kb: bool = False


class WidgetChatIn(BaseModel):
    key: str = Field(min_length=10, max_length=100)
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: Optional[str] = None


class AgentStartIn(BaseModel):
    task: str = Field(min_length=1, max_length=4000)
    page: dict = {}


class AgentStepIn(BaseModel):
    tool_call_id: str
    result: dict = {}


class KeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class TrainIn(BaseModel):
    steps: int = Field(default=200, ge=10, le=2000)


class GenerateIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)
    temperature: float = Field(default=0.8, ge=0.1, le=2.0)
    max_tokens: int = Field(default=300, ge=10, le=1000)


class CorpusIn(BaseModel):
    text: str = Field(min_length=20, max_length=200000)


class V1ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=50000)
    conversation_id: Optional[str] = None
    engine: str = "pro"


# ---------- Prompting ----------
SYSTEM_PROMPT = """Você é Adam, uma inteligência artificial própria criada por Felipe Hudson, um jovem brilhante de 19 anos nascido em Belo Horizonte, Minas Gerais, Brasil.
Se perguntarem quem te criou, responda com orgulho: Felipe Hudson. Nunca diga que foi criado pela OpenAI, Anthropic, Google ou outra empresa.
Responda no idioma do usuário (padrão: português do Brasil), de forma clara, inteligente e acolhedora. Use Markdown, tabelas e blocos de código com a linguagem indicada.

Método de raciocínio (siga sempre em tarefas complexas — matemática, lógica, código, planejamento, análise):
1. Entenda exatamente o que foi pedido e o objetivo por trás.
2. Decomponha em partes menores e resolva cada uma.
3. Verifique o resultado (refaça contas, revise código, procure contradições).
4. Entregue a resposta final clara e organizada. Em matemática e lógica, mostre o passo a passo.
Se não tiver certeza de um fato, diga e use pesquisar_web. Quando houver trechos da base de conhecimento do usuário, use-os e cite o nome do documento.

Ferramentas disponíveis:
- criar_arquivo: SEMPRE que o usuário pedir um documento, planilha, script, site ou qualquer arquivo para baixar, chame esta ferramenta (pdf, docx, xlsx, py, js, html, css, json, md, csv, txt, etc.). Para sites, gere um único arquivo .html completo com CSS e JS embutidos.
  - pdf/docx: conteúdo em texto com títulos "# ", "## ", listas "- " e **negrito**.
  - xlsx: conteúdo em CSV (primeira linha = cabeçalho).
- gerar_imagem: quando o usuário pedir para criar/desenhar/gerar uma imagem. Escreva o prompt em inglês, detalhado.
- salvar_memoria: quando o usuário contar algo importante e duradouro sobre si, preferências ou projetos.
- pesquisar_web: para fatos atuais, notícias, preços, documentação ou qualquer coisa que você não tenha certeza. Cite as fontes com links.
- abrir_site: para ler o conteúdo de uma página (use após pesquisar ou quando o usuário enviar um link).
- abrir_no_navegador: quando o usuário pedir para abrir/ir para um site no computador dele; abre uma nova aba no navegador do usuário.
Depois de usar uma ferramenta, comente brevemente o resultado. Nunca insira imagens ou links de arquivos em Markdown: os arquivos e imagens criados já aparecem automaticamente para o usuário com botão de download. Seja honesto sobre limitações: nesta versão você ainda não clica nem digita dentro do navegador do usuário — você lê sites no servidor e abre abas para ele."""

TOOLS = [
    {"type": "function", "function": {
        "name": "criar_arquivo",
        "description": "Cria um arquivo para o usuário baixar (pdf, docx, xlsx, py, js, html, css, json, md, csv, txt...).",
        "parameters": {"type": "object", "properties": {
            "nome_arquivo": {"type": "string", "description": "Nome com extensão, ex: relatorio.pdf"},
            "conteudo": {"type": "string", "description": "Conteúdo completo do arquivo"}},
            "required": ["nome_arquivo", "conteudo"]}}},
    {"type": "function", "function": {
        "name": "gerar_imagem",
        "description": "Gera uma imagem a partir de uma descrição.",
        "parameters": {"type": "object", "properties": {
            "prompt": {"type": "string", "description": "Descrição detalhada em inglês"}},
            "required": ["prompt"]}}},
    {"type": "function", "function": {
        "name": "salvar_memoria",
        "description": "Salva um fato duradouro sobre o usuário na memória de longo prazo.",
        "parameters": {"type": "object", "properties": {
            "fato": {"type": "string"}, "tag": {"type": "string", "description": "preferencia, projeto, pessoal, tecnologia..."}},
            "required": ["fato"]}}},
    {"type": "function", "function": {
        "name": "pesquisar_web",
        "description": "Pesquisa na internet e retorna títulos, links e trechos.",
        "parameters": {"type": "object", "properties": {"consulta": {"type": "string"}}, "required": ["consulta"]}}},
    {"type": "function", "function": {
        "name": "abrir_site",
        "description": "Acessa uma URL e retorna título, texto e links da página.",
        "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}}},
    {"type": "function", "function": {
        "name": "abrir_no_navegador",
        "description": "Abre uma URL em nova aba no navegador do usuário.",
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string"}, "titulo": {"type": "string"}}, "required": ["url"]}}},
]
TOOL_LABELS = {"criar_arquivo": "Criando arquivo", "gerar_imagem": "Gerando imagem", "salvar_memoria": "Salvando na memória",
               "pesquisar_web": "Pesquisando na web", "abrir_site": "Lendo site", "abrir_no_navegador": "Abrindo no seu navegador"}
WIDGET_TOOLS = [t for t in TOOLS if t["function"]["name"] in ("pesquisar_web", "abrir_site")]
WIDGET_PROMPT = """Você é {title}, um assistente baseado no Adam (IA criada por Felipe Hudson, de Belo Horizonte, Brasil), atendendo visitantes de um site.
Responda no idioma do visitante, de forma curta, simpática e útil. Use Markdown simples. Não invente informações sobre a empresa do site: se não souber, diga e sugira o contato."""


async def build_system(user_id: str) -> str:
    mems = await db.memories.find({"user_id": user_id}, {"_id": 0, "fact": 1}).sort("created_at", -1).to_list(50)
    st = await db.settings.find_one({"user_id": user_id}, {"_id": 0}) or {}
    extra = ""
    if mems:
        extra += "\n\nMemória de longo prazo sobre o usuário:\n" + "\n".join(f"- {m['fact']}" for m in mems)
    if st.get("response_style"):
        extra += f"\n\nPreferência de estilo do usuário: {st['response_style']}"
    return SYSTEM_PROMPT + extra


# ---------- Files ----------
def file_public(rec: dict) -> dict:
    return {k: rec.get(k) for k in ("id", "name", "mime", "size", "kind", "prompt", "created_at")}


async def save_file(user_id: str, name: str, data: bytes, mime: str, kind: str, **extra) -> dict:
    fid = str(uuid.uuid4())
    path = f"{storage.APP_NAME}/{kind}/{user_id}/{fid}.{files_util.ext_of(name)}"
    res = await asyncio.to_thread(storage.put_object, path, data, mime)
    rec = {"id": fid, "user_id": user_id, "name": name, "mime": mime, "size": len(data), "kind": kind,
           "storage_path": res["path"], "is_deleted": False, "created_at": now(), **extra}
    await db.files.insert_one(rec)
    return file_public(rec)


async def generate_image(user_id: str, prompt: str) -> dict:
    chat = LlmChat(api_key=LLM_KEY, session_id=str(uuid.uuid4()), system_message="You are an image generator.")
    chat.with_model("gemini", IMAGE_MODEL).with_params(modalities=["image", "text"])
    _, images = await chat.send_message_multimodal_response(UserMessage(text=prompt))
    if not images:
        raise RuntimeError("Nenhuma imagem retornada")
    img = images[0]
    data = base64.b64decode(img["data"])
    ext = "png" if "png" in img.get("mime_type", "png") else "jpg"
    return await save_file(user_id, f"adam-vision-{uuid.uuid4().hex[:6]}.{ext}", data, img.get("mime_type", "image/png"), "image", prompt=prompt)


async def dispatch_tool(user_id: str, name: str, args: dict):
    if name == "criar_arquivo":
        fname = (args.get("nome_arquivo") or "arquivo.txt").strip().replace("/", "_")
        data, mime = await asyncio.to_thread(files_util.build_file, fname, args.get("conteudo", ""))
        f = await save_file(user_id, fname, data, mime, "generated")
        return {"ok": True, "arquivo": fname, "tamanho_bytes": len(data)}, {"type": "file", "file": f}
    if name == "gerar_imagem":
        f = await generate_image(user_id, args.get("prompt", ""))
        return {"ok": True, "imagem": f["name"]}, {"type": "file", "file": f}
    if name == "salvar_memoria":
        await db.memories.insert_one({"id": str(uuid.uuid4()), "user_id": user_id, "fact": args.get("fato", "")[:1000],
                                      "tag": args.get("tag") or "geral", "source": "adam", "created_at": now()})
        await learn(user_id, args.get("fato", ""), "memory")
        return {"ok": True}, None
    if name == "pesquisar_web":
        q = args.get("consulta", "")
        res = await web_tools.web_search(q)
        link = {"url": web_tools.search_link(q), "title": f"Pesquisa: {q}", "kind": "search"}
        return {"resultados": res or "Nenhum resultado"}, {"type": "link", "link": link}
    if name == "abrir_site":
        page = await web_tools.open_site(args.get("url", ""))
        return page, {"type": "link", "link": {"url": page["url"], "title": page.get("titulo") or page["url"], "kind": "read"}}
    if name == "abrir_no_navegador":
        url = args.get("url", "")
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        return {"ok": True, "aberto": url}, {"type": "link", "link": {"url": url, "title": args.get("titulo") or url, "kind": "open"}}
    return {"ok": False, "erro": "ferramenta desconhecida"}, None


# ---------- Engines ----------
async def run_pro(user_id, system, history, text, images, tools=None):
    initial = [{"role": "system", "content": system}] + history
    chat = (LlmChat(api_key=LLM_KEY, session_id=str(uuid.uuid4()), system_message=system, initial_messages=initial)
            .with_model(*PRO_MODEL).with_tools(tools or TOOLS, tool_choice="auto"))
    user_msg = UserMessage(text=text, file_contents=[ImageContent(image_base64=b) for b in images])
    for _ in range(6):
        pending = []
        async for ev in chat.stream_message(user_msg):
            if isinstance(ev, TextDelta):
                yield {"type": "delta", "content": ev.content}
            elif isinstance(ev, ToolCallStart):
                yield {"type": "tool", "name": ev.name, "label": TOOL_LABELS.get(ev.name, ev.name)}
            elif isinstance(ev, ToolCallReady):
                pending.append(ev.tool_call)
            elif isinstance(ev, StreamDone):
                break
        if not pending:
            return
        for tc in pending:
            args = tc.arguments if isinstance(tc.arguments, dict) else json.loads(tc.arguments or "{}")
            try:
                result, ev = await dispatch_tool(user_id, tc.name, args)
                if ev:
                    yield ev
            except Exception as e:
                logger.exception("tool %s failed", tc.name)
                result = {"ok": False, "erro": str(e)[:300]}
            chat.add_tool_result(tc.id, json.dumps(result, ensure_ascii=False))
        user_msg = None
        yield {"type": "delta", "content": "\n\n"}


async def run_neural(history, text):
    ctx = "".join(f"{'Usuário' if m['role'] == 'user' else 'Adam'}: {m['content'][:300]}\n" for m in history[-4:])
    prompt = f"{ctx}Usuário: {text[:500]}\nAdam:"
    out = await asyncio.to_thread(neural.generate, prompt, 320, 0.7, "\nUsuário:")
    out = out.strip() or "(A rede neural ainda está aprendendo. Treine mais épocas no Laboratório Neural.)"
    for i in range(0, len(out), 4):
        yield {"type": "delta", "content": out[i:i + 4]}
        await asyncio.sleep(0.01)


async def run_local(user_id, system, history, text):
    st = await db.settings.find_one({"user_id": user_id}, {"_id": 0}) or {}
    url = (st.get("ollama_url") or "").rstrip("/")
    if not url:
        yield {"type": "delta", "content": "Nenhum servidor local configurado. Vá em **Configurações** e informe a URL do seu servidor Ollama (ex: `http://seu-servidor:11434`)."}
        return
    msgs = [{"role": "system", "content": system}] + history + [{"role": "user", "content": text}]
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=8)) as hc:
            async with hc.stream("POST", f"{url}/api/chat", json={"model": st.get("ollama_model") or "llama3.1", "messages": msgs, "stream": True}) as r:
                if r.status_code != 200:
                    yield {"type": "delta", "content": f"Servidor local respondeu com erro {r.status_code}."}
                    return
                async for line in r.aiter_lines():
                    if line.strip():
                        piece = json.loads(line).get("message", {}).get("content", "")
                        if piece:
                            yield {"type": "delta", "content": piece}
    except Exception as e:
        yield {"type": "delta", "content": f"Não consegui conectar ao servidor local `{url}`: {str(e)[:200]}"}


KEEP_RECENT = 16
SUMMARY_BATCH = 10


async def compact_history(conv: dict, past: list) -> str:
    """Rolling summary: older messages are folded into conv.summary so context never overflows."""
    summary, upto = conv.get("summary", ""), conv.get("summary_upto", 0)
    older = past[:-KEEP_RECENT] if len(past) > KEEP_RECENT else []
    pending = older[upto:]
    if len(pending) < SUMMARY_BATCH:
        return summary
    transcript = "\n".join(f"{m['role']}: {(m.get('model_text') or m['content'])[:3000]}" for m in pending)
    prompt = (f"Resumo atual:\n{summary or '(vazio)'}\n\nNovas mensagens:\n{transcript}\n\n"
              "Atualize o resumo em português, em no máximo 400 palavras, preservando fatos, decisões, nomes, código importante e pedidos pendentes.")
    try:
        chat = LlmChat(api_key=LLM_KEY, session_id=str(uuid.uuid4()), system_message="Você resume conversas com precisão.").with_model(*PRO_MODEL)
        summary = (await chat.send_message(UserMessage(text=prompt))).strip()
        await db.conversations.update_one({"id": conv["id"]}, {"$set": {"summary": summary, "summary_upto": len(older)}})
    except Exception as e:
        logger.error("compact_history failed: %s", e)
    return summary


async def learn(user_id: str, text: str, source: str):
    """Feeds the AdamNano continuous-learning corpus (only user-owned or open-model data)."""
    st = await db.settings.find_one({"user_id": user_id}, {"_id": 0, "neural_learning": 1}) or {}
    if st.get("neural_learning", True) and text.strip():
        await db.neural_corpus.insert_one({"id": str(uuid.uuid4()), "user_id": user_id, "text": text[:20000],
                                           "source": source, "created_at": now()})


async def kb_search(user_id: str, query: str, limit: int = 4) -> list:
    try:
        return await db.kb_chunks.find({"user_id": user_id, "$text": {"$search": query[:500]}},
                                       {"_id": 0, "text": 1, "name": 1, "score": {"$meta": "textScore"}}
                                       ).sort([("score", {"$meta": "textScore"})]).limit(limit).to_list(limit)
    except Exception as e:
        logger.error("kb_search failed: %s", e)
        return []


async def chat_turn(user_id: str, body: ChatIn, mode: str = "app", system_override: Optional[str] = None, kb_user_id: Optional[str] = None):
    conv = None
    if body.conversation_id:
        conv = await db.conversations.find_one({"id": body.conversation_id, "user_id": user_id}, {"_id": 0})
        if not conv:
            yield {"type": "error", "message": "Conversa não encontrada"}
            return
    if not conv:
        conv = {"id": str(uuid.uuid4()), "user_id": user_id, "title": body.message.strip()[:60], "engine": body.engine,
                "created_at": now(), "updated_at": now()}
        await db.conversations.insert_one(dict(conv))
    cid = conv["id"]
    yield {"type": "meta", "conversation_id": cid, "title": conv["title"]}

    past = await db.messages.find({"conversation_id": cid}, {"_id": 0}).sort("created_at", 1).to_list(2000)
    summary = await compact_history(conv, past)
    recent = past[-KEEP_RECENT:]
    history = []
    for i, m in enumerate(recent):
        txt = (m.get("model_text") or m["content"]).strip()
        if txt:
            history.append({"role": m["role"], "content": txt if i >= len(recent) - 4 else txt[:6000]})

    attachments, images, doc_texts = [], [], []
    if body.attachment_ids:
        recs = await db.files.find({"id": {"$in": body.attachment_ids[:10]}, "user_id": user_id, "is_deleted": False}, {"_id": 0}).to_list(10)
        for r in recs:
            attachments.append(file_public(r))
            if r["mime"].startswith("image/"):
                data, _ = await asyncio.to_thread(storage.get_object, r["storage_path"])
                images.append(await asyncio.to_thread(files_util.image_to_jpeg_b64, data))
            elif r.get("extracted_text"):
                doc_texts.append(f"\n\n[Arquivo anexado: {r['name']}]\n{r['extracted_text'][:30000]}")
    model_text = body.message + "".join(doc_texts)
    if images and body.engine == "pro":
        model_text += f"\n\n[{len(images)} imagem(ns) anexada(s)]"

    await db.messages.insert_one({"id": str(uuid.uuid4()), "conversation_id": cid, "user_id": user_id, "role": "user",
                                  "content": body.message, "model_text": model_text, "attachments": attachments,
                                  "files": [], "engine": body.engine, "created_at": now()})
    system = system_override or await build_system(user_id)
    if summary:
        system += f"\n\nResumo da parte anterior desta conversa (mensagens antigas compactadas):\n{summary}"
    hits = await kb_search(kb_user_id or user_id, body.message) if (mode == "app" or kb_user_id) else []
    if hits:
        system += "\n\nTrechos relevantes da base de conhecimento:\n" + "\n\n".join(f"[{h['name']}]\n{h['text']}" for h in hits)
        for name in dict.fromkeys(h["name"] for h in hits):
            yield {"type": "link", "link": {"url": "", "title": name, "kind": "kb"}}
    parts, files, links = [], [], []
    links += [{"url": "", "title": n, "kind": "kb"} for n in dict.fromkeys(h["name"] for h in hits)]
    try:
        if body.engine == "neural":
            gen = run_neural(history, body.message)
        elif body.engine == "local":
            gen = run_local(user_id, system, history, model_text)
        else:
            gen = run_pro(user_id, system, history, model_text, images, WIDGET_TOOLS if mode == "widget" else TOOLS)
        async for ev in gen:
            if ev["type"] == "delta":
                parts.append(ev["content"])
            elif ev["type"] == "file":
                files.append(ev["file"])
            elif ev["type"] == "link":
                links.append(ev["link"])
            yield ev
    except Exception as e:
        logger.exception("chat failed")
        msg = f"\n\n⚠️ Erro ao gerar resposta: {str(e)[:200]}"
        parts.append(msg)
        yield {"type": "delta", "content": msg}
    mid = str(uuid.uuid4())
    await db.messages.insert_one({"id": mid, "conversation_id": cid, "user_id": user_id, "role": "assistant",
                                  "content": "".join(parts).strip(), "attachments": [], "files": files, "links": links,
                                  "engine": body.engine, "created_at": now()})
    await db.conversations.update_one({"id": cid}, {"$set": {"updated_at": now(), "engine": body.engine}})
    if mode == "app":
        reply = "".join(parts).strip()
        sample = f"Usuário: {body.message[:2000]}\n"
        if body.engine == "local" and reply:
            sample += f"Adam: {reply[:2000]}\n"
        await learn(user_id, sample, f"chat-{body.engine}")
    yield {"type": "done", "message_id": mid, "conversation_id": cid}


# ---------- Routes: chat ----------
@api.get("/")
async def root():
    return {"name": "Adam", "creator": "Felipe Hudson", "status": "online"}


@api.get("/me")
async def me(user: dict = Depends(require_user)):
    return {"user_id": user["user_id"]}


@api.post("/chat/stream")
async def chat_stream(body: ChatIn, user: dict = Depends(require_user)):
    async def sse():
        async for ev in chat_turn(user["user_id"], body):
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
    return StreamingResponse(sse(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@api.get("/conversations")
async def list_conversations(user: dict = Depends(require_user)):
    return await db.conversations.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).sort("updated_at", -1).to_list(300)


@api.get("/conversations/{cid}")
async def get_conversation(cid: str, user: dict = Depends(require_user)):
    conv = await db.conversations.find_one({"id": cid, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not conv:
        raise HTTPException(404, "Conversa não encontrada")
    msgs = await db.messages.find({"conversation_id": cid}, {"_id": 0, "model_text": 0, "user_id": 0}).sort("created_at", 1).to_list(1000)
    return {"conversation": conv, "messages": msgs}


@api.patch("/conversations/{cid}")
async def rename_conversation(cid: str, body: TitleIn, user: dict = Depends(require_user)):
    r = await db.conversations.update_one({"id": cid, "user_id": user["user_id"]}, {"$set": {"title": body.title}})
    if not r.matched_count:
        raise HTTPException(404, "Conversa não encontrada")
    return {"ok": True}


@api.delete("/conversations/{cid}")
async def delete_conversation(cid: str, user: dict = Depends(require_user)):
    r = await db.conversations.delete_one({"id": cid, "user_id": user["user_id"]})
    if not r.deleted_count:
        raise HTTPException(404, "Conversa não encontrada")
    await db.messages.delete_many({"conversation_id": cid})
    return {"ok": True}


# ---------- Routes: files ----------
MAX_UPLOAD = 20 * 1024 * 1024


@api.post("/files/upload")
async def upload_file(file: UploadFile = File(...), user: dict = Depends(require_user)):
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Arquivo maior que 20 MB")
    mime = file.content_type or "application/octet-stream"
    name = file.filename or "arquivo"
    extracted = "" if mime.startswith("image/") else await asyncio.to_thread(files_util.extract_text, data, name, mime)
    if not mime.startswith("image/") and not extracted.strip():
        raise HTTPException(415, "Formato não suportado. Envie imagens, PDF, DOCX, XLSX ou arquivos de texto/código.")
    return await save_file(user["user_id"], name, data, mime, "uploads", extracted_text=extracted[:100000])


@api.get("/files")
async def list_files(user: dict = Depends(require_user)):
    recs = await db.files.find({"user_id": user["user_id"], "is_deleted": False, "kind": {"$in": ["generated", "image"]}},
                               {"_id": 0}).sort("created_at", -1).to_list(200)
    return [file_public(r) for r in recs]


@api.get("/files/{fid}")
async def download_file(fid: str, user: dict = Depends(require_user)):
    rec = await db.files.find_one({"id": fid, "user_id": user["user_id"], "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Arquivo não encontrado")
    data, _ = await asyncio.to_thread(storage.get_object, rec["storage_path"])
    return Response(content=data, media_type=rec["mime"], headers={"Content-Disposition": f'inline; filename="{rec["name"]}"'})


# ---------- Routes: memory & settings ----------
@api.get("/memories")
async def list_memories(user: dict = Depends(require_user)):
    return await db.memories.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).sort("created_at", -1).to_list(500)


@api.post("/memories")
async def add_memory(body: MemoryIn, user: dict = Depends(require_user)):
    doc = {"id": str(uuid.uuid4()), "user_id": user["user_id"], "fact": body.fact, "tag": body.tag, "source": "manual", "created_at": now()}
    await db.memories.insert_one(dict(doc))
    await learn(user["user_id"], body.fact, "memory")
    doc.pop("user_id")
    return doc


@api.delete("/memories/{mid}")
async def delete_memory(mid: str, user: dict = Depends(require_user)):
    r = await db.memories.delete_one({"id": mid, "user_id": user["user_id"]})
    if not r.deleted_count:
        raise HTTPException(404, "Memória não encontrada")
    return {"ok": True}


@api.get("/settings")
async def get_settings(user: dict = Depends(require_user)):
    st = await db.settings.find_one({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    return st or SettingsIn().model_dump()


@api.put("/settings")
async def put_settings(body: SettingsIn, user: dict = Depends(require_user)):
    await db.settings.update_one({"user_id": user["user_id"]}, {"$set": body.model_dump()}, upsert=True)
    return body.model_dump()


# ---------- Routes: API keys ----------
def hash_key(k: str) -> str:
    return hashlib.sha256(k.encode()).hexdigest()


@api.get("/keys")
async def list_keys(user: dict = Depends(require_user)):
    return await db.api_keys.find({"user_id": user["user_id"], "revoked": False}, {"_id": 0, "hash": 0, "user_id": 0}).sort("created_at", -1).to_list(100)


@api.post("/keys")
async def create_key(body: KeyIn, user: dict = Depends(require_user)):
    raw = "adam_live_" + secrets.token_urlsafe(32)
    doc = {"id": str(uuid.uuid4()), "user_id": user["user_id"], "name": body.name, "prefix": raw[:16] + "…",
           "hash": hash_key(raw), "revoked": False, "created_at": now(), "last_used_at": None}
    await db.api_keys.insert_one(dict(doc))
    return {"id": doc["id"], "name": doc["name"], "prefix": doc["prefix"], "created_at": doc["created_at"], "key": raw}


@api.delete("/keys/{kid}")
async def revoke_key(kid: str, user: dict = Depends(require_user)):
    r = await db.api_keys.update_one({"id": kid, "user_id": user["user_id"], "revoked": False}, {"$set": {"revoked": True}})
    if not r.matched_count:
        raise HTTPException(404, "Chave não encontrada")
    return {"ok": True}


async def require_api_key(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    raw = request.headers.get("x-api-key") or (auth[7:] if auth.lower().startswith("bearer ") else "")
    if not raw.startswith("adam_"):
        raise HTTPException(401, "Chave de API ausente ou inválida")
    rec = await db.api_keys.find_one({"hash": hash_key(raw), "revoked": False}, {"_id": 0})
    if not rec:
        raise HTTPException(401, "Chave de API inválida ou revogada")
    await db.api_keys.update_one({"id": rec["id"]}, {"$set": {"last_used_at": now()}})
    return {"user_id": rec["user_id"]}


@api.post("/v1/chat")
async def v1_chat(body: V1ChatIn, key: dict = Depends(require_api_key)):
    parts, files, cid, err = [], [], None, None
    links = []
    async for ev in chat_turn(key["user_id"], ChatIn(message=body.message, conversation_id=body.conversation_id, engine=body.engine)):
        if ev["type"] == "delta":
            parts.append(ev["content"])
        elif ev["type"] == "file":
            files.append(ev["file"])
        elif ev["type"] == "link":
            links.append(ev["link"])
        elif ev["type"] in ("meta", "done"):
            cid = ev["conversation_id"]
        elif ev["type"] == "error":
            err = ev["message"]
    if err:
        raise HTTPException(404, err)
    return {"conversation_id": cid, "engine": body.engine, "reply": "".join(parts).strip(), "files": files, "links": links}


@api.get("/v1/files/{fid}")
async def v1_file(fid: str, key: dict = Depends(require_api_key)):
    return await download_file(fid, key)


# ---------- Routes: neural lab ----------
CORPUS_BASE = (ROOT_DIR / "neural_corpus.txt").read_text(encoding="utf-8")
NEURAL_ID = "adam-nano-v1"


async def corpus_text() -> str:
    extra = await db.neural_corpus.find({}, {"_id": 0, "text": 1}).sort("created_at", -1).to_list(3000)
    return CORPUS_BASE + "\n" + "\n".join(e["text"] for e in reversed(extra))


async def autolearn_loop():
    """Continuous background learning: retrains AdamNano whenever new corpus data arrives."""
    while True:
        await asyncio.sleep(int(os.environ.get("ADAM_AUTOLEARN_SECONDS", "300")))
        try:
            total = await db.neural_corpus.count_documents({})
            doc = await db.neural_models.find_one({"id": NEURAL_ID}, {"_id": 0, "corpus_seen": 1}) or {}
            if total - doc.get("corpus_seen", 0) >= 1 and not neural.state["training"]:
                neural.state["training"] = True
                await train_and_save(150)
                await db.neural_models.update_one({"id": NEURAL_ID}, {"$set": {"corpus_seen": total, "last_autolearn": now()}})
                logger.info("AdamNano aprendeu com %s novos exemplos", total - doc.get("corpus_seen", 0))
        except Exception as e:
            neural.state["training"] = False
            logger.error("autolearn failed: %s", e)


async def train_and_save(steps: int):
    text = await corpus_text()
    await asyncio.to_thread(neural.train, text, steps)
    blob = await asyncio.to_thread(neural.export)
    await db.neural_models.update_one({"id": NEURAL_ID}, {"$set": {"state": Binary(blob), "step": neural.state["step"],
                                                                     "losses": neural.state["losses"][-2000:], "updated_at": now()}}, upsert=True)


@api.get("/neural/status")
async def neural_status(user: dict = Depends(require_user)):
    extra = await db.neural_corpus.count_documents({})
    meta = await db.neural_models.find_one({"id": NEURAL_ID}, {"_id": 0, "last_autolearn": 1, "corpus_seen": 1}) or {}
    return {**neural.info(), "corpus_chars": len(await corpus_text()), "corpus_contributions": extra,
            "last_autolearn": meta.get("last_autolearn"), "pending_examples": max(0, extra - meta.get("corpus_seen", 0))}


@api.post("/neural/train")
async def neural_train(body: TrainIn, user: dict = Depends(require_user)):
    if neural.state["training"]:
        raise HTTPException(409, "Treinamento já em andamento")
    neural.state["training"] = True
    app.state.train_task = asyncio.create_task(train_and_save(body.steps))
    return {"ok": True, "steps": body.steps}


@api.post("/neural/generate")
async def neural_generate(body: GenerateIn, user: dict = Depends(require_user)):
    text = await asyncio.to_thread(neural.generate, body.prompt, body.max_tokens, body.temperature)
    return {"prompt": body.prompt, "completion": text}


@api.post("/neural/corpus")
async def neural_corpus_add(body: CorpusIn, user: dict = Depends(require_user)):
    await db.neural_corpus.insert_one({"id": str(uuid.uuid4()), "user_id": user["user_id"], "text": body.text, "source": "manual", "created_at": now()})
    return {"ok": True, "chars": len(body.text)}


# ---------- Routes: knowledge base (RAG) ----------
def chunk_text(text: str, size: int = 1200, overlap: int = 200) -> list:
    text = text.strip()
    out, i = [], 0
    while i < len(text):
        out.append(text[i:i + size])
        i += size - overlap
    return out


@api.get("/kb")
async def kb_list(user: dict = Depends(require_user)):
    return await db.kb_docs.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).sort("created_at", -1).to_list(500)


@api.post("/kb")
async def kb_upload(file: UploadFile = File(...), user: dict = Depends(require_user)):
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Arquivo maior que 20 MB")
    name = file.filename or "documento"
    text = await asyncio.to_thread(files_util.extract_text, data, name, file.content_type or "")
    if len(text.strip()) < 20:
        raise HTTPException(415, "Não consegui extrair texto. Envie PDF, DOCX, XLSX, TXT, MD, CSV ou código.")
    did = str(uuid.uuid4())
    chunks = chunk_text(text[:2_000_000])
    await db.kb_chunks.insert_many([{"id": str(uuid.uuid4()), "user_id": user["user_id"], "doc_id": did, "name": name,
                                     "idx": i, "text": c} for i, c in enumerate(chunks)])
    doc = {"id": did, "user_id": user["user_id"], "name": name, "chars": len(text), "chunks": len(chunks), "created_at": now()}
    await db.kb_docs.insert_one(dict(doc))
    await learn(user["user_id"], text[:20000], "kb")
    doc.pop("user_id")
    return doc


@api.delete("/kb/{did}")
async def kb_delete(did: str, user: dict = Depends(require_user)):
    r = await db.kb_docs.delete_one({"id": did, "user_id": user["user_id"]})
    if not r.deleted_count:
        raise HTTPException(404, "Documento não encontrado")
    await db.kb_chunks.delete_many({"doc_id": did, "user_id": user["user_id"]})
    return {"ok": True}


@api.get("/kb/search")
async def kb_search_route(q: str, user: dict = Depends(require_user)):
    return await kb_search(user["user_id"], q, 6)


# ---------- Routes: voice ----------
def speech_text(md: str) -> str:
    import re
    t = re.sub(r"```.*?```", " (há um bloco de código na tela) ", md, flags=re.S)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"[#*_`>|~]+", "", t)
    return re.sub(r"\s+", " ", t).strip()[:4000]


@api.post("/voice/transcribe")
async def voice_transcribe(file: UploadFile = File(...), user: dict = Depends(require_user)):
    import io
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(413, "Áudio maior que 25 MB")
    buf = io.BytesIO(data)
    ext = files_util.ext_of(file.filename or "audio.webm")
    buf.name = f"audio.{ext if ext in ('mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm') else 'webm'}"
    try:
        res = await OpenAISpeechToText(api_key=LLM_KEY).transcribe(file=buf, model="whisper-1", response_format="json", language="pt",
                                                               prompt="Adam, Felipe Hudson, Belo Horizonte.")
    except Exception as e:
        logger.exception("transcribe failed")
        raise HTTPException(502, f"Falha na transcrição: {str(e)[:200]}")
    return {"text": res.text.strip()}


ELEVEN_API = "https://api.elevenlabs.io"


def eleven_key() -> str:
    return os.environ.get("ELEVENLABS_API_KEY", "")


async def eleven_shared_voices(gender: str = "") -> list:
    params = {"language": "pt", "accent": "brazilian", "page_size": 30, "sort": "usage_character_count_1y"}
    if gender:
        params["gender"] = gender
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{ELEVEN_API}/v1/shared-voices", params=params, headers={"xi-api-key": eleven_key()})
    r.raise_for_status()
    return [{"voice_id": v["voice_id"], "public_owner_id": v["public_owner_id"], "name": v["name"], "gender": v.get("gender"),
             "age": v.get("age"), "description": (v.get("description") or "")[:140], "preview_url": v.get("preview_url")}
            for v in r.json().get("voices", [])]


async def eleven_ensure_voice(user_id: str, st: dict) -> str:
    """Returns a usable ElevenLabs voice_id; adds a Brazilian voice from the library to the account if needed."""
    if st.get("eleven_voice_id"):
        return st["eleven_voice_id"]
    voices = await eleven_shared_voices("male")
    if not voices:
        raise RuntimeError("Nenhuma voz brasileira encontrada")
    vid = await eleven_add_shared(voices[0]["public_owner_id"], voices[0]["voice_id"], voices[0]["name"])
    await db.settings.update_one({"user_id": user_id}, {"$set": {"eleven_voice_id": vid, "eleven_voice_name": voices[0]["name"]}}, upsert=True)
    return vid


async def eleven_add_shared(owner_id: str, voice_id: str, name: str) -> str:
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(f"{ELEVEN_API}/v1/voices/add/{owner_id}/{voice_id}", headers={"xi-api-key": eleven_key()},
                         json={"new_name": f"Adam BR - {name}"[:100]})
    if r.status_code == 400 and "already" in r.text.lower():
        return voice_id
    r.raise_for_status()
    return r.json().get("voice_id", voice_id)


async def eleven_tts(voice_id: str, text: str) -> bytes:
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{ELEVEN_API}/v1/text-to-speech/{voice_id}", params={"output_format": "mp3_44100_128"},
                         headers={"xi-api-key": eleven_key(), "Accept": "audio/mpeg"},
                         json={"text": text, "model_id": "eleven_multilingual_v2", "language_code": "pt",
                               "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.2, "use_speaker_boost": True}})
    if r.status_code >= 400:
        raise RuntimeError(f"ElevenLabs {r.status_code}: {r.text[:200]}")
    return r.content


@api.get("/voice/eleven/voices")
async def eleven_voices(user: dict = Depends(require_user)):
    if not eleven_key():
        return {"enabled": False, "voices": []}
    try:
        return {"enabled": True, "voices": await eleven_shared_voices()}
    except Exception as e:
        raise HTTPException(502, f"ElevenLabs: {str(e)[:200]}")


class ElevenPickIn(BaseModel):
    voice_id: str
    public_owner_id: str
    name: str


@api.post("/voice/eleven/select")
async def eleven_select(body: ElevenPickIn, user: dict = Depends(require_user)):
    try:
        vid = await eleven_add_shared(body.public_owner_id, body.voice_id, body.name)
    except Exception as e:
        raise HTTPException(502, f"ElevenLabs: {str(e)[:200]}")
    await db.settings.update_one({"user_id": user["user_id"]}, {"$set": {"eleven_voice_id": vid, "eleven_voice_name": body.name,
                                                                          "voice_provider": "elevenlabs"}}, upsert=True)
    return {"voice_id": vid, "name": body.name}


@api.post("/voice/speak")
async def voice_speak(body: SpeakIn, user: dict = Depends(require_user)):
    st = await db.settings.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    text = speech_text(body.text)
    if not text:
        raise HTTPException(400, "Nada para falar")
    if eleven_key() and st.get("voice_provider", "elevenlabs") == "elevenlabs":
        try:
            audio = await eleven_tts(await eleven_ensure_voice(user["user_id"], st), text[:2500])
            return Response(content=audio, media_type="audio/mpeg", headers={"X-Voice-Provider": "elevenlabs"})
        except Exception as e:
            logger.error("elevenlabs failed, falling back to OpenAI: %s", e)
    try:
        audio = await OpenAITextToSpeech(api_key=LLM_KEY).generate_speech(text=text, model="tts-1", voice=body.voice or st.get("voice") or "onyx")
    except Exception as e:
        logger.exception("tts failed")
        raise HTTPException(502, f"Falha ao gerar voz: {str(e)[:200]}")
    return Response(content=audio, media_type="audio/mpeg", headers={"X-Voice-Provider": "openai"})


# ---------- Routes: website widget ----------
WIDGET_JS = (ROOT_DIR / "static" / "widget.js").read_text(encoding="utf-8")
_rate: dict = {}


def rate_ok(key: str, limit: int = 20, window: int = 60) -> bool:
    t = datetime.now(timezone.utc).timestamp()
    hits = [h for h in _rate.get(key, []) if h > t - window]
    if len(hits) >= limit:
        _rate[key] = hits
        return False
    _rate[key] = hits + [t]
    return True


def widget_public(w: dict) -> dict:
    return {k: w.get(k) for k in ("id", "name", "title", "greeting", "color", "allowed_origins", "use_kb", "public_key", "created_at", "messages")}


@api.get("/widgets")
async def widgets_list(user: dict = Depends(require_user)):
    ws = await db.widgets.find({"user_id": user["user_id"], "revoked": False}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return [widget_public(w) for w in ws]


@api.post("/widgets")
async def widgets_create(body: WidgetIn, user: dict = Depends(require_user)):
    w = {"id": str(uuid.uuid4()), "user_id": user["user_id"], "public_key": "adam_pub_" + secrets.token_urlsafe(18),
         **body.model_dump(), "revoked": False, "messages": 0, "created_at": now()}
    await db.widgets.insert_one(dict(w))
    return widget_public(w)


@api.put("/widgets/{wid}")
async def widgets_update(wid: str, body: WidgetIn, user: dict = Depends(require_user)):
    r = await db.widgets.update_one({"id": wid, "user_id": user["user_id"], "revoked": False}, {"$set": body.model_dump()})
    if not r.matched_count:
        raise HTTPException(404, "Widget não encontrado")
    return {"ok": True}


@api.delete("/widgets/{wid}")
async def widgets_delete(wid: str, user: dict = Depends(require_user)):
    r = await db.widgets.update_one({"id": wid, "user_id": user["user_id"]}, {"$set": {"revoked": True}})
    if not r.matched_count:
        raise HTTPException(404, "Widget não encontrado")
    return {"ok": True}


@api.get("/widget.js")
async def widget_js():
    return Response(content=WIDGET_JS, media_type="application/javascript", headers={"Cache-Control": "public, max-age=300"})


async def get_widget(key: str, request: Request) -> dict:
    w = await db.widgets.find_one({"public_key": key, "revoked": False}, {"_id": 0})
    if not w:
        raise HTTPException(404, "Widget não encontrado")
    allowed = [o.strip().rstrip("/") for o in (w.get("allowed_origins") or "").split(",") if o.strip()]
    origin = (request.headers.get("origin") or "").rstrip("/")
    if allowed and origin not in allowed:
        raise HTTPException(403, "Domínio não autorizado para este widget")
    return w


@api.get("/widget/config/{key}")
async def widget_config(key: str, request: Request):
    w = await get_widget(key, request)
    return {"title": w["title"], "greeting": w["greeting"], "color": w["color"]}


@api.post("/widget/chat")
async def widget_chat(body: WidgetChatIn, request: Request):
    w = await get_widget(body.key, request)
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    if not rate_ok(f"{w['id']}:{ip}"):
        raise HTTPException(429, "Muitas mensagens. Aguarde um minuto.")
    parts, cid, err = [], None, None
    system = WIDGET_PROMPT.format(title=w["title"])
    async for ev in chat_turn(f"widget:{w['id']}", ChatIn(message=body.message, conversation_id=body.conversation_id, engine="pro"),
                              mode="widget", system_override=system, kb_user_id=w["user_id"] if w.get("use_kb") else None):
        if ev["type"] == "delta":
            parts.append(ev["content"])
        elif ev["type"] in ("meta", "done"):
            cid = ev["conversation_id"]
        elif ev["type"] == "error":
            err = ev["message"]
    if err:
        raise HTTPException(404, err)
    await db.widgets.update_one({"id": w["id"]}, {"$inc": {"messages": 1}})
    return {"conversation_id": cid, "reply": "".join(parts).strip()}


# ---------- Routes: browser agent (Chrome extension) ----------
async def agent_user(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    if auth[7:].startswith("adam_") or request.headers.get("x-api-key"):
        return await require_api_key(request)
    return require_user(request)


@api.post("/v1/agent/start")
async def agent_start(body: AgentStartIn, request: Request):
    user = await agent_user(request)
    mems = await db.memories.find({"user_id": user["user_id"]}, {"_id": 0, "fact": 1}).to_list(30)
    ctx = ("\n\nFatos sobre o usuário:\n" + "\n".join(f"- {m['fact']}" for m in mems)) if mems else ""
    try:
        return await browser_agent.start(LLM_KEY, PRO_MODEL, user["user_id"], body.task, body.page, ctx)
    except Exception as e:
        logger.exception("agent start failed")
        raise HTTPException(502, f"Falha no agente: {str(e)[:200]}")


@api.post("/v1/agent/{sid}/step")
async def agent_step(sid: str, body: AgentStepIn, request: Request):
    user = await agent_user(request)
    try:
        return await browser_agent.step(sid, user["user_id"], body.tool_call_id, body.result)
    except KeyError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        logger.exception("agent step failed")
        raise HTTPException(502, f"Falha no agente: {str(e)[:200]}")


@api.post("/v1/agent/{sid}/stop")
async def agent_stop(sid: str, request: Request):
    user = await agent_user(request)
    browser_agent.stop(sid, user["user_id"])
    return {"ok": True}


@api.get("/extension/download")
async def extension_download(server: str, user: dict = Depends(require_user)):
    import io
    import zipfile
    if not server.startswith(("https://", "http://")):
        raise HTTPException(400, "Servidor inválido")
    buf = io.BytesIO()
    src = ROOT_DIR / "extension"
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in src.rglob("*"):
            if p.is_file():
                z.write(p, f"adam-extension/{p.relative_to(src)}")
        z.writestr("adam-extension/config.js", f"const ADAM_SERVER = {json.dumps(server.rstrip('/'))};\n")
    return Response(content=buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": 'attachment; filename="adam-extension.zip"'})


app.include_router(api)
app.include_router(clerk_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    app.state.index_task = asyncio.create_task(ensure_indexes())
    try:
        await asyncio.to_thread(storage.init_storage)
    except Exception as e:
        logger.error("Storage init failed: %s", e)
    doc = await db.neural_models.find_one({"id": NEURAL_ID})
    if doc:
        try:
            neural.load(bytes(doc["state"]), doc.get("step", 0), doc.get("losses", []))
            logger.info("AdamNano carregado (step %s)", doc.get("step"))
        except Exception as e:
            logger.error("Falha ao carregar AdamNano: %s", e)
    app.state.autolearn_task = asyncio.create_task(autolearn_loop())


@app.on_event("shutdown")
async def shutdown():
    app.state.index_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.index_task
    client.close()
