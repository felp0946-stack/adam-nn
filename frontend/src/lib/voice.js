let current = null;
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn(current?.id || null));

export function onSpeakingChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function stopSpeaking() {
  if (current) {
    current.audio.pause();
    URL.revokeObjectURL(current.url);
    current = null;
    emit();
  }
}

export async function speak(api, text, id = "msg") {
  stopSpeaking();
  const r = await api.post("/voice/speak", { text }, { responseType: "blob" });
  const url = URL.createObjectURL(r.data);
  const audio = new Audio(url);
  current = { audio, url, id };
  emit();
  audio.onended = () => { if (current?.audio === audio) stopSpeaking(); };
  await audio.play();
  return audio;
}

export async function speakAndWait(api, text, id = "call") {
  const audio = await speak(api, text, id);
  await new Promise((resolve) => {
    const done = () => resolve();
    audio.addEventListener("ended", done);
    audio.addEventListener("pause", done);
  });
}

export async function recordAudio() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: mime }));
    };
  });
  rec.start();
  return { stop: () => { rec.stop(); return done; }, mime };
}
