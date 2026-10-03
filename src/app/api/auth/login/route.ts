import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  verifyPassword,
  signSession,
} from "@/lib/auth";// POST /api/auth/login
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email || !password)
    return NextResponse.json({ error: "EMAIL_PASSWORD_REQUIRED" }, { status: 400 });

  const user = await db.user.findUnique({
    where: { email: String(email).toLowerCase() },
    include: { school: true, teacher: true, organization: true },
  });
  if (!user)
    return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
const validPassword = await verifyPassword(
  password,
  user.passwordHash
);

if (!validPassword) {
  return NextResponse.json(
    { error: "INVALID_PASSWORD" },
    { status: 401 }
  );
}
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    schoolId: user.schoolId,
    teacherId: user.teacherId,
  };
  const token = await signSession(payload);
  const res = NextResponse.json({ ok: true, user: payload });
  res.cookies.set("tt-session", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return res;
}

export async function GET() {
  return NextResponse.json({ ok: true });
}