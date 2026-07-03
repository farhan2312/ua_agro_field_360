/**
 * Seed the internal login accounts (employee-code based).
 *   npm run db:accounts
 *
 * - UA999  / uaagro999   → System Admin (super admin)
 * - UA1001 / uaagro12345 → Regional Manager (test)
 * - UA1002 / uaagro12345 → Agricultural Officer (test)
 * - UA1003 / uaagro12345 → Central Team (test)
 * All approved, no forced password change. Also removes the old email admin.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ACCOUNTS = [
  { code: "UA999", pw: "uaagro999", name: "UA Agro Admin", role: "SYSADMIN", label: "System Admin", gradA: "#E65100", gradB: "#FF8F00", territory: "All Regions" },
  { code: "UA1001", pw: "uaagro12345", name: "Regional Manager (Test)", role: "REGIONAL", label: "Regional Manager", gradA: "#43A047", gradB: "#F9A825", territory: "Test Region" },
  { code: "UA1002", pw: "uaagro12345", name: "Agricultural Officer (Test)", role: "ASR", label: "Agri Officer", gradA: "#1565C0", gradB: "#42A5F5", territory: "Test Territory" },
  { code: "UA1003", pw: "uaagro12345", name: "Central Team (Test)", role: "CENTRAL", label: "Central Admin", gradA: "#7B1FA2", gradB: "#CE93D8", territory: "HQ" },
] as const;

async function main() {
  for (const a of ACCOUNTS) {
    const passwordHash = await bcrypt.hash(a.pw, 10);
    const data = {
      name: a.name,
      role: a.role as never,
      roleLabel: a.label,
      initials: a.code.replace(/[^A-Z0-9]/g, "").slice(-2),
      gradA: a.gradA,
      gradB: a.gradB,
      passwordHash,
      mustChangePassword: false,
      approvalStatus: "APPROVED" as const,
      active: true,
      territory: a.territory,
      lastActive: "Just now",
      visitsMtd: "—",
      source: "REAL" as const,
    };
    await prisma.user.upsert({
      where: { employeeCode: a.code },
      update: data,
      create: { employeeCode: a.code, ...data },
    });
    console.log(`  ✓ ${a.code} / ${a.pw}  (${a.label})`);
  }

  // Drop the old email-based admin — login is employee-code only now.
  const del = await prisma.user.deleteMany({ where: { email: "admin@uaagro.com", employeeCode: null } });
  if (del.count) console.log(`  ✓ removed legacy admin@uaagro.com (${del.count})`);

  console.log("Accounts ready.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
