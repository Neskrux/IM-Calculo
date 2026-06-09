// Cruza os 3 buckets do resíduo (b9 pagas/pendentes-órfãs, b10 pro_soluto≠Sienge,
// distrato A.2) pra achar casos compartilhados. READ-ONLY (lê JSONs + lista de
// distratos embutida vinda de SELECT). Não toca produção.

import { readFileSync } from 'node:fs'

const b9 = JSON.parse(readFileSync('docs/rodadas/b9/b9-duplicatas-comissao.json', 'utf8'))
const b10 = JSON.parse(readFileSync('docs/rodadas/b10/b10-prosoluto-divergente.json', 'utf8'))

// 25 distratos (situacao_contrato='3') — snapshot do SELECT 2026-06-02
const distratos = [
  ['25','508 A','11728f4d-67d3-4629-a6b2-d93ec06dbea0'],['42','609 A','5cfdabb1-25aa-4633-a6e0-b3c4651cf052'],
  ['79','904 A','39d7aad3-aa7b-459c-820a-17a00e1aa7f4'],['141','1105 A','c2c465e1-cec4-42bc-8f40-db0d7d7d3106'],
  ['145','1103 A','472d7dfe-e95a-40d7-8739-328d2b576c44'],['149','1304 A','e1c0ca9b-452f-4955-aeb3-a0e1fc36642c'],
  ['168','1702 A','64aa2405-0068-4c20-8d15-736e1a1d6b1b'],['181','603 B','eb4ac0bc-7de5-49fd-a933-3ab7de549dac'],
  ['186','803 B','1ed61c21-97b9-4409-bf45-403cb41e3889'],['209','403 C','8b74adf9-e6dc-404b-8144-d026dbb256ed'],
  ['255','1405 C','84b74c27-fa97-4cb0-9e22-be95f88237d2'],['268','604 D','335e0f43-2a77-4399-ae27-eb4af0a56a68'],
  ['278','901 D','ac19aefe-53c9-4f4c-a519-e603fc6aa05e'],['284','1001 D','64ffc2fb-b265-41d3-b7d5-cc101d813220'],
  ['290','1008 D','67240a63-fd0f-4d21-8dd6-5ea34e4c0c76'],['307','1707 A','6065c4ff-1bb2-42ab-85f5-b769f7f97253'],
  ['311','803 A','16f0a4fd-e669-49be-814d-76789ed6bb4c'],['315','406 A','36965dcf-4d05-42f6-b066-ac480bb1a561'],
  ['341','503 B','9581a13a-5d34-44a0-b54d-62a841d757a7'],['354','510 C','908fbcdb-ac7a-45f0-95c1-5e4f45e67736'],
  ['355','1707 A','83b8f727-e9a9-4a88-846c-272f6970356a'],['361','1707 A','7787a154-ec62-469f-b330-d9b3b6142dd2'],
  ['362','906 A','5cbed8bd-36a1-4ec6-ace1-0aa9da2023b1'],['380','507 A','54497681-10e3-4a1a-89d8-b3356fdec09a'],
  ['384','604 D','d77a7a35-7c36-450a-b4af-9648bc44adc7'],
].map(([c,u,id]) => ({ contrato: c, unidade: u, venda_id: id }))

const norm = (s) => (s || '').trim().toUpperCase()

// índices
const idx = {
  b9: b9.casos.map(c => ({ venda_id: c.venda_id, contrato: c.numero_contrato, unidade: norm(c.unidade), grupo: c.grupo, comissao: c.comissao_em_jogo })),
  b10: b10.casos.map(c => ({ venda_id: c.venda_id, contrato: c.numero_contrato, unidade: norm(c.unidade), dif: c.diferenca, pct: c.pct_diferenca })),
  dist: distratos.map(d => ({ venda_id: d.venda_id, contrato: d.contrato, unidade: norm(d.unidade) })),
}

const byId = new Map()
const add = (bucket, arr) => arr.forEach(x => {
  if (!byId.has(x.venda_id)) byId.set(x.venda_id, { venda_id: x.venda_id, contrato: x.contrato, unidade: x.unidade, buckets: {} })
  byId.get(x.venda_id).buckets[bucket] = x
})
add('b9', idx.b9); add('b10', idx.b10); add('dist', idx.dist)

console.log('=== A) MESMO venda_id em ≥2 buckets ===')
let nMulti = 0
for (const v of byId.values()) {
  const bs = Object.keys(v.buckets)
  if (bs.length >= 2) {
    nMulti++
    const det = bs.map(b => {
      if (b === 'b9') return `b9(g${v.buckets.b9.grupo}, R$${v.buckets.b9.comissao})`
      if (b === 'b10') return `b10(dif ${v.buckets.b10.dif}, ${v.buckets.b10.pct}%)`
      return 'distrato'
    }).join(' + ')
    console.log(`  c${v.contrato} ${v.unidade} [${det}]  ${v.venda_id}`)
  }
}
if (!nMulti) console.log('  (nenhum)')

console.log('\n=== B) MESMA unidade entre buckets distintos (revenda/colisão) ===')
const byUnit = new Map()
const addU = (bucket, arr) => arr.forEach(x => {
  if (!byUnit.has(x.unidade)) byUnit.set(x.unidade, new Map())
  byUnit.get(x.unidade).set(bucket + ':' + x.contrato, bucket)
})
addU('b9', idx.b9); addU('b10', idx.b10); addU('dist', idx.dist)
let nUnit = 0
for (const [u, m] of byUnit) {
  const buckets = new Set([...m.values()])
  if (buckets.size >= 2) {
    nUnit++
    console.log(`  ${u}: ${[...m.keys()].join(', ')}`)
  }
}
if (!nUnit) console.log('  (nenhuma)')

console.log('\n=== C) unidade repetida DENTRO de um bucket (mesma unidade, contratos diferentes) ===')
for (const [bucket, arr] of Object.entries(idx)) {
  const u2 = new Map()
  arr.forEach(x => { if (!u2.has(x.unidade)) u2.set(x.unidade, []); u2.get(x.unidade).push(x.contrato) })
  for (const [u, cs] of u2) if (cs.length >= 2) console.log(`  [${bucket}] ${u}: contratos ${cs.join(', ')}`)
}

console.log('\n=== RESUMO ===')
console.log(`  b9=${idx.b9.length}  b10=${idx.b10.length}  distratos=${idx.dist.length}`)
console.log(`  venda_id em ≥2 buckets: ${nMulti}`)
console.log(`  unidades cruzando buckets: ${nUnit}`)
