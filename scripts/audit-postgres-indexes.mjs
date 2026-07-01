import { closePool, getPool, postgresEnabled } from "../lib/postgres.js";

function db() {
  return getPool();
}

function hasPostgres() {
  return postgresEnabled();
}

const duplicateIndexQuery = `
  with index_data as (
    select
      ns.nspname as schema_name,
      tbl.relname as table_name,
      idx.relname as index_name,
      ind.indisprimary as is_primary,
      ind.indisunique as is_unique,
      pg_get_expr(ind.indpred, ind.indrelid) as predicate,
      pg_get_expr(ind.indexprs, ind.indrelid) as expressions,
      (
        select string_agg(att.attname, ', ' order by ord.ordinality)
        from unnest(ind.indkey) with ordinality as ord(attnum, ordinality)
        join pg_attribute att
          on att.attrelid = ind.indrelid
         and att.attnum = ord.attnum
      ) as key_columns
    from pg_index ind
    join pg_class idx on idx.oid = ind.indexrelid
    join pg_class tbl on tbl.oid = ind.indrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    where ns.nspname = 'public'
      and idx.relkind = 'i'
  )
  select
    a.table_name,
    a.index_name as kept_index,
    b.index_name as redundant_index,
    a.is_primary as kept_is_primary,
    a.is_unique as kept_is_unique,
    b.is_primary as redundant_is_primary,
    b.is_unique as redundant_is_unique,
    coalesce(a.key_columns, '') as key_columns,
    coalesce(a.predicate, '') as predicate,
    coalesce(a.expressions, '') as expressions
  from index_data a
  join index_data b
    on a.table_name = b.table_name
   and a.index_name < b.index_name
   and coalesce(a.key_columns, '') = coalesce(b.key_columns, '')
   and coalesce(a.predicate, '') = coalesce(b.predicate, '')
   and coalesce(a.expressions, '') = coalesce(b.expressions, '')
  where a.is_primary <> b.is_primary
     or a.is_unique <> b.is_unique
     or a.index_name <> b.index_name
  order by a.table_name, a.index_name, b.index_name
`;

try {
  if (!hasPostgres()) {
    console.log("Postgres is not enabled. No index audit available.");
    process.exit(0);
  }

  const result = await db().query(duplicateIndexQuery);
  if (!result.rowCount) {
    console.log("No exact duplicate public indexes found.");
  } else {
    console.table(result.rows);
  }
} finally {
  await closePool();
}
