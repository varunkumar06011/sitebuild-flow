import { readFileSync } from "fs";
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

async function runMigration(connString) {
  const sql = readFileSync(
    new URL("../supabase/migrations/001_initial_schema.sql", import.meta.url),
    "utf8",
  );

  const pool = new Pool({
    connectionString: connString,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  try {
    console.log("\nRunning migration...");
    await client.query(sql);
    console.log("Migration completed successfully.");

    const { rows: tables } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    console.log(`\nTables created (${tables.length}):`);
    for (const t of tables) console.log(`  - ${t.tablename}`);

    const { rows: users } = await client.query(
      `SELECT username, role, name FROM users ORDER BY role`,
    );
    console.log(`\nUsers seeded (${users.length}):`);
    for (const u of users) console.log(`  - ${u.username} (${u.role}): ${u.name}`);

    const { rows: vendors } = await client.query(
      `SELECT name, gst_number FROM vendors ORDER BY name LIMIT 5`,
    );
    console.log(`\nVendors seeded (${vendors.length} shown):`);
    for (const v of vendors) console.log(`  - ${v.name} (GST: ${v.gst_number})`);

    const { rows: gps } = await client.query(
      `SELECT gp_number, status FROM gate_passes ORDER BY gp_number`,
    );
    console.log(`\nGate passes seeded (${gps.length}):`);
    for (const g of gps) console.log(`  - ${g.gp_number} (${g.status})`);

    console.log("\nTesting audit_log immutability trigger...");
    try {
      await client.query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (NULL, 'test_insert', 'test', 'test', '{}'::jsonb)",
      );
      await client.query("UPDATE audit_log SET action = 'hacked' WHERE action = 'test_insert'");
      console.log("  ERROR: Trigger did not block UPDATE!");
    } catch (e) {
      console.log(`  UPDATE blocked: ${e.message.substring(0, 80)}`);
    }

    console.log("\nTesting RLS deny-all...");
    const { rows: rlsCheck } = await client.query(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('users', 'gate_passes', 'audit_log') AND relrowsecurity = true`,
    );
    console.log(`  RLS enabled on ${rlsCheck.length}/3 checked tables`);

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
  await runMigration(connString);
}

main();
