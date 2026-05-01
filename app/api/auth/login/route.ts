import { NextResponse } from 'next/server';
import { loginUser, loginAdmin } from '@/lib/auth';

export async function POST(req: Request) {
  const { password, role } = await req.json();
  if (typeof password !== 'string') {
    return NextResponse.json({ ok: false, error: 'Password required' }, { status: 400 });
  }

  const ok = role === 'admin' ? await loginAdmin(password) : await loginUser(password);
  if (!ok) return NextResponse.json({ ok: false, error: 'Wrong password' }, { status: 401 });

  return NextResponse.json({ ok: true });
}
