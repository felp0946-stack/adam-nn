export default function AuthLayout({ children }) {
  return (
    <div className="grain min-h-[100dvh] flex bg-[#090A0F]">
      <aside className="hidden lg:flex relative w-[46%] flex-col justify-between p-14 overflow-hidden border-r border-white/5">
        <img src="https://images.pexels.com/photos/17483871/pexels-photo-17483871.png?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
          alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#090A0F] via-[#090A0F]/70 to-transparent" />
        <div className="relative flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-[#F4A261] pulse-node" />
          <span className="font-display text-xl font-semibold tracking-[0.3em]">ADAM</span>
        </div>
        <div className="relative max-w-md rise">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500 mb-5">BH · BR — v1.0</p>
          <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight">
            Uma mente <span className="adam-gradient-text">própria</span>,<br />feita no Brasil.
          </h1>
          <p className="mt-6 text-zinc-400 leading-relaxed">
            Conversa, lê arquivos e imagens, cria documentos, planilhas, código e imagens — e tem uma rede neural treinada do zero.
          </p>
          <p className="mt-10 text-xs text-zinc-500">Criado por <span className="text-zinc-300">Felipe Hudson</span>, Belo Horizonte.</p>
        </div>
      </aside>
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
        <div className="lg:hidden flex items-center gap-3 mb-8">
          <span className="w-2.5 h-2.5 rounded-full bg-[#F4A261] pulse-node" />
          <span className="font-display text-xl font-semibold tracking-[0.3em]">ADAM</span>
        </div>
        <div data-testid="auth-container">{children}</div>
      </main>
    </div>
  );
}
