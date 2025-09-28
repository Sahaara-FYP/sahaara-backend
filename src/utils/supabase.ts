import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  var supabase: SupabaseClient | undefined;
}

const supabase =
  global.supabase ||
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

if (process.env.NODE_ENV !== "production") {
  global.supabase = supabase;
}

export default supabase;
