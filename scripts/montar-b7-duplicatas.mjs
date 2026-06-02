// Monta rodada b7 — vendas FIGUEIRA com numero_parcela duplicado em
// pagamentos_prosoluto (par cancelado + ativo). Origem: varredura de
// 2026-05-13 (docs/varredura-pagamentos-bagunca-2026-05-13.json), 11 vendas
// score 2 com dup>0.
//
// READ-ONLY: nao altera banco. Gera apenas docs/b7-*.json + docs/b7-*.md.
//
// Spec:  .claude/rules/rodadas-b.md, .claude/rules/sincronizacao-sienge.md

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=')
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)
const supa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const VARREDURA = JSON.parse(readFileSync('docs/varredura-pagamentos-bagunca-2026-05-13.json', 'utf8'))
const dups = VARREDURA.vendas.filter((v) => v.sintomas.numero_parcela_duplicado > 0)
console.log(`Vendas com duplicata: ${dups.length}`)

const dataEhMesmaSerieGerador = (psNum) => {
  // Heuristica: se as duplicatas tem mesma data_prevista mas status diferentes,
  // foi regeneracao do mesmo slot logico. Se data_prevista difere, foi regeneracao
  // de bloco diferente do cronograma.
  const datas = new Set(psNum.map((p) => p.data_prevista).filter(Boolean))
  return datas.size === 1
}

const casos = []

for (const v of dups) {
  // puxar venda primeiro pra ter cliente_id/corretor_id corretos
  const { data: venda } = await supa.from('vendas').select('*').eq('id', v.venda_id).single()
  const [{ data: cliente }, { data: corretor }, { data: pagamentos }] = await Promise.all([
    venda?.cliente_id
      ? supa.from('clientes').select('id, nome_completo, cpf, telefone').eq('id', venda.cliente_id).maybeSingle()
      : Promise.resolve({ data: null }),
    venda?.corretor_id
      ? supa.from('corretores').select('*').eq('id', venda.corretor_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supa
      .from('pagamentos_prosoluto')
      .select('id, numero_parcela, tipo, valor, data_prevista, data_pagamento, status, comissao_gerada')
      .eq('venda_id', v.venda_id)
      .order('numero_parcela', { ascending: true, nullsFirst: true })
      .order('data_prevista', { ascending: true }),
  ])

  // agrupar por (tipo, numero_parcela)
  const grupos = new Map()
  for (const p of pagamentos || []) {
    if (p.numero_parcela == null) continue
    const k = `${p.tipo}__${p.numero_parcela}`
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k).push(p)
  }

  const pares = []
  for (const [k, arr] of grupos.entries()) {
    if (arr.length <= 1) continue
    const tem_cancelado = arr.some((x) => x.status === 'cancelado')
    const tem_ativo = arr.some((x) => x.status !== 'cancelado')
    if (!tem_cancelado || !tem_ativo) continue
    pares.push({
      grupo_key: k,
      linhas: arr.map((p) => ({
        id: p.id,
        numero_parcela: p.numero_parcela,
        tipo: p.tipo,
        valor: p.valor,
        data_prevista: p.data_prevista,
        data_pagamento: p.data_pagamento,
        status: p.status,
        comissao_gerada: p.comissao_gerada,
      })),
      mesma_data_prevista: dataEhMesmaSerieGerador(arr),
      tem_pago: arr.some((x) => x.status === 'pago'),
    })
  }

  const algumPago = pares.some((p) => p.tem_pago)
  const valorTotalDuplicado = pares.reduce(
    (s, p) => s + p.linhas.filter((l) => l.status !== 'cancelado').reduce((ss, l) => ss + Number(l.valor || 0), 0),
    0,
  )

  casos.push({
    venda_id: v.venda_id,
    sienge_contract_id: venda?.sienge_contract_id || null,
    numero_contrato: venda?.numero_contrato || null,
    unidade: venda?.unidade || null,
    cliente: cliente?.nome_completo || venda?.nome_cliente || null,
    cliente_cpf: cliente?.cpf || null,
    cliente_telefone: cliente?.telefone || null,
    cliente_suspeito_ser_corretor:
      !!cliente?.nome_completo && (corretor?.nome_completo === cliente?.nome_completo || corretor?.nome === cliente?.nome_completo),
    corretor: corretor?.nome_completo || corretor?.nome || null,
    corretor_telefone: corretor?.telefone || null,
    valor_venda: venda?.valor_venda || null,
    valor_pro_soluto: venda?.valor_pro_soluto || null,
    parcelou_entrada: venda?.parcelou_entrada,
    qtd_parcelas_entrada: venda?.qtd_parcelas_entrada,
    valor_parcela_entrada: venda?.valor_parcela_entrada,
    contagem: {
      total_pagamentos: pagamentos?.length || 0,
      pagos: (pagamentos || []).filter((p) => p.status === 'pago').length,
      pendentes: (pagamentos || []).filter((p) => p.status === 'pendente').length,
      cancelados: (pagamentos || []).filter((p) => p.status === 'cancelado').length,
      pares_duplicados: pares.length,
      total_pago_em_duplicatas: algumPago ? pares.filter((p) => p.tem_pago).length : 0,
    },
    risco: algumPago ? 'alto' : 'medio',
    motivo: algumPago
      ? 'Tem par com linha PAGA — qualquer alteracao em pago precisa decisao explicita (spec 017/020).'
      : 'Apenas pares cancelado+pendente — pode-se cancelar consistentemente sem tocar em pago.',
    acao_sugerida: algumPago
      ? 'aguardar_reconciliacao_sienge_bulkdata'
      : 'manter_ativo_cancelar_redundante',
    opcoes: algumPago
      ? [
          { id: '1', label: 'Aguardar re-baixa Sienge', efeito: 'Re-baixa /bulk-data/v1/income, popula sienge_installment_id, re-amarra parcelas, depois cancela duplicatas redundantes' },
          { id: '2', label: 'Investigar caso a caso', efeito: 'Olha cada duplicata pago+cancelado e decide individualmente — mais lento' },
        ]
      : [
          { id: '1', label: 'Cancelar redundante (Recommended)', efeito: 'Mantem a linha ativa, marca a redundante como cancelado em massa apos confirmacao' },
          { id: '2', label: 'Investigar caso a caso', efeito: 'Olha cada par antes de cancelar' },
        ],
    pares,
  })
}

casos.sort((a, b) => {
  if (a.risco !== b.risco) return a.risco === 'alto' ? -1 : 1
  return (b.contagem.pares_duplicados || 0) - (a.contagem.pares_duplicados || 0)
})

const out = {
  meta: {
    geradoEm: new Date().toISOString(),
    total: casos.length,
    spec_ref: '.claude/rules/sincronizacao-sienge.md, .claude/rules/rodadas-b.md',
    regra:
      'Vendas com numero_parcela duplicado (par cancelado+ativo dentro da mesma sequencia logica). ' +
      'Sintoma do backfill antigo que fez match por (venda_id, numero_parcela) sem reconciliar com installmentId Sienge. ' +
      'Pre-requisito de aplicacao: migration 023 + re-baixa /bulk-data/v1/income (hoje 2026-05-13 bati quota — retry-after ~8000s).',
  },
  casos,
}

writeFileSync('docs/b7-duplicatas-numero-parcela.json', JSON.stringify(out, null, 2))
console.log(`Salvo: docs/b7-duplicatas-numero-parcela.json (${casos.length} casos)`)

// Markdown pra gestora
const linhas = [
  '# Rodada B.7 — Parcelas duplicadas no banco (numero_parcela repetido)',
  '',
  `Encontrei **${casos.length} vendas** com pares de parcelas duplicadas no nosso banco — duas linhas com o mesmo \`numero_parcela\` e mesmo tipo, sendo uma cancelada e outra ativa. Isso veio do backfill antigo de pagamentos, que não amarrava as parcelas pelo id real do Sienge.`,
  '',
  '**Importante:** o Sienge está correto. A bagunça é só no nosso banco. Vou corrigir respeitando o Sienge como fonte da verdade.',
  '',
  '---',
  '',
  '## Grupo 1 — Casos com par PAGO (risco alto) — aguardar re-baixa Sienge',
  '',
  `${casos.filter((c) => c.risco === 'alto').length} vendas tem pelo menos um par onde uma das linhas duplicadas está **paga**. Nesses casos, não vou cancelar nada antes de confirmar com o Sienge qual linha realmente recebeu pagamento.`,
  '',
]
for (const c of casos.filter((c) => c.risco === 'alto')) {
  linhas.push(`### Contrato ${c.numero_contrato || '-'} — Sienge ${c.sienge_contract_id || '-'} — Unidade ${c.unidade || '-'}`)
  linhas.push(
    `- **Cliente:** ${c.cliente || '-'}${c.cliente_cpf ? ` — CPF ${c.cliente_cpf}` : ''}${c.cliente_telefone ? ` — Tel ${c.cliente_telefone}` : ''}`,
  )
  linhas.push(`- **Corretor:** ${c.corretor || '-'}${c.corretor_telefone ? ` — ${c.corretor_telefone}` : ''}`)
  linhas.push(`- **Valor venda:** R$ ${Number(c.valor_venda || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
  linhas.push(
    `- **Pagamentos:** ${c.contagem.pagos} pagos, ${c.contagem.pendentes} pendentes, ${c.contagem.cancelados} cancelados — ${c.contagem.pares_duplicados} pares duplicados, ${c.contagem.total_pago_em_duplicatas} com linha paga`,
  )
  linhas.push('- **Pares duplicados:**')
  for (const par of c.pares) {
    const sumario = par.linhas
      .map((l) => `${l.status}(R$ ${l.valor}, prev ${l.data_prevista || '-'}, pago ${l.data_pagamento || '-'})`)
      .join(' + ')
    linhas.push(`  - parc ${par.linhas[0]?.numero_parcela} / ${par.linhas[0]?.tipo}: ${sumario}`)
  }
  linhas.push('- **Ação proposta:** aguardar re-baixa de `/bulk-data/v1/income` (quota Sienge esgotou hoje 2026-05-13) → popular `sienge_installment_id` (migration 023) → re-amarrar parcelas pelo id real → cancelar a duplicata redundante.')
  linhas.push('')
}
linhas.push('---')
linhas.push('')
linhas.push('## Grupo 2 — Casos sem par pago (risco médio) — podem ser cancelados em massa')
linhas.push('')
linhas.push(
  `${casos.filter((c) => c.risco === 'medio').length} vendas têm duplicatas apenas em \`pendente + cancelado\`. Posso manter a linha ativa e marcar a redundante como cancelada com segurança — não afeta nenhum dado financeiro confirmado.`,
)
linhas.push('')
for (const c of casos.filter((c) => c.risco === 'medio')) {
  linhas.push(`### Contrato ${c.numero_contrato || '-'} — Sienge ${c.sienge_contract_id || '-'} — Unidade ${c.unidade || '-'}`)
  linhas.push(
    `- **Cliente:** ${c.cliente || '-'}${c.cliente_cpf ? ` — CPF ${c.cliente_cpf}` : ''}${c.cliente_telefone ? ` — Tel ${c.cliente_telefone}` : ''}`,
  )
  linhas.push(`- **Corretor:** ${c.corretor || '-'}${c.corretor_telefone ? ` — ${c.corretor_telefone}` : ''}`)
  linhas.push(`- **Pares duplicados:** ${c.contagem.pares_duplicados}`)
  linhas.push('')
}
linhas.push('---')
linhas.push('')
linhas.push('## O que fazer agora')
linhas.push('')
linhas.push('**Eu não vou alterar nada no banco ainda.** Esse documento e o JSON `docs/b7-duplicatas-numero-parcela.json` são pra você revisar e me dar o sinal verde caso a caso.')
linhas.push('')
linhas.push('**Resposta esperada por linha:**')
linhas.push('- Para Grupo 1: "ok, aguarda re-baixa Sienge" ou "investiga o contrato X primeiro"')
linhas.push('- Para Grupo 2: "ok, cancela as redundantes" ou "deixa como está"')
linhas.push('')
linhas.push('Quando você responder, transcrevo em `docs/b7-respostas.json` e rodo a aplicação respeitando as regras de [.claude/rules/sincronizacao-sienge.md](../.claude/rules/sincronizacao-sienge.md).')

writeFileSync('docs/b7-texto-para-usuaria.md', linhas.join('\n'))
console.log('Salvo: docs/b7-texto-para-usuaria.md')
