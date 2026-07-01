import { closePool, getPool, postgresEnabled } from "../lib/postgres.js";

function db() {
  return getPool();
}

function hasPostgres() {
  return postgresEnabled();
}

function samePrefix(indexKeys, foreignKeyKeys) {
  if (indexKeys.length < foreignKeyKeys.length) return false;
  return foreignKeyKeys.every((attnum, index) => indexKeys[index] === attnum);
}

const foreignKeyQuery = `
  select
    con.oid as constraint_oid,
    con.conrelid,
    rel.relname as table_name,
    con.conname as constraint_name,
    array_agg(att.attname order by ord.ordinality) as fk_columns,
    array_agg(att.attnum::int order by ord.ordinality) as fk_attnums
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  join unnest(con.conkey) with ordinality as ord(attnum, ordinality) on true
  join pg_attribute att
    on att.attrelid = con.conrelid
   and att.attnum = ord.attnum
  where con.contype = 'f'
    and ns.nspname = 'public'
  group by con.oid, con.conrelid, rel.relname, con.conname
  order by rel.relname, con.conname
`;

const indexQuery = `
  select
    ind.indrelid,
    idx.relname as index_name,
    array_agg(ord.attnum::int order by ord.ordinality)
      filter (where ord.ordinality <= ind.indnkeyatts and ord.attnum > 0) as index_attnums
  from pg_index ind
  join pg_class idx on idx.oid = ind.indexrelid
  join pg_class rel on rel.oid = ind.indrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  join unnest(ind.indkey::int2[]) with ordinality as ord(attnum, ordinality) on true
  where ns.nspname = 'public'
    and ind.indpred is null
    and ind.indexprs is null
  group by ind.indrelid, idx.relname, ind.indnkeyatts
`;

try {
  if (!hasPostgres()) {
    console.log("Postgres is not enabled. No foreign-key index audit available.");
    process.exit(0);
  }

  const [foreignKeysResult, indexesResult] = await Promise.all([
    db().query(foreignKeyQuery),
    db().query(indexQuery)
  ]);

  const indexesByTable = new Map();
  for (const row of indexesResult.rows) {
    const list = indexesByTable.get(row.indrelid) || [];
    list.push({
      indexName: row.index_name,
      indexAttnums: row.index_attnums || []
    });
    indexesByTable.set(row.indrelid, list);
  }

  const uncovered = foreignKeysResult.rows
    .filter((foreignKey) => {
      const indexes = indexesByTable.get(foreignKey.conrelid) || [];
      return !indexes.some((index) => samePrefix(index.indexAttnums, foreignKey.fk_attnums || []));
    })
    .map((foreignKey) => ({
      table_name: foreignKey.table_name,
      constraint_name: foreignKey.constraint_name,
      fk_columns: (foreignKey.fk_columns || []).join(", ")
    }));

  if (!uncovered.length) {
    console.log("All public foreign keys have an index prefix.");
  } else {
    console.table(uncovered);
  }
} finally {
  await closePool();
}
