import { useEffect, useRef, useState } from "react";
import { BookOpen, Loader2, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { errMsg, useApi } from "@/lib/api";
import PageHeader from "@/components/adam/PageHeader";

export default function KnowledgePage() {
  const api = useApi();
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState(null);
  const ref = useRef(null);

  const load = () => api.get("/kb").then((r) => setDocs(r.data));
  useEffect(() => { load(); }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (files) => {
    setBusy(true);
    for (const f of Array.from(files)) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        const { data } = await api.post("/kb", fd);
        toast.success(`${data.name}: ${data.chunks} trechos indexados`);
      } catch (e) { toast.error(`${f.name}: ${errMsg(e)}`); }
    }
    setBusy(false);
    load();
  };
  const del = async (id) => { await api.delete(`/kb/${id}`); toast.success("Documento removido"); load(); };
  const search = async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    const { data } = await api.get("/kb/search", { params: { q } });
    setHits(data);
  };

  return (
    <div className="flex-1 overflow-y-auto scroll-thin">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-14">
        <PageHeader eyebrow="RAG · Busca em documentos" title="Base de Conhecimento"
          subtitle="Envie manuais, contratos, apostilas e planilhas. Em toda conversa o Adam busca os trechos mais relevantes e responde com base neles, citando a fonte." />

        <button onClick={() => ref.current?.click()} disabled={busy} data-testid="kb-upload-button"
          className="w-full flex flex-col items-center gap-2 py-10 rounded-2xl border border-dashed border-white/15 hover:border-[#F4A261]/50 hover:bg-white/[0.02] transition-colors mb-8">
          {busy ? <Loader2 className="w-6 h-6 animate-spin text-[#F4A261]" /> : <Upload className="w-6 h-6 text-[#F4A261]" />}
          <span className="text-sm">{busy ? "Indexando…" : "Clique para enviar documentos"}</span>
          <span className="text-xs text-zinc-500">PDF, DOCX, XLSX, TXT, MD, CSV, código · até 20 MB</span>
        </button>
        <input ref={ref} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }}
          accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.json,.py,.js,.html,.css" data-testid="kb-upload-input" />

        <div className="grid sm:grid-cols-2 gap-3 mb-10" data-testid="kb-docs-list">
          {docs.length === 0 && <p className="text-sm text-zinc-500">Nenhum documento ainda.</p>}
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.025] border border-white/[0.07]" data-testid={`kb-doc-${d.id}`}>
              <BookOpen className="w-5 h-5 text-[#F4A261] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{d.name}</p>
                <p className="text-xs text-zinc-500">{d.chunks} trechos · {d.chars.toLocaleString("pt-BR")} caracteres</p>
              </div>
              <button onClick={() => del(d.id)} data-testid="kb-doc-delete" className="text-zinc-500 hover:text-rose-400"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>

        <form onSubmit={search} className="flex gap-2 mb-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Teste a busca: o que o Adam encontraria?" data-testid="kb-search-input"
            className="flex-1 px-4 py-3 rounded-xl bg-[#12141D] border border-white/10 outline-none focus:border-[#F4A261]/50 text-sm" />
          <button data-testid="kb-search-button" className="px-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10"><Search className="w-4 h-4" /></button>
        </form>
        {hits && (hits.length === 0 ? <p className="text-sm text-zinc-500">Nada encontrado.</p> : hits.map((h, i) => (
          <div key={i} className="p-4 rounded-xl bg-[#12141D] border border-white/[0.07] mb-2" data-testid="kb-search-hit">
            <p className="text-[11px] font-mono text-[#F4A261] mb-1">{h.name} · relevância {h.score.toFixed(2)}</p>
            <p className="text-sm text-zinc-300 whitespace-pre-wrap line-clamp-5">{h.text}</p>
          </div>
        )))}
      </div>
    </div>
  );
}
