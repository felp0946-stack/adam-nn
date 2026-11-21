export default function PageHeader({ eyebrow, title, subtitle, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-10">
      <div className="flex-1">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500 mb-3">{eyebrow}</p>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm sm:text-base text-zinc-400 mt-3 max-w-2xl leading-relaxed">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
