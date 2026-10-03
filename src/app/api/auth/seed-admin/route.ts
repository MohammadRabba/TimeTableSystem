import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, signSession } from "@/lib/auth";

// POST /api/auth/seed-admin  — seed initial super admin (idempotent)
export async function POST(_req: NextRequest) {
  const email = "admin@school.tt";
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ ok: true, already: true, email, password: "(already set)" });
  }
  const pwHash = await hashPassword("admin123");
  const org = await db.organization.create({
    data: { name: "Ministry of Education", code: "MOE" },
  });
  const user = await db.user.create({
    data: {
      email,
      name: "Super Admin",
      passwordHash: pwHash,
      role: "SUPER_ADMIN",
      organizationId: org.id,
    },
  });
  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, role: user.role },
    password: "admin123",
    note: "Use these credentials to login.",
  });
}

export async function GET() {
  const count = await db.user.count();
  return NextResponse.json({ seeded: count > 0, users: count });
}
