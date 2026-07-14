# MJ Stock Magic System Map

Use this map before opening broad parts of the repository. Start with the row matching the screen, then inspect only its frontend, API, domain, and focused test.

| Flow | Browser code | API boundary | Backend/domain | Focused regression |
| --- | --- | --- | --- | --- |
| Home | `public/dashboard/` | `lib/operations-api.js` | `lib/dashboard-domain.js` | `tests/frontend-session-helpers.test.mjs` |
| Ordering | `public/ordering/` | `lib/mutation-api.js`, `lib/operations-api.js` | `lib/request-domain.js`, `lib/request-item-service.js` | `tests/ordering-workflow-regressions.test.mjs` |
| Receiving | `public/receiving-sheet/` | `lib/operations-api.js`, `lib/mutation-api.js` | `lib/sheet-domain.js`, `lib/request-domain.js` | `tests/standing-order-receiving-regressions.test.mjs` |
| Standing orders | `public/standing-orders/` | `lib/workflow-api.js`, `lib/mutation-api.js` | `lib/standing-order-domain.js` | `tests/standing-order-receiving-regressions.test.mjs` |
| Driver sheet | `public/driver-sheet/` | `lib/operations-api.js`, `lib/workflow-api.js` | `lib/sheet-domain.js` | add coverage beside sheet regressions when changed |
| Reports | `public/order-report/`, `public/management-report.js` | `lib/operations-api.js` | `lib/report-support-domain.js`, `lib/audit-log.js` | add focused coverage when changed |
| Users and permissions | `public/user-admin/`, `public/menus.js`, `public/settings.js` | `lib/app-user-api.js` | `lib/app-user-domain.js`, `lib/user-helpers.js` | `tests/security-admin-internal-data.test.mjs` |
| Internal data | `public/internal-data.js` | `lib/setup-admin-api.js` | `lib/internal-data-domain.js` | `tests/security-admin-internal-data.test.mjs` |
| Kitchen roster | `public/kitchen-roster.js` | `lib/operations-api.js` | `lib/kitchen-roster-domain.js` | add focused coverage when changed |

## Shared boundaries

- Pages and shell configuration: `lib/page-route-definitions.js`, `views/layouts/base.ejs`
- Menu visibility and screen access: `public/menu-config.js`, `public/menus.js`, `lib/user-helpers.js`
- API assembly: `lib/server-api-runtime.js`
- Domain assembly: `lib/server-composition.js`
- Database baseline: `database/schema.sql`
- Forward-only migrations: `lib/postgres-migrations.js`, `lib/postgres-migrations/`

## Lean commands

- `npm run inspect:changes`: show which fragile flows and tests are affected by uncommitted files.
- `npm run inspect:codebase`: static syntax, import, migration, menu-route, frontend/API-route, and frontend/database-boundary checks.
- `npm run check:fast`: inspector, startup imports, and focused regression suite. Use during implementation.
- `npm run check:release`: fast checks plus the application health check. Use before commit and deploy.

The health check renders every routed page and verifies the shared shell, mobile viewport, stylesheet, menus, theme script, and unique element IDs.

Do not run browser checks unless a visual or interaction problem specifically requires one.
