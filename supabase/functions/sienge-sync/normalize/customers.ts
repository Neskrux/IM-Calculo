import { publicClient } from "../raw/writer.ts"
import { log } from "../lib/log.ts"

interface Phone { number?: string; main?: boolean }
interface Address {
  streetName?: string; number?: string; complement?: string; neighborhood?: string
  city?: string; state?: string; zipCode?: string; mail?: boolean
}
interface CpfLike { value?: string | number }
interface Spouse {
  name?: string; cpf?: string | CpfLike; email?: string; phones?: Phone[]
  profession?: string; birthDate?: string; numberIdentityCard?: string
}
interface CustomerPayload {
  id: string | number
  name?: string
  cpf?: string | CpfLike
  cnpj?: string | CpfLike
  email?: string
  phones?: Phone[]
  addresses?: Address[]
  birthDate?: string
  numberIdentityCard?: string
  profession?: string
  sex?: string
  civilStatus?: string
  fatherName?: string
  motherName?: string
  nationality?: string
  personType?: string
  modifiedAt?: string
  spouse?: Spouse
}

function extractDoc(v: unknown): string | null {
  if (!v) return null
  if (typeof v === "string") return v.replace(/\D/g, "")
  if (typeof v === "object" && v && "value" in v) return String((v as CpfLike).value ?? "").replace(/\D/g, "")
  return null
}

function extractPhone(phones?: Phone[]): string | null {
  if (!phones?.length) return null
  return (phones.find((p) => p.main === true) ?? phones[0])?.number ?? null
}

function extractCep(addrs?: Address[]): string | null {
  if (!addrs?.length) return null
  return (addrs.find((a) => a.mail === true) ?? addrs[0])?.zipCode ?? null
}

function formatAddress(addrs?: Address[]): string | null {
  if (!addrs?.length) return null
  const a = addrs.find((x) => x.mail === true) ?? addrs[0]
  const parts = [
    a.streetName,
    a.number ? `nº ${a.number}` : null,
    a.complement,
    a.neighborhood,
    a.city,
    a.state,
  ].filter(Boolean)
  return parts.length ? parts.join(", ") : null
}

function mapCustomer(c: CustomerPayload) {
  return {
    sienge_customer_id: String(c.id),
    nome_completo: c.name || "Cliente Sienge",
    cpf: extractDoc(c.cpf),
    cnpj: extractDoc(c.cnpj),
    email: c.email ?? null,
    telefone: extractPhone(c.phones),
    endereco: formatAddress(c.addresses),
    cep: extractCep(c.addresses),
    data_nascimento: c.birthDate ?? null,
    rg: c.numberIdentityCard ?? null,
    profissao: c.profession ?? null,
    sexo: c.sex ?? null,
    estado_civil: c.civilStatus ?? null,
    nome_pai: c.fatherName ?? null,
    nome_mae: c.motherName ?? null,
    nacionalidade: c.nationality ?? null,
    tipo_pessoa: c.personType ?? "Física",
    sienge_updated_at: c.modifiedAt ? new Date(c.modifiedAt).toISOString() : new Date().toISOString(),
  }
}

export async function normalizeCustomers(_runId: string): Promise<{ inserted: number; updated: number; errors: number }> {
  const supa = publicClient()
  const { data: raws, error: rawErr } = await supa
    .schema("sienge_raw")
    .from("objects")
    .select("sienge_id,payload")
    .eq("entity", "customers")
  if (rawErr) throw new Error(`raw.objects(customers): ${rawErr.message}`)
  if (!raws?.length) return { inserted: 0, updated: 0, errors: 0 }

  const { data: existing, error: exErr } = await supa
    .from("clientes")
    .select("id,sienge_customer_id")
    .not("sienge_customer_id", "is", null)
  if (exErr) throw new Error(`clientes.select: ${exErr.message}`)

  const existingMap = new Map<string, string>()
  for (const row of existing ?? []) existingMap.set(row.sienge_customer_id, row.id)

  let inserted = 0, updated = 0, errors = 0
  const now = new Date().toISOString()

  for (const raw of raws as Array<{ sienge_id: string; payload: CustomerPayload }>) {
    try {
      const mapped = mapCustomer(raw.payload)
      const existingId = existingMap.get(mapped.sienge_customer_id)
      let clienteId: string

      if (existingId) {
        const { error } = await supa.from("clientes").update({ ...mapped, updated_at: now }).eq("id", existingId)
        if (error) throw error
        clienteId = existingId
        updated++
      } else {
        const { data, error } = await supa
          .from("clientes")
          .insert({ ...mapped, created_at: now, updated_at: now })
          .select("id").single()
        if (error) throw error
        clienteId = (data as { id: string }).id
        inserted++
      }

      const spouse = raw.payload.spouse
      if (spouse?.name) {
        const spouseRow = {
          cliente_id: clienteId,
          sienge_spouse_id: String(raw.payload.id),
          nome: spouse.name,
          cpf: extractDoc(spouse.cpf),
          email: spouse.email ?? null,
          telefone: extractPhone(spouse.phones),
          profissao: spouse.profession ?? null,
          data_nascimento: spouse.birthDate ?? null,
          rg: spouse.numberIdentityCard ?? null,
          parentesco: "Cônjuge",
          origem: "sienge",
        }
        const { data: exSp } = await supa
          .from("complementadores_renda")
          .select("id")
          .eq("cliente_id", clienteId)
          .eq("sienge_spouse_id", spouseRow.sienge_spouse_id)
          .maybeSingle()
        if (exSp) await supa.from("complementadores_renda").update(spouseRow).eq("id", (exSp as { id: string }).id)
        else await supa.from("complementadores_renda").insert(spouseRow)
      }
    } catch (e) {
      errors++
      log("error", "normalize_customer_error", { siengeId: raw.sienge_id, err: String(e) })
    }
  }

  return { inserted, updated, errors }
}
