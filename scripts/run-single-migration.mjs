import { readFileSync } from "fs";
import pg from "pg";

const { Pool } = pg;

// Load .env manually
const env = readFileSync(".env", "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/run-single-migration.mjs <migration-file.sql>");
  process.exit(1);
}

const conn = process.env["SUPABASE_DB_URL"];
if (!conn) {
  console.error("Missing SUPABASE_DB_URL in .env");
  process.exit(1);
}

async function main() {
  const sql = readFileSync(
    new URL(`../supabase/migrations/${file}`, import.meta.url),
    "utf8",
  );

  const pool = new Pool({
    connectionString: conn,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  try {
    console.log(`Running ${file}...`);
    await client.query(sql);
    console.log(`${file} completed successfully.`);

    const { rows: tables } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    console.log(`\nTables (${tables.length}):`);
    for (const t of tables) console.log(`  - ${t.tablename}`);
  } catch (error) {
    console.error(`Migration ${file} failed:`, error.message);
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
