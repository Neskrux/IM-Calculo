// Reconcilia a "inadimplência local" contra o Sienge — ZERO bulk extra.
// ver .claude/rules/sincronizacao-sienge.md
//
// Pergunta: dos 346 inadimplentes locais (status≠pago/cancelado, vencidos),
// quantos são inadimplência REAL (Sienge balanceAmount>0) e quantos são
// FALSO PENDENTE (Sienge balanceAmount≈0 = cliente já pagou, backfill não trouxe)?
//
// Fonte Sienge: docs/auditorias/fase0/income-D-raw-<hoje>.json
//   (sidecar gerado por scripts/medir-inadimplencia-sienge.mjs — 1 bulk já gasto).
// Fonte local:  PostgREST pagamentos_prosoluto (read-only, sem quota Sienge).
//
// Âncora 1:1: (sienge_bill_id, sienge_installment_id). 247/346 têm âncora.
// Os 99 sem âncora caem em fallback heurístico (valor + dueDate) — conservador.
//
// Saída: docs/rodadas/b8/reconciliacao-cauda-<hoje>.json (schema canônico de métrica).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const HOJE = new Date().toISOString().slice(0, 10)
const RAW_PATH = `docs/auditorias/fase0/income-D-raw-${HOJE}.json`
const SUPABASE_URL = 'https://jdkkusrxullttyeakwib.supabase.co'

const env = readFileSync('.env', 'utf8')
const KEY = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

const diasAtraso = (d) => Math.floor((Date.parse(HOJE) - Date.parse(d)) / 86400000)
const faixaDe = (dias) =>
  dias <= 30 ? '1-30' : dias <= 90 ? '31-90' : dias <= 180 ? '91-180' : dias <= 365 ? '181-365' : '365+'
const novoAging = () => ({ '1-30': 0, '31-90': 0, '91-180': 0, '181-365': 0, '365+': 0 })

async function fetchLocalInadimplentes() {
  const sel = 'id,venda_id,numero_parcela,tipo,valor,data_prevista,status,sienge_bill_id,sienge_installment_id'
  const url = `${SUPABASE_URL}/rest/v1/pagamentos_prosoluto`
    + `?select=${sel}`
    + `&status=not.in.(pago,cancelado)`
    + `&data_prevista=lte.${HOJE}`
    + `&order=data_prevista.asc`
  const r = await fetch(url, { headers: H })
  if (!r.ok) throw new Error(`PostgREST ${r.status}: ${(await r.text()).slice(0, 300)}`)
  return r.json()
}

function main() {
  const raw = JSON.parse(readFileSync(RAW_PATH, 'utf8'))
  const incomeRows = raw.rows || []

  // índice 1:1 por (billId, installmentId)
  const porAncora = new Map()
  // índice heurístico por (dueDate | originalAmount arredondado) -> [rows]
  const porHeur = new Map()
  for (const r of incomeRows) {
    porAncora.set(`${r.billId}|${r.installmentId}`, r)
    const hk = `${r.dueDate}|${Math.round(Number(r.originalAmount || 0) * 100)}`
    if (!porHeur.has(hk)) porHeur.set(hk, [])
    porHeur.get(hk).push(r)
  }

  return fetchLocalInadimplentes().then((locais) => {
    const classes = {
      real: [],          // Sienge balanceAmount > 0 — inadimplência verdadeira
      falsoPendente: [],  // Sienge balanceAmount ≈ 0 — cliente pagou, local não sabe
      semMatchSienge: [], // tem âncora mas billId+instId não está no income/D
      semAncora: [],      // sienge_bill_id null — heurístico ambíguo/sem match
    }
    const agingReal = novoAging()
    const agingFalso = novoAging()
    let valorReal = 0, valorFalso = 0

    for (const p of locais) {
      const dias = diasAtraso(p.data_prevista)
      const faixa = faixaDe(dias)
      const valor = Number(p.valor || 0)

      let row = null
      let via = null
      if (p.sienge_bill_id != null && p.sienge_installment_id != null) {
        row = porAncora.get(`${p.sienge_bill_id}|${p.sienge_installment_id}`)
        via = 'ancora'
      }
      if (!row && p.sienge_bill_id == null) {
        // fallback heurístico conservador: match único por (data_prevista, valor)
        const hk = `${p.data_prevista}|${Math.round(valor * 100)}`
        const cands = porHeur.get(hk) || []
        if (cands.length === 1) { row = cands[0]; via = 'heuristico' }
      }

      const base = {
        id: p.id, venda_id: p.venda_id, numero_parcela: p.numero_parcela, tipo: p.tipo,
        valor, data_prevista: p.data_prevista, dias_atraso: dias, faixa,
        sienge_bill_id: p.sienge_bill_id, sienge_installment_id: p.sienge_installment_id,
      }

      if (!row) {
        if (p.sienge_bill_id == null) classes.semAncora.push(base)
        else classes.semMatchSienge.push({ ...base, motivo: 'billId+installmentId ausente no income/D (drift de dueDate?)' })
        continue
      }

      const saldo = Number(row.balanceAmount || 0)
      const pagto = (row.receipts || []).map((rc) => rc.paymentDate).filter(Boolean)[0] || null
      const enriquecido = {
        ...base, via,
        sienge: {
          balanceAmount: saldo, originalAmount: Number(row.originalAmount || 0),
          dueDate: row.dueDate, paymentDate: pagto, clientName: row.clientName, mainUnit: row.mainUnit,
        },
      }

      if (saldo > 0.005) {
        classes.real.push(enriquecido)
        agingReal[faixa]++
        valorReal += valor
      } else {
        classes.falsoPendente.push(enriquecido)
        agingFalso[faixa]++
        valorFalso += valor
      }
    }

    const out = {
      meta: {
        geradoEm: new Date().toISOString(),
        spec_ref: '.claude/rules/sincronizacao-sienge.md',
        script: 'scripts/reconciliar-cauda-inadimplencia.mjs',
        modo: 'dry-run',
        fonteSienge: RAW_PATH,
        totalLocalInadimplente: locais.length,
      },
      counts: {
        inadimplencia_real: classes.real.length,
        falso_pendente: classes.falsoPendente.length,
        sem_match_sienge: classes.semMatchSienge.length,
        sem_ancora: classes.semAncora.length,
      },
      valores: {
        valor_real: Number(valorReal.toFixed(2)),
        valor_falso_pendente: Number(valorFalso.toFixed(2)),
      },
      aging: { real: agingReal, falsoPendente: agingFalso },
      detalhe: classes,
    }

    mkdirSync('docs/rodadas/b8', { recursive: true })
    const outPath = `docs/rodadas/b8/reconciliacao-cauda-${HOJE}.json`
    writeFileSync(outPath, JSON.stringify(out, null, 2))

    console.log('================ RECONCILIAÇÃO CAUDA INADIMPLÊNCIA ================')
    console.log(`local inadimplente (vencido, ≠pago/cancelado): ${locais.length}`)
    console.log(`  INADIMPLÊNCIA REAL (Sienge saldo>0):  ${classes.real.length}  | R$ ${valorReal.toFixed(2)}`)
    console.log(`  FALSO PENDENTE   (Sienge saldo≈0):    ${classes.falsoPendente.length}  | R$ ${valorFalso.toFixed(2)}`)
    console.log(`  sem match no income/D (âncora órfã):  ${classes.semMatchSienge.length}`)
    console.log(`  sem âncora (bill_id null):            ${classes.semAncora.length}`)
    console.log('aging REAL:        ', agingReal)
    console.log('aging FALSO-PEND:  ', agingFalso)
    console.log(`Output: ${outPath}`)
  })
}

main().catch((e) => { console.error('FALHOU:', e); process.exit(1) })
