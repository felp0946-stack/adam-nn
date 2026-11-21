import { useRef, useState } from "react";
import { ArrowUp, Loader2, Mic, Paperclip, Sparkles, Square, X } from "lucide-react";
import { toast } from "sonner";
import { errMsg, useApi } from "@/lib/api";
import { recordAudio } from "@/lib/voice";
import { useAdam } from "@/lib/adamContext";

export default function Composer({ onSend, busy }) {
  const api = useApi();
  const { engine } = useAdam();
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [rec, setRec] = useState(null);
  const [transcribing, setTranscribing] = useState(false);
  const inputRef = useRef(null);

  const upload = async (list) => {
    setUploading(true);
    for (const f of Array.from(list)) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        const { data } = await api.post("/files/upload", fd);
        setFiles((p) => [...p, data]);
      } catch (e) { toast.error(`${f.name}: ${errMsg(e)}`); }
    }
    setUploading(false);
  };

  const submit = () => {
    if (!text.trim() || busy || uploading) return;
    onSend(text.trim(), files);
    setText(""); setFiles([]);
  };

  const toggleMic = async () => {
    if (rec) {
      const r = rec;
      setRec(null);
      setTranscribing(true);
      try {
        const blob = await r.stop();
        const fd = new FormData();
        fd.append("file", blob, r.mime.includes("webm") ? "voz.webm" : "voz.mp4");
        const { data } = await api.post("/voice/transcribe", fd);
        if (data.text) { onSend(data.text, files, true); setFiles([]); } else toast.info("Não ouvi nada. Tente de novo.");
      } catch (e) { toast.error(errMsg(e)); }
      setTranscribing(false);
      return;
    }
    try { setRec(await recordAudio()); } catch { toast.error("Permita o acesso ao microfone para falar com o Adam."); }
  };

  return (
    <div className="sticky bottom-0 w-full px-3 sm:px-4 pb-4 pt-2 bg-gradient-to-t from-[#090A0F] via-[#090A0F] to-transparent">
      <div className="mx-auto max-w-3xl bg-[#12141D]/90 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl p-2.5 sm:p-3 transition-colors focus-within:border-[#F4A261]/50">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2" data-testid="attachments-list">
            {files.map((f) => (
              <span key={f.id} className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg bg-white/5 border border-white/10 text-xs">
                {f.name}
                <button onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))} data-testid={`attachment-remove-${f.id}`} className="p-0.5 hover:text-rose-400"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
        <textarea data-testid="chat-input-textarea" value={text} rows={1} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Pergunte, peça um arquivo, um site ou uma imagem ao Adam…"
          className="w-full resize-none bg-transparent outline-none text-[0.95rem] placeholder:text-zinc-600 px-2 py-1.5 max-h-48 scroll-thin"
          style={{ height: "auto", minHeight: 44 }} />
        <div className="flex items-center gap-1 mt-1">
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }}
            accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.docx,.xlsx,.txt,.md,.csv,.json,.py,.js,.ts,.jsx,.html,.css,.sql" data-testid="file-upload-input" />
          <button onClick={() => inputRef.current?.click()} disabled={engine !== "pro"} title={engine !== "pro" ? "Anexos disponíveis no Adam Pro" : "Anexar arquivo"}
            data-testid="file-upload-button" className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 disabled:opacity-30 transition-colors">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
          </button>
          <button onClick={() => setText((t) => (t.startsWith("Gere uma imagem") ? t : `Gere uma imagem de ${t}`))} disabled={engine !== "pro"}
            data-testid="image-generate-trigger" title="Gerar imagem" className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 disabled:opacity-30 transition-colors">
            <Sparkles className="w-4 h-4" />
          </button>
          <span className="ml-auto hidden sm:inline text-[10px] font-mono text-zinc-600 mr-2">{rec ? "Gravando… clique para enviar" : "Enter envia · Shift+Enter quebra linha"}</span>
          <button onClick={toggleMic} disabled={busy || transcribing} data-testid="voice-record-button" title={rec ? "Parar e enviar" : "Falar com o Adam"}
            className={`p-2 rounded-xl transition-colors disabled:opacity-30 ${rec ? "bg-rose-500/20 text-rose-300 animate-pulse" : "text-zinc-400 hover:text-white hover:bg-white/5"}`}>
            {transcribing ? <Loader2 className="w-4 h-4 animate-spin" /> : rec ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button onClick={submit} disabled={!text.trim() || busy || uploading} data-testid="chat-send-button"
            className="p-2 rounded-xl bg-gradient-to-r from-[#F4A261] to-[#E07A5F] text-white hover:opacity-90 disabled:opacity-30 transition-opacity">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
