# idzen

A full-stack commerce platform with a Next.js storefront and admin console, backed by an Express REST API and MySQL/Prisma.

## Quick start

1. Copy `.env.example` to `.env` and set the required secrets.
2. Run `docker compose up -d db` then `npm install`.
3. Run `npm run db:generate`, `npm run dev`.

Storefront: `http://localhost:3000`. API health: `http://localhost:4000/api/health`.

## Workspace

- `apps/web` - Next.js customer website and protected admin dashboard
- `apps/api` - Express REST API, JWT/OAuth/OTP authentication, payments and reporting
- `packages/db` - Prisma schema and generated client
- `packages/shared` - Cross-service TypeScript contracts

See `.env.example` for the optional Firebase, Google, Cloudinary, SMTP and Razorpay configuration.
