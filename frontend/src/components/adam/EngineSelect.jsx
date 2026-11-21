import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ENGINES } from "@/lib/api";
import { useAdam } from "@/lib/adamContext";

export default function EngineSelect() {
  const { engine, setEngine } = useAdam();
  const cur = ENGINES[engine];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-testid="engine-selector-dropdown"
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${cur.cls}`}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: cur.dot }} />
        {cur.label}
        <ChevronDown className="w-3.5 h-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 bg-[#12141D] border-white/10 p-1.5">
        {Object.entries(ENGINES).map(([key, e]) => (
          <DropdownMenuItem key={key} data-testid={`engine-option-${key}`} onClick={() => setEngine(key)}
            className="flex items-start gap-3 p-3 rounded-lg cursor-pointer focus:bg-white/5">
            <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: e.dot }} />
            <div className="flex-1">
              <p className="text-sm text-white">{e.label}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{e.sub}</p>
            </div>
            {engine === key && <Check className="w-4 h-4 text-[#F4A261]" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
