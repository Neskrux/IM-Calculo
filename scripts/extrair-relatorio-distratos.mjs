// Relatorio de DISTRATOS — a foto de tudo que foi cancelado, e do que sobrou de real.
//
// Por que existe: distrato e o evento que mais suja numero neste sistema. Ao
// distratar, o Sienge da baixa em TODAS as parcelas do contrato de uma vez —
// inclusive as que so venceriam anos depois — e isso vira comissao que nunca
// existiu (caso 1002 D, 2026-08-25: R$ 12.868,71 de fatia fantasma em 3 dias).
// Quando alguem perguntar "o que aconteceu com esse contrato", a resposta tem
// que sair daqui, nao de uma investigacao do zero.
//
// SO LE. Emite JSON que o monta-excel-distratos.py transforma em planilha.
//
// Regras respeitadas:
//   - pago REAL de uma distratada = parcela com VENCIMENTO ate a data do distrato
//     (regua canonica ehBaixaFalsaDeDistrato). Usar data_pagamento como regua
//     FALHA: a baixa em massa reescreve a data das que ja estavam pagas.
//   - comissao sempre das linhas de pagamentos_prosoluto (comissao-corretor.md);
//     `comissao_gerada` e o TOTAL da parcela, a fatia do corretor sai da proporcao
//     pct_cargo/pct_total (fator-comissao.md)
//   - leitura paginada (leitura-de-listas-e-refetch.md)
//
// Uso: node scripts/extrair-relatorio-distratos.mjs [saida.json]

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { ehBaixaFalsaDeDistrato } from '../src/utils/comissaoCalculator.js'

// Credencial: variavel de ambiente primeiro (e como o cron roda), .env como
// conveniencia local. Sem o arquivo nao e erro — so nao ha o que ler dele.
const arquivoEnv = process.env.ENV_PATH || '.env'
const env = existsSync(arquivoEnv)
  ? Object.fromEntries(
      readFileSync(arquivoEnv, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
    )
  : {}
const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('faltam VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (env ou .env)')
  process.exit(1)
}
const supabase = createClient(url, key)

async function paginado(build) {
  const PAGE = 1000
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < PAGE) break // termina por pagina incompleta, nunca por count
  }
  return out
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

async function main() {
  const saida = process.argv[2] || 'relatorio-distratos.json'

  // percentuais por tipo, da configuracao (nao hardcodar)
  const { data: cargos, error: eC } = await supabase
    .from('cargos_empreendimento').select('nome_cargo, percentual, tipo_corretor')
  if (eC) throw new Error(eC.message)
  const pctPorTipo = {}
  for (const c of cargos) {
    const t = c.tipo_corretor
    pctPorTipo[t] = pctPorTipo[t] || { total: 0, corretor: 0 }
    pctPorTipo[t].total += Number(c.percentual)
    if (c.nome_cargo === 'Corretor') pctPorTipo[t].corretor = Number(c.percentual)
  }

  const vendas = await paginado((from, to) =>
    supabase.from('vendas')
      .select('id, unidade, nome_cliente, cliente_id, corretor_id, valor_venda, valor_pro_soluto, data_venda, data_distrato, situacao_contrato, tipo_corretor, sienge_contract_id, empreendimento_id')
      .eq('status', 'distrato')
      .or('excluido.is.null,excluido.eq.false')
      .order('id', { ascending: true }).range(from, to)
  )

  const [usuarios, clientes, emps] = await Promise.all([
    paginado((f, t) => supabase.from('usuarios').select('id, nome').order('id').range(f, t)),
    paginado((f, t) => supabase.from('clientes').select('id, nome_completo').order('id').range(f, t)),
    paginado((f, t) => supabase.from('empreendimentos').select('id, nome').order('id').range(f, t)),
  ])
  const nomeCorretor = new Map(usuarios.map((u) => [u.id, u.nome]))
  const nomeCliente = new Map(clientes.map((c) => [c.id, c.nome_completo]))
  const nomeEmp = new Map(emps.map((e) => [e.id, e.nome]))

  // TODAS as parcelas (inclusive canceladas): a cura vive nelas, e o relatorio
  // precisa mostrar quanto foi cancelado, nao so o que sobrou.
  const ids = vendas.map((v) => v.id)
  const pagamentos = []
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50)
    pagamentos.push(...(await paginado((from, to) =>
      supabase.from('pagamentos_prosoluto')
        .select('id, venda_id, tipo, numero_parcela, valor, status, data_prevista, data_pagamento, comissao_gerada, motivo_cancelamento_parcela')
        .in('venda_id', lote).order('numero_parcela').order('id').range(from, to)
    )))
  }
  const porVenda = new Map(ids.map((id) => [id, []]))
  for (const p of pagamentos) porVenda.get(p.venda_id)?.push(p)

  const linhas = vendas.map((v) => {
    const pags = porVenda.get(v.id) || []
    const pct = pctPorTipo[v.tipo_corretor || 'externo'] || pctPorTipo.externo
    const fatia = (c) => r2((Number(c) || 0) * pct.corretor / pct.total)

    // Regua canonica: paga com vencimento ate o distrato = dinheiro real do cliente.
    const pagasReais = pags.filter((p) => p.status === 'pago' && !ehBaixaFalsaDeDistrato(p, v))
    // Ainda marcada 'pago' com vencimento futuro = baixa-em-massa NAO curada (alerta).
    const falsasVivas = pags.filter((p) => ehBaixaFalsaDeDistrato(p, v))
    const curadas = pags.filter((p) => p.status === 'cancelado' && p.motivo_cancelamento_parcela === 'distrato')
    const canceladasOutro = pags.filter((p) => p.status === 'cancelado' && p.motivo_cancelamento_parcela !== 'distrato')
    const pendentes = pags.filter((p) => p.status === 'pendente')

    const com7Real = pagasReais.reduce((s, p) => s + (Number(p.comissao_gerada) || 0), 0)
    const com7Falsa = falsasVivas.reduce((s, p) => s + (Number(p.comissao_gerada) || 0), 0)
    const com7Curada = curadas.reduce((s, p) => s + (Number(p.comissao_gerada) || 0), 0)

    const datasPagas = pagasReais.map((p) => p.data_pagamento).filter(Boolean).sort()

    return {
      unidade: v.unidade || '—',
      empreendimento: nomeEmp.get(v.empreendimento_id) || '—',
      cliente: v.nome_cliente || nomeCliente.get(v.cliente_id) || '—',
      corretor: nomeCorretor.get(v.corretor_id) || '—',
      contrato: v.sienge_contract_id || '',
      tipo_corretor: v.tipo_corretor || 'externo',
      data_venda: v.data_venda || '',
      data_distrato: v.data_distrato || '',
      valor_venda: Number(v.valor_venda) || 0,
      valor_pro_soluto: Number(v.valor_pro_soluto) || 0,
      // o que o cliente realmente pagou antes de cancelar
      parcelas_pagas_reais: pagasReais.length,
      valor_pago_real: r2(pagasReais.reduce((s, p) => s + (Number(p.valor) || 0), 0)),
      comissao_total_real: r2(com7Real),
      fatia_corretor_real: fatia(com7Real),
      primeiro_pagamento: datasPagas[0] || '',
      ultimo_pagamento: datasPagas[datasPagas.length - 1] || '',
      // a baixa-em-massa: quanto ja foi limpo, e quanto ainda esta sujo
      parcelas_curadas: curadas.length,
      comissao_falsa_removida: r2(com7Curada),
      parcelas_falsas_vivas: falsasVivas.length,
      comissao_falsa_viva: r2(com7Falsa),
      // resto
      parcelas_pendentes: pendentes.length,
      parcelas_canceladas_outro_motivo: canceladasOutro.length,
      situacao_sienge: v.situacao_contrato || '',
      pendencia: falsasVivas.length > 0
        ? `${falsasVivas.length} baixas de distrato ainda marcadas como pagas`
        : (pendentes.length > 0 ? `${pendentes.length} parcelas ainda pendentes (deveriam estar canceladas)` : ''),
    }
  }).sort((a, b) => String(b.data_distrato).localeCompare(String(a.data_distrato)))

  const soma = (k) => r2(linhas.reduce((s, l) => s + (l[k] || 0), 0))
  const resultado = {
    meta: {
      geradoEm: new Date().toISOString(),
      script: 'scripts/extrair-relatorio-distratos.mjs',
      spec_ref: 'docs/specs/2026-08-28-spec-regua-unica-telas-distrato.md',
      regua: 'pago real = parcela com VENCIMENTO ate a data do distrato (ehBaixaFalsaDeDistrato)',
      pctPorTipo,
    },
    totais: {
      distratos: linhas.length,
      corretores_afetados: new Set(linhas.map((l) => l.corretor)).size,
      vgv_distratado: soma('valor_venda'),
      valor_pago_real: soma('valor_pago_real'),
      comissao_total_real: soma('comissao_total_real'),
      fatia_corretor_real: soma('fatia_corretor_real'),
      parcelas_curadas: linhas.reduce((s, l) => s + l.parcelas_curadas, 0),
      comissao_falsa_removida: soma('comissao_falsa_removida'),
      parcelas_falsas_vivas: linhas.reduce((s, l) => s + l.parcelas_falsas_vivas, 0),
      comissao_falsa_viva: soma('comissao_falsa_viva'),
      com_pendencia: linhas.filter((l) => l.pendencia).length,
    },
    distratos: linhas,
  }

  writeFileSync(saida, JSON.stringify(resultado, null, 2))
  const t = resultado.totais
  console.log(`${saida}: ${t.distratos} distratos | VGV R$ ${t.vgv_distratado.toLocaleString('pt-BR')} | ` +
    `pago real R$ ${t.valor_pago_real.toLocaleString('pt-BR')} | fatia corretor R$ ${t.fatia_corretor_real.toLocaleString('pt-BR')}`)
  console.log(`  cura: ${t.parcelas_curadas} parcelas canceladas (R$ ${t.comissao_falsa_removida.toLocaleString('pt-BR')} de comissao falsa removida)`)
  if (t.parcelas_falsas_vivas > 0) {
    console.log(`  ⚠️  ${t.parcelas_falsas_vivas} baixas de distrato AINDA marcadas como pagas ` +
      `(R$ ${t.comissao_falsa_viva.toLocaleString('pt-BR')}) — rode scripts/curar-distrato-apply.mjs --apply`)
  } else {
    console.log('  ✓ nenhuma baixa-em-massa pendente de cura')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
