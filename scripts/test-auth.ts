import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function testAuth() {
  console.log("Email:", process.env.ADMIN_EMAIL);
  const { data, error } = await db.auth.signInWithPassword({
    email: process.env.ADMIN_EMAIL!,
    password: process.env.ADMIN_PASSWORD!,
  });
  console.log("Error:", error);
  console.log("Data:", data.user ? "Success" : "No user");
}
testAuth();
