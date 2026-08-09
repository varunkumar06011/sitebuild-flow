import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env["SUPABASE_URL"] as string;
const supabaseServiceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] as string;

// Supabase client using the service-role key for privileged server-side queries.
export const supabaseServer = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
