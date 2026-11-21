import { useEffect, useState } from "react";
import { Code2, Download, FileSpreadsheet, FileText, Image as ImageIcon, Maximize2, Monitor, Smartphone, Table } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useApi } from "@/lib/api";

const TYPES = {
  pdf: { icon: FileText, badge: "PDF", cls: "text-rose-400 bg-rose-500/10 border-rose-500/20" },
  docx: { icon: FileSpreadsheet, badge: "Word", cls: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  xlsx: { icon: Table, badge: "Excel", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  csv: { icon: Table, badge: "CSV", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  image: { icon: ImageIcon, badge: "Imagem", cls: "text-sky-400 bg-sky-500/10 border-sky-500/20" },
  code: { icon: Code2, badge: "Código", cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
};

export const typeOf = (f) => (f.mime?.startsWith("image/") ? "image" : TYPES[f.name.split(".").pop().toLowerCase()] ? f.name.split(".").pop().toLowerCase() : "code");
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

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
  const t = TYPES[typeOf(file)];
  const Icon = t.icon;
  if (typeOf(file) === "image") return <GeneratedImage file={file} />;
  const card = (
    <div className="flex items-center gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-colors my-2 max-w-md rise" data-testid={`generated-file-card-${file.id}`}>
      <div className={`p-2.5 rounded-lg border ${t.cls}`}><Icon className="w-5 h-5" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white truncate">{file.name}</p>
        <p className="text-xs text-zinc-500">{t.badge} · {fmtSize(file.size)}</p>
      </div>
      <button onClick={() => downloadFile(api, file)} data-testid="generated-file-card-download"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 border border-white/10 transition-colors">
        <Download className="w-3.5 h-3.5" /> Baixar
      </button>
    </div>
  );
  if (!/\.html?$/i.test(file.name)) return card;
  return (
    <div className="max-w-3xl">
      {card}
      <SitePreview file={file} />
    </div>
  );
}

function SitePreview({ file }) {
  const api = useApi();
  const [html, setHtml] = useState(null);
  const [open, setOpen] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [full, setFull] = useState(false);
  useEffect(() => {
    api.get(`/files/${file.id}`, { responseType: "text" }).then((r) => setHtml(r.data)).catch(() => {});
  }, [file.id, api]);
  if (!html) return null;
  const frame = (h) => (
    <iframe title={file.name} srcDoc={html} sandbox="allow-scripts allow-forms allow-modals allow-popups" data-testid="site-preview-iframe"
      className="bg-white rounded-lg mx-auto block transition-[width] duration-300" style={{ width: mobile ? 390 : "100%", height: h, border: 0 }} />
  );
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden mb-2 rise" data-testid={`site-preview-${file.id}`}>
      <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.04] border-b border-white/5 text-xs">
        <span className="flex gap-1.5 mr-2"><i className="w-2.5 h-2.5 rounded-full bg-rose-400/70" /><i className="w-2.5 h-2.5 rounded-full bg-amber-400/70" /><i className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" /></span>
        <span className="font-mono text-zinc-400 truncate flex-1">Prévia ao vivo · {file.name}</span>
        <button onClick={() => setMobile(!mobile)} data-testid="site-preview-device-toggle" className="p-1 rounded hover:bg-white/10" title="Celular / Desktop">
          {mobile ? <Monitor className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
        </button>
        <button onClick={() => setFull(true)} data-testid="site-preview-fullscreen" className="p-1 rounded hover:bg-white/10" title="Tela cheia"><Maximize2 className="w-3.5 h-3.5" /></button>
        <button onClick={() => setOpen(!open)} data-testid="site-preview-toggle" className="px-2 py-0.5 rounded hover:bg-white/10 text-zinc-400">{open ? "Ocultar" : "Mostrar"}</button>
      </div>
      {open && <div className="bg-[#0c0d14] p-2">{frame(420)}</div>}
      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-3 bg-[#0c0d14] border-white/10 flex flex-col">
          <DialogTitle className="text-sm font-mono text-zinc-400">{file.name}</DialogTitle>
          <div className="flex-1 min-h-0">{frame("100%")}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
