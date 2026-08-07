import { readFileSync } from "fs";

// Load .env manually
const env = readFileSync(".env", "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

// Test the exact same flow the server function does
const supabaseUrl = process.env["SUPABASE_URL"];
const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const jwtSecret = process.env["APP_JWT_SECRET"];

console.log("=== Env check ===");
console.log("SUPABASE_URL:", supabaseUrl ? "OK" : "MISSING");
console.log("SUPABASE_SERVICE_ROLE_KEY:", supabaseKey ? "OK (" + supabaseKey.substring(0, 20) + "...)" : "MISSING");
console.log("APP_JWT_SECRET:", jwtSecret ? "OK" : "MISSING");

// Test admin login specifically
console.log("\n=== Testing admin login ===");
const bcrypt = await import("bcryptjs");
const jwt = await import("jsonwebtoken");

const res = await fetch(`${supabaseUrl}/rest/v1/users?select=id,username,password_hash,role,name,phone,failed_login_attempts,locked_until&username=eq.admin`, {
  headers: {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  },
});
const users = await res.json();
console.log("API status:", res.status);
console.log("Users found:", users.length);

if (users.length > 0) {
  const user = users[0];
  console.log("User:", user.username, user.role, user.name);
  console.log("Locked until:", user.locked_until ?? "not locked");
  console.log("Failed attempts:", user.failed_login_attempts);

  const match = await bcrypt.compare("admin123", user.password_hash);
  console.log("Password match (admin123):", match);

  if (match) {
  const token = jwt.default.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: "12h" });
  console.log("JWT token generated:", token.substring(0, 30) + "...");

  // Test session insert
  const tokenHash = await bcrypt.hash(token, 10);
  const sessionRes = await fetch(`${supabaseUrl}/rest/v1/sessions`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      revoked: false,
    }),
  });
  console.log("Session insert status:", sessionRes.status);
  if (sessionRes.ok) {
    console.log("Session created successfully!");
  } else {
    const errBody = await sessionRes.text();
    console.log("Session insert failed:", errBody);
  }
  }
}

// Also test supervisor
console.log("\n=== Testing supervisor login ===");
const res2 = await fetch(`${supabaseUrl}/rest/v1/users?select=id,username,password_hash,role,name&username=eq.supervisor`, {
  headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
});
const users2 = await res2.json();
if (users2.length > 0) {
  const match2 = await bcrypt.compare("site123", users2[0].password_hash);
  console.log("supervisor / site123 match:", match2);
}
