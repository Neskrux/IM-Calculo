// Resolve qual cadastro/venda uma linha da planilha de cobranças representa.
// Gêmeo de scripts/boletos/_titular.cjs (robôs) — manter os dois iguais.
//
// Clientes que entram pelo contrato do Sienge chegam SEM CPF (o contrato só traz nome e
// código). Quando o mesmo cliente também tem um cadastro antigo COM CPF, ligado a uma
// venda excluída, a busca por CPF cai no cadastro errado e a cobrança some como
// "sem venda ativa" (nov/2026: 1506 D, 1502 D, 901 D, 1507 D, 906 A, 510 C).
//
// Regra: se pelo CPF não há venda ativa na unidade, procura a venda ATIVA da unidade da
// planilha (com a letra da torre) e aceita o titular se ele estiver SEM CPF/CNPJ (ou com
// o mesmo CPF) e tiver o MESMO nome (sem acento/caixa/espaço). Ambíguo → não resolve.

const dig = (s) => String(s ?? '').replace(/\D/g, '')

export const normNome = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()

const normUni = (s) => String(s ?? '').toUpperCase().replace(/^FIGUEIRA\s*/, '').replace(/\s+/g, '')
const ativa = (v) => v.excluido !== true && v.status !== 'distrato'

// Data da planilha → 'AAAA-MM-DD'. Aceita "20/11/2026", "2026-11-20", Date e o NÚMERO de
// série do Excel (46346 = 20/11/2026): data digitada numa célula formatada como data é
// gravada como número, não texto (1105 B parc 18, nov/2026, barrada como "divergente").
export const dataPlanilhaISO = (s) => {
  if (s instanceof Date) return isNaN(s) ? null : s.toISOString().slice(0, 10)
  const txt = String(s ?? '').trim()
  if (typeof s === 'number' || /^\d{5}(\.\d+)?$/.test(txt)) {
    const n = Math.floor(Number(s))
    if (n < 20000 || n > 80000) return null // fora de 1954..2119: não é data
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10)
  }
  const br = txt.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  const iso = txt.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

/** @returns {{ cli: object|null, vendasCli: object[], viaNome: boolean }} */
export function resolverTitular({ cpfD, unidadePlanilha, nomePlanilha, cliPorCpf, clientes, vendas }) {
  const mUni = String(unidadePlanilha ?? '').match(/(\d+)\s*([A-Za-z]?)\s*$/)
  const uniDig = mUni?.[1]
  const cli = cliPorCpf.get(cpfD) ?? null
  const vendasCli = cli
    ? vendas.filter(v => String(v.cliente_id) === String(cli.id) && ativa(v) &&
        (!uniDig || String(v.unidade ?? '').replace(/\D/g, '') === uniDig))
    : []
  if (vendasCli.length > 0 || !mUni) return { cli, vendasCli, viaNome: false }

  const nomeAlvo = normNome(nomePlanilha || cli?.nome_completo)
  if (!nomeAlvo) return { cli, vendasCli, viaNome: false }
  const uniAlvo = normUni(`${mUni[1]}${mUni[2] ?? ''}`)
  const porId = new Map(clientes.map(c => [String(c.id), c]))
  const cands = vendas.filter(v => ativa(v) && normUni(v.unidade) === uniAlvo).filter(v => {
    const t = porId.get(String(v.cliente_id))
    if (!t) return false
    const docT = dig(t.cpf) || dig(t.cnpj)
    return (!docT || docT === cpfD) && normNome(t.nome_completo) === nomeAlvo
  })
  if (cands.length !== 1) return { cli, vendasCli, viaNome: false }
  return { cli: porId.get(String(cands[0].cliente_id)), vendasCli: cands, viaNome: true }
}
