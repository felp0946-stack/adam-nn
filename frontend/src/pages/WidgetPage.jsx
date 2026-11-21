import { useEffect, useState } from "react";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL, errMsg, useApi } from "@/lib/api";
import PageHeader from "@/components/adam/PageHeader";

const field = "w-full px-3 py-2.5 rounded-lg bg-[#181A26] border border-white/10 outline-none focus:border-[#F4A261]/50 text-sm";
const EMPTY = { name: "", title: "Adam", greeting: "Olá! Sou o Adam. Como posso ajudar?", color: "#E07A5F", allowed_origins: "", use_kb: false };
const snippet = (k) => `<script src="${BACKEND_URL}/api/widget.js" data-key="${k}" async></script>`;

function CopyBtn({ text, testid }) {
  const [ok, setOk] = useState(false);
  return (
    <button data-testid={testid} onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}
      className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white shrink-0">{ok ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{ok ? "Copiado" : "Copiar"}</button>
  );
}

export default function WidgetPage() {
  const api = useApi();
  const [list, setList] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const load = () => api.get("/widgets").then((r) => setList(r.data));
  useEffect(() => { load(); }, [api]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const create = async (e) => {
    e.preventDefault();
    try { await api.post("/widgets", { ...form, name: form.name || form.title }); setForm(EMPTY); toast.success("Widget criado"); load(); }
    catch (err) { toast.error(errMsg(err)); }
  };
  const del = async (id) => { await api.delete(`/widgets/${id}`); toast.success("Widget desativado"); load(); };

  return (
    <div className="flex-1 overflow-y-auto scroll-thin">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-14">
        <PageHeader eyebrow="Plugin · Uma linha de código" title="O Adam em qualquer site"
          subtitle="Crie um widget de chat e cole o código no HTML do seu site (WordPress, Wix, Shopify, React…). Visitantes conversam com o Adam sem acessar suas memórias ou conversas." />

        <form onSubmit={create} className="grid sm:grid-cols-2 gap-4 p-6 rounded-2xl bg-[#12141D] border border-white/[0.07] mb-10">
          <div><label className="text-xs text-zinc-400">Nome interno</label><input className={`${field} mt-1`} value={form.name} onChange={set("name")} placeholder="Site da padaria" data-testid="widget-name-input" /></div>
          <div><label className="text-xs text-zinc-400">Título no chat</label><input className={`${field} mt-1`} value={form.title} onChange={set("title")} data-testid="widget-title-input" /></div>
          <div className="sm:col-span-2"><label className="text-xs text-zinc-400">Mensagem de boas-vindas</label><input className={`${field} mt-1`} value={form.greeting} onChange={set("greeting")} data-testid="widget-greeting-input" /></div>
          <div><label className="text-xs text-zinc-400">Domínios permitidos (vazio = todos)</label><input className={`${field} mt-1`} value={form.allowed_origins} onChange={set("allowed_origins")} placeholder="https://meusite.com.br" data-testid="widget-origins-input" /></div>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-xs text-zinc-400">Cor <input type="color" value={form.color} onChange={set("color")} className="w-9 h-9 rounded bg-transparent" data-testid="widget-color-input" /></label>
            <label className="flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={form.use_kb} onChange={set("use_kb")} data-testid="widget-kb-checkbox" /> Responder com minha Base de Conhecimento</label>
          </div>
          <button data-testid="widget-create-button" className="sm:col-span-2 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-[#F4A261] to-[#E07A5F] text-sm font-medium hover:opacity-90">
            <Plus className="w-4 h-4" /> Criar widget
          </button>
        </form>

        <div className="space-y-4" data-testid="widget-list">
          {list.length === 0 && <p className="text-sm text-zinc-500">Nenhum widget ainda.</p>}
          {list.map((w) => (
            <div key={w.id} className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.07]" data-testid={`widget-row-${w.id}`}>
              <div className="flex items-center gap-3 mb-3">
                <span className="w-3 h-3 rounded-full" style={{ background: w.color }} />
                <p className="font-display">{w.name}</p>
                <span className="text-xs text-zinc-500">“{w.title}” · {w.messages} mensagens{w.use_kb ? " · usa base de conhecimento" : ""}</span>
                <button onClick={() => del(w.id)} data-testid="widget-delete-button" className="ml-auto text-zinc-500 hover:text-rose-400"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-[#0c0d14] border border-white/10">
                <code className="flex-1 text-xs font-mono text-zinc-300 break-all" data-testid="widget-snippet">{snippet(w.public_key)}</code>
                <CopyBtn text={snippet(w.public_key)} testid="widget-snippet-copy" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
