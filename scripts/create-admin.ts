/**
 * Create / reset the default admin account.
 *   npm run db:admin
 * Email: admin@uaagro.com   Password: uaagro12345
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const EMAIL = "admin@uaagro.com";
const PASSWORD = "uaagro12345";

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const base = {
    name: "UA Agro Admin",
    role: "SYSADMIN" as const,
    roleLabel: "System Admin",
    initials: "UA",
    gradA: "#E65100",
    gradB: "#FF8F00",
    passwordHash,
    approvalStatus: "APPROVED" as const,
    active: true,
    territory: "All Regions",
    lastActive: "Just now",
    visitsMtd: "—",
    source: "REAL" as const,
  };
  await prisma.user.upsert({
    where: { email: EMAIL },
    update: base,
    create: { email: EMAIL, ...base },
  });
  console.log(`✓ Admin ready — ${EMAIL} / ${PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
