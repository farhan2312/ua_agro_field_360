"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRole } from "@/lib/session";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
async function admin(): Promise<boolean> { return (await getRole()) === "sysadmin"; }

export interface ConversationVM {
  mobile: string;
  name: string | null;
  farmerId: number | null;
  farmerName: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastDirection: string | null;
  unreadCount: number;
  messageCount: number;
  optInAt: string | null;
  within24h: boolean; // reply session window open (they messaged in the last 24h)
}

export interface InboxData { conversations: ConversationVM[]; totalUnread: number; total: number }

/** Conversation list for the Sysadmin WhatsApp Inbox. Filter: all | unread | unmatched. */
export async function listConversations(filter: "all" | "unread" | "unmatched" = "all", q = ""): Promise<InboxData | null> {
  if (!(await admin())) return null;
  const where: Prisma.WhatsAppOptInWhereInput = {};
  if (filter === "unread") where.unreadCount = { gt: 0 };
  if (filter === "unmatched") where.farmerId = null;
  const term = q.trim();
  if (term) {
    const digits = term.replace(/\D/g, "");
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { lastMessage: { contains: term, mode: "insensitive" } },
      ...(digits ? [{ mobile: { contains: digits } }] as Prisma.WhatsAppOptInWhereInput[] : []),
    ];
  }

  const rows = await prisma.whatsAppOptIn.findMany({ where, orderBy: { lastMessageAt: "desc" }, take: 300 });
  const farmerIds = [...new Set(rows.map((r) => r.farmerId).filter((x): x is number => x != null))];
  const farmers = new Map((farmerIds.length ? await prisma.farmer.findMany({ where: { id: { in: farmerIds } }, select: { id: true, name: true } }) : []).map((f) => [f.id, f.name]));
  const now = Date.now();

  const conversations: ConversationVM[] = rows.map((r) => ({
    mobile: r.mobile, name: r.name, farmerId: r.farmerId, farmerName: r.farmerId ? (farmers.get(r.farmerId) ?? null) : null,
    lastMessage: r.lastMessage, lastMessageAt: iso(r.lastMessageAt), lastDirection: r.lastDirection,
    unreadCount: r.unreadCount, messageCount: r.messageCount, optInAt: iso(r.optInAt),
    within24h: !!r.lastInboundAt && now - r.lastInboundAt.getTime() < WINDOW_MS,
  }));

  const [totalUnread, total] = await Promise.all([
    prisma.whatsAppOptIn.count({ where: { unreadCount: { gt: 0 } } }),
    prisma.whatsAppOptIn.count(),
  ]);
  return { conversations, totalUnread, total };
}

export interface ThreadMessage {
  id: number; direction: string; type: string; text: string | null;
  mediaId: string | null; mediaMime: string | null; status: string | null; errorText: string | null;
  sentByName: string | null; at: string;
}
export interface ThreadVM {
  mobile: string; name: string | null; farmerId: number | null; farmerName: string | null;
  optInAt: string | null; within24h: boolean; firstMessage: string | null;
  messages: ThreadMessage[];
}

/** Full message thread for one contact. Also marks the conversation read. */
export async function getThread(mobile: string): Promise<ThreadVM | null> {
  if (!(await admin())) return null;
  const m = mobile.replace(/\D/g, "").slice(-10);
  const header = await prisma.whatsAppOptIn.findUnique({ where: { mobile: m } });
  if (!header) return null;

  const [rows] = await Promise.all([
    prisma.whatsAppMessage.findMany({ where: { mobile: m }, orderBy: { createdAt: "asc" }, take: 500 }),
    prisma.whatsAppOptIn.update({ where: { mobile: m }, data: { unreadCount: 0 } }).catch(() => null),
  ]);
  const farmerName = header.farmerId ? (await prisma.farmer.findUnique({ where: { id: header.farmerId }, select: { name: true } }))?.name ?? null : null;
  revalidatePath("/whatsapp");

  return {
    mobile: m, name: header.name, farmerId: header.farmerId, farmerName,
    optInAt: iso(header.optInAt),
    within24h: !!header.lastInboundAt && Date.now() - header.lastInboundAt.getTime() < WINDOW_MS,
    firstMessage: header.firstMessage,
    messages: rows.map((r) => ({
      id: r.id, direction: r.direction, type: r.type, text: r.text,
      mediaId: r.mediaId, mediaMime: r.mediaMime, status: r.status, errorText: r.errorText,
      sentByName: r.sentByName, at: (r.waTimestamp ?? r.createdAt).toISOString(),
    })),
  };
}

/** Mark a conversation's unread count back to 0 (without opening the thread). */
export async function markConversationRead(mobile: string): Promise<{ ok: boolean }> {
  if (!(await admin())) return { ok: false };
  const m = mobile.replace(/\D/g, "").slice(-10);
  await prisma.whatsAppOptIn.update({ where: { mobile: m }, data: { unreadCount: 0 } }).catch(() => null);
  revalidatePath("/whatsapp");
  return { ok: true };
}
