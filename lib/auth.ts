import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const COOKIE_USER = 'training_session';
const COOKIE_ADMIN = 'training_admin';
const ALG = 'HS256';

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET must be set to a 32+ char string');
  }
  return new TextEncoder().encode(s);
}

async function sign(role: 'user' | 'admin'): Promise<string> {
  return await new SignJWT({ role })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secretKey());
}

async function verify(token: string | undefined): Promise<{ role: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload as { role: string };
  } catch {
    return null;
  }
}

export async function loginUser(password: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected || password !== expected) return false;
  const token = await sign('user');
  (await cookies()).set(COOKIE_USER, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return true;
}

export async function loginAdmin(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || password !== expected) return false;
  const token = await sign('admin');
  (await cookies()).set(COOKIE_ADMIN, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return true;
}

export async function logout(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_USER);
  c.delete(COOKIE_ADMIN);
}

export async function isAuthed(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE_USER)?.value;
  return (await verify(token)) !== null;
}

export async function isAdmin(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE_ADMIN)?.value;
  const payload = await verify(token);
  return payload?.role === 'admin';
}
