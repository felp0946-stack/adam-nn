import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import { UserButton, useUser } from "@clerk/react";
import { Activity, BookOpen, Brain, Chrome, Code, Cpu, FolderOpen, KeyRound, MessageSquare, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAdam } from "@/lib/adamContext";
import { useApi } from "@/lib/api";

const NAV = [
  { to: "/", label: "Chat", icon: MessageSquare, id: "chat" },
  { to: "/memoria", label: "Memória", icon: Brain, id: "memory" },
  { to: "/conhecimento", label: "Base de Conhecimento", icon: BookOpen, id: "knowledge" },
  { to: "/arquivos", label: "Arquivos", icon: FolderOpen, id: "files" },
  { to: "/laboratorio", label: "Laboratório Neural", icon: Activity, id: "lab" },
  { to: "/extensao", label: "Extensão Chrome", icon: Chrome, id: "extension" },
  { to: "/widget", label: "Widget para Sites", icon: Code, id: "widget" },
  { to: "/api", label: "API & Chaves", icon: KeyRound, id: "api" },
  { to: "/configuracoes", label: "Configurações", icon: Cpu, id: "settings" },
];

function ConversationItem({ c, active, onNavigate }) {
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
      className={`group flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${active ? "bg-white/[0.07] text-white" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"}`}>
      <span className="truncate flex-1">{c.title}</span>
      <button onClick={del} data-testid={`conversation-delete-${c.id}`} className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-rose-400 transition-opacity">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </Link>
  );
}

export default function Sidebar({ onNavigate }) {
  const { conversations } = useAdam();
  const { id } = useParams();
  const { user } = useUser();
  return (
    <div className="flex flex-col w-full h-full">
      <div className="px-5 pt-5 pb-4">
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
      <nav className="px-3 mt-4 space-y-0.5">
        {NAV.map(({ to, label, icon: Icon, id: nid }) => (
          <NavLink key={to} to={to} end onClick={onNavigate} data-testid={`sidebar-${nid}-link`}
            className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? "text-white bg-white/[0.06]" : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]"}`}>
            <Icon className="w-4 h-4" /> {label}
          </NavLink>
        ))}
      </nav>
      <p className="px-6 mt-6 mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">Histórico</p>
      <div className="flex-1 overflow-y-auto scroll-thin px-3 space-y-0.5 pb-3" data-testid="conversation-list">
        {conversations.length === 0 && <p className="px-3 text-xs text-zinc-600">Nenhuma conversa ainda.</p>}
        {conversations.map((c) => <ConversationItem key={c.id} c={c} active={c.id === id} onNavigate={onNavigate} />)}
      </div>
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
