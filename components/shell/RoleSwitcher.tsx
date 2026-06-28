"use client";

import { useState, useTransition } from "react";
import { PERSONAS, ROLE_ORDER, type RoleKey } from "@/lib/roles";
import { setRoleAction } from "@/app/actions/session";
import { CaretUpDown } from "../icons";

export function RoleSwitcher({ role }: { role: RoleKey }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const persona = PERSONAS[role];

  const choose = (k: RoleKey) => {
    setOpen(false);
    start(() => {
      void setRoleAction(k);
    });
  };

  return (
    <div className="relative border-t border-white/[0.08]">
      {open && (
        <div className="absolute bottom-full left-3 right-3 mb-1 rounded-xl border border-white/[0.12] bg-brand-900 p-2 shadow-[0_-4px_20px_rgba(0,0,0,0.3)]">
          <div className="px-2 pt-1.5 pb-2 text-[9.5px] font-semibold uppercase tracking-[1px] text-white/30">
            Switch Persona
          </div>
          {ROLE_ORDER.map((key) => {
            const p = PERSONAS[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => choose(key)}
                className="mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left hover:bg-white/[0.08]"
                style={{ background: key === role ? "rgba(255,255,255,0.12)" : "transparent" }}
              >
                <span
                  className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: p.color }}
                >
                  {p.init}
                </span>
                <span>
                  <span className="block text-[12px] font-semibold text-white">{p.name}</span>
                  <span className="block text-[10px] text-white/45">{p.role}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-[18px] py-4 text-left hover:bg-white/[0.04] disabled:opacity-60"
        disabled={pending}
      >
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-[14px] font-bold text-white"
          style={{ background: persona.color }}
        >
          {persona.init}
        </span>
        <span className="flex-1">
          <span className="block text-[13px] font-semibold text-white">{persona.name}</span>
          <span className="block text-[10px] text-white/50">{persona.role}</span>
        </span>
        <CaretUpDown className="text-white/40" />
      </button>
    </div>
  );
}
