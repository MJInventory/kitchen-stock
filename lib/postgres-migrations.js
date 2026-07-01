import { runLegacySchemaBootstrap } from "./postgres-migrations/001-runtime-schema-bootstrap.js";
import { dropRedundantIndexes } from "./postgres-migrations/002-drop-redundant-indexes.js";

export const POSTGRES_MIGRATIONS = [
  {
    version: "001_runtime_schema_bootstrap",
    migrate: runLegacySchemaBootstrap
  },
  {
    version: "002_drop_redundant_indexes",
    migrate: dropRedundantIndexes
  }
];
