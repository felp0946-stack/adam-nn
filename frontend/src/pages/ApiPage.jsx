import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL, errMsg, useApi } from "@/lib/api";
import PageHeader from "@/components/adam/PageHeader";

const examples = (k) => ({
  cURL: `curl -X POST ${BACKEND_URL}/api/v1/chat \\
  -H "Authorization: Bearer ${k}" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Olá Adam!", "engine": "pro"}'`,
  Python: `import requests

r = requests.post(
    "${BACKEND_URL}/api/v1/chat",
    headers={"Authorization": "Bearer ${k}"},
    json={"message": "Olá Adam!", "engine": "pro"},
)
print(r.json()["reply"])`,
  JavaScript: `const r = await fetch("${BACKEND_URL}/api/v1/chat", {
  method: "POST",
  headers: { "Authorization": "Bearer ${k}", "Content-Type": "application/json" },
  body: JSON.stringify({ message: "Olá Adam!", engine: "pro" }),
});
console.log((await r.json()).reply);`,
});

function Copyable({ text, testid }) {
  const [ok, setOk] = useState(false);
  return (
    <button data-testid={testid} onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}
      className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white">{ok ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{ok ? "Copiado" : "Copiar"}</button>
  );
}

export default function ApiPage() {
  const api = useApi();
  const [keys, setKeys] = useState([]);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState(null);
  const [tab, setTab] = useState("cURL");

  const load = () => api.get("/keys").then((r) => setKeys(r.data));
  useEffect(() => { load(); }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (e) => {
    e.preventDefault();
    try { const { data } = await api.post("/keys", { name: name.trim() || "Minha integração" }); setFresh(data.key); setName(""); load(); }
    catch (err) { toast.error(errMsg(err)); }
  };
  const revoke = async (id) => { await api.delete(`/keys/${id}`); toast.success("Chave revogada"); load(); };
  const code = examples(fresh || "adam_live_SUA_CHAVE")[tab];

  return (
    <div className="flex-1 overflow-y-auto scroll-thin">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-14">
        <PageHeader eyebrow="Adam API v1" title="Integre o Adam em qualquer sistema"
          subtitle="Gere chaves e chame o Adam de scripts, apps, plugins, WhatsApp bots ou outros sistemas. As conversas feitas pela API aparecem no seu histórico." />

        <form onSubmit={create} className="flex flex-col sm:flex-row gap-2 mb-4">
          <input data-testid="api-key-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da chave (ex: Plugin do site)"
            className="flex-1 px-4 py-3 rounded-xl bg-[#12141D] border border-white/10 outline-none focus:border-[#F4A261]/50 text-sm" />
          <button data-testid="api-create-key-button" className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-[#F4A261] to-[#E07A5F] text-sm font-medium hover:opacity-90">
            <KeyRound className="w-4 h-4" /> Gerar nova chave
          </button>
        </form>

        {fresh && (
          <div className="mb-6 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 rise" data-testid="api-new-key-box">
            <p className="text-xs text-emerald-300 mb-2">Copie agora — esta chave não será mostrada novamente.</p>
            <div className="flex items-center gap-3">
              <code className="flex-1 text-sm font-mono break-all" data-testid="api-new-key-value">{fresh}</code>
              <Copyable text={fresh} testid="api-new-key-copy" />
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-white/[0.07] overflow-hidden mb-10" data-testid="api-keys-table">
          {keys.length === 0 && <p className="p-6 text-sm text-zinc-500">Nenhuma chave ativa.</p>}
          {keys.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-4 border-b border-white/5 last:border-0 bg-white/[0.015]" data-testid={`api-key-row-${k.id}`}>
              <p className="text-sm min-w-40">{k.name}</p>
              <code className="font-mono text-xs text-zinc-400">{k.prefix}</code>
              <span className="text-xs text-zinc-500">criada {new Date(k.created_at).toLocaleDateString("pt-BR")}</span>
              <span className="text-xs text-zinc-500">{k.last_used_at ? `último uso ${new Date(k.last_used_at).toLocaleString("pt-BR")}` : "nunca usada"}</span>
              <button onClick={() => revoke(k.id)} data-testid="api-revoke-key-button" className="ml-auto flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300">
                <Trash2 className="w-3.5 h-3.5" /> Revogar
              </button>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0c0d14] overflow-hidden">
          <div className="flex items-center gap-1 px-3 py-2 border-b border-white/5 bg-white/[0.03]">
            {Object.keys(examples("")).map((t) => (
              <button key={t} onClick={() => setTab(t)} data-testid={`api-example-tab-${t.toLowerCase()}`}
                className={`px-3 py-1 rounded-md text-xs font-mono ${tab === t ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"}`}>{t}</button>
            ))}
            <div className="ml-auto pr-2"><Copyable text={code} testid="api-example-copy" /></div>
          </div>
          <pre className="p-5 text-[13px] font-mono text-zinc-200 overflow-x-auto scroll-thin">{code}</pre>
        </div>
        <div className="mt-6 text-sm text-zinc-400 space-y-1.5">
          <p><code className="text-[#F4A261]">POST /api/v1/chat</code> — corpo: <code>message</code>, <code>conversation_id</code> (opcional, continua uma conversa), <code>engine</code>: pro | neural | local.</p>
          <p>Resposta: <code>reply</code>, <code>conversation_id</code> e <code>files</code> (baixe com <code className="text-[#F4A261]">GET /api/v1/files/&#123;id&#125;</code>).</p>
        </div>
      </div>
    </div>
  );
}
