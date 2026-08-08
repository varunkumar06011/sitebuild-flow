import { readFileSync } from "fs";

const env = readFileSync(".env", "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const baseUrl = process.env["SUPABASE_URL"];

if (!serviceKey || !baseUrl) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL in .env");
  process.exit(1);
}

async function createBucket(id) {
  const r = await fetch(baseUrl + "/storage/v1/bucket", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id, name: id, public: false }),
  });
  const t = await r.text();
  console.log(id + ": " + r.status + " " + t.substring(0, 100));
}

async function main() {
  await createBucket("documents");
  await createBucket("photos");
}

main();
