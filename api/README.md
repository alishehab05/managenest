# Factory ERP API

NestJS + Mongoose API for a general-purpose factory management system. See the [project setup](../README.md) for environment configuration and startup.

## Initial endpoints

- `GET /api/health` — public process health check.
- `GET /api/session` — resolves the authenticated Clerk user to a company manager or worker profile.
- `PATCH /api/session/email` — stores an email only after Clerk confirms it is verified.
- `GET/POST/PATCH/DELETE /api/admin/managers` — platform-admin-only manager/company management.
- `GET/POST/PATCH/DELETE /api/workers` — manager-only, scoped to the manager's company.
- `GET /api/warehouses` — lists active warehouses for the user's company.
- `POST /api/warehouses` — creates a warehouse in the authenticated user's company.

Protected routes verify Clerk bearer tokens. Tenant IDs are derived from the user's active membership, not accepted from request bodies. Manager/company provisioning uses MongoDB transactions, so the database must run as a replica set.

To create the initial root administrator, set `PLATFORM_ADMIN_USERNAME`, `PLATFORM_ADMIN_NAME`, and `PLATFORM_ADMIN_INITIAL_PASSWORD` in ignored `api/.admin-bootstrap.env`, then run `npm run seed:admin`. The Clerk development instance must have username sign-in enabled; public self-sign-up is disabled.
