import { createContext, useContext } from "react";

export const ArtifactCtx = createContext(null);
export const useArtifact = () => useContext(ArtifactCtx);

export function codeBlocks(text) {
  const out = [];
  let lang = null, buf = [];
  for (const line of (text || "").split("\n")) {
    const s = line.trim();
    if (lang === null && s.startsWith("```")) { lang = s.slice(3).trim().toLowerCase(); buf = []; }
    else if (lang !== null && s === "```") { out.push({ lang, code: buf.join("\n"), closed: true }); lang = null; }
    else if (lang !== null) buf.push(line);
  }
  if (lang !== null) out.push({ lang, code: buf.join("\n"), closed: false });
  return out;
}

export const isSite = (lang, code) => ["", "html", "htm"].includes(lang || "") && /<!doctype html|<html[\s>]/i.test((code || "").slice(0, 500));
export const siteBlocks = (text) => codeBlocks(text).filter((b) => isSite(b.lang, b.code));
export const siteTitle = (code) => (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(code || "")?.[1] || "Site").trim();
