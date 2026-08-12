"use server";

import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { getScope, canManage } from "@/lib/scope";

async function adminOnly(): Promise<boolean> {
  const { role } = await getScope();
  return canManage(role);
}

export interface OptInRow {
  id: number;
  mobile: string;
  name: string;
  farmerId: number | null;
  farmerName: string;
  lastMessage: string;
  messageCount: number;
  optInAt: string;
  lastMessageAt: string;
}

/** WhatsApp opt-ins (people who messaged our number / scanned the QR). Admin-only. */
export async function listOptIns(q?: string): Promise<{ total: number; rows: OptInRow[] }> {
  if (!(await adminOnly())) return { total: 0, rows: [] };
  const term = (q ?? "").trim();
  const where = term
    ? { OR: [{ mobile: { contains: term.replace(/\D/g, "") || term } }, { name: { contains: term, mode: "insensitive" as const } }] }
    : {};
  const [total, rows] = await Promise.all([
    prisma.whatsAppOptIn.count(),
    prisma.whatsAppOptIn.findMany({ where, orderBy: { lastMessageAt: "desc" }, take: 200 }),
  ]);
  const farmerIds = rows.map((r) => r.farmerId).filter((x): x is number => x != null);
  const farmers = farmerIds.length
    ? new Map((await prisma.farmer.findMany({ where: { id: { in: farmerIds } }, select: { id: true, name: true } })).map((f) => [f.id, f.name]))
    : new Map<number, string>();
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id, mobile: r.mobile, name: r.name ?? "", farmerId: r.farmerId,
      farmerName: r.farmerId ? farmers.get(r.farmerId) ?? "" : "",
      lastMessage: r.lastMessage ?? "", messageCount: r.messageCount,
      optInAt: r.optInAt.toISOString(), lastMessageAt: r.lastMessageAt.toISOString(),
    })),
  };
}

/** Build a WhatsApp click-to-chat link + a QR PNG (data URL) for the opt-in poster. Admin-only. */
export async function generateOptInQr(input: { businessNumber: string; message: string }): Promise<{ ok: boolean; link?: string; qr?: string; error?: string }> {
  if (!(await adminOnly())) return { ok: false, error: "Admins only." };
  const num = (input.businessNumber ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (num.length < 10) return { ok: false, error: "Enter a valid business WhatsApp number (with country code, e.g. 91XXXXXXXXXX)." };
  const to = num.length === 10 ? `91${num}` : num; // default India code if a bare 10-digit was given
  const msg = (input.message ?? "").trim();
  const link = `https://wa.me/${to}${msg ? `?text=${encodeURIComponent(msg)}` : ""}`;
  try {
    const qr = await QRCode.toDataURL(link, { margin: 1, width: 512, errorCorrectionLevel: "M" });
    return { ok: true, link, qr };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not generate the QR." };
  }
}
