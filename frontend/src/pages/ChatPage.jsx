import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FileText, Globe, Image as ImageIcon, Phone, Search } from "lucide-react";
import { toast } from "sonner";
import { API, errMsg, useApi } from "@/lib/api";
import { useAdam } from "@/lib/adamContext";
import EngineSelect from "@/components/adam/EngineSelect";
import MessageBubble from "@/components/adam/MessageBubble";
import Composer from "@/components/adam/Composer";
import CallMode from "@/components/adam/CallMode";
import { speak } from "@/lib/voice";

const SUGGESTIONS = [
  { icon: Globe, text: "Crie um site de portfólio moderno em um único arquivo HTML" },
  { icon: FileText, text: "Gere um PDF com um plano de estudos de redes neurais em 8 semanas" },
  { icon: Search, text: "Pesquise as últimas notícias sobre inteligência artificial no Brasil" },
  { icon: ImageIcon, text: "Gere uma imagem de Belo Horizonte futurista ao entardecer" },
];

async function readSSE(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const p of parts) if (p.startsWith("data: ")) onEvent(JSON.parse(p.slice(6)));
  }
}

function Empty({ onPick }) {
  return (
    <div className="flex-1 flex flex-col justify-center max-w-3xl w-full mx-auto px-5 py-10">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500 mb-4 rise">Adam · IA própria</p>
      <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight leading-tight rise" style={{ animationDelay: "60ms" }}>
        Olá. Em que vamos <span className="adam-gradient-text">trabalhar</span> hoje?
      </h1>
      <div className="grid sm:grid-cols-2 gap-2.5 mt-10">
        {SUGGESTIONS.map(({ icon: Icon, text }, i) => (
          <button key={text} onClick={() => onPick(text)} data-testid={`suggestion-${i}`} style={{ animationDelay: `${120 + i * 60}ms` }}
            className="rise text-left flex gap-3 p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:border-[#E07A5F]/40 hover:bg-white/[0.04] transition-colors text-sm text-zinc-300">
            <Icon className="w-4 h-4 mt-0.5 text-[#F4A261] shrink-0" /> {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { engine, refresh, settings } = useAdam();
  const [messages, setMessages] = useState([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const skipLoad = useRef(null);
  const endRef = useRef(null);
  const convRef = useRef(id || null);
  const sendRef = useRef(null);
  const [calling, setCalling] = useState(false);

  useEffect(() => {
    convRef.current = id || null;
    if (!id) { setMessages([]); setTitle(""); return; }
    if (skipLoad.current === id) return;
    api.get(`/conversations/${id}`).then(({ data }) => { setMessages(data.messages); setTitle(data.conversation.title); })
      .catch(() => { toast.error("Conversa não encontrada"); navigate("/"); });
  }, [id, api, navigate]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);

  const patchLast = (fn) => setMessages((p) => { const c = [...p]; c[c.length - 1] = fn(c[c.length - 1]); return c; });

  const send = async (text, files, byVoice = false) => {
    setBusy(true);
    let finalText = "";
    setMessages((p) => [...p, { id: `u-${Date.now()}`, role: "user", content: text, attachments: files },
      { id: "streaming", role: "assistant", content: "", files: [], engine }]);
    try {
      const token = await api.token();
      const res = await fetch(`${API}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text, conversation_id: convRef.current || null, engine, attachment_ids: files.map((f) => f.id) }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || `Erro ${res.status}`);
      await readSSE(res, (ev) => {
        if (ev.type === "meta") {
          setTitle(ev.title);
          if (!convRef.current) { convRef.current = ev.conversation_id; skipLoad.current = ev.conversation_id; navigate(`/chat/${ev.conversation_id}`, { replace: true }); refresh(); }
        } else if (ev.type === "delta") { finalText += ev.content; patchLast((m) => ({ ...m, content: m.content + ev.content, tool: null })); }
        else if (ev.type === "tool") patchLast((m) => ({ ...m, tool: ev.label }));
        else if (ev.type === "file") patchLast((m) => ({ ...m, files: [...m.files, ev.file], tool: null }));
        else if (ev.type === "link") {
          patchLast((m) => ({ ...m, links: [...(m.links || []), ev.link], tool: null }));
          if (ev.link.kind === "open" && !window.open(ev.link.url, "_blank", "noopener")) toast.info("Seu navegador bloqueou a nova aba. Clique em “Abrir” no cartão.");
        }
        else if (ev.type === "error") toast.error(ev.message);
        else if (ev.type === "done") patchLast((m) => ({ ...m, id: ev.message_id }));
      });
      if (byVoice === true || (settings.auto_speak && byVoice !== "call")) {
        if (finalText.trim()) speak(api, finalText, "last").catch(() => toast.error("Não consegui falar a resposta."));
      }
      return finalText;
    } catch (e) {
      toast.error(errMsg(e));
      patchLast((m) => ({ ...m, content: m.content || "⚠️ Não foi possível obter resposta." }));
      return "";
    } finally {
      setBusy(false);
      refresh();
    }
  };
  sendRef.current = send;

  return (
    <div className="flex flex-col h-full min-h-0">
      {calling && <CallMode onSend={(t) => sendRef.current(t, [], "call")} onClose={() => setCalling(false)} />}
      <header className="h-14 shrink-0 pl-14 md:pl-6 pr-4 border-b border-white/5 bg-[#090A0F]/80 backdrop-blur-xl flex items-center gap-4 z-20">
        <EngineSelect />
        <p className="text-sm text-zinc-400 truncate flex-1" data-testid="chat-title">{title}</p>
        {busy && <span className="text-[11px] font-mono text-[#F4A261] animate-pulse" data-testid="chat-streaming-indicator">gerando…</span>}
        <button onClick={() => setCalling(true)} data-testid="call-mode-start-button" title="Ligar para o Adam"
          className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-xs hover:bg-emerald-500/20 transition-colors">
          <Phone className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Ligar</span>
        </button>
      </header>
      <div className="flex-1 overflow-y-auto scroll-thin flex flex-col" data-testid="chat-messages">
        {messages.length === 0 ? <Empty onPick={(t) => send(t, [])} /> : (
          <div className="max-w-3xl w-full mx-auto px-4 sm:px-5 py-8 space-y-7">
            {messages.map((m, i) => <MessageBubble key={m.id} m={m} streaming={busy && i === messages.length - 1 && m.role === "assistant"} />)}
            <div ref={endRef} />
          </div>
        )}
      </div>
      <Composer onSend={send} busy={busy} />
    </div>
  );
}
