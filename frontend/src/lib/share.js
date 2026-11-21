import { toast } from "sonner";
import { BACKEND_URL, errMsg } from "@/lib/api";

export async function openShared(api, fileId) {
  const w = window.open("", "_blank");
  try {
    const { data } = await api.post(`/files/${fileId}/share`);
    const url = `${BACKEND_URL}${data.path}`;
    if (w) w.location.href = url; else window.location.assign(url);
    return url;
  } catch (e) {
    w?.close();
    toast.error(errMsg(e));
  }
}

export async function saveTextAsFile(api, name, content) {
  const { data } = await api.post("/files/text", { name, content });
  return data;
}
