# Training

AI-generated training programmes for Acumon staff. Pick a category, type a topic, and get a narrated slide deck plus an interactive quiz with widgets (T-accounts, journal entries, etc.) and personalised feedback.

## Stack
- Next.js 16 (App Router)
- Prisma + Vercel Postgres (Neon)
- Together AI — Llama 3.3 70B Turbo (lesson generation + grading + feedback)
- ElevenLabs — text-to-speech narration
- NextAuth v5 + Microsoft Entra ID — sign-in restricted to `@acumon.com` accounts
- Tailwind CSS

## Auth model
- Anyone with an `@acumon.com` Microsoft account can sign in and use `/learn`.
- The single user whose email matches `ADMIN_EMAIL` can also access `/admin` to manage categories.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the values.
3. `npm run db:push` to push the Prisma schema to your database.
4. `npm run db:seed` to create the starter categories (Accounting, Audit).
5. `npm run dev`.

## Deploying to Vercel

1. Push this repo to GitHub (already done if you're reading this on Vercel).
2. Import the repo into Vercel.
3. In Vercel → Storage, create a Postgres database (Neon) and connect it. `DATABASE_URL` is auto-injected.
4. Add the remaining env vars from `.env.example` to Vercel project settings.
5. In your Azure AD app registration, add this redirect URI:
   `https://<your-vercel-domain>/api/auth/callback/microsoft-entra-id`
6. First deploy runs `prisma db push` automatically (see `package.json` build script).
7. Run the seed once: `vercel env pull .env.local`, then `npm install && npm run db:seed`.

## Adding categories

Sign in as the `ADMIN_EMAIL` user, then visit `/admin`. New categories appear in the learner picker immediately.

## Adding widget types

Widgets live in `components/widgets/`. To add a new one:
1. Create the React component in `components/widgets/YourWidget.tsx` accepting `{config, value, onChange, disabled}`.
2. Add it to the registry in `lib/widgets/registry.ts` (slug, label, LLM description, config shape).
3. Add the dispatch entry in `components/widgets/index.tsx`.
4. Add a deterministic grader in `gradeWidget()`, or fall through to LLM grading.
5. Tick the widget's checkbox on the relevant categories in `/admin`.
