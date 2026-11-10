# Factory Management ERP

Cross-platform factory management ERP: Expo + React Native + TypeScript mobile app, NestJS API, MongoDB/Mongoose, and Clerk authentication for company users. Inventory, products, materials, purchasing, sales, transport, assets, and expenses are designed for general factory operations.

## What is implemented

- Expo mobile app with Clerk username-or-email/password sign-in and verified email setup.
- Public sign-up is disabled; the platform admin provisions company managers and managers provision workers.
- Company-scoped manager and worker lifecycle controls, including editing, suspending, and soft-deleting accounts.
- Tenant-scoped warehouse creation/listing. Every warehouse is tied to a company on the server; clients cannot choose the tenant ID.
- General inventory batches use the existing `cocoaLots` collection for backward compatibility; the application presents these as inventory batches rather than cocoa-specific stock.
- API bearer-token verification against Clerk, request DTO validation, and a public health endpoint.
- Company records in `companies`, company managers in `users`, and employee profiles in `accounts`.

The `users` collection stores the `platform_admin` and `company_manager` identities. `accounts` stores each company's workers. Each identity has a unique username used for login; MongoDB `_id` remains the internal primary key so existing document references stay stable. Admin-created accounts receive a generated initial password that is shown once to the creator. New users add and verify an email after their first username/password login.

## Requirements

- Node.js 22+
- MongoDB Atlas configured for transactions (Atlas replica-set deployments support the company-registration transaction)
- Clerk application with email/password sign-in and email-code verification enabled

## Configure and run

1. Copy `api/.env.example` to `api/.env`, replace the Atlas username/password placeholders with rotated database credentials, and set your Clerk secret key. Keep `api/.env` local; it is git-ignored.
2. Clerk development keys are managed in `mobile/.env.local` by `npx clerk@latest env pull`; keep both local env files private and git-ignored.
3. Configure Clerk's allowed development URLs as needed.
4. In one terminal run:

   ```powershell
   cd api
   npm install
   npm run start:dev
   ```

5. In another terminal run:

   ```powershell
   cd mobile
   npm install
   npx expo start
   ```

The API health endpoint is `GET /api/health`. Authenticated routes include `GET /api/session`, `PATCH /api/session/email`, `GET/POST/PATCH/DELETE /api/admin/managers`, `GET/POST/PATCH/DELETE /api/workers`, and warehouse read/create endpoints for company managers.

## Deploy for worldwide access

The mobile app must use a public HTTPS API; a private LAN address such as `192.168.x.x` only works on that local network. The root `render.yaml` defines a Render web service in Frankfurt with a health check and the API build/start commands.

1. Push this repository to a Git provider and create a Render Blueprint from it, selecting the root `render.yaml`. The API service uses Render's paid Starter plan so it stays available instead of sleeping between requests.
2. Set `MONGODB_URI` to the production Atlas URI and `CLERK_SECRET_KEY` to the secret key for the same Clerk production instance used by the app. Set `CORS_ORIGINS` to the exact HTTPS origin(s) of any browser-based clients; native mobile clients do not use browser CORS.
3. In MongoDB Atlas, allow the API host's outbound IP ranges in Network Access and use a least-privilege database user. Do not expose the database to all IPs with `0.0.0.0/0`.
4. Wait for Render's `/api/health` check to pass, then copy the service's public HTTPS URL. Set the EAS `production` variables `EXPO_PUBLIC_API_URL` to that URL followed by `/api` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` to the matching Clerk `pk_live_...` key. Never put `CLERK_SECRET_KEY` in the mobile app or EAS public variables.
5. Build and distribute a new production app from `mobile/` with `eas build --platform android --profile production` (and the corresponding iOS build if required).

A public API URL makes the service reachable worldwide; choose hosting regions and database locations that meet your latency, data-residency, and availability requirements.

## Tenant and authentication rules

- Mobile users authenticate with Clerk. The API verifies bearer JWTs using `CLERK_SECRET_KEY`.
- Sign-up is disabled in both the app and Clerk instance.
- Bootstrap the initial platform administrator after setting `PLATFORM_ADMIN_USERNAME`, `PLATFORM_ADMIN_NAME`, and a unique 15+ character `PLATFORM_ADMIN_INITIAL_PASSWORD` in the ignored `api/.admin-bootstrap.env` (copy `.admin-bootstrap.env.example` first): run `npm run seed:admin` from `api`. The script provisions the Clerk username/password if needed and inserts the `platform_admin` record in `users`.
- The platform admin creates companies and their manager accounts. A company manager can only provision and manage workers whose `companyId` matches their own company.
- All company-owned documents carry `companyId`; services obtain this ID from the authenticated user's active membership, never from request data.
- Workers belong in `accounts`; both managers and the platform admin belong in `users`.
- Deleted accounts are soft-deleted in MongoDB and banned in Clerk so historical references remain intact.

This is a foundation, not a production accounting system. Next modules should implement inventory movements and weighted-average valuation, purchasing/sales posting, party balances, truck/assets, expenses, audit logs, role/warehouse permissions, and their transaction-level tests before financial use.
