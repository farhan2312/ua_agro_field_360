"use client";

// Users page (System Admin): records still stamped with an employee code that no account has — e.g. a
// temporary code changed outside this screen, or an account deleted and re-created with the permanent
// code. Those people can't mark their own follow-ups done until the records are moved to their code.
import { useEffect, useState } from "react";
import { listOrphanCodes, reassignOrphanCode, type OrphanCodeVM, type CodeOwnerOption } from "@/app/actions/users";
import { useConfirm } from "@/components/ConfirmDialog";

const n = (x: number) => x.toLocaleString("en-IN");
const TABLE_LABEL: Record<string, string> = {
  Action: "follow-ups", ActionComment: "follow-up comments", Visit: "visits", VisitReviewRevision: "visit review history",
  CampaignMember: "campaign outcomes", CampaignMemberRound: "earlier-round outcomes", CampaignWorker: "campaign team picks",
  CampaignCaller: "campaigner assignments", CampaignHelper: "helper grants", CampaignPhaseAdvance: "round advances",
  Cluster: "clusters", Broadcast: "mass sends", Ghoshti: "Ghoshti meetups", GhoshtiAttendee: "Ghoshti attendance",
  Bug: "bug reports", SmsLog: "SMS sends", WhatsAppLog: "WhatsApp sends", WhatsAppMessage: "WhatsApp replies",
};

export function LostCodesCard() {
  const [data, setData] = useState<{ orphans: OrphanCodeVM[]; users: CodeOwnerOption[] } | null>(null);
  const [pick, setPick] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const load = () => listOrphanCodes().then((d) => {
    setData(d);
    setPick(Object.fromEntries(d.orphans.filter((o) => o.suggestions[0]).map((o) => [o.code, o.suggestions[0].id])));
  }).catch(() => setData({ orphans: [], users: [] }));
  useEffect(() => { load(); }, []);

  if (!data || data.orphans.length === 0) return done ? <div className="mb-3 rounded-[12px] border border-[#C8E6C9] bg-[#F1F8F1] px-4 py-2.5 text-[12.5px] text-[#1B5E20]">✓ {done}</div> : null;

  const move = async (o: OrphanCodeVM) => {
    const uid = pick[o.code];
    const u = data.users.find((x) => x.id === uid);
    if (!u) return;
    const ok = await confirm({
      title: `Move ${o.code}'s records to ${u.name} (${u.code})?`,
      message: <>All {n(o.rows)} records stamped <b>{o.code}</b> ({o.byTable.map((t) => `${n(t.rows)} ${TABLE_LABEL[t.table] ?? t.table}`).join(", ")}) will be re-stamped <b>{u.code}</b>. {u.name} can then mark their {n(o.openActions)} open follow-ups done, and analytics credit the work to them.</>,
      confirmLabel: "Move records",
    });
    if (!ok) return;
    setBusy(o.code);
    const r = await reassignOrphanCode(o.code, uid);
    setBusy(null);
    if (!r.ok) { alert(r.error ?? "Couldn't move the records."); return; }
    setDone(`${o.code}: ${n(r.moved ?? 0)} records moved to ${u.name} (${u.code}).`);
    load();
  };

  return (
    <div className="mb-4 rounded-[14px] border border-[#FFE0B2] bg-[#FFFBF5] p-4">
      {dialog}
      <div className="text-[13.5px] font-bold text-[#E65100]">⚠ Records under an employee code no account has</div>
      <div className="mt-0.5 text-[11.5px] text-[#8D6E63]">
        Usually a temporary code that was changed outside this screen, or an account deleted and re-created with the permanent code. Until you move them, that person can&apos;t mark these follow-ups done and their work is credited to a code nobody has.
        Changing a code with ✎ Edit here moves the records automatically.
      </div>
      {done && <div className="mt-2 text-[12px] font-semibold text-[#2E7D32]">✓ {done}</div>}
      <div className="mt-3 flex flex-col gap-2">
        {data.orphans.map((o) => (
          <div key={o.code} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[#F3E5D8] bg-white px-3 py-2.5">
            <div className="min-w-[230px] flex-1">
              <div className="text-[13px] font-bold text-[#1A1C1A]"><span className="font-mono">{o.code}</span>{o.names.length > 0 && <span className="ml-1.5 font-semibold text-[#616161]">· {o.names.join(" / ")}</span>}</div>
              <div className="mt-0.5 text-[11.5px] text-[#757575]">
                {o.openActions > 0 && <b className="text-[#C62828]">{n(o.openActions)} open follow-ups · </b>}
                {o.byTable.map((t) => `${n(t.rows)} ${TABLE_LABEL[t.table] ?? t.table}`).join(" · ")}
                {o.storeNames.length > 0 && <> · store {o.storeNames.join(", ")}</>}
                {o.lastSeen && <> · last used {new Date(o.lastSeen).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] text-[#9E9E9E]">Move to</span>
              <select value={pick[o.code] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [o.code]: Number(e.target.value) }))}
                className="max-w-[300px] rounded-[8px] border border-[#E0E0E0] bg-white px-2 py-1.5 text-[12px] text-[#424242]">
                <option value="">Pick the person…</option>
                {o.suggestions.length > 0 && (
                  <optgroup label="Likely owner (same name)">
                    {o.suggestions.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.code}{s.store ? ` · ${s.store}` : ""}{s.sameStore ? " (same store)" : ""}{s.active ? "" : " (inactive)"}</option>)}
                  </optgroup>
                )}
                <optgroup label="Everyone">
                  {data.users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.code}{u.store ? ` · ${u.store}` : ""}{u.active ? "" : " (inactive)"}</option>)}
                </optgroup>
              </select>
              <button type="button" onClick={() => move(o)} disabled={!pick[o.code] || busy != null}
                className="rounded-[8px] bg-[#E65100] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#BF360C] disabled:opacity-40">
                {busy === o.code ? "Moving…" : "Move records"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
