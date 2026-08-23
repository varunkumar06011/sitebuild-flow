import { readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;

function loadLocalEnv() {
  try {
    const env = readFileSync(".env", "utf8");
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^"|"$/g, "");
      }
    }
  } catch {
    // CI may provide SUPABASE_DB_URL directly.
  }
}

loadLocalEnv();
const connectionString = process.env["SUPABASE_DB_URL"];
if (!connectionString) {
  console.error(
    "Missing SUPABASE_DB_URL. Inventory verification is read-only and requires a database URL.",
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

const checks = [
  {
    name: "Required inventory relations exist",
    sql: `
      SELECT COUNT(*)::int AS count
      FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relname = ANY($1::text[])
    `,
    params: [
      [
        "inventory_categories",
        "inventory_items",
        "inventory_transactions",
        "inventory_warehouses",
        "inventory_locations",
        "inventory_receipts",
        "inventory_consumptions",
        "inventory_assets",
        "inventory_serials",
        "inventory_transaction_reversals",
        "inventory_consumption_reversals",
        "inventory_stock_balances",
        "inventory_cost_summary",
        "inventory_daily_register",
      ],
    ],
    validate: (row) => Number(row.count) === 14,
    failure: (row) => `Expected 14 relations/views, found ${row.count}`,
  },
  {
    name: "Inventory transactions have valid item references",
    sql: `
      SELECT COUNT(*)::int AS count
      FROM inventory_transactions t
      LEFT JOIN inventory_items i ON i.id = t.item_id
      WHERE i.id IS NULL
    `,
    validate: (row) => Number(row.count) === 0,
    failure: (row) => `${row.count} orphan transactions found`,
  },
  {
    name: "No negative scoped stock balances",
    sql: `SELECT COUNT(*)::int AS count FROM inventory_stock_balances WHERE current_stock < 0`,
    validate: (row) => Number(row.count) === 0,
    failure: (row) => `${row.count} negative stock scopes found`,
  },
  {
    name: "No over-reversed transactions",
    sql: `
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT original.id
        FROM inventory_transaction_reversals r
        JOIN inventory_transactions original ON original.id = r.original_transaction_id
        GROUP BY original.id, original.quantity
        HAVING SUM(r.quantity) > original.quantity
      ) invalid_reversals
    `,
    validate: (row) => Number(row.count) === 0,
    failure: (row) => `${row.count} over-reversed transactions found`,
  },
  {
    name: "Consumption quantities match linked ledger movements",
    sql: `
      SELECT COUNT(*)::int AS count
      FROM inventory_consumptions c
      LEFT JOIN inventory_transactions used_tx ON used_tx.id = c.used_transaction_id
      LEFT JOIN inventory_transactions waste_tx ON waste_tx.id = c.waste_transaction_id
      WHERE (c.used_quantity > 0 AND (used_tx.id IS NULL OR used_tx.quantity <> c.used_quantity))
         OR (c.wasted_quantity > 0 AND (waste_tx.id IS NULL OR waste_tx.quantity <> c.wasted_quantity))
    `,
    validate: (row) => Number(row.count) === 0,
    failure: (row) => `${row.count} consumption records have mismatched ledger links`,
  },
  {
    name: "Receipts have linked receipt transactions",
    sql: `
      SELECT COUNT(*)::int AS count
      FROM inventory_receipts r
      LEFT JOIN inventory_transactions t ON t.id = r.inventory_transaction_id
      WHERE t.id IS NULL
    `,
    validate: (row) => Number(row.count) === 0,
    failure: (row) => `${row.count} receipts have no linked ledger transaction`,
  },
  {
    name: "Serialized inventory has unique serials",
    sql: `
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT organization_id, serial_number
        FROM inventory_serials
        GROUP BY organization_id, serial_number
        HAVING COUNT(*) > 1
      ) duplicates
    `,
    validate: (row) => Number(row.count) === 0,
    failure: (row) => `${row.count} duplicate serial groups found`,
  },
  {
    name: "Transfer groups contain paired movements",
    sql: `
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT transfer_group_id
        FROM inventory_transactions
        WHERE transfer_group_id IS NOT NULL
        GROUP BY transfer_group_id
        HAVING COUNT(*) <> 2 OR COUNT(*) FILTER (WHERE type = 'out') <> 1 OR COUNT(*) FILTER (WHERE type = 'in') <> 1
      ) invalid_groups
    `,
    validate: (row) => Number(row.count) === 0,
    failure: (row) => `${row.count} invalid transfer groups found`,
  },
];

try {
  await pool.query("SELECT 1");
  let failed = 0;
  for (const check of checks) {
    const result = await pool.query(check.sql, check.params ?? []);
    const row = result.rows[0] ?? { count: 0 };
    if (check.validate(row)) {
      console.log(`PASS: ${check.name}`);
    } else {
      failed += 1;
      console.error(`FAIL: ${check.name} — ${check.failure(row)}`);
    }
  }
  if (failed > 0) {
    process.exitCode = 1;
    console.error(`\nInventory verification failed: ${failed} check(s).`);
  } else {
    console.log(`\nInventory verification passed: ${checks.length} checks.`);
  }
} catch (error) {
  console.error(
    `Inventory verification could not run: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
