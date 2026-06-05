// Gera a rodada b10 — vendas onde a soma do income (Sienge) diverge do valor_pro_soluto local.
//
// ver .claude/rules/rodadas-b.md + .claude/rules/sincronizacao-sienge.md
//
// READ-ONLY: lê o dry-run mais recente + DB. NÃO decide. NÃO escreve no banco.
// Invariante da spec: valor_pro_soluto é IMUTÁVEL quando ≠0 E a venda tem parcela 'pago'.
//   - sem parcela paga -> auto-corrigível (pode usar valor do Sienge)
//   - com parcela paga -> escala negócio (gestora decide; no máx. refaz snapshot de fator)
//
// Uso: node scripts/gerar-rodada-b10-prosoluto.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || fromFile('SUPABASE_SERVICE_ROLE_KEY') ||
            process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
if (!URL || !KEY) { console.error('Faltam credenciais Supabase no .env'); process.exit(1) }
const supabase = createClient(URL, KEY)

const reportFile = readdirSync('docs').filter((f) => /^reconciliacao-geral-.*-dryrun\.json$/.test(f)).sort().pop()
if (!reportFile) { console.error('Nenhum dry-run encontrado'); process.exit(1) }
const report = JSON.parse(readFileSync(`docs/${reportFile}`, 'utf8'))
console.log(`Lendo: docs/${reportFile}`)

// Casos pro_soluto: motivo "soma income (X) != pro_soluto (Y)"
const casosRaw = (report.revisao_humana || [])
  .filter((c) => /soma income/i.test(c.motivo || ''))
  .map((c) => {
    const m = (c.motivo || '').match(/soma income \(([\d.]+)\)\s*!=\s*pro_soluto \(([\d.]+)\)/i)
    return { ...c, soma_income: m ? Number(m[1]) : null, pro_soluto_motivo: m ? Number(m[2]) : null }
  })
console.log(`Casos pro_soluto: ${casosRaw.length}`)

const vendaIds = [...new Set(casosRaw.map((c) => c.venda_id))]
const { data: vendas } = await supabase.from('vendas').select('*').in('id', vendaIds)
const cliIds = [...new Set((vendas || []).map((v) => v.cliente_id).filter(Boolean))]
const corIds = [...new Set((vendas || []).map((v) => v.corretor_id).filter(Boolean))]
const { data: clientes } = cliIds.length ? await supabase.from('clientes').select('id, nome_completo, nome').in('id', cliIds) : { data: [] }
const { data: corretores } = corIds.length ? await supabase.from('usuarios').select('id, nome, nome_fantasia, telefone, celular').in('id', corIds) : { data: [] }

// pags paginado + ordenado (contar parcelas pagas por venda)
let pags = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from('pagamentos_prosoluto').select('venda_id, status')
    .in('venda_id', vendaIds).order('id', { ascending: true }).range(from, from + 999)
  if (error) throw error
  pags = pags.concat(data || [])
  if (!data || data.length < 1000) break
}

const vById = new Map((vendas || []).map((v) => [v.id, v]))
const cById = new Map((clientes || []).map((c) => [c.id, c]))
const coById = new Map((corretores || []).map((c) => [c.id, c]))
const pagosPorVenda = new Map()
for (const p of pags) if (p.status === 'pago') pagosPorVenda.set(p.venda_id, (pagosPorVenda.get(p.venda_id) || 0) + 1)

const nomeCli = (v) => cById.get(v?.cliente_id)?.nome_completo || cById.get(v?.cliente_id)?.nome || '(sem cliente)'
const nomeCor = (v) => coById.get(v?.corretor_id)?.nome || coById.get(v?.corretor_id)?.nome_fantasia || '(sem corretor)'
const telCor = (v) => coById.get(v?.corretor_id)?.telefone || coById.get(v?.corretor_id)?.celular || ''
const brl = (n) => 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const casos = casosRaw.map((c) => {
  const v = vById.get(c.venda_id)
  const proLocal = Number(v?.valor_pro_soluto) || c.pro_soluto_motivo || 0
  const income = c.soma_income || 0
  const diff = income - proLocal
  const pctDiff = proLocal > 0 ? (diff / proLocal) * 100 : null
  const nPagas = pagosPorVenda.get(c.venda_id) || 0
  const fatorAtual = Number(v?.fator_comissao) || null
  // fator é inversamente proporcional ao pro_soluto: novo_fator ≈ fator × (pro_local / income)
  const fatorSeCorrigir = (fatorAtual && income > 0) ? fatorAtual * (proLocal / income) : null
  const autoCorrigivel = nPagas === 0 // spec: pro_soluto imutável se tem parcela paga
  return {
    grupo: autoCorrigivel ? 'A' : 'B',
    venda_id: c.venda_id,
    sienge_contract_id: v?.sienge_contract_id ?? null,
    numero_contrato: c.contrato ?? v?.numero_contrato ?? null,
    unidade: c.unidade ?? v?.unidade ?? null,
    cliente: nomeCli(v), corretor: nomeCor(v), corretor_telefone: telCor(v),
    valor_venda: v?.valor_venda ?? null,
    pro_soluto_local: Number(proLocal.toFixed(2)),
    soma_income_sienge: Number(income.toFixed(2)),
    diferenca: Number(diff.toFixed(2)),
    pct_diferenca: pctDiff != null ? Number(pctDiff.toFixed(1)) : null,
    parcelas_pagas: nPagas,
    fator_comissao_atual: fatorAtual,
    fator_comissao_se_corrigir: fatorSeCorrigir != null ? Number(fatorSeCorrigir.toFixed(6)) : null,
    auto_corrigivel: autoCorrigivel,
    motivo: autoCorrigivel
      ? 'Sem parcela paga → pro_soluto pode ser corrigido pro valor do Sienge (auto).'
      : `${nPagas} parcela(s) paga(s) → pro_soluto IMUTÁVEL pela spec. Decisão de negócio.`,
    acao_sugerida: null,
    opcoes: [
      { id: '1', label: 'Manter pro_soluto local', efeito: 'nenhuma alteração' },
      { id: '2', label: 'Usar valor do Sienge', efeito: autoCorrigivel ? 'PATCH valor_pro_soluto + recalcula fator' : 'BLOQUEADO (tem paga) → só com decisão de negócio explícita' },
      { id: '3', label: 'Investigar', efeito: 'aguardar análise caso a caso' },
    ],
  }
}).sort((a, b) => (a.grupo === b.grupo ? Math.abs(b.diferenca) - Math.abs(a.diferenca) : a.grupo.localeCompare(b.grupo)))

const out = {
  meta: {
    geradoEm: new Date().toISOString(),
    spec_ref: '.claude/rules/rodadas-b.md',
    fonte: `docs/${reportFile}`,
    total: casos.length,
    regra: 'soma income (Sienge) ≠ valor_pro_soluto (local). pro_soluto imutável se há parcela paga (spec). Script NÃO decide.',
  },
  resumo: {
    auto_corrigiveis_A: casos.filter((c) => c.grupo === 'A').length,
    escala_negocio_B: casos.filter((c) => c.grupo === 'B').length,
    maior_diferenca: casos.reduce((m, c) => Math.max(m, Math.abs(c.diferenca)), 0),
  },
  casos,
}
mkdirSync('docs/rodadas/b10', { recursive: true })
writeFileSync('docs/rodadas/b10/b10-prosoluto-divergente.json', JSON.stringify(out, null, 2))

const grupoMd = (g, titulo, intro) => {
  const cs = casos.filter((c) => c.grupo === g)
  if (!cs.length) return ''
  return `\n## Grupo ${g} — ${titulo}\n\n${intro}\n\n` + cs.map((c, i) =>
    `### ${i + 1}. Contrato ${c.numero_contrato} · Unidade ${c.unidade}\n` +
    `- Cliente: **${c.cliente}** · Corretor: **${c.corretor}**${c.corretor_telefone ? ' (' + c.corretor_telefone + ')' : ''}\n` +
    `- pro_soluto local: **${brl(c.pro_soluto_local)}** · soma income Sienge: **${brl(c.soma_income_sienge)}** · ` +
    `diferença: **${brl(c.diferenca)}** (${c.pct_diferenca}%)\n` +
    `- Parcelas pagas: **${c.parcelas_pagas}**${c.fator_comissao_se_corrigir ? ` · fator ${c.fator_comissao_atual} → ${c.fator_comissao_se_corrigir} se corrigir` : ''}\n` +
    `- **Decisão:** ${c.opcoes.map((o) => `(${o.id}) ${o.label}`).join(' · ')}\n`).join('\n')
}

const md = `# Rodada b10 — pro_soluto local ≠ Sienge (${new Date().toISOString().slice(0, 10)})

Gerado de \`docs/${reportFile}\`. **${casos.length} vendas** onde a soma do income do Sienge diverge do
\`valor_pro_soluto\` gravado no banco. Isso afeta o **fator de comissão** (fator = comissão / pro_soluto).

> Regra: se a venda **já tem parcela paga**, o \`pro_soluto\` é **imutável** (mexer recalcularia comissão
> de histórico financeiro). Esses casos viram **decisão de negócio** (Grupo B). Só os sem parcela paga
> (Grupo A) podem ser auto-corrigidos pro valor do Sienge.
${grupoMd('A', 'Auto-corrigíveis (sem parcela paga)', 'Podem ser alinhados ao Sienge sem risco financeiro.')}
${grupoMd('B', 'Escala negócio (tem parcela paga → pro_soluto imutável)', 'Mexer afeta comissão de histórico. Decisão sua: manter, ou autorizar correção excepcional.')}

## O que fazer agora

Responda por caso (ex.: "Grupo B, contrato 411 → opção 1"). O operador transcreve em
\`docs/rodadas/b10/b10-respostas.json\` e roda \`aplicar-rodada-b.mjs --rodada b10\`.
`
writeFileSync('docs/rodadas/b10/b10-texto-para-usuaria.md', md)

console.log(`\nGerado:`)
console.log(`  docs/rodadas/b10/b10-prosoluto-divergente.json (${casos.length} casos)`)
console.log(`  docs/rodadas/b10/b10-texto-para-usuaria.md`)
console.log(`\nResumo:`, JSON.stringify(out.resumo))
