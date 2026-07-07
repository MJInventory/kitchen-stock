import { runLegacySchemaBootstrap } from "./postgres-migrations/001-runtime-schema-bootstrap.js";
import { dropRedundantIndexes } from "./postgres-migrations/002-drop-redundant-indexes.js";
import { backfillSupportingIndexes } from "./postgres-migrations/003-backfill-supporting-indexes.js";
import { backfillSecondaryIndexes } from "./postgres-migrations/004-backfill-secondary-indexes.js";
import { backfillFinalForeignKeyIndexes } from "./postgres-migrations/005-backfill-final-foreign-key-indexes.js";
import { refreshReportingViews } from "./postgres-migrations/006-refresh-reporting-views.js";
import { refreshKitchenRosterSchema } from "./postgres-migrations/007-refresh-kitchen-roster-schema.js";
import { refreshSupportingDomainSchema } from "./postgres-migrations/008-refresh-supporting-domain-schema.js";
import { refreshInternalOrderSchema } from "./postgres-migrations/009-refresh-internal-order-schema.js";
import { refreshAppUserSchema } from "./postgres-migrations/010-refresh-app-user-schema.js";
import { refreshInventoryPriceSchema } from "./postgres-migrations/011-refresh-inventory-price-schema.js";

export const POSTGRES_MIGRATIONS = [
  {
    version: "001_runtime_schema_bootstrap",
    description: "Legacy bootstrap placeholder",
    migrate: runLegacySchemaBootstrap
  },
  {
    version: "002_drop_redundant_indexes",
    description: "Drop duplicate indexes already covered by constraints",
    migrate: dropRedundantIndexes
  },
  {
    version: "003_backfill_supporting_indexes",
    description: "Backfill missing supporting indexes with concurrent creation",
    transaction: false,
    migrate: backfillSupportingIndexes
  },
  {
    version: "004_backfill_secondary_indexes",
    description: "Backfill secondary concurrent indexes for active relational paths",
    transaction: false,
    migrate: backfillSecondaryIndexes
  },
  {
    version: "005_backfill_final_foreign_key_indexes",
    description: "Backfill the final remaining foreign-key support indexes",
    transaction: false,
    migrate: backfillFinalForeignKeyIndexes
  },
  {
    version: "006_refresh_reporting_views",
    description: "Move reporting and workflow views into a tracked migration",
    migrate: refreshReportingViews
  },
  {
    version: "007_refresh_kitchen_roster_schema",
    description: "Move kitchen roster tables and views into a tracked migration",
    migrate: refreshKitchenRosterSchema
  },
  {
    version: "008_refresh_supporting_domain_schema",
    description: "Move supporting domain tables and columns into a tracked migration",
    migrate: refreshSupportingDomainSchema
  },
  {
    version: "009_refresh_internal_order_schema",
    description: "Move internal order tables and indexes into a tracked migration",
    migrate: refreshInternalOrderSchema
  },
  {
    version: "010_refresh_app_user_schema",
    description: "Move app user schema updates into a tracked migration",
    migrate: refreshAppUserSchema
  },
  {
    version: "011_refresh_inventory_price_schema",
    description: "Add lightweight inventory pricing and refresh dependent views",
    migrate: refreshInventoryPriceSchema
  }
];
