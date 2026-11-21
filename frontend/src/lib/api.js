import { useMemo } from "react";
import axios from "axios";
import { useAuth } from "@clerk/react";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export function useApi() {
  const { getToken } = useAuth();
  return useMemo(() => {
    const inst = axios.create({ baseURL: API });
    inst.interceptors.request.use(async (cfg) => {
      const t = await getToken();
      if (t) cfg.headers.Authorization = `Bearer ${t}`;
      return cfg;
    });
    inst.token = getToken;
    return inst;
  }, [getToken]);
}

export const errMsg = (e) => e?.response?.data?.detail || e?.message || "Erro inesperado";

export const ENGINES = {
  pro: { label: "Adam Pro", sub: "Motor cognitivo completo: arquivos, visão e imagens", dot: "#F4A261", cls: "text-amber-300 bg-amber-500/10 border-amber-500/30" },
  neural: { label: "Adam Neural", sub: "Mini Transformer próprio, treinado do zero em PyTorch", dot: "#8338EC", cls: "text-purple-300 bg-purple-500/10 border-purple-500/30" },
  local: { label: "Servidor Local", sub: "Seu modelo aberto via Ollama (Llama, Qwen, Gemma)", dot: "#2A9D8F", cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30" },
};
