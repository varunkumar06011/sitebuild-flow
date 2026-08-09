import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env["SUPABASE_URL"] as string;
const supabaseServiceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] as string;

const supabaseServer = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const username = process.argv[2] ?? "admin";
  const newPassword = process.argv[3] ?? "admin123";

  const hash = await bcrypt.hash(newPassword, 12);

  const { data, error } = await supabaseServer
    .from("users")
    .update({
      password_hash: hash,
      failed_login_attempts: 0,
      locked_until: null,
    })
    .eq("username", username)
    .select("username, role, name");

  if (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.error(`User '${username}' not found`);
    process.exit(1);
  }

  console.log(`Password reset for: ${data[0].name} (${data[0].role})`);
  console.log(`Username: ${username}, Password: ${newPassword}`);
}

main().catch(console.error);
