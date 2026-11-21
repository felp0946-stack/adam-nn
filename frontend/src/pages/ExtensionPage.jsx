import { BellRing, Download, MousePointerClick, ShieldCheck, Keyboard, Globe } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL, errMsg, useApi } from "@/lib/api";
import PageHeader from "@/components/adam/PageHeader";

const STEPS = [
  "Baixe o arquivo .zip e descompacte em uma pasta.",
  "No Chrome, abra chrome://extensions e ative o “Modo do desenvolvedor” (canto superior direito).",
  "Clique em “Carregar sem compactação” e selecione a pasta adam-extension.",
  "Em Adam → API & Chaves, gere uma chave e cole nas configurações (⚙) da extensão.",
  "Clique no ícone do Adam na barra do Chrome: o painel lateral abre. Digite a tarefa e aprove cada ação.",
  "Tarefas longas: pode fechar o painel ou trocar de aba — o Adam continua em segundo plano, pede permissão por notificação e avisa quando terminar.",
];


const CAPS = [
  { icon: Globe, t: "Navega", d: "Abre sites, pesquisa no Google, volta páginas." },
  { icon: MousePointerClick, t: "Clica", d: "Botões, links, abas e menus da página." },
  { icon: Keyboard, t: "Digita", d: "Preenche campos e envia formulários." },
  { icon: ShieldCheck, t: "Com permissão", d: "Pede sua aprovação antes de cada ação. Nunca digita senhas ou paga sem você pedir." },
  { icon: BellRing, t: "Segundo plano", d: "Executa tarefas longas (até 80 passos) enquanto você usa outras abas e te notifica no fim." },
];

export default function ExtensionPage() {
  const api = useApi();
  const download = async () => {
    try {
      const r = await api.get("/extension/download", { params: { server: BACKEND_URL }, responseType: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(r.data);
      a.download = "adam-extension.zip";
      a.click();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="flex-1 overflow-y-auto scroll-thin">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-14">
        <PageHeader eyebrow="Edge Agent · Chrome" title="O Adam no controle do seu navegador"
          subtitle="Uma extensão do Chrome que deixa o Adam ver a aba atual, clicar, digitar e navegar para cumprir suas tarefas, sempre com a sua permissão.">
          <button onClick={download} data-testid="extension-download-button"
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-[#F4A261] to-[#E07A5F] text-sm font-medium hover:opacity-90">
            <Download className="w-4 h-4" /> Baixar extensão
          </button>
        </PageHeader>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-12">
          {CAPS.map(({ icon: Icon, t, d }) => (
            <div key={t} className="p-5 rounded-xl bg-white/[0.025] border border-white/[0.07]">
              <Icon className="w-5 h-5 text-[#F4A261] mb-3" />
              <p className="font-display">{t}</p>
              <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
        <h2 className="font-display text-xl mb-5">Como instalar</h2>
        <ol className="space-y-3" data-testid="extension-steps">
          {STEPS.map((s, i) => (
            <li key={i} className="flex gap-4 p-4 rounded-xl bg-[#12141D] border border-white/[0.07]">
              <span className="font-mono text-sm text-[#F4A261] w-6 shrink-0">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-sm text-zinc-300">{s}</span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-zinc-500 mt-6">Exemplos de tarefa: “Pesquise notebooks até R$ 4.000 no Mercado Livre e liste os 3 mais bem avaliados” · “Preencha este formulário com meu nome e e-mail”.</p>
      </div>
    </div>
  );
}
