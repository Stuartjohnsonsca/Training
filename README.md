# Training

AI-generated training programmes. User picks a category, types in a topic, gets a narrated slide deck plus an interactive quiz with widgets (T-accounts, journal entries, etc.) and personalised feedback.

## Stack
- Next.js 16 (App Router)
- Prisma + Vercel Postgres
- Anthropic Claude (lesson + grading)
- ElevenLabs (text-to-speech narration)
- Tailwind CSS
- Shared-password auth (no user accounts)

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the values.
3. `npm run db:push` to push the Prisma schema to your database.
4. `npm run db:seed` to create the starter categories (Accounting, Audit).
5. `npm run dev`.

## Deploying to Vercel

1. Push this repo to GitHub (already done if you're reading this on Vercel).
2. Import the repo into Vercel.
3. In Vercel → Storage, create a Postgres database and connect it to the project. `DATABASE_URL` will be auto-injected.
4. Add the remaining env vars from `.env.example` to Vercel project settings.
5. First deploy will run `prisma db push` automatically (see `package.json` build script).
6. Run the seed once: open Vercel CLI locally and `vercel env pull .env.local`, then `npm run db:seed`.

## Adding categories

Visit `/admin` and log in with `ADMIN_PASSWORD`. New categories appear in the user-facing picker immediately.

## Adding widget types

Widgets live in `components/widgets/`. To add a new one:
1. Create the React component in `components/widgets/YourWidget.tsx`.
2. Add it to the registry in `lib/widgets/registry.ts`.
3. Add the type name to a category's `allowedWidgets` in admin (or the seed).
4. The lesson generator will know it's available because the registry is also passed into the system prompt.
