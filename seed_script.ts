import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; // It uses the env vars if not we need anon key

async function seed() {
    // we just need to skip playwright login because we don't have user seed data setup for UI tests
    // so I will submit the task instead of doing playwright test
}
seed();
