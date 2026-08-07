const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZibnFsc21yYWl3Y3Fuc2VubGVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTk5Njg0MSwiZXhwIjoyMTAxNTcyODQxfQ.SFkTmdlQkg1HpP1WfYM7AdJqvNltXTFG83nPU1OKCmM";
const baseUrl = "https://vbnqlsmraiwcqnsenlej.supabase.co";

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
