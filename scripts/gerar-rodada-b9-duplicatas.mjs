// Gera a rodada b9 — fila de revisão humana das parcelas órfãs (sem match no Sienge)
// e dos casos ambíguos detectados pelo reconciliador.
//
// ver .claude/rules/rodadas-b.md + .claude/rules/sincronizacao-sienge.md
//
// READ-ONLY: lê o dry-run mais recente (docs/reconciliacao-geral-*-dryrun.json) + DB
// pra enriquecer cada caso. NÃO decide (acao_sugerida: null). NÃO escreve no banco.
// Emite docs/rodadas/b9/b9-duplicatas-comissao.json + b9-texto-para-usuaria.md.
//
// Uso: node scripts/gerar-rodada-b9-duplicatas.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const fromFile = (k) => envFile.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()
const URL = process.env.VITE_SUPABASE_URL || fromFile('VITE_SUPABASE_URL')
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || fromFile('SUPABASE_SERVICE_ROLE_KEY') ||
            process.env.VITE_SUPABASE_ANON_KEY || fromFile('VITE_SUPABASE_ANON_KEY')
if (!URL || !KEY) { console.error('Faltam credenciais Supabase no .env'); process.exit(1) }
const supabase = createClient(URL, KEY)

// 1) Report dry-run mais recente
const reportFile = readdirSync('docs')
  .filter((f) => /^reconciliacao-geral-.*-dryrun\.json$/.test(f))
  .sort().pop()
if (!reportFile) { console.error('Nenhum docs/reconciliacao-geral-*-dryrun.json. Rode reconciliar-todas-vendas.mjs primeiro.'); process.exit(1) }
const report = JSON.parse(readFileSync(`docs/${reportFile}`, 'utf8'))
console.log(`Lendo: docs/${reportFile}`)

// 2) Coletar casos do report
//    a) processadas[].semMatch  -> parcelas órfãs (pago = delicado / pendente = baixo risco)
//    b) revisao_humana ambíguos -> linhas com mesmo (tipo,valor,data)
const orfasPorVenda = new Map() // venda_id -> [semMatch itens]
for (const p of report.processadas || []) {
  if ((p.semMatch || []).length) {
    orfasPorVenda.set(p.venda_id, { unidade: p.unidade, contrato: p.contrato, bill: p.bill, itens: p.semMatch })
  }
}
const ambiguos = (report.revisao_humana || []).filter((c) => /ambig|mesmo \(tipo/i.test(c.motivo || ''))

const vendaIds = [...new Set([...orfasPorVenda.keys(), ...ambiguos.map((a) => a.venda_id)])]
console.log(`Vendas com órfãs: ${orfasPorVenda.size} | ambíguos: ${ambiguos.length} | total vendas: ${vendaIds.length}`)

// 3) Enriquecer via DB (read-only)
const { data: vendas } = await supabase.from('vendas').select('*').in('id', vendaIds)
const cliIds = [...new Set((vendas || []).map((v) => v.cliente_id).filter(Boolean))]
const corIds = [...new Set((vendas || []).map((v) => v.corretor_id).filter(Boolean))]
const { data: clientes } = cliIds.length ? await supabase.from('clientes').select('*').in('id', cliIds) : { data: [] }
const { data: corretores } = corIds.length ? await supabase.from('usuarios').select('id, nome, nome_fantasia, telefone, celular').in('id', corIds) : { data: [] }
// pagina (Supabase corta em 1000 por default; 60 vendas × ~58 parcelas > 1000)
// .order('id') é OBRIGATÓRIO: sem ordem estável, .range() pula/duplica linhas entre páginas.
let pags = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from('pagamentos_prosoluto').select('*')
    .in('venda_id', vendaIds).order('id', { ascending: true }).range(from, from + 999)
  if (error) throw error
  pags = pags.concat(data || [])
  if (!data || data.length < 1000) break
}

const vById = new Map((vendas || []).map((v) => [v.id, v]))
const cById = new Map((clientes || []).map((c) => [c.id, c]))
const coById = new Map((corretores || []).map((c) => [c.id, c]))
const pagsByVenda = new Map()
for (const p of pags || []) { if (!pagsByVenda.has(p.venda_id)) pagsByVenda.set(p.venda_id, []); pagsByVenda.get(p.venda_id).push(p) }

const nomeCli = (v) => cById.get(v?.cliente_id)?.nome_completo || cById.get(v?.cliente_id)?.nome || '(sem cliente)'
const nomeCor = (v) => coById.get(v?.corretor_id)?.nome || coById.get(v?.corretor_id)?.nome_fantasia || '(sem corretor)'
const telCor = (v) => coById.get(v?.corretor_id)?.telefone || coById.get(v?.corretor_id)?.celular || ''
const brl = (n) => 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// 4) Montar casos
const casos = []
const idsOrfas = new Set()
for (const [vid, info] of orfasPorVenda) {
  for (const it of info.itens) idsOrfas.add(it.id)
}

// 4a) órfãs (pago + pendente)
for (const [vid, info] of orfasPorVenda) {
  const v = vById.get(vid)
  const linhasVenda = (pagsByVenda.get(vid) || [])
  const orfas = info.itens
  const orfasPagas = orfas.filter((o) => o.status === 'pago')
  const orfasPend = orfas.filter((o) => o.status === 'pendente')
  const comissaoOrfaPaga = linhasVenda
    .filter((l) => orfasPagas.some((o) => o.id === l.id))
    .reduce((a, l) => a + (Number(l.comissao_gerada) || 0), 0)
  const temPaga = orfasPagas.length > 0
  casos.push({
    grupo: temPaga ? 2 : 1,
    venda_id: vid,
    sienge_contract_id: v?.sienge_contract_id ?? null,
    numero_contrato: info.contrato ?? v?.numero_contrato ?? null,
    sienge_bill_id: info.bill ?? v?.sienge_receivable_bill_id ?? null,
    unidade: info.unidade ?? v?.unidade ?? null,
    cliente: nomeCli(v), cliente_id: v?.cliente_id ?? null,
    corretor: nomeCor(v), corretor_telefone: telCor(v),
    valor_venda: v?.valor_venda ?? null,
    valor_pro_soluto: v?.valor_pro_soluto ?? null,
    motivo: temPaga
      ? `${orfasPagas.length} parcela(s) PAGA(s) sem match no Sienge (provável fantasma do gerador antigo). Comissão envolvida: ${brl(comissaoOrfaPaga)}.`
      : `${orfasPend.length} parcela(s) PENDENTE(s) sem match no Sienge (provável fantasma; nenhum dinheiro movido).`,
    comissao_em_jogo: Number(comissaoOrfaPaga.toFixed(2)),
    acao_sugerida: null, // script NUNCA decide (rodadas-b.md)
    estado_atual: {
      linhas: orfas.map((o) => {
        const l = linhasVenda.find((x) => x.id === o.id) || {}
        return {
          id: o.id, tipo: o.tipo, numero_parcela: l.numero_parcela ?? null, status: o.status,
          valor: o.valor, comissao_gerada: l.comissao_gerada ?? null,
          data_prevista: o.data_prevista ?? l.data_prevista ?? null, data_pagamento: l.data_pagamento ?? null,
          tem_ancora: !!(l.sienge_installment_id),
          orfa: true,
        }
      }),
      total_linhas_ativas_venda: linhasVenda.filter((l) => l.status !== 'cancelado').length,
    },
    opcoes: temPaga
      ? [
          { id: '1', label: 'Confirmar fantasma — pode cancelar (NÃO houve repasse)', efeito: 'Excluir Baixa: status→pendente + data_pagamento=NULL, depois cancelado' },
          { id: '2', label: 'JÁ foi repassada ao corretor', efeito: 'manter linha; investigar discrepância Sienge×repasse' },
          { id: '3', label: 'Aguardar investigação', efeito: 'não mexer' },
        ]
      : [
          { id: '1', label: 'Confirmar fantasma — cancelar', efeito: 'status→cancelado' },
          { id: '2', label: 'É real (Sienge sob outro termo)', efeito: 'manter; re-ancorar manualmente' },
        ],
  })
}

// 4b) ambíguos
for (const a of ambiguos) {
  const v = vById.get(a.venda_id)
  const linhasVenda = (pagsByVenda.get(a.venda_id) || []).filter((l) => l.status !== 'cancelado')
  casos.push({
    grupo: 3,
    venda_id: a.venda_id,
    sienge_contract_id: v?.sienge_contract_id ?? null,
    numero_contrato: a.contrato ?? v?.numero_contrato ?? null,
    sienge_bill_id: v?.sienge_receivable_bill_id ?? null,
    unidade: a.unidade ?? v?.unidade ?? null,
    cliente: nomeCli(v), cliente_id: v?.cliente_id ?? null,
    corretor: nomeCor(v), corretor_telefone: telCor(v),
    valor_venda: v?.valor_venda ?? null,
    valor_pro_soluto: v?.valor_pro_soluto ?? null,
    motivo: a.motivo,
    acao_sugerida: null,
    estado_atual: {
      linhas: linhasVenda.map((l) => ({
        id: l.id, tipo: l.tipo, numero_parcela: l.numero_parcela ?? null, status: l.status,
        valor: l.valor, comissao_gerada: l.comissao_gerada ?? null,
        data_prevista: l.data_prevista ?? null, data_pagamento: l.data_pagamento ?? null,
        tem_ancora: !!(l.sienge_installment_id),
      })),
    },
    opcoes: [
      { id: '1', label: 'Indicar qual linha é a verdadeira', efeito: 'manter a indicada, cancelar a(s) outra(s)' },
      { id: '2', label: 'Aguardar investigação', efeito: 'não mexer' },
    ],
  })
}

casos.sort((a, b) => a.grupo - b.grupo)

// 5) JSON canônico
const out = {
  meta: {
    geradoEm: new Date().toISOString(),
    spec_ref: '.claude/rules/rodadas-b.md',
    fonte: `docs/${reportFile}`,
    total: casos.length,
    regra: 'Parcelas ativas sem match no Sienge (pago = exige confirmação de não-repasse antes de cancelar) e linhas ambíguas. Script NÃO decide.',
  },
  resumo: {
    grupo1_pendentes_orfas: casos.filter((c) => c.grupo === 1).length,
    grupo2_pagas_orfas: casos.filter((c) => c.grupo === 2).length,
    grupo3_ambiguos: casos.filter((c) => c.grupo === 3).length,
    comissao_paga_em_jogo: Number(casos.reduce((a, c) => a + (c.comissao_em_jogo || 0), 0).toFixed(2)),
  },
  casos,
}
mkdirSync('docs/rodadas/b9', { recursive: true })
writeFileSync('docs/rodadas/b9/b9-duplicatas-comissao.json', JSON.stringify(out, null, 2))

// 6) MD pra gestora
const linhasMd = (c) => c.estado_atual.linhas.map((l) =>
  `    - \`${l.tipo}${l.numero_parcela ? ' #' + l.numero_parcela : ''}\` · ${l.status} · ${brl(l.valor)}` +
  `${l.orfa ? ' · ⚠️ órfã (sem match Sienge)' : ''}${l.data_pagamento ? ' · pago em ' + l.data_pagamento : ''}`).join('\n')

const grupoMd = (n, titulo, intro) => {
  const cs = casos.filter((c) => c.grupo === n)
  if (!cs.length) return ''
  return `\n## Grupo ${n} — ${titulo}\n\n${intro}\n\n` + cs.map((c, i) =>
    `### ${i + 1}. Contrato ${c.numero_contrato} · Unidade ${c.unidade}\n` +
    `- Cliente: **${c.cliente}** · Corretor: **${c.corretor}**${c.corretor_telefone ? ' (' + c.corretor_telefone + ')' : ''}\n` +
    `- Valor da venda: ${brl(c.valor_venda)} · ${c.motivo}\n` +
    `- Linhas envolvidas:\n${linhasMd(c)}\n` +
    `- **Decisão:** ${c.opcoes.map((o) => `(${o.id}) ${o.label}`).join(' · ')}\n`).join('\n')
}

const md = `# Rodada b9 — parcelas órfãs e casos ambíguos (${new Date().toISOString().slice(0, 10)})

Gerado de \`docs/${reportFile}\` (reconciliação contra Sienge fresco). **${casos.length} casos.**
Comissão paga em jogo: **${brl(out.resumo.comissao_paga_em_jogo)}**.

> Contexto: o Sienge é a fonte da verdade. Estas parcelas estão no nosso banco mas **não têm
> correspondente no Sienge** — provavelmente fantasmas do gerador antigo. Antes de cancelar
> qualquer parcela **paga**, precisamos confirmar com você que ela **não foi repassada** ao corretor.
${grupoMd(1, 'Pendentes órfãs (baixo risco — nenhum dinheiro movido)', 'Parcelas pendentes sem match no Sienge. Se confirmadas fantasmas, cancelamos (reversível).')}
${grupoMd(2, 'Pagas órfãs (confirmar não-repasse)', 'Parcelas **pagas** sem match no Sienge. Some comissão dupla. Confirme se NÃO foram repassadas ao corretor antes de cancelarmos.')}
${grupoMd(3, 'Ambíguos (qual linha é a verdadeira?)', 'O banco tem parcelas duplicadas com mesmo tipo/valor/data. Indique qual manter.')}

## O que fazer agora

Responda por caso o número da opção (ex.: "Grupo 2, contrato 11 → opção 1"). O operador transcreve
em \`docs/rodadas/b9/b9-respostas.json\` e roda o script de aplicação (respeitando os triggers de pago).
`
writeFileSync('docs/rodadas/b9/b9-texto-para-usuaria.md', md)

console.log(`\nGerado:`)
console.log(`  docs/rodadas/b9/b9-duplicatas-comissao.json (${casos.length} casos)`)
console.log(`  docs/rodadas/b9/b9-texto-para-usuaria.md`)
console.log(`\nResumo:`, JSON.stringify(out.resumo))
