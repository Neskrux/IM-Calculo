// Lista COMPLETA dos 3 buckets do resíduo com unidade, parcela, tipo e "o que é".
// READ-ONLY (lê JSONs + snapshot distratos). Marca sobreposições entre buckets.

import { readFileSync } from 'node:fs'

const b9 = JSON.parse(readFileSync('docs/rodadas/b9/b9-duplicatas-comissao.json', 'utf8'))
const b10 = JSON.parse(readFileSync('docs/rodadas/b10/b10-prosoluto-divergente.json', 'utf8'))

const distratos = [
  ['25','508 A','11728f4d-67d3-4629-a6b2-d93ec06dbea0','2025-09-23','46482.60','232413.12'],
  ['42','609 A','5cfdabb1-25aa-4633-a6e0-b3c4651cf052','2026-02-06','80471.46','402356.42'],
  ['79','904 A','39d7aad3-aa7b-459c-820a-17a00e1aa7f4','2026-02-24','83668.40','418341.97'],
  ['141','1105 A','c2c465e1-cec4-42bc-8f40-db0d7d7d3106','2026-02-02','85350.13','426750.63'],
  ['145','1103 A','472d7dfe-e95a-40d7-8739-328d2b576c44','2026-01-06','74593.99','422991.12'],
  ['149','1304 A','e1c0ca9b-452f-4955-aeb3-a0e1fc36642c','2026-02-04','87065.40','435328.32'],
  ['168','1702 A','64aa2405-0068-4c20-8d15-736e1a1d6b1b','2025-11-17','88913.16','444567.92'],
  ['181','603 B','eb4ac0bc-7de5-49fd-a933-3ab7de549dac','2026-02-02','80470.89','402356.42'],
  ['186','803 B','1ed61c21-97b9-4409-bf45-403cb41e3889','2026-01-14','82088.55','410443.77'],
  ['209','403 C','8b74adf9-e6dc-404b-8144-d026dbb256ed','2026-01-13','78141.60','375638.57'],
  ['255','1405 C','84b74c27-fa97-4cb0-9e22-be95f88237d2','2025-12-29','73581.34','363369.59'],
  ['268','604 D','335e0f43-2a77-4399-ae27-eb4af0a56a68','2026-01-06','76639.32','383196.59'],
  ['278','901 D','ac19aefe-53c9-4f4c-a519-e603fc6aa05e','2025-12-15','69146.67','345733.70'],
  ['284','1001 D','64ffc2fb-b265-41d3-b7d5-cc101d813220','2025-12-09','88732.06','443660.52'],
  ['290','1008 D','67240a63-fd0f-4d21-8dd6-5ea34e4c0c76','2025-11-17','109571.60','349191.04'],
  ['307','1707 A','6065c4ff-1bb2-42ab-85f5-b769f7f97253','2025-12-05','87161.76','435808.19'],
  ['311','803 A','16f0a4fd-e669-49be-814d-76789ed6bb4c','2025-11-24','82088.56','410443.77'],
  ['315','406 A','36965dcf-4d05-42f6-b066-ac480bb1a561','2026-04-09','63308.76','292366.06'],
  ['341','503 B','9581a13a-5d34-44a0-b54d-62a841d757a7','2026-03-25','79622.00','398372.68'],
  ['354','510 C','908fbcdb-ac7a-45f0-95c1-5e4f45e67736','2026-01-15','75880.20','379402.55'],
  ['355','1707 A','83b8f727-e9a9-4a88-846c-272f6970356a','2025-12-04','87161.76','435808.19'],
  ['361','1707 A','7787a154-ec62-469f-b330-d9b3b6142dd2','2026-01-29','88913.20','444567.92'],
  ['362','906 A','5cbed8bd-36a1-4ec6-ace1-0aa9da2023b1','2026-01-15','175999.86','372000.00'],
  ['380','507 A','54497681-10e3-4a1a-89d8-b3356fdec09a','2026-02-08','57370.04','292366.06'],
  ['384','604 D','d77a7a35-7c36-450a-b4af-9648bc44adc7','2026-03-17','85379.61','426900.16'],
]
const distMap = new Map(distratos.map(d => [d[2], { contrato: d[0], unidade: d[1], data: d[3], pro: d[4], venda: d[5] }]))
const distUnidades = new Set(distratos.map(d => d[1]))
const b10ByUnit = new Map(b10.casos.map(c => [c.unidade, c.numero_contrato]))

const money = (n) => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ---------- B9 ----------
console.log('\n############ B9 — 60 casos (órfãs do gerador antigo) ############\n')
const fmtB9 = (c, linha, tipoTxt) => {
  const marca = distMap.has(c.venda_id) ? ' ⚑DISTRATO' : ''
  return `| c${c.numero_contrato} | ${c.unidade} | ${linha} | ${tipoTxt} | ${c.cliente || '(sem)'}${marca} |`
}
console.log('### g1 — pendentes-órfãs (5) — R$ 0 (nunca pago, cancelar é trivial)')
console.log('| Contrato | Unid | Parcela | Tipo | Cliente |\n|---|---|---|---|---|')
for (const c of b9.casos.filter(x => x.grupo === 1)) {
  const l = c.estado_atual.linhas[0]
  console.log(fmtB9(c, l.numero_parcela ?? '—', `${l.tipo} ${money(l.valor)}`))
}
console.log('\n### g2 — pagas-órfãs (49) — R$ 21.870 (ghost pago; precisa "Excluir Baixa")')
console.log('| Contrato | Unid | Parc | Tipo | Valor | Comissão | Cliente |\n|---|---|---|---|---|---|---|')
let somaG2 = 0
for (const c of b9.casos.filter(x => x.grupo === 2)) {
  somaG2 += c.comissao_em_jogo || 0
  for (const l of c.estado_atual.linhas) {
    const marca = distMap.has(c.venda_id) ? ' ⚑DISTRATO' : ''
    console.log(`| c${c.numero_contrato} | ${c.unidade} | ${l.numero_parcela ?? '—'} | ${l.tipo} | ${money(l.valor)} | ${money(l.comissao_gerada)} | ${c.cliente || '(sem)'}${marca} |`)
  }
}
console.log(`\n_soma comissão g2 = ${money(somaG2)}_`)
console.log('\n### g3 — ambíguos (6) — não cancelar cego')
console.log('| Contrato | Unid | Linhas | Causa | Cliente |\n|---|---|---|---|---|')
for (const c of b9.casos.filter(x => x.grupo === 3)) {
  const n = c.estado_atual.linhas.length
  const causa = c.motivo.includes('Sienge') ? 'Sienge tem (tipo,valor,data) duplicado' : 'banco tem ATIVAS duplicadas (gêmeos)'
  const marca = distMap.has(c.venda_id) ? ' ⚑DISTRATO' : ''
  console.log(`| c${c.numero_contrato} | ${c.unidade} | ${n} | ${causa} | ${c.cliente || '(sem)'}${marca} |`)
}

// ---------- B10 ----------
console.log('\n\n############ B10 — 28 casos (pro_soluto local ≠ soma income Sienge) ############\n')
console.log('| Contrato | Unid | Pro_soluto local | Soma income | Dif | % | Pagas | O que é |\n|---|---|---|---|---|---|---|---|')
for (const c of b10.casos) {
  let oque = Math.abs(c.pct_diferenca) <= 2 ? 'drift pequeno (arred.)' : 'divergência a investigar'
  if (distUnidades.has(c.unidade)) oque = '⚑REVENDA de unidade distratada'
  if (Math.abs(c.diferenca) >= 100000) oque = '⚑OUTLIER gigante'
  console.log(`| c${c.numero_contrato} | ${c.unidade} | ${money(c.pro_soluto_local)} | ${money(c.soma_income_sienge)} | ${money(c.diferenca)} | ${c.pct_diferenca}% | ${c.parcelas_pagas} | ${oque} |`)
}

// ---------- DISTRATO ----------
console.log('\n\n############ DISTRATO — 25 casos (situacao_contrato=3) ############\n')
console.log('| Contrato | Unid | Distrato em | Valor venda | Pro_soluto | Também em | Obs |\n|---|---|---|---|---|---|---|')
const b9Vendas = new Set(b9.casos.map(c => c.venda_id))
const unidCount = {}
for (const d of distratos) unidCount[d[1]] = (unidCount[d[1]] || 0) + 1
for (const d of distratos) {
  const [contrato, unidade, venda_id, data, pro, valor] = d
  const tambem = []
  if (b9Vendas.has(venda_id)) tambem.push('b9')
  if (b10ByUnit.has(unidade)) tambem.push(`b10(revenda c${b10ByUnit.get(unidade)})`)
  const obs = []
  if (unidCount[unidade] > 1) obs.push(`unid. distratada ${unidCount[unidade]}×`)
  if (Number(pro) / Number(valor) > 0.25) obs.push(`pro_soluto ${(100 * pro / valor).toFixed(0)}% (alto)`)
  console.log(`| c${contrato} | ${unidade} | ${data} | ${money(valor)} | ${money(pro)} | ${tambem.join(', ') || '—'} | ${obs.join('; ') || ''} |`)
}
