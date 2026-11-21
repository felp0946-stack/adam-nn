import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import { UserButton, useUser } from "@clerk/react";
import { Activity, BookOpen, Brain, Chrome, Code, Cpu, FolderOpen, KeyRound, Plus, Search, SlidersHorizontal, SquareTerminal, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useAdam } from "@/lib/adamContext";
import { ENGINES, useApi } from "@/lib/api";

const NAV = [
  { to: "/memoria", label: "Memória", icon: Brain, id: "memory" },
  { to: "/conhecimento", label: "Base de Conhecimento", icon: BookOpen, id: "knowledge" },
  { to: "/arquivos", label: "Arquivos e Sites", icon: FolderOpen, id: "files" },
  { to: "/laboratorio", label: "Laboratório Neural", icon: Activity, id: "lab" },
  { to: "/vscode", label: "Extensão VS Code", icon: SquareTerminal, id: "vscode" },
  { to: "/extensao", label: "Extensão Chrome", icon: Chrome, id: "extension" },
  { to: "/widget", label: "Widget para Sites", icon: Code, id: "widget" },
  { to: "/api", label: "API & Chaves", icon: KeyRound, id: "api" },
  { to: "/configuracoes", label: "Configurações", icon: Cpu, id: "settings" },
];
const PERIODS = [["all", "Tudo"], ["1d", "24h"], ["7d", "7 dias"], ["30d", "30 dias"], ["90d", "90 dias"]];

function groupOf(iso) {
  const d = new Date(iso), now = new Date();
  const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 7) return "Últimos 7 dias";
  if (days < 30) return "Últimos 30 dias";
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function Highlight({ text, q }) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark className="bg-[#F4A261]/30 text-amber-100 rounded px-0.5">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

function ConversationItem({ c, active, onNavigate, q }) {
  const api = useApi();
  const { refresh } = useAdam();
  const navigate = useNavigate();
  const del = async (e) => {
    e.preventDefault();
    await api.delete(`/conversations/${c.id}`);
    toast.success("Conversa excluída");
    refresh();
    if (active) navigate("/");
  };
  return (
    <Link to={`/chat/${c.id}`} onClick={onNavigate} data-testid={`conversation-item-${c.id}`}
      className={`group flex items-start gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${active ? "bg-white/[0.07] text-white" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"}`}>
      <span className="w-1.5 h-1.5 mt-[7px] rounded-full shrink-0" style={{ background: (ENGINES[c.engine] || ENGINES.pro).dot }} />
      <span className="flex-1 min-w-0">
        <span className="block truncate"><Highlight text={c.title} q={q} /></span>
        {c.snippet && <span className="block text-[11px] text-zinc-500 line-clamp-2 mt-0.5"><Highlight text={c.snippet} q={q} /></span>}
      </span>
      <button onClick={del} data-testid={`conversation-delete-${c.id}`} className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-rose-400 transition-opacity mt-0.5">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </Link>
  );
}

function Filters({ f, setF }) {
  const chip = (on) => `px-2 py-1 rounded-md text-[11px] border transition-colors ${on ? "border-[#F4A261]/60 bg-[#F4A261]/10 text-amber-200" : "border-white/10 text-zinc-400 hover:text-zinc-200"}`;
  return (
    <div className="mt-2 p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-3 rise" data-testid="history-filters">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Período</p>
        <div className="flex flex-wrap gap-1">{PERIODS.map(([k, l]) => <button key={k} onClick={() => setF({ ...f, period: k })} data-testid={`history-period-${k}`} className={chip(f.period === k)}>{l}</button>)}</div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Motor</p>
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setF({ ...f, engine: "" })} data-testid="history-engine-all" className={chip(!f.engine)}>Todos</button>
          {Object.entries(ENGINES).map(([k, e]) => <button key={k} onClick={() => setF({ ...f, engine: k })} data-testid={`history-engine-${k}`} className={chip(f.engine === k)}>{e.label}</button>)}
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-300">
        <input type="checkbox" checked={f.scope === "all"} onChange={(e) => setF({ ...f, scope: e.target.checked ? "all" : "title" })} data-testid="history-scope-checkbox" />
        Buscar também dentro das mensagens
      </label>
    </div>
  );
}

function History({ onNavigate }) {
  const api = useApi();
  const { conversations } = useAdam();
  const { id } = useParams();
  const [q, setQ] = useState("");
  const [f, setF] = useState({ period: "all", engine: "", scope: "all" });
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState(null);
  const active = q.trim() || f.period !== "all" || f.engine;

  useEffect(() => {
    if (!active) return setResults(null);
    const t = setTimeout(() => {
      api.get("/conversations/search", { params: { q: q.trim(), ...f } }).then((r) => setResults(r.data)).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, f, active, api, conversations]);

  const list = results ?? conversations;
  const groups = useMemo(() => {
    const g = [];
    for (const c of list) {
      const k = groupOf(c.updated_at);
      if (!g.length || g[g.length - 1][0] !== k) g.push([k, []]);
      g[g.length - 1][1].push(c);
    }
    return g;
  }, [list]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 pt-3">
        <div className="flex items-center justify-between px-2 mb-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">Histórico</p>
          <span className="font-mono text-[10px] text-zinc-600" data-testid="history-count">{active ? `${list.length} resultado(s)` : conversations.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 focus-within:border-[#F4A261]/50">
            <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar conversas…" data-testid="history-search-input"
              className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-zinc-600" />
            {q && <button onClick={() => setQ("")} data-testid="history-search-clear" className="text-zinc-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>}
          </div>
          <button onClick={() => setShowFilters(!showFilters)} data-testid="history-filters-toggle" title="Busca avançada"
            className={`p-2 rounded-lg border transition-colors ${showFilters || f.period !== "all" || f.engine ? "border-[#F4A261]/60 text-[#F4A261] bg-[#F4A261]/10" : "border-white/10 text-zinc-400 hover:text-white"}`}>
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>
        {showFilters && <Filters f={f} setF={setF} />}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-history px-3 pt-2 pb-3" data-testid="conversation-list">
        {list.length === 0 && <p className="px-3 py-4 text-xs text-zinc-600">{active ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}</p>}
        {groups.map(([label, items]) => (
          <div key={label} className="mb-2">
            <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-600 first-letter:uppercase">{label}</p>
            <div className="space-y-0.5">{items.map((c) => <ConversationItem key={c.id} c={c} active={c.id === id} onNavigate={onNavigate} q={q.trim()} />)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Sidebar({ onNavigate }) {
  const { user } = useUser();
  return (
    <div className="flex flex-col w-full h-full">
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-[#F4A261] pulse-node" />
          <span className="font-display text-lg font-semibold tracking-[0.3em]">ADAM</span>
          <span className="ml-auto font-mono text-[10px] text-zinc-600">BH-BR v1.0</span>
        </div>
        <p className="text-[11px] text-zinc-600 mt-1">por Felipe Hudson</p>
      </div>
      <div className="px-3">
        <Link to="/" onClick={onNavigate} data-testid="new-chat-button"
          className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl border border-white/10 text-sm hover:border-[#E07A5F]/60 hover:bg-[#E07A5F]/5 transition-colors">
          <Plus className="w-4 h-4 text-[#F4A261]" /> Nova conversa
        </Link>
      </div>
      <nav className="px-3 mt-3 grid grid-cols-5 gap-1" data-testid="sidebar-nav">
        {NAV.map(({ to, label, icon: Icon, id: nid }) => (
          <NavLink key={to} to={to} onClick={onNavigate} data-testid={`sidebar-${nid}-link`} title={label} aria-label={label}
            className={({ isActive }) => `flex items-center justify-center h-10 rounded-lg transition-colors ${isActive ? "text-[#F4A261] bg-white/[0.07]" : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]"}`}>
            <Icon className="w-[18px] h-[18px]" />
          </NavLink>
        ))}
      </nav>
      <div className="mx-3 mt-3 border-t border-white/5" />
      <History onNavigate={onNavigate} />
      <div className="border-t border-white/5 p-4 flex items-center gap-3" data-testid="sidebar-user">
        <UserButton />
        <div className="min-w-0">
          <p className="text-sm truncate">{user?.fullName || user?.primaryEmailAddress?.emailAddress}</p>
          <p className="text-[11px] text-zinc-500 truncate">{user?.fullName ? user?.primaryEmailAddress?.emailAddress : "Conta Adam"}</p>
        </div>
      </div>
    </div>
  );
}
