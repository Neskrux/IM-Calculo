import { readFileSync, writeFileSync } from 'node:fs'
const src = 'C:/Users/im jonas/.claude/projects/c--Users-im-jonas-trabalho-projetos-IM-Calculo/471e5e6d-e632-4d34-8c35-0252e1eaeec2/tool-results/mcp-supabase-execute_sql-1777042229869.txt'
const txt = readFileSync(src, 'utf8')
console.log('len', txt.length, 'hasTag', txt.includes('untrusted-data'))
const iOpen = txt.indexOf('untrusted-data')
console.log('snippet around open:', JSON.stringify(txt.slice(iOpen, iOpen+200)))
const iClose = txt.lastIndexOf('</untrusted-data')
console.log('snippet around close:', JSON.stringify(txt.slice(iClose-100, iClose+50)))
// file is JSON-string-escaped: real content uses \n and \" literals.
// parse the whole text as a JSON string, then extract array by boundaries.
const decoded = JSON.parse('"' + txt.replace(/\\"/g,'\\"').replace(/"/g,'\\"').replace(/\\\\"/g,'\\"') + '"')
// simpler: replace \n and \" manually
const unesc = txt.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
const m = unesc.match(/<untrusted-data-[^>]+>\s*(\[[\s\S]*?\])\s*<\/untrusted-data/)
if (!m) { console.error('nao achou apos unescape'); process.exit(1) }
writeFileSync('docs/b5-colididos.json', m[1])
const arr = JSON.parse(m[1])
console.log('rows', arr.length, 'primeira', JSON.stringify(arr[0]))
