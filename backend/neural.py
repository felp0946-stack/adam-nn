"""AdamNano: Transformer decoder-only escrito do zero em PyTorch, com tokenizer próprio de caracteres."""
import io
import string
import threading

import torch
import torch.nn as nn
import torch.nn.functional as F

torch.set_num_threads(4)

CFG = {"n_layer": 4, "n_head": 4, "n_embd": 128, "block": 128}
EXTRA = "áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ—–“”‘’•"


class CharTokenizer:
    def __init__(self):
        chars = sorted(set(string.printable.replace("\x0b", "").replace("\x0c", "").replace("\r", "") + EXTRA))
        self.itos = chars
        self.stoi = {c: i for i, c in enumerate(chars)}
        self.unk = self.stoi[" "]

    @property
    def size(self):
        return len(self.itos)

    def encode(self, text):
        return [self.stoi.get(c, self.unk) for c in text]

    def decode(self, ids):
        return "".join(self.itos[i] for i in ids)


class CausalSelfAttention(nn.Module):
    def __init__(self, d, h):
        super().__init__()
        self.h = h
        self.qkv = nn.Linear(d, 3 * d)
        self.proj = nn.Linear(d, d)

    def forward(self, x):
        B, T, C = x.shape
        q, k, v = self.qkv(x).split(C, dim=2)
        q, k, v = [t.view(B, T, self.h, C // self.h).transpose(1, 2) for t in (q, k, v)]
        y = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        return self.proj(y.transpose(1, 2).contiguous().view(B, T, C))


class Block(nn.Module):
    def __init__(self, d, h):
        super().__init__()
        self.ln1 = nn.LayerNorm(d)
        self.attn = CausalSelfAttention(d, h)
        self.ln2 = nn.LayerNorm(d)
        self.mlp = nn.Sequential(nn.Linear(d, 4 * d), nn.GELU(), nn.Linear(4 * d, d))

    def forward(self, x):
        x = x + self.attn(self.ln1(x))
        return x + self.mlp(self.ln2(x))


class AdamNano(nn.Module):
    def __init__(self, vocab, cfg):
        super().__init__()
        d = cfg["n_embd"]
        self.block = cfg["block"]
        self.tok = nn.Embedding(vocab, d)
        self.pos = nn.Embedding(cfg["block"], d)
        self.blocks = nn.Sequential(*[Block(d, cfg["n_head"]) for _ in range(cfg["n_layer"])])
        self.ln = nn.LayerNorm(d)
        self.head = nn.Linear(d, vocab, bias=False)
        self.head.weight = self.tok.weight

    def forward(self, idx, targets=None):
        T = idx.shape[1]
        x = self.tok(idx) + self.pos(torch.arange(T, device=idx.device))
        logits = self.head(self.ln(self.blocks(x)))
        loss = None if targets is None else F.cross_entropy(logits.view(-1, logits.size(-1)), targets.view(-1))
        return logits, loss

    @torch.no_grad()
    def generate(self, idx, max_new, temperature=0.8, top_k=40, stop=None, decode=None):
        for _ in range(max_new):
            logits, _ = self(idx[:, -self.block:])
            logits = logits[:, -1, :] / max(temperature, 0.05)
            v, _ = torch.topk(logits, min(top_k, logits.size(-1)))
            logits[logits < v[:, [-1]]] = -float("inf")
            nxt = torch.multinomial(F.softmax(logits, dim=-1), 1)
            idx = torch.cat([idx, nxt], dim=1)
            if stop and decode and decode(idx[0, -len(stop):].tolist()) == stop:
                break
        return idx


class NeuralEngine:
    def __init__(self):
        self.tok = CharTokenizer()
        self.model = AdamNano(self.tok.size, CFG)
        self.params = sum(p.numel() for p in self.model.parameters())
        self.state = {"training": False, "step": 0, "losses": [], "target": 0, "run_step": 0}
        self.lock = threading.Lock()

    def info(self):
        return {**CFG, "params": self.params, "vocab": self.tok.size, "tokenizer": "Caracteres (próprio)",
                "training": self.state["training"], "step": self.state["step"],
                "run_step": self.state["run_step"], "target": self.state["target"],
                "losses": self.state["losses"][-400:],
                "last_loss": self.state["losses"][-1]["loss"] if self.state["losses"] else None}

    def load(self, blob, step, losses):
        self.model.load_state_dict(torch.load(io.BytesIO(blob), map_location="cpu"))
        self.state["step"], self.state["losses"] = step, losses

    def export(self) -> bytes:
        buf = io.BytesIO()
        torch.save(self.model.state_dict(), buf)
        return buf.getvalue()

    def train(self, text, steps, batch=16, lr=3e-3):
        with self.lock:
            self.state.update(training=True, target=steps, run_step=0)
            try:
                data = torch.tensor(self.tok.encode(text), dtype=torch.long)
                B = self.model.block
                opt = torch.optim.AdamW(self.model.parameters(), lr=lr, weight_decay=0.01)
                self.model.train()
                for i in range(steps):
                    ix = torch.randint(len(data) - B - 1, (batch,))
                    x = torch.stack([data[j:j + B] for j in ix])
                    y = torch.stack([data[j + 1:j + B + 1] for j in ix])
                    _, loss = self.model(x, y)
                    opt.zero_grad(set_to_none=True)
                    loss.backward()
                    torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                    opt.step()
                    self.state["step"] += 1
                    self.state["run_step"] = i + 1
                    if i % 10 == 0 or i == steps - 1:
                        self.state["losses"].append({"step": self.state["step"], "loss": round(loss.item(), 4)})
            finally:
                self.model.eval()
                self.state["training"] = False

    def generate(self, prompt, max_new=300, temperature=0.8, stop=None):
        ids = self.tok.encode(prompt)[-self.model.block:] or [self.tok.unk]
        out = self.model.generate(torch.tensor([ids]), max_new, temperature, stop=stop, decode=self.tok.decode)
        text = self.tok.decode(out[0, len(ids):].tolist())
        return text[: -len(stop)] if stop and text.endswith(stop) else text


engine = NeuralEngine()
