import { useEffect, useState } from "react";
import { Check, Code2, Copy, Download, ExternalLink, Eye, FileSpreadsheet, FileText, Github, Image as ImageIcon, Maximize2, Monitor, Smartphone, Table } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useApi } from "@/lib/api";
import { openShared } from "@/lib/share";
import GithubPushDialog from "@/components/adam/GithubPushDialog";
import { useArtifact } from "@/lib/artifact";

const TYPES = {
  pdf: { icon: FileText, badge: "PDF", cls: "text-rose-400 bg-rose-500/10 border-rose-500/20" },
  docx: { icon: FileSpreadsheet, badge: "Word", cls: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  xlsx: { icon: Table, badge: "Excel", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  csv: { icon: Table, badge: "CSV", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  html: { icon: Monitor, badge: "Site", cls: "text-orange-300 bg-orange-500/10 border-orange-500/20" },
  htm: { icon: Monitor, badge: "Site", cls: "text-orange-300 bg-orange-500/10 border-orange-500/20" },
  image: { icon: ImageIcon, badge: "Imagem", cls: "text-sky-400 bg-sky-500/10 border-sky-500/20" },
  code: { icon: Code2, badge: "Código", cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
};
const BINARY = ["pdf", "docx", "xlsx"];

export const typeOf = (f) => (f.mime?.startsWith("image/") ? "image" : TYPES[f.name.split(".").pop().toLowerCase()] ? f.name.split(".").pop().toLowerCase() : "code");
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const btn = "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 border border-white/10 transition-colors";

export function useBlobUrl(fileId) {
  const api = useApi();
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let u;
    if (!fileId) return;
    api.get(`/files/${fileId}`, { responseType: "blob" }).then((r) => { u = URL.createObjectURL(r.data); setUrl(u); }).catch(() => {});
    return () => u && URL.revokeObjectURL(u);
  }, [fileId, api]);
  return url;
}

export async function downloadFile(api, f) {
  const r = await api.get(`/files/${f.id}`, { responseType: "blob" });
  const u = URL.createObjectURL(r.data);
  const a = document.createElement("a");
  a.href = u; a.download = f.name; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}

export function GeneratedImage({ file }) {
  const api = useApi();
  const url = useBlobUrl(file.id);
  return (
    <div className="relative group rounded-2xl overflow-hidden border border-white/10 my-3 max-w-md rise" data-testid={`generated-image-${file.id}`}>
      {url ? <img src={url} alt={file.prompt || file.name} className="w-full h-auto block" />
        : <div className="aspect-square bg-gradient-to-br from-white/5 to-white/[0.02] animate-pulse flex items-center justify-center text-xs text-zinc-500">Carregando imagem…</div>}
      <div className="absolute inset-x-0 bottom-0 p-3 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-300">Gerado por Adam Vision</span>
        <button onClick={() => downloadFile(api, file)} data-testid="generated-image-download" className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20">
          <Download className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function FileCard({ file }) {
  const api = useApi();
  const artifact = useArtifact();
  const [gh, setGh] = useState(false);
  const kind = typeOf(file);
  if (kind === "image") return <GeneratedImage file={file} />;
  const t = TYPES[kind];
  const Icon = t.icon;
  const isHtml = kind === "html" || kind === "htm";
  return (
    <div className="max-w-3xl my-2 rise">
      <div className="flex flex-wrap items-center gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-colors" data-testid={`generated-file-card-${file.id}`}>
        <div className={`p-2.5 rounded-lg border ${t.cls}`}><Icon className="w-5 h-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white truncate">{file.name}</p>
          <p className="text-xs text-zinc-500">{t.badge} · {fmtSize(file.size)}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {isHtml && artifact && <button onClick={() => artifact.open({ file })} data-testid="file-preview-panel-button" className={`${btn} border-[#F4A261]/40 text-amber-200`}><Eye className="w-3.5 h-3.5" /> Pré-visualização</button>}
          {isHtml && <button onClick={() => openShared(api, file.id)} data-testid="file-open-browser-button" className={`${btn} border-[#2A9D8F]/40 text-emerald-200 hover:bg-[#2A9D8F]/20`}><ExternalLink className="w-3.5 h-3.5" /> Abrir no navegador</button>}
          {!BINARY.includes(kind) && <button onClick={() => setGh(true)} data-testid="file-github-button" className={btn}><Github className="w-3.5 h-3.5" /> GitHub</button>}
          <button onClick={() => downloadFile(api, file)} data-testid="generated-file-card-download" className={btn}><Download className="w-3.5 h-3.5" /> Baixar</button>
        </div>
      </div>
      {isHtml && !artifact && <SitePreview file={file} />}
      {gh && <GithubPushDialog file={file} open={gh} onOpenChange={setGh} />}
    </div>
  );
}

function CopyBtn({ text }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }} data-testid="site-code-copy" className="p-1 rounded hover:bg-white/10" title="Copiar código">
      {ok ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export function SiteFrame({ html, mobile, height, name }) {
  return (
    <iframe title={name} srcDoc={html} sandbox="allow-scripts allow-forms allow-modals allow-popups" data-testid="site-preview-iframe"
      className="bg-white rounded-lg mx-auto block transition-[width] duration-300" style={{ width: mobile ? 390 : "100%", height, border: 0 }} />
  );
}

function SitePreview({ file }) {
  const api = useApi();
  const [html, setHtml] = useState(null);
  const [tab, setTab] = useState("preview");
  const [mobile, setMobile] = useState(false);
  const [full, setFull] = useState(false);
  useEffect(() => {
    api.get(`/files/${file.id}`, { responseType: "text", transformResponse: (d) => d }).then((r) => setHtml(r.data)).catch(() => setHtml(""));
  }, [file.id, api]);
  const tabCls = (k) => `flex items-center gap-1 px-2.5 py-1 rounded-md ${tab === k ? "bg-white/10 text-white" : "text-zinc-400 hover:text-zinc-200"}`;
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden mt-2 mb-2" data-testid={`site-preview-${file.id}`}>
      <div className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.04] border-b border-white/5 text-xs">
        <span className="flex gap-1.5 mr-2"><i className="w-2.5 h-2.5 rounded-full bg-rose-400/70" /><i className="w-2.5 h-2.5 rounded-full bg-amber-400/70" /><i className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" /></span>
        <button onClick={() => setTab("preview")} data-testid="site-tab-preview" className={tabCls("preview")}><Eye className="w-3.5 h-3.5" /> Prévia</button>
        <button onClick={() => setTab("code")} data-testid="site-tab-code" className={tabCls("code")}><Code2 className="w-3.5 h-3.5" /> Código</button>
        <span className="flex-1" />
        {tab === "preview" ? (<>
          <button onClick={() => setMobile(!mobile)} data-testid="site-preview-device-toggle" className="p-1 rounded hover:bg-white/10" title="Celular / Desktop">
            {mobile ? <Monitor className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => setFull(true)} data-testid="site-preview-fullscreen" className="p-1 rounded hover:bg-white/10" title="Tela cheia"><Maximize2 className="w-3.5 h-3.5" /></button>
        </>) : html && <CopyBtn text={html} />}
      </div>
      {html === null && <div className="h-40 animate-pulse bg-white/[0.02]" />}
      {html === "" && <p className="p-4 text-xs text-zinc-500">Não consegui carregar a prévia. Use “Abrir no navegador”.</p>}
      {html && tab === "preview" && <div className="bg-[#0c0d14] p-2"><SiteFrame html={html} mobile={mobile} height={460} name={file.name} /></div>}
      {html && tab === "code" && <pre className="p-4 max-h-[460px] overflow-auto scroll-thin text-[12.5px] leading-relaxed text-zinc-200 bg-[#0c0d14]" data-testid="site-code-view"><code>{html}</code></pre>}
      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-3 bg-[#0c0d14] border-white/10 flex flex-col">
          <DialogTitle className="text-sm font-mono text-zinc-400">{file.name}</DialogTitle>
          <div className="flex-1 min-h-0">{html && <SiteFrame html={html} mobile={mobile} height="100%" name={file.name} />}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
