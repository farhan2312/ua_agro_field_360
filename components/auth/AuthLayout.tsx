export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Left brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-900 to-brand-950 p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -left-48 top-[28%] h-[560px] w-[560px] rounded-full border border-white/[0.04]" />
        <div className="pointer-events-none absolute -left-28 top-[42%] h-[380px] w-[380px] rounded-full border border-white/[0.05]" />
        <div className="pointer-events-none absolute right-0 top-0 h-full w-px bg-white/[0.05]" />

        <div className="relative flex items-center gap-3">
          <img src="/logo.png" alt="UA Agro" className="h-11 w-11 rounded-lg bg-white p-1" />
          <div>
            <div className="text-[15px] font-bold">UA Field Intel</div>
            <div className="text-[10px] uppercase tracking-[0.5px] text-white/50">Kisan Sewa Kendra</div>
          </div>
        </div>

        <div className="relative">
          <h1 className="text-[40px] font-light leading-[1.1]">
            Field intelligence for
            <br />
            <span className="font-semibold text-brand-200">every farmer</span>
          </h1>
          <p className="mt-5 max-w-sm text-[13px] leading-relaxed text-white/60">
            Real-time visit analytics, Farmer 360, and sales intelligence for the UA Agro
            field team.
          </p>
        </div>

        <div className="relative text-[11px] text-white/40">
          UA Agro · Internal use only
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex w-full items-center justify-center bg-canvas p-6 lg:w-1/2">
        {children}
      </div>
    </div>
  );
}
