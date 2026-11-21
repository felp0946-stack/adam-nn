import { useEffect, useRef, useState } from "react";
import { Check, Code2, Copy, Download, ExternalLink, Eye, Github, Loader2, Monitor, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL, errMsg, useApi } from "@/lib/api";
import { saveTextAsFile } from "@/lib/share";
import { siteBlocks, siteTitle } from "@/lib/artifact";
import { SiteFrame, downloadFile } from "@/components/adam/FileCard";
import GithubPushDialog from "@/components/adam/GithubPushDialog";

const btn = "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-40 disabled:pointer-events-none";

function useFileText(file) {
  const api = useApi();
  const [text, setText] = useState(null);
  useEffect(() => {
    if (!file) return;
    api.get(`/files/${file.id}`, { responseType: "text", transformResponse: (d) => d }).then((r) => setText(r.data)).catch(() => setText(""));
  }, [file, api]);
  return text;
}

function resolve(artifact, messages, busy) {
  if (artifact.file) return { file: artifact.file, building: false };
  const idx = messages.findIndex((x) => x.id === artifact.messageId);
  const msg = messages[idx];
  const block = msg && siteBlocks(msg.content)[artifact.index];
  const file = msg?.files?.find((f) => f.source === "chat_block" && f.block_index === artifact.index);
  const streaming = busy && idx === messages.length - 1;
  return { code: block?.code || "", file, building: streaming && !block?.closed, waiting: streaming };
}

function CodeView({ code, building }) {
  const ref = useRef(null);
  useEffect(() => { if (building && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [code, building]);
  return (
    <pre ref={ref} className="h-full overflow-auto scroll-thin p-4 text-[12.5px] leading-relaxed text-zinc-200 bg-[#0c0d14]" data-testid="artifact-code-view">
      <code>{code}</code>{building && <span className="inline-block w-2 h-4 align-middle bg-[#F4A261] animate-pulse ml-0.5" />}
    </pre>
  );
}

function CopyBtn({ text }) {
  const [ok, setOk] = useState(false);
  return <button onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }} data-testid="artifact-copy-button" className={btn} title="Copiar código">{ok ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}</button>;
}

export default function ArtifactPanel({ artifact, messages, busy, onClose }) {
  const api = useApi();
  const r = resolve(artifact, messages, busy);
  const fileText = useFileText(artifact.file);
  const code = artifact.file ? fileText || "" : r.code;
  const [tab, setTab] = useState(r.building ? "code" : "preview");
  const [mobile, setMobile] = useState(false);
  const [preview, setPreview] = useState(code);
  const [savedFile, setSavedFile] = useState(null);
  const [gh, setGh] = useState(false);
  const wasBuilding = useRef(r.building);
  const file = r.file || savedFile;
  const lines = code ? code.split("\n").length : 0;

  useEffect(() => {
    if (wasBuilding.current && !r.building) setTab("preview");
    wasBuilding.current = r.building;
  }, [r.building]);
  useEffect(() => {
    if (!r.building) return setPreview(code);
    const t = setTimeout(() => setPreview(code), 1200);
    return () => clearTimeout(t);
  }, [code, r.building]);

  const ensureFile = async () => file || saveTextAsFile(api, `${siteTitle(code).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site"}.html`, code).then((f) => { setSavedFile(f); return f; });
  const open = async () => {
    const w = window.open("", "_blank");
    try { const f = await ensureFile(); const { data } = await api.post(`/files/${f.id}/share`); w.location.href = `${BACKEND_URL}${data.path}`; }
    catch (e) { w?.close(); toast.error(errMsg(e)); }
  };
  const act = (fn) => async () => { try { fn(await ensureFile()); } catch (e) { toast.error(errMsg(e)); } };
  const tabCls = (k) => `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${tab === k ? "bg-white/10 text-white" : "text-zinc-400 hover:text-zinc-200"}`;
  const disabled = r.building || !code;

  return (
    <aside className="fixed inset-0 z-40 md:static md:z-auto md:w-[50%] md:max-w-[960px] shrink-0 flex flex-col bg-[#0B0C12] md:border-l border-white/10 slide-in" data-testid="artifact-panel">
      <div className="h-14 shrink-0 flex items-center gap-2 px-3 border-b border-white/5">
        <div className="min-w-0 flex-1 pl-1">
          <p className="text-sm text-white truncate" data-testid="artifact-title">{siteTitle(code)}</p>
          <p className="text-[11px] font-mono text-zinc-500 flex items-center gap-1.5" data-testid="artifact-status">
            {r.building ? <><Loader2 className="w-3 h-3 animate-spin text-[#F4A261]" /><span className="text-[#F4A261]">Construindo… {lines} linhas</span></>
              : r.waiting ? <><Loader2 className="w-3 h-3 animate-spin" /> Finalizando…</> : <><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Pronto · {lines} linhas</>}
          </p>
        </div>
        <button onClick={onClose} data-testid="artifact-close-button" className="p-2 rounded-lg hover:bg-white/10 text-zinc-400" title="Fechar"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-white/5 bg-white/[0.02]">
        <button onClick={() => setTab("preview")} data-testid="artifact-tab-preview" className={tabCls("preview")}><Eye className="w-3.5 h-3.5" /> Pré-visualização</button>
        <button onClick={() => setTab("code")} data-testid="artifact-tab-code" className={tabCls("code")}><Code2 className="w-3.5 h-3.5" /> Código</button>
        <span className="flex-1" />
        {tab === "preview" && <button onClick={() => setMobile(!mobile)} data-testid="artifact-device-toggle" className={btn} title="Celular / Desktop">{mobile ? <Monitor className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}</button>}
        {tab === "code" && code && <CopyBtn text={code} />}
        <button onClick={open} disabled={disabled} data-testid="artifact-open-browser-button" className={`${btn} text-emerald-200 border-[#2A9D8F]/40`}><ExternalLink className="w-3.5 h-3.5" /> Abrir no navegador</button>
        <button onClick={act(() => setGh(true))} disabled={disabled} data-testid="artifact-github-button" className={btn}><Github className="w-3.5 h-3.5" /> GitHub</button>
        <button onClick={act((f) => downloadFile(api, f))} disabled={disabled} data-testid="artifact-download-button" className={btn}><Download className="w-3.5 h-3.5" /></button>
      </div>
      <div className="flex-1 min-h-0">
        {!code && <div className="h-full flex items-center justify-center text-xs text-zinc-500 gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Preparando…</div>}
        {code && tab === "code" && <CodeView code={code} building={r.building} />}
        {code && tab === "preview" && (
          <div className="h-full bg-[#0c0d14] p-2 relative">
            <SiteFrame html={preview} mobile={mobile} height="100%" name={siteTitle(code)} />
            {r.building && <span className="absolute top-4 right-4 text-[10px] font-mono px-2 py-1 rounded bg-black/70 text-[#F4A261]">prévia ao vivo</span>}
          </div>
        )}
      </div>
      {gh && file && <GithubPushDialog file={file} open={gh} onOpenChange={setGh} />}
    </aside>
  );
}
