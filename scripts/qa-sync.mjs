// node scripts/qa-sync.mjs : signs up a throwaway account, round-trips a class and a snapshot through the same tables the app syncs to, then deletes the account
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => l.split('=')))
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
const email = `qa-mastery-book-${Date.now()}@example.com`, password = 'qa-' + Math.random().toString(36).slice(2) + 'X9!'
const ok = (label, r) => { if (r.error) { console.log('FAIL', label, r.error.message); process.exitCode = 1 } else console.log('ok  ', label) }
const up = await sb.auth.signUp({ email, password }); ok('sign up ' + email, up)
if (!up.data.session) ok('sign in', await sb.auth.signInWithPassword({ email, password }))
const id = crypto.randomUUID(), vid = crypto.randomUUID()
ok('upsert class', await sb.from('projects').upsert({ id, app: 'mastery-book', name: 'QA class', data: { project: { id, name: 'QA class', config: { method: 'decaying' } }, dataset: { students: [{ id: 's0abc123', name: '' }], assessments: [], scores: [], itemScores: [] } }, updated_at: new Date().toISOString() }))
ok('insert snapshot', await sb.from('project_versions').insert({ id: vid, project_id: id, label: 'Quarter 1', data: { id: vid, label: 'Quarter 1', date: '2026-10-31', rows: [{ sid: 's0abc123', letter: 'B', levels: {} }] } }))
const rows = await sb.from('projects').select('id,name,data').eq('app', 'mastery-book'); ok('read back', rows)
console.log(rows.data?.length === 1 && rows.data[0].data.project.config.method === 'decaying' && rows.data[0].data.dataset.students[0].name === '' ? 'ok   round trip matches' : 'FAIL round trip')
const vs = await sb.from('project_versions').select('id').in('project_id', [id]); console.log(vs.data?.length === 1 ? 'ok   snapshot round trip' : 'FAIL snapshot')
ok('delete account', await sb.rpc('delete_my_account'))
const after = await sb.auth.signInWithPassword({ email, password }); console.log(after.error ? 'ok   account gone (' + after.error.message + ')' : 'FAIL account still exists')
