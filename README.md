# UA Field Intel — Kisan Sewa Kendra

A field data-capture & analytics platform for Agricultural Specialist Sales Representatives (ASRs),
converted from the original design-composer mockup into a full-stack **Next.js + TypeScript + Tailwind CSS**
app backed by **Azure PostgreSQL** via **Prisma**.

## Stack

- **Next.js 14** (App Router) — UI + server API
- **TypeScript** + **Tailwind CSS**
- **Prisma** ORM → **Azure Database for PostgreSQL**
- **react-leaflet** (OpenStreetMap) for the Map View
- Deploy target: **Vercel**

## Getting started

```bash
cd webapp
npm install

# 1. Set your DB password
#    Edit .env and replace REPLACE_WITH_DB_PASSWORD with the real Azure password.

# 2. Create the schema in Postgres
npm run db:push

# 3. Import real master data (stores, 88k farmers, employees, field options)
npm run db:import

# 4. Seed the curated demo records (rich farmers, visits, projects, clusters, users)
npm run db:seed

# 5. Run
npm run dev   # http://localhost:3000
```

Shortcut for steps 2–4 once `.env` is set: `npm run db:setup`.

## Environment variables

See `.env.example`. Required:

| Var            | Description                                                    |
| -------------- | ------------------------------------------------------------- |
| `DATABASE_URL` | Azure Postgres connection string (keep `?sslmode=require`)    |
| `DIRECT_URL`   | Non-pooled connection for Prisma migrate (same value ok)      |
| `AUTH_SECRET`  | Long random secret for signing session JWTs (required for login) |

## Authentication

The app is gated by real auth (middleware protects every route):

- **Sign in** at `/login`; **register** at `/register` (request access → admin approves).
- Create the default admin: `npm run db:admin` → **admin@uaagro.com / uaagro12345**.
- New users register with a requested role and land in **Pending** on the **Users** page;
  the admin approves them there and assigns a role. Only the admin sees the "view as role"
  switcher; everyone else has their assigned role + sign out.

Generate `AUTH_SECRET`: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

## Deploying to Vercel

1. Push this `webapp/` folder to a Git repo.
2. In Vercel → New Project → set **Root Directory = `webapp`**.
3. Add `DATABASE_URL` and `DIRECT_URL` in Project Settings → Environment Variables.
4. Build command is `npm run build` (runs `prisma generate` first). Deploy.
5. Run `npm run db:push && npm run db:import && npm run db:seed` once against the Azure DB
   (locally or from a one-off job) to populate data.

## Data model

The real spreadsheet only contains basic store/farmer/employee data. Rich fields
(crops, visits, sales, segments, leads, projects, clusters) shown in the dashboards come from
**curated demo records** seeded on top of the real data. Each row is tagged `source = REAL | DEMO`.

See `docs/spec/` for the per-screen specifications derived from the original design.
```
```
