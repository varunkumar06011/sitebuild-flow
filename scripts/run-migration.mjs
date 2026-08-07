import { readFileSync, readdirSync } from "fs";
import pg from "pg";

const { Pool } = pg;

const connections = [
  {
    name: "Pooler (aws-0-ap-northeast-1)",
    conn: "postgresql://postgres.vbnqlsmraiwcqnsenlej:Varun06011%40@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
  },
];

async function tryConnect() {
  for (const c of connections) {
    console.log(`\nTrying: ${c.name}...`);
    try {
      const pool = new Pool({
        connectionString: c.conn,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
      });
      const client = await pool.connect();
      const { rows } = await client.query("SELECT 1 as test");
      console.log(`  Connected! Result: ${rows[0].test}`);
      client.release();
      await pool.end();
      return c.conn;
    } catch (e) {
      console.log(`  Failed: ${e.message.substring(0, 100)}`);
    }
  }
  return null;
}

async function runMigrations(connString) {
  const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`\nFound ${files.length} migration files: ${files.join(", ")}`);

  const pool = new Pool({
    connectionString: connString,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  try {
    for (const file of files) {
      const sql = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
      console.log(`\nRunning ${file}...`);
      await client.query(sql);
      console.log(`  ${file} completed.`);
    }

    console.log("\n=== All migrations completed ===");

    const { rows: tables } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    console.log(`\nTables (${tables.length}):`);
    for (const t of tables) console.log(`  - ${t.tablename}`);

    const { rows: users } = await client.query(
      `SELECT username, role, name FROM users ORDER BY role`,
    );
    console.log(`\nUsers (${users.length}):`);
    for (const u of users) console.log(`  - ${u.username} (${u.role}): ${u.name}`);

    console.log("\nTesting next_gp_number() function...");
    const { rows: gpResult } = await client.query("SELECT next_gp_number() as gp_number");
    console.log(`  Next GP number: ${gpResult[0].gp_number}`);

    console.log("\n=== All verification checks passed ===");
  } catch (error) {
    console.error("Migration failed:", error.message);
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const connString = await tryConnect();
  if (!connString) {
    console.error("\nCould not connect to any Supabase database endpoint.");
    console.error("The project may be paused. Please:");
    console.error("1. Go to https://supabase.com/dashboard/project/vbnqlsmraiwcqnsenlej");
    console.error("2. If paused, click 'Restore project'");
    console.error("3. Run: node scripts/run-migration.mjs");
    process.exit(1);
  }
  await runMigrations(connString);
}

main();
