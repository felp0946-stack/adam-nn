import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { errMsg, useApi } from "@/lib/api";
import PageHeader from "@/components/adam/PageHeader";

export default function MemoryPage() {
  const api = useApi();
  const [items, setItems] = useState([]);
  const [fact, setFact] = useState("");
  const [tag, setTag] = useState("geral");

  const load = () => api.get("/memories").then((r) => setItems(r.data));
  useEffect(() => { load(); }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (e) => {
    e.preventDefault();
    if (fact.trim().length < 2) return;
    try { await api.post("/memories", { fact: fact.trim(), tag }); setFact(""); toast.success("Memória salva"); load(); }
    catch (err) { toast.error(errMsg(err)); }
  };
  const del = async (id) => { await api.delete(`/memories/${id}`); toast.success("Memória esquecida"); load(); };

  return (
    <div className="flex-1 overflow-y-auto scroll-thin">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-14">
        <PageHeader eyebrow="Memória de longo prazo" title="O que o Adam lembra sobre você"
          subtitle="Fatos e preferências usados em todas as conversas. O Adam também salva memórias sozinho quando você conta algo importante." />
        <form onSubmit={add} className="flex flex-col sm:flex-row gap-2 mb-8">
          <input data-testid="memory-fact-input" value={fact} onChange={(e) => setFact(e.target.value)} placeholder="Ex: Prefiro respostas curtas e com exemplos em Python"
            className="flex-1 px-4 py-3 rounded-xl bg-[#12141D] border border-white/10 outline-none focus:border-[#F4A261]/50 text-sm" />
          <select data-testid="memory-tag-select" value={tag} onChange={(e) => setTag(e.target.value)} className="px-3 py-3 rounded-xl bg-[#12141D] border border-white/10 text-sm">
            {["geral", "preferencia", "projeto", "pessoal", "tecnologia"].map((t) => <option key={t}>{t}</option>)}
          </select>
          <button data-testid="memory-add-button" className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-[#F4A261] to-[#E07A5F] text-sm font-medium hover:opacity-90 transition-opacity">
            <Plus className="w-4 h-4" /> Adicionar
          </button>
        </form>
        <p className="font-mono text-xs text-zinc-500 mb-4" data-testid="memory-count">{items.length} fatos ativos</p>
        {items.length === 0 && <p className="text-sm text-zinc-500 py-10 text-center border border-dashed border-white/10 rounded-2xl">Nenhuma memória ainda. Conte algo sobre você no chat ou adicione acima.</p>}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((m) => (
            <div key={m.id} data-testid="memory-item-card" className="group p-4 rounded-xl bg-white/[0.025] border border-white/[0.07] hover:border-white/15 transition-colors rise">
              <p className="text-sm text-zinc-200 leading-relaxed">{m.fact}</p>
              <div className="flex items-center gap-2 mt-4">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#E07A5F]/10 text-[#F4A261] border border-[#E07A5F]/20">#{m.tag}</span>
                <span className="text-[10px] text-zinc-600">{m.source === "adam" ? "salva pelo Adam" : "manual"} · {new Date(m.created_at).toLocaleDateString("pt-BR")}</span>
                <button onClick={() => del(m.id)} data-testid="memory-delete-button" className="ml-auto text-zinc-600 hover:text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
