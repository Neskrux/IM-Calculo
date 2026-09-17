// READ-ONLY. Verificação pós-apply do T7: roda os helpers do app contra produção,
// pelo mesmo caminho que o CorretorDashboard usa. Spec 2026-09-04.
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  coordenadoraDoUsuario, papeisDisponiveis, vendasDaCoordenacao, resumoCoordenacao,
} from '../src/utils/comissaoCalculator.js'

const env = Object.fromEntries(
  fs.readFileSync('C:/Users/Jonas/trabalho/projetos/IM-Calculo/.env', 'utf8')
    .split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] })
)
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const pageAll = async (build) => {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}
const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)

const { data: coordenadoras } = await sb.from('coordenadoras').select('*').eq('ativo', true)
const { data: cargos } = await sb.from('cargos_empreendimento')
  .select('empreendimento_id, nome_cargo, tipo_corretor, percentual')

const PESSOAS = [
  ['Matheus Pires', '9b1f5c90-defa-4b6c-b011-ffb496a14349'],
  ['Carolina (Carol)', '4c04b405-d75b-4638-9dab-c149e563bc0c'],
  ['Jessica', 'e94de4d7-1e73-478a-9a93-39132265ab7e'],
  ['CONTROLE NEGATIVO (corretor comum)', 'f55c86e8-5e10-4091-be1f-b0545b4b7418'],
]

for (const [nome, id] of PESSOAS) {
  const perfil = { id }
  const coord = coordenadoraDoUsuario(perfil, coordenadoras)
  console.log(`\n=== ${nome} ===`)
  console.log('  papeis:', papeisDisponiveis(perfil, coordenadoras).join(' + '))
  if (!coord) { console.log('  sem papel de coordenação (seletor NÃO aparece)'); continue }
  console.log(`  taxa vigente: ${coord.percentual_padrao}%`)

  const vendasRaw = await pageAll((from, to) => sb.from('vendas')
    .select('id, corretor_id, coordenadora_id, coordenadora_taxa, tipo_corretor, status, excluido')
    .eq('coordenadora_id', coord.id).order('id').range(from, to))
  const escopo = vendasDaCoordenacao(vendasRaw, coord)

  const pags = []
  for (let i = 0; i < escopo.length; i += 100) {
    const ids = escopo.slice(i, i + 100).map(v => v.id)
    pags.push(...await pageAll((from, to) => sb.from('pagamentos_prosoluto')
      .select('id, venda_id, valor, status, data_prevista, data_pagamento, comissao_gerada, percentual_comissao_total, fator_comissao_aplicado')
      .in('venda_id', ids).order('data_prevista').order('id').range(from, to)))
  }

  const r = resumoCoordenacao({ vendas: escopo, pagamentos: pags, coordenadora: coord, cargos, coordenadoras })
  console.log(`  escopo=${escopo.length} vendas · ${pags.length} parcelas · vazio=${r.vazio}`)
  console.log(`  fatia recebida=${fmt(r.fatiaPaga)} · a receber=${fmt(r.fatiaPendente)}`)
  if (r.vazio) console.log('  → painel mostra o estado vazio (nenhuma venda direcionada ainda)')
}
