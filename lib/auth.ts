import NextAuth from 'next-auth';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';

const ALLOWED_DOMAIN = 'acumon.com';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      issuer: 'https://login.microsoftonline.com/common/v2.0',
      authorization: {
        url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        params: { scope: 'openid profile email' },
      },
      token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userinfo: 'https://graph.microsoft.com/oidc/userinfo',
      jwks_endpoint: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const email = ((profile as any)?.email as string | undefined)?.toLowerCase();
      if (!email) return false;
      return email.endsWith(`@${ALLOWED_DOMAIN}`);
    },
    async jwt({ token, profile }) {
      if (profile?.email) {
        token.email = (profile.email as string).toLowerCase();
        token.name = (profile.name as string) ?? token.name ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = (token.email as string) ?? session.user.email;
        session.user.name = (token.name as string) ?? session.user.name;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
});

export async function isAuthed(): Promise<boolean> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  return !!email && email.endsWith(`@${ALLOWED_DOMAIN}`);
}

export async function isAdmin(): Promise<boolean> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  const adminEmail = (process.env.ADMIN_EMAIL ?? '').toLowerCase();
  if (!adminEmail) return false;
  return !!email && email === adminEmail;
}

export async function currentUserEmail(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email?.toLowerCase() ?? null;
}
