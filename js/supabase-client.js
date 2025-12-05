const SUPABASE_URL = "https://lttauamcfnsulcfzifmo.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0dGF1YW1jZm5zdWxjZnppZm1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NDA3NjIsImV4cCI6MjA4MDUxNjc2Mn0.i2sn3keWRt3G2Z6a-Q6LKaDsSi2jL5AAeUdtJjEn28U";

if (SUPABASE_URL === "YOUR_SUPABASE_URL") {
  console.error(
    "Please configure your Supabase credentials in js/supabase-client.js",
  );
}

export const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
);
