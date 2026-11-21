"""Adam AI backend regression tests (auth, chat SSE, files, memory, history, engines, neural lab, API keys)."""
import io
import json
import os
import subprocess
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in open("/app/frontend/.env"):
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = BASE_URL + "/api"


def _token(email=None):
    args = ["python", "/app/scripts_clerk_token.py"] + ([email] if email else [])
    return subprocess.check_output(args, text=True).strip()


@pytest.fixture(scope="session")
def tok_a():
    return _token()


@pytest.fixture(scope="session")
def tok_b():
    return _token("felipeb+clerk_test@example.com")


@pytest.fixture(scope="session")
def A(tok_a):
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {tok_a}"
    return s


@pytest.fixture(scope="session")
def B(tok_b):
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {tok_b}"
    return s


@pytest.fixture(scope="session")
def created():
    d = {"convs": [], "mems": [], "keys": []}
    yield d


@pytest.fixture(scope="session", autouse=True)
def cleanup(A, created):
    yield
    for c in created["convs"]:
        A.delete(f"{API}/conversations/{c}")
    for m in created["mems"]:
        A.delete(f"{API}/memories/{m}")
    for k in created["keys"]:
        A.delete(f"{API}/keys/{k}")


def stream(sess, payload, timeout=240):
    r = sess.post(f"{API}/chat/stream", json=payload, stream=True, timeout=timeout)
    assert r.status_code == 200, r.text
    evs = []
    for line in r.iter_lines(decode_unicode=True):
        if line and line.startswith("data: "):
            evs.append(json.loads(line[6:]))
    return evs


def text_of(evs):
    return "".join(e["content"] for e in evs if e["type"] == "delta")


# --- Auth ---
@pytest.mark.parametrize("path", ["/conversations", "/memories", "/settings", "/keys", "/neural/status"])
def test_protected_401_and_200(A, path):
    assert requests.get(API + path).status_code == 401
    r = A.get(API + path)
    assert r.status_code == 200, r.text


# --- Chat Pro: PDF + XLSX + HTML files ---
def test_chat_pro_files(A, created):
    evs = stream(A, {"message": "Crie 3 arquivos curtos: um PDF 'teste.pdf' com um título e 2 itens, uma planilha 'gastos.xlsx' com 3 linhas (Item,Valor) e um 'pagina.html' simples com um h1 Olá. Use a ferramenta criar_arquivo para cada.", "engine": "pro"})
    types = [e["type"] for e in evs]
    print("event types:", sorted(set(types)))
    assert types[0] == "meta" and types[-1] == "done"
    assert "delta" in types and "tool" in types
    created["convs"].append(evs[0]["conversation_id"])
    files = [e["file"] for e in evs if e["type"] == "file"]
    names = [f["name"] for f in files]
    print("files:", names)
    exts = {n.rsplit(".", 1)[-1] for n in names}
    assert {"pdf", "xlsx", "html"} <= exts
    for f in files:
        r = A.get(f"{API}/files/{f['id']}")
        assert r.status_code == 200
        if f["name"].endswith(".pdf"):
            assert r.content[:4] == b"%PDF"
        elif f["name"].endswith(".xlsx"):
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(r.content))
            assert wb.active.max_row >= 2
        elif f["name"].endswith(".html"):
            assert "<h1" in r.text.lower()
    # files list contains generated
    lst = A.get(f"{API}/files").json()
    assert any(x["id"] == files[0]["id"] for x in lst)


# --- Image generation ---
def test_chat_image(A, created):
    evs = stream(A, {"message": "Gere uma imagem de um gato astronauta simples", "engine": "pro"})
    created["convs"].append(evs[0]["conversation_id"])
    imgs = [e["file"] for e in evs if e["type"] == "file" and e["file"]["kind"] == "image"]
    txt = text_of(evs)
    print("image reply:", txt[:300])
    assert imgs, f"no image file event; text={txt[:300]}"
    assert "![" not in txt
    r = A.get(f"{API}/files/{imgs[0]['id']}")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/") and len(r.content) > 1000


# --- Upload txt + image, answer based on content ---
def test_upload_and_attach(A, created):
    r = A.post(f"{API}/files/upload", files={"file": ("nota.txt", b"O codigo secreto do projeto e ZEBRA-4421.", "text/plain")})
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (300, 200), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([20, 20, 140, 180], fill="red")
    d.ellipse([160, 40, 280, 160], fill="blue")
    buf = io.BytesIO(); img.save(buf, "PNG")
    r2 = A.post(f"{API}/files/upload", files={"file": ("formas.png", buf.getvalue(), "image/png")})
    assert r2.status_code == 200
    iid = r2.json()["id"]
    evs = stream(A, {"message": "Qual é o código secreto no arquivo e quais cores/formas aparecem na imagem? Responda curto.", "engine": "pro", "attachment_ids": [tid, iid]})
    created["convs"].append(evs[0]["conversation_id"])
    txt = text_of(evs)
    print("attach reply:", txt[:400])
    assert "ZEBRA-4421" in txt
    low = txt.lower()
    assert ("vermelh" in low or "red" in low) and ("azul" in low or "blue" in low)


def test_upload_unsupported(A):
    r = A.post(f"{API}/files/upload", files={"file": ("x.bin", b"\x00\x01\x02", "application/octet-stream")})
    assert r.status_code == 415


# --- Memory CRUD + use in chat + tool save ---
def test_memory_crud_and_usage(A, created):
    r = A.post(f"{API}/memories", json={"fact": "TEST_ A cor favorita do usuário é verde-limão", "tag": "preferencia"})
    assert r.status_code == 200
    mid = r.json()["id"]
    created["mems"].append(mid)
    assert any(m["id"] == mid for m in A.get(f"{API}/memories").json())
    evs = stream(A, {"message": "Qual é minha cor favorita? Responda em uma frase.", "engine": "pro"})
    created["convs"].append(evs[0]["conversation_id"])
    assert "lim" in text_of(evs).lower()
    assert A.delete(f"{API}/memories/{mid}").status_code == 200
    created["mems"].remove(mid)
    assert not any(m["id"] == mid for m in A.get(f"{API}/memories").json())
    assert A.delete(f"{API}/memories/{mid}").status_code == 404


def test_memory_saved_by_tool(A, created):
    before = {m["id"] for m in A.get(f"{API}/memories").json()}
    evs = stream(A, {"message": "Quero que você lembre disso para sempre: eu tenho um cachorro chamado TESTBiscoito.", "engine": "pro"})
    created["convs"].append(evs[0]["conversation_id"])
    after = A.get(f"{API}/memories").json()
    new = [m for m in after if m["id"] not in before]
    print("new memories:", new)
    for m in new:
        created["mems"].append(m["id"])
    assert any("biscoito" in m["fact"].lower() for m in new)


# --- History, context, isolation, delete ---
def test_history_context_isolation(A, B, created):
    evs = stream(A, {"message": "Meu número da sorte hoje é 7391. Apenas confirme.", "engine": "pro"})
    cid = evs[0]["conversation_id"]
    created["convs"].append(cid)
    assert any(c["id"] == cid for c in A.get(f"{API}/conversations").json())
    evs2 = stream(A, {"message": "Qual é meu número da sorte que eu disse?", "conversation_id": cid, "engine": "pro"})
    assert "7391" in text_of(evs2)
    d = A.get(f"{API}/conversations/{cid}").json()
    assert len(d["messages"]) == 4 and d["messages"][0]["role"] == "user"
    assert B.get(f"{API}/conversations/{cid}").status_code == 404
    assert B.delete(f"{API}/conversations/{cid}").status_code == 404
    evb = stream(B, {"message": "oi", "conversation_id": cid, "engine": "neural"})
    assert evb[0]["type"] == "error"
    assert A.delete(f"{API}/conversations/{cid}").status_code == 200
    created["convs"].remove(cid)
    assert A.get(f"{API}/conversations/{cid}").status_code == 404


# --- Neural & local engines ---
def test_engine_neural(A, created):
    evs = stream(A, {"message": "Olá Adam", "engine": "neural"})
    created["convs"].append(evs[0]["conversation_id"])
    assert evs[-1]["type"] == "done" and len(text_of(evs)) > 0


def test_engine_local_unconfigured(A, created):
    st = A.get(f"{API}/settings").json()
    if st.get("ollama_url"):
        pytest.skip("ollama_url configured")
    evs = stream(A, {"message": "oi", "engine": "local"})
    created["convs"].append(evs[0]["conversation_id"])
    assert "Configurações" in text_of(evs)


def test_settings_roundtrip(A):
    orig = A.get(f"{API}/settings").json()
    r = A.put(f"{API}/settings", json={**orig, "response_style": "TEST_ objetivo"})
    assert r.status_code == 200
    assert A.get(f"{API}/settings").json()["response_style"] == "TEST_ objetivo"
    A.put(f"{API}/settings", json={k: orig.get(k, "") for k in ("ollama_url", "ollama_model", "default_engine", "response_style")})


# --- Neural lab ---
def test_neural_lab(A):
    st = A.get(f"{API}/neural/status").json()
    assert st["params"] > 0 and "losses" in st
    g = A.post(f"{API}/neural/generate", json={"prompt": "Adam é", "max_tokens": 40})
    assert g.status_code == 200 and isinstance(g.json()["completion"], str)
    c = A.post(f"{API}/neural/corpus", json={"text": "TEST_ Adam é uma IA criada por Felipe Hudson em Belo Horizonte."})
    assert c.status_code == 200
    step0 = st["step"]
    t = A.post(f"{API}/neural/train", json={"steps": 50})
    assert t.status_code == 200
    t2 = A.post(f"{API}/neural/train", json={"steps": 50})
    assert t2.status_code == 409
    for _ in range(60):
        time.sleep(3)
        s = A.get(f"{API}/neural/status").json()
        if not s["training"]:
            break
    assert not s["training"] and s["step"] >= step0 + 50


# --- API keys ---
def test_api_keys(A, created):
    r = A.post(f"{API}/keys", json={"name": "TEST_key"})
    assert r.status_code == 200
    k = r.json()
    assert k["key"].startswith("adam_live_")
    created["keys"].append(k["id"])
    v = requests.post(f"{API}/v1/chat", headers={"Authorization": f"Bearer {k['key']}"}, json={"message": "oi", "engine": "neural"}, timeout=120)
    assert v.status_code == 200 and "reply" in v.json()
    created["convs"].append(v.json()["conversation_id"])
    assert requests.post(f"{API}/v1/chat", headers={"Authorization": "Bearer adam_live_bogus"}, json={"message": "oi"}).status_code == 401
    assert A.delete(f"{API}/keys/{k['id']}").status_code == 200
    created["keys"].remove(k["id"])
    assert requests.post(f"{API}/v1/chat", headers={"Authorization": f"Bearer {k['key']}"}, json={"message": "oi", "engine": "neural"}).status_code == 401
