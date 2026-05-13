// Busca dados completos dos brokers 156 (GABRIEL LUZ) e 144 (PAULO CHAVES JR)
// no Sienge — preparacao pra cadastra-los em usuarios.
import { siengeGet } from './_sienge-http.mjs'

for (const brokerId of [156, 144]) {
  console.log(`\n=== BROKER ${brokerId} ===`)
  // tenta /creditors/{id}
  try {
    const r = await siengeGet({ path: `/creditors/${brokerId}` })
    const c = r.data
    console.log(`  via /creditors/${brokerId}:`)
    console.log(`    name: ${c?.name}`)
    console.log(`    tradeName: ${c?.tradeName}`)
    console.log(`    cpf: ${c?.cpf}`)
    console.log(`    cnpj: ${c?.cnpj}`)
    console.log(`    email: ${c?.email}`)
    console.log(`    phones: ${JSON.stringify(c?.phones).slice(0, 200)}`)
    console.log(`    city: ${c?.city || c?.address?.cityName}`)
    console.log(`    state: ${c?.state || c?.address?.stateInitials}`)
  } catch (err) {
    console.log(`  /creditors/${brokerId}: ${err.message.slice(0, 150)}`)
  }
}
