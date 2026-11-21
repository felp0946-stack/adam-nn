import { useEffect, useState } from "react";
import { useApi } from "@/lib/api";
import PageHeader from "@/components/adam/PageHeader";
import { FileCard } from "@/components/adam/FileCard";

export default function FilesPage() {
  const api = useApi();
  const [files, setFiles] = useState(null);
  useEffect(() => { api.get("/files").then((r) => setFiles(r.data)).catch(() => setFiles([])); }, [api]);
  return (
    <div className="flex-1 overflow-y-auto scroll-thin">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-14">
        <PageHeader eyebrow="Biblioteca" title="Arquivos e imagens criados" subtitle="Tudo o que o Adam gerou para você: documentos, planilhas, códigos, sites e imagens." />
        {files?.length === 0 && <p className="text-sm text-zinc-500 py-10 text-center border border-dashed border-white/10 rounded-2xl">Nada aqui ainda. Peça um PDF, planilha ou imagem no chat.</p>}
        <div className="grid sm:grid-cols-2 gap-x-4" data-testid="files-grid">
          {files?.map((f) => <FileCard key={f.id} file={f} />)}
        </div>
      </div>
    </div>
  );
}
