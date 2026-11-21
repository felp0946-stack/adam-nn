import ipaddress
import re
import socket
from html import unescape
from html.parser import HTMLParser
from urllib.parse import quote_plus, urlparse

import httpx

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 AdamBot/1.0"


def _safe_url(url: str) -> str:
    url = url.strip()
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    host = urlparse(url).hostname
    if not host:
        raise ValueError("URL inválida")
    for info in socket.getaddrinfo(host, None):
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ValueError("Endereço não permitido")
    return url


class _Extractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head", "iframe"}

    def __init__(self):
        super().__init__()
        self.parts, self.links, self.title, self._skip, self._in_title, self._href = [], [], "", 0, False, None

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1
        if tag == "title":
            self._in_title = True
        if tag == "a":
            self._href = dict(attrs).get("href")
        if tag in ("p", "div", "br", "li", "h1", "h2", "h3", "h4", "tr", "section", "article"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        if tag == "title":
            self._in_title = False
        if tag == "a":
            self._href = None

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._skip:
            return
        text = data.strip()
        if text:
            self.parts.append(text + " ")
            if self._href and self._href.startswith("http") and len(self.links) < 25:
                self.links.append(f"{text[:60]} -> {self._href}")


async def open_site(url: str, max_chars: int = 12000) -> dict:
    url = _safe_url(url)
    async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers={"User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"}) as c:
        r = await c.get(url)
    _safe_url(str(r.url))
    ctype = r.headers.get("content-type", "")
    if "html" not in ctype and "text" not in ctype and "json" not in ctype:
        return {"url": str(r.url), "status": r.status_code, "conteudo": f"[Conteúdo não textual: {ctype}]"}
    if "html" not in ctype:
        return {"url": str(r.url), "status": r.status_code, "conteudo": r.text[:max_chars]}
    p = _Extractor()
    p.feed(r.text)
    text = re.sub(r"\n\s*\n+", "\n\n", re.sub(r"[ \t]+", " ", "".join(p.parts))).strip()
    return {"url": str(r.url), "status": r.status_code, "titulo": unescape(p.title.strip())[:200],
            "conteudo": text[:max_chars], "links": p.links}


def _clean(s):
    return unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


async def web_search(query: str, limit: int = 8) -> list:
    async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers={"User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9"}) as c:
        r = await c.get("https://search.brave.com/search", params={"q": query, "source": "web"})
    results = []
    for b in re.findall(r'data-type="web"(.*?)(?=data-type="web"|\Z)', r.text, re.S):
        cite = re.search(r"<cite[^>]*>(.*?)</cite>", b, re.S)
        title = re.search(r'class="title[^"]*"[^>]*title="([^"]*)"', b)
        snip = re.search(r'class="content[^"]*"[^>]*>(.*?)</div>', b, re.S)
        if not cite or not title:
            continue
        url = re.sub(r"\s*›\s*", "/", _clean(cite.group(1))).replace(" ", "")
        results.append({"titulo": unescape(title.group(1)), "url": url, "trecho": _clean(snip.group(1) if snip else "")[:350]})
        if len(results) >= limit:
            break
    return results


def search_link(query: str) -> str:
    return f"https://www.google.com/search?q={quote_plus(query)}"
