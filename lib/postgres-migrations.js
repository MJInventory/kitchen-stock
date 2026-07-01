import { runLegacySchemaBootstrap } from "./postgres-migrations/001-runtime-schema-bootstrap.js";
import { dropRedundantIndexes } from "./postgres-migrations/002-drop-redundant-indexes.js";
import { backfillSupportingIndexes } from "./postgres-migrations/003-backfill-supporting-indexes.js";
import { backfillSecondaryIndexes } from "./postgres-migrations/004-backfill-secondary-indexes.js";
import { backfillFinalForeignKeyIndexes } from "./postgres-migrations/005-backfill-final-foreign-key-indexes.js";

export const POSTGRES_MIGRATIONS = [
  {
    version: "001_runtime_schema_bootstrap",
    description: "One-time legacy schema bootstrap",
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
  }
];
