import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { Loader2, Play, Plus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { errMsg, useApi } from "@/lib/api";
import PageHeader from "@/components/adam/PageHeader";

function Metric({ label, value, testid }) {
  return (
    <div className="p-4 rounded-xl bg-white/[0.025] border border-white/[0.07]">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="font-display text-xl mt-1.5" data-testid={testid}>{value}</p>
    </div>
  );
}

export default function LabPage() {
  const api = useApi();
  const [s, setS] = useState(null);
  const [steps, setSteps] = useState(200);
  const [prompt, setPrompt] = useState("Usuário: Quem te criou?\nAdam:");
  const [temp, setTemp] = useState(0.7);
  const [out, setOut] = useState("");
  const [gen, setGen] = useState(false);
  const [corpus, setCorpus] = useState("");

  const load = () => api.get("/neural/status").then((r) => setS(r.data)).catch(() => {});
  useEffect(() => { load(); }, [api]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!s?.training) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [s?.training]); // eslint-disable-line react-hooks/exhaustive-deps

  const train = async () => {
    try { await api.post("/neural/train", { steps }); toast.success(`Treinando ${steps} passos`); setS((p) => ({ ...p, training: true })); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const generate = async () => {
    setGen(true);
    try { const { data } = await api.post("/neural/generate", { prompt, temperature: temp, max_tokens: 250 }); setOut(data.completion); }
    catch (e) { toast.error(errMsg(e)); }
    setGen(false);
  };
  const addCorpus = async () => {
    try { await api.post("/neural/corpus", { text: corpus }); setCorpus(""); toast.success("Texto adicionado ao dataset"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  if (!s) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>;
  const pct = s.target ? Math.round((s.run_step / s.target) * 100) : 0;

  return (
    <div className="flex-1 overflow-y-auto scroll-thin">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14">
        <PageHeader eyebrow="Laboratório Neural · PyTorch" title="AdamNano — Transformer próprio, do zero"
          subtitle="Arquitetura decoder-only escrita à mão com atenção causal, tokenizer próprio de caracteres e treino por previsão do próximo token. Pequena de propósito: é a semente da Versão 3 do Adam." />

        <div className="flex flex-wrap items-center gap-3 mb-6 px-4 py-3 rounded-xl border border-purple-500/25 bg-purple-500/5 text-sm" data-testid="lab-autolearn-status">
          <span className="w-2 h-2 rounded-full bg-purple-400 pulse-node" />
          <span className="text-purple-200">Aprendizado contínuo ativo</span>
          <span className="text-zinc-500 text-xs">{s.pending_examples} novos exemplos na fila · treina sozinho a cada 5 min · {s.last_autolearn ? `último aprendizado ${new Date(s.last_autolearn).toLocaleString("pt-BR")}` : "aguardando primeiro ciclo"}</span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-8">
          <Metric label="Parâmetros" value={`${(s.params / 1e6).toFixed(2)}M`} testid="lab-params" />
          <Metric label="Camadas" value={s.n_layer} />
          <Metric label="Cabeças" value={s.n_head} />
          <Metric label="Embedding" value={s.n_embd} />
          <Metric label="Vocabulário" value={s.vocab} />
          <Metric label="Passos treinados" value={s.step} testid="lab-steps" />
        </div>

        <div className="grid lg:grid-cols-5 gap-5">
          <section className="lg:col-span-3 p-5 rounded-2xl bg-[#12141D] border border-white/[0.07]">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <h2 className="font-display text-lg">Curva de loss</h2>
              <span className="font-mono text-xs text-zinc-500" data-testid="lab-last-loss">{s.last_loss != null ? `última: ${s.last_loss}` : "sem treino ainda"}</span>
              <div className="ml-auto flex items-center gap-2">
                <select data-testid="lab-steps-select" value={steps} onChange={(e) => setSteps(+e.target.value)} className="px-2 py-1.5 rounded-lg bg-[#181A26] border border-white/10 text-xs">
                  {[100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n} passos</option>)}
                </select>
                <button onClick={train} disabled={s.training} data-testid="lab-train-epoch-button"
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-purple-500/15 text-purple-200 border border-purple-500/30 text-xs hover:bg-purple-500/25 disabled:opacity-50 transition-colors">
                  {s.training ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} {s.training ? `Treinando ${pct}%` : "Treinar"}
                </button>
              </div>
            </div>
            {s.training && <div className="h-1 rounded bg-white/5 mb-3 overflow-hidden"><div className="h-full bg-purple-400 transition-all" style={{ width: `${pct}%` }} /></div>}
            <div className="h-64" data-testid="lab-loss-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={s.losses}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="step" stroke="#68687D" fontSize={11} />
                  <YAxis stroke="#68687D" fontSize={11} scale="log" domain={["auto", "auto"]} allowDataOverflow />
                  <Tooltip contentStyle={{ background: "#181A26", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="loss" stroke="#8338EC" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-zinc-500 mt-3">Dataset atual: {s.corpus_chars.toLocaleString("pt-BR")} caracteres · {s.corpus_contributions} contribuições suas. Treino roda em CPU no servidor.</p>
          </section>

          <section className="lg:col-span-2 p-5 rounded-2xl bg-[#12141D] border border-white/[0.07] flex flex-col">
            <h2 className="font-display text-lg mb-3">Inferência pura</h2>
            <textarea data-testid="lab-prompt-input" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
              className="w-full px-3 py-2 rounded-lg bg-[#181A26] border border-white/10 text-sm font-mono outline-none focus:border-purple-400/50" />
            <div className="flex items-center gap-3 mt-3">
              <label className="text-xs text-zinc-500">Temperatura {temp}</label>
              <input type="range" min="0.1" max="1.5" step="0.1" value={temp} onChange={(e) => setTemp(+e.target.value)} className="flex-1 accent-purple-400" data-testid="lab-temperature" />
              <button onClick={generate} disabled={gen} data-testid="lab-generate-text-button"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs hover:bg-white/10 disabled:opacity-50">
                {gen ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Gerar
              </button>
            </div>
            <pre data-testid="lab-generated-text" className="mt-4 flex-1 min-h-32 p-3 rounded-lg bg-black/30 border border-white/5 text-xs text-purple-100 whitespace-pre-wrap font-mono">{out || "A saída da rede aparece aqui."}</pre>
          </section>
        </div>

        <section className="mt-5 p-5 rounded-2xl bg-[#12141D] border border-white/[0.07]">
          <h2 className="font-display text-lg">Ensinar com seus dados</h2>
          <p className="text-xs text-zinc-500 mt-1 mb-3">Cole textos ou diálogos no formato "Usuário: … / Adam: …". Eles entram no dataset do próximo treino.</p>
          <textarea data-testid="lab-corpus-input" value={corpus} onChange={(e) => setCorpus(e.target.value)} rows={4} placeholder={"Usuário: Qual o melhor time de BH?\nAdam: ..."}
            className="w-full px-3 py-2 rounded-lg bg-[#181A26] border border-white/10 text-sm font-mono outline-none focus:border-purple-400/50" />
          <button onClick={addCorpus} disabled={corpus.trim().length < 20} data-testid="lab-corpus-add-button"
            className="mt-3 flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/5 border border-white/10 text-xs hover:bg-white/10 disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> Adicionar ao dataset
          </button>
        </section>
      </div>
    </div>
  );
}
