import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Github, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { errMsg, useApi } from "@/lib/api";

const field = "w-full px-3 py-2.5 rounded-lg bg-[#181A26] border border-white/10 outline-none focus:border-[#F4A261]/50 text-sm";
const slug = (n) => n.replace(/\.[^.]+$/, "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "meu-site";

function ResultLinks({ r }) {
  const links = [["Repositório", r.repo_url], ["Commit", r.commit_url], ["Arquivo", r.file_url], ["Site no ar (GitHub Pages)", r.pages_url]].filter(([, u]) => u);
  return (
    <div className="space-y-2" data-testid="github-push-result">
      <p className="text-sm text-emerald-300">{r.created ? "Repositório criado e commit enviado." : "Commit enviado."}</p>
      {links.map(([l, u]) => (
        <a key={l} href={u} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-zinc-300 hover:text-white" data-testid={`github-result-${l.split(" ")[0].toLowerCase()}`}>
          <ExternalLink className="w-3.5 h-3.5 text-[#F4A261]" /> {l}
        </a>
      ))}
      {r.pages_url && <p className="text-xs text-zinc-500">O GitHub Pages pode levar 1–2 minutos para publicar.</p>}
      {r.pages_error && <p className="text-xs text-amber-300">{r.pages_error}</p>}
    </div>
  );
}

export default function GithubPushDialog({ file, open, onOpenChange }) {
  const api = useApi();
  const isHtml = /\.html?$/i.test(file.name);
  const [status, setStatus] = useState(null);
  const [f, setF] = useState({ repo: slug(file.name), path: isHtml ? "index.html" : file.name, message: `Adiciona ${file.name} (Adam)`, private: false, pages: isHtml });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { if (open) api.get("/github/status").then((r) => setStatus(r.data)).catch(() => setStatus({ connected: false })); }, [open, api]);

  const push = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { const { data } = await api.post("/github/push", { file_id: file.id, ...f }); setResult(data); toast.success("Enviado para o GitHub"); }
    catch (err) { toast.error(errMsg(err)); }
    setBusy(false);
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setResult(null); }}>
      <DialogContent className="bg-[#12141D] border-white/10 max-w-md" data-testid="github-push-dialog">
        <DialogTitle className="flex items-center gap-2 font-display"><Github className="w-4 h-4" /> Enviar para o GitHub</DialogTitle>
        <DialogDescription className="text-zinc-500 text-xs">{file.name}</DialogDescription>
        {!status && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
        {status && !status.connected && (
          <p className="text-sm text-zinc-400" data-testid="github-not-connected">
            Conecte sua conta do GitHub primeiro em <Link to="/configuracoes" onClick={() => onOpenChange(false)} className="text-[#F4A261] underline">Configurações</Link>.
          </p>
        )}
        {status?.connected && (result ? <ResultLinks r={result} /> : (
          <form onSubmit={push} className="space-y-3">
            <p className="text-xs text-zinc-500">Conta: <span className="text-zinc-300">{status.login}</span>. Se o repositório não existir, ele será criado.</p>
            <div>
              <label className="text-xs text-zinc-400">Repositório</label>
              <input data-testid="github-repo-input" className={`${field} mt-1`} value={f.repo} onChange={set("repo")} pattern="[A-Za-z0-9._-]+" required />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Caminho do arquivo no repositório</label>
              <input data-testid="github-path-input" className={`${field} mt-1`} value={f.path} onChange={set("path")} required />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Mensagem do commit</label>
              <input data-testid="github-message-input" className={`${field} mt-1`} value={f.message} onChange={set("message")} required />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={f.private} onChange={set("private")} data-testid="github-private-checkbox" /> Repositório privado (se for criado agora)</label>
            {isHtml && <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={f.pages} onChange={set("pages")} data-testid="github-pages-checkbox" /> Publicar o site no GitHub Pages</label>}
            <button disabled={busy} data-testid="github-push-submit" className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[#F4A261] to-[#E07A5F] text-sm font-medium disabled:opacity-60">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Github className="w-4 h-4" />} {busy ? "Enviando…" : "Fazer commit e push"}
            </button>
          </form>
        ))}
      </DialogContent>
    </Dialog>
  );
}
