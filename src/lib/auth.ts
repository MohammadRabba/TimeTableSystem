import { db } from "@/lib/db";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "dev-secret-change-in-production-please";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role:
    | "SUPER_ADMIN"
    | "SCHOOL_ADMIN"
    | "SCHEDULER"
    | "TEACHER"
    | "VIEWER";
  schoolId: string | null;
  teacherId: string | null;
};

export async function signSession(
  user: SessionUser
): Promise<string> {
  return jwt.sign(user, JWT_SECRET, {
    expiresIn: "7d",
  });
}

export async function verifySession(
  token: string
): Promise<SessionUser | null> {
  try {
    const payload = jwt.verify(
      token,
      JWT_SECRET
    ) as SessionUser;

    return payload;
  } catch {
    return null;
  }
}

export async function hashPassword(
  password: string
): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    console.error("Password verification failed:", error);
    return false;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("tt-session")?.value;

  if (!token) {
    return null;
  }

  return verifySession(token);
}

export async function requireRole(
  roles: SessionUser["role"][]
): Promise<SessionUser> {
  const session = await getSession();

  if (!session) {
    throw new Error("UNAUTHORIZED");
  }

  if (!roles.includes(session.role)) {
    throw new Error("FORBIDDEN");
  }

  return session;
}

export async function audit(opts: {
  userId?: string;
  schoolId?: string;
  action: string;
  entity: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string;
}) {
  try {
    await db.auditLog.create({
      data: {
        userId: opts.userId || null,
        schoolId: opts.schoolId || null,
        action: opts.action,
        entity: opts.entity,
        entityId: opts.entityId || null,
        oldValue:
          opts.oldValue !== undefined
            ? JSON.stringify(opts.oldValue)
            : null,
        newValue:
          opts.newValue !== undefined
            ? JSON.stringify(opts.newValue)
            : null,
        ip: opts.ip || null,
      },
    });
  } catch (error) {
    console.error("Audit log failed:", error);
  }
}
