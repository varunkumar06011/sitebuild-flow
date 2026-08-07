import { readFileSync } from "fs";
import pg from "pg";

const { Pool } = pg;

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/run-single-migration.mjs <migration-file.sql>");
  process.exit(1);
}

const conn = "postgresql://postgres.vbnqlsmraiwcqnsenlej:Varun06011%40@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres";

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
