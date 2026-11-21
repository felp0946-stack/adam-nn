import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { errMsg, useApi } from "@/lib/api";
import PageHeader from "@/components/adam/PageHeader";
import { useAdam } from "@/lib/adamContext";

const field = "w-full px-4 py-3 rounded-xl bg-[#181A26] border border-white/10 outline-none focus:border-[#F4A261]/50 text-sm";
const VOICES = [["onyx", "grave e firme"], ["echo", "suave e calma"], ["ash", "clara"], ["sage", "sábia"], ["alloy", "neutra"], ["coral", "calorosa"], ["nova", "enérgica"], ["shimmer", "alegre"], ["fable", "expressiva"]];

function BrazilianVoices({ current, onPicked }) {
  const api = useApi();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => { api.get("/voice/eleven/voices").then((r) => setData(r.data)).catch((e) => setData({ enabled: true, voices: [], error: errMsg(e) })); }, [api]);
  if (!data) return <p className="text-xs text-zinc-500 mb-4">Carregando vozes brasileiras…</p>;
  if (!data.enabled) return <p className="text-xs text-amber-300 mb-4" data-testid="eleven-missing-key">Chave da ElevenLabs ainda não configurada — usando a voz OpenAI enquanto isso.</p>;
  if (data.error) return <p className="text-xs text-rose-300 mb-4">{data.error}</p>;
  const pick = async (v) => {
    setBusy(v.voice_id);
    try { const { data: d } = await api.post("/voice/eleven/select", v); onPicked(d); toast.success(`Voz “${v.name}” selecionada`); }
    catch (e) { toast.error(errMsg(e)); }
    setBusy(null);
  };
  return (
    <div className="grid sm:grid-cols-2 gap-2 mb-4 max-h-80 overflow-y-auto scroll-thin pr-1" data-testid="eleven-voice-list">
      {data.voices.map((v) => (
        <div key={v.voice_id} className={`p-3 rounded-xl border ${current === v.voice_id ? "border-[#F4A261]/60 bg-[#F4A261]/5" : "border-white/10 bg-white/[0.02]"}`}>
          <div className="flex items-center gap-2">
            <p className="text-sm truncate flex-1">{v.name}</p>
            <span className="text-[10px] text-zinc-500">{v.gender === "male" ? "masc." : v.gender === "female" ? "fem." : ""} {v.age || ""}</span>
          </div>
          <p className="text-[11px] text-zinc-500 line-clamp-2 mt-1 min-h-8">{v.description}</p>
          <div className="flex items-center gap-2 mt-2">
            {v.preview_url && <button type="button" onClick={() => new Audio(v.preview_url).play()} data-testid={`eleven-preview-${v.voice_id}`} className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10">▶ Ouvir</button>}
            <button type="button" onClick={() => pick(v)} disabled={busy === v.voice_id} data-testid={`eleven-pick-${v.voice_id}`}
              className="text-xs px-2 py-1 rounded bg-[#E07A5F]/20 text-amber-200 hover:bg-[#E07A5F]/30 disabled:opacity-50">{current === v.voice_id ? "Selecionada" : busy === v.voice_id ? "…" : "Usar esta"}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const api = useApi();
  const { setSettings } = useAdam();
  const [s, setS] = useState(null);
  useEffect(() => { api.get("/settings").then((r) => setS(r.data)); }, [api]);
  const save = async () => {
    try { await api.put("/settings", s); setSettings(s); toast.success("Configurações salvas"); } catch (e) { toast.error(errMsg(e)); }
  };
  if (!s) return null;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });

  return (
    <div className="flex-1 overflow-y-auto scroll-thin">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-14">
        <PageHeader eyebrow="Configurações & Motores" title="Como o Adam pensa" />

        <section className="p-6 rounded-2xl bg-[#12141D] border border-white/[0.07] mb-5">
          <h2 className="font-display text-lg">Servidor local (Ollama)</h2>
          <p className="text-sm text-zinc-500 mt-1 mb-5">Rode um modelo aberto (Llama, Qwen, Gemma) no seu servidor com GPU e conecte aqui. O motor "Servidor Local" usará este endereço — sem nenhuma API de terceiros.</p>
          <label className="text-xs text-zinc-400">URL do servidor</label>
          <input data-testid="settings-ollama-url-input" className={`${field} mt-1.5 mb-4`} value={s.ollama_url} onChange={set("ollama_url")} placeholder="http://seu-servidor:11434" />
          <label className="text-xs text-zinc-400">Modelo</label>
          <input data-testid="settings-ollama-model-input" className={`${field} mt-1.5`} value={s.ollama_model} onChange={set("ollama_model")} placeholder="llama3.1, qwen2.5, gemma2…" />
        </section>

        <section className="p-6 rounded-2xl bg-[#12141D] border border-white/[0.07] mb-5">
          <h2 className="font-display text-lg">Estilo de resposta</h2>
          <p className="text-sm text-zinc-500 mt-1 mb-4">Instrução aplicada em todas as conversas.</p>
          <textarea data-testid="settings-style-input" rows={3} className={field} value={s.response_style} onChange={set("response_style")} placeholder="Ex: Seja direto, use exemplos práticos e emojis com moderação." />
        </section>

        <section className="p-6 rounded-2xl bg-[#12141D] border border-white/[0.07] mb-5">
          <h2 className="font-display text-lg">Voz do Adam</h2>
          <p className="text-sm text-zinc-500 mt-1 mb-4">Fale pelo microfone ou use “Ligar” no chat. Quando você fala, o Adam responde falando.</p>
          <label className="text-xs text-zinc-400">Motor de voz</label>
          <select data-testid="settings-voice-provider" className={`${field} mt-1.5 mb-4`} value={s.voice_provider || "elevenlabs"} onChange={set("voice_provider")}>
            <option value="elevenlabs">ElevenLabs — sotaque brasileiro natural</option>
            <option value="openai">OpenAI — vozes multilíngues (sotaque americano)</option>
          </select>
          {(s.voice_provider || "elevenlabs") === "elevenlabs" ? <BrazilianVoices current={s.eleven_voice_id} onPicked={(v) => setS({ ...s, eleven_voice_id: v.voice_id, eleven_voice_name: v.name, voice_provider: "elevenlabs" })} /> : (<>
          <label className="text-xs text-zinc-400">Voz</label>
          <select data-testid="settings-voice-select" className={`${field} mt-1.5 mb-4`} value={s.voice || "onyx"} onChange={set("voice")}>
            {VOICES.map(([v, d]) => <option key={v} value={v}>{v} — {d}</option>)}
          </select></>)}
          <label className="flex items-center gap-3 text-sm text-zinc-300">
            <input type="checkbox" checked={!!s.auto_speak} onChange={(e) => setS({ ...s, auto_speak: e.target.checked })} data-testid="settings-auto-speak" />
            Ler todas as respostas em voz alta automaticamente
          </label>
        </section>

        <section className="p-6 rounded-2xl bg-[#12141D] border border-white/[0.07] mb-5">
          <h2 className="font-display text-lg">Aprendizado contínuo</h2>
          <label className="flex items-start gap-3 text-sm text-zinc-300 mt-3">
            <input type="checkbox" className="mt-1" checked={s.neural_learning !== false} onChange={(e) => setS({ ...s, neural_learning: e.target.checked })} data-testid="settings-neural-learning" />
            <span>Permitir que o Adam Neural aprenda em segundo plano com minhas mensagens, memórias, documentos e respostas do Servidor Local.
              <span className="block text-xs text-zinc-500 mt-1">O Adam Neural é um modelo compartilhado da plataforma. Respostas do Adam Pro não são usadas no treino.</span></span>
          </label>
        </section>

        <button onClick={save} data-testid="settings-save-button" className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-[#F4A261] to-[#E07A5F] text-sm font-medium hover:opacity-90">
          <Save className="w-4 h-4" /> Salvar
        </button>

        <section className="mt-12 relative overflow-hidden rounded-2xl border border-white/[0.07]">
          <img src="https://images.unsplash.com/photo-1543958871-ccfa180a0c39?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200" alt="Belo Horizonte" className="absolute inset-0 w-full h-full object-cover opacity-25" />
          <div className="relative p-6 bg-gradient-to-r from-[#090A0F] to-transparent">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">Sobre</p>
            <p className="font-display text-xl mt-2">Adam foi criado por Felipe Hudson</p>
            <p className="text-sm text-zinc-400 mt-1">19 anos · Belo Horizonte, Minas Gerais, Brasil</p>
          </div>
        </section>
      </div>
    </div>
  );
}
