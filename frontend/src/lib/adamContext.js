import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useApi } from "@/lib/api";

const Ctx = createContext(null);

export function AdamProvider({ children }) {
  const api = useApi();
  const [conversations, setConversations] = useState([]);
  const [settings, setSettings] = useState({});
  const [engine, setEngineState] = useState(() => localStorage.getItem("adam-engine") || "pro");

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/conversations");
      setConversations(data);
    } catch {}
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { api.get("/settings").then((r) => setSettings(r.data)).catch(() => {}); }, [api]);

  const setEngine = (e) => { setEngineState(e); localStorage.setItem("adam-engine", e); };

  return <Ctx.Provider value={{ conversations, refresh, engine, setEngine, settings, setSettings }}>{children}</Ctx.Provider>;
}

export const useAdam = () => useContext(Ctx);
