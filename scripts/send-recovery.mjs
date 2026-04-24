import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=')
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const url = env.VITE_SUPABASE_URL
const anon = env.VITE_SUPABASE_ANON_KEY
if (!url || !anon) { console.error('missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY'); process.exit(1) }

const email = process.argv[2]
const redirectTo =
  process.argv[3] ||
  process.env.RECOVERY_REDIRECT_TO ||
  'http://localhost:5173/reset-password'
if (!email) { console.error('usage: node scripts/send-recovery.mjs <email> [redirectTo]'); process.exit(1) }
console.log('redirectTo:', redirectTo)

const supa = createClient(url, anon)
const { data, error } = await supa.auth.resetPasswordForEmail(email, { redirectTo })
if (error) { console.error('error:', error.message, error); process.exit(1) }
console.log('ok:', JSON.stringify(data))
