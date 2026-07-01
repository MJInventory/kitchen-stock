import { closePool, getPool, postgresEnabled } from "../lib/postgres.js";

function db() {
  return getPool();
}

function hasPostgres() {
  return postgresEnabled();
}

const foreignKeyCoverageQuery = `
  with fk_columns as (
    select
      con.oid as constraint_oid,
      ns.nspname as schema_name,
      rel.relname as table_name,
      con.conname as constraint_name,
      array_agg(att.attname order by ord.ordinality) as fk_columns,
      array_agg(att.attnum order by ord.ordinality) as fk_attnums
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    join unnest(con.conkey) with ordinality as ord(attnum, ordinality) on true
    join pg_attribute att
      on att.attrelid = con.conrelid
     and att.attnum = ord.attnum
    where con.contype = 'f'
      and ns.nspname = 'public'
    group by con.oid, ns.nspname, rel.relname, con.conname
  ),
  covering_indexes as (
    select
      fk.constraint_oid,
      idx.relname as index_name
    from fk_columns fk
    join pg_constraint con on con.oid = fk.constraint_oid
    join pg_index ind on ind.indrelid = con.conrelid
    join pg_class idx on idx.oid = ind.indexrelid
    where ind.indpred is null
      and ind.indexprs is null
      and ind.indnatts >= cardinality(fk.fk_attnums)
      and (ind.indkey::smallint[])[1:cardinality(fk.fk_attnums)] = fk.fk_attnums
  )
  select
    fk.table_name,
    fk.constraint_name,
    array_to_string(fk.fk_columns, ', ') as fk_columns
  from fk_columns fk
  left join covering_indexes ci on ci.constraint_oid = fk.constraint_oid
  where ci.index_name is null
  order by fk.table_name, fk.constraint_name
`;

try {
  if (!hasPostgres()) {
    console.log("Postgres is not enabled. No foreign-key index audit available.");
    process.exit(0);
  }

  const result = await db().query(foreignKeyCoverageQuery);
  if (!result.rowCount) {
    console.log("All public foreign keys have an index prefix.");
  } else {
    console.table(result.rows);
  }
} finally {
  await closePool();
}
