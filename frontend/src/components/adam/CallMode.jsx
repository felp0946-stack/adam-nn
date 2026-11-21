import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import { useApi } from "@/lib/api";
import { speakAndWait, stopSpeaking } from "@/lib/voice";

const STATUS = { calibrating: "Ajustando o microfone…", listening: "Ouvindo…", thinking: "Pensando…", speaking: "Adam falando", muted: "Microfone mudo" };
const SILENCE_MS = 1300;
const MIN_SPEECH_MS = 450;

export default function CallMode({ onSend, onClose }) {
  const api = useApi();
  const [status, setStatus] = useState("calibrating");
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [muted, setMuted] = useState(false);
  const [err, setErr] = useState("");
  const r = useRef({ status: "calibrating", muted: false, alive: true });

  const set = (s) => { r.current.status = s; setStatus(s); };

  useEffect(() => {
    const st = r.current;
    let stream, ctx, timer, recorder, chunks = [], speechStart = 0, lastVoice = 0, noise = 0.01, samples = [], loud = 0;

    const startRec = () => {
      chunks = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      recorder = new MediaRecorder(stream, { mimeType: mime });
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.start();
      speechStart = Date.now();
    };

    const finishTurn = async () => {
      const rec = recorder;
      recorder = null;
      set("thinking");
      const blob = await new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType })); rec.stop(); });
      try {
        const fd = new FormData();
        fd.append("file", blob, rec.mimeType.includes("webm") ? "voz.webm" : "voz.mp4");
        const { data } = await api.post("/voice/transcribe", fd);
        const text = (data.text || "").trim();
        if (!st.alive) return;
        if (text.length < 2) return set(st.muted ? "muted" : "listening");
        setHeard(text);
        setReply("");
        const answer = await onSend(text);
        if (!st.alive) return;
        setReply(answer || "");
        if (answer?.trim()) { set("speaking"); await speakAndWait(api, answer); }
      } catch (e) {
        setErr("Falha na ligação. Tente falar de novo.");
      }
      if (st.alive) set(st.muted ? "muted" : "listening");
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch {
        setErr("Permita o acesso ao microfone para ligar para o Adam.");
        return;
      }
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const t0 = Date.now();
      timer = setInterval(() => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(rms);
        const now = Date.now();
        if (st.status === "calibrating") {
          samples.push(rms);
          if (now - t0 > 700) { noise = samples.reduce((a, b) => a + b, 0) / samples.length; set("listening"); }
          return;
        }
        const thresh = Math.max(0.025, noise * 3);
        if (st.status === "speaking") {
          loud = rms > thresh * 2.2 ? loud + 1 : 0;
          if (loud > 6) { loud = 0; stopSpeaking(); }
          return;
        }
        if (st.status !== "listening" || st.muted) return;
        if (rms > thresh) {
          lastVoice = now;
          if (!recorder) startRec();
        } else if (recorder && now - lastVoice > SILENCE_MS) {
          if (lastVoice - speechStart < MIN_SPEECH_MS) { recorder.stop(); recorder = null; }
          else finishTurn();
        }
      }, 50);
    })();

    return () => {
      st.alive = false;
      clearInterval(timer);
      stopSpeaking();
      if (recorder?.state === "recording") recorder.stop();
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    r.current.muted = m;
    if (r.current.status === "listening" || r.current.status === "muted") set(m ? "muted" : "listening");
  };

  const scale = 1 + Math.min(level * 6, 0.6);
  const color = status === "speaking" ? "#F4A261" : status === "thinking" ? "#8338EC" : "#E07A5F";

  return (
    <div className="fixed inset-0 z-[100] bg-[#06070B]/95 backdrop-blur-2xl flex flex-col items-center justify-between py-16 px-6 rise" data-testid="call-mode-overlay">
      <div className="text-center">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-500">Em ligação com</p>
        <p className="font-display text-3xl sm:text-4xl font-semibold tracking-[0.2em] mt-2">ADAM</p>
      </div>
      <div className="flex flex-col items-center gap-10">
        <div className="relative w-56 h-56 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full blur-3xl opacity-40 transition-transform duration-100" style={{ background: color, transform: `scale(${scale})` }} />
          <div className={`relative w-40 h-40 rounded-full transition-transform duration-100 ${status === "thinking" ? "animate-pulse" : ""}`}
            style={{ background: `radial-gradient(circle at 35% 30%, #fff8, ${color} 45%, #3A86FF 120%)`, transform: `scale(${status === "speaking" ? 1.05 : scale})` }} />
        </div>
        <p className="font-mono text-sm text-zinc-300" data-testid="call-mode-status">{err || STATUS[status]}</p>
        <div className="max-w-xl text-center space-y-3 min-h-24">
          {heard && <p className="text-sm text-zinc-500" data-testid="call-mode-heard">Você: “{heard}”</p>}
          {reply && <p className="text-base text-zinc-200 line-clamp-4" data-testid="call-mode-reply">{reply.replace(/[#*`]/g, "")}</p>}
        </div>
      </div>
      <div className="flex items-center gap-6">
        <button onClick={toggleMute} data-testid="call-mode-mute" className={`w-14 h-14 rounded-full flex items-center justify-center border transition-colors ${muted ? "bg-white text-black" : "bg-white/5 border-white/15 hover:bg-white/10"}`}>
          {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>
        <button onClick={onClose} data-testid="call-mode-end" className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center transition-colors">
          <PhoneOff className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}
