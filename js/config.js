// Public Supabase settings. The anon key is SAFE to be public: it can only do
// what the database Row Level Security allows (see SETUP_GUIDE.md).
// NEVER put the "service_role" key in this file or anywhere in this site.
const SUPABASE_URL = "https://psbslduycrftfdkajqut.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzYnNsZHV5Y3JmdGZka2FqcXV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3ODAwMjgsImV4cCI6MjEwMzM1NjAyOH0.ytmnZw0ELYNGzpzxATqxjs3euMJ_delht2A4eoi4CKQ";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Team logos live in /logos/logo-01.svg ... logo-40.svg.
// To add more: drop logo-41.svg, logo-42.svg ... into /logos and raise this
// number (the database accepts logo-01 ... logo-99).
const LOGO_COUNT = 40;
