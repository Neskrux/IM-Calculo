import { readFileSync, writeFileSync } from 'node:fs'
const src = 'C:/Users/im jonas/.claude/projects/c--Users-im-jonas-trabalho-projetos-IM-Calculo/471e5e6d-e632-4d34-8c35-0252e1eaeec2/tool-results/mcp-supabase-execute_sql-1777047850026.txt'
const txt = readFileSync(src, 'utf8')
console.log('len', txt.length)
const unesc = txt.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
const m = unesc.match(/<untrusted-data-[^>]+>\s*(\[[\s\S]*?\])\s*<\/untrusted-data/)
if (!m) { console.error('nao achou'); process.exit(1) }
writeFileSync('docs/b6-universo-local.json', m[1])
const arr = JSON.parse(m[1])
console.log('rows', arr.length, 'primeira', JSON.stringify(arr[0]))
