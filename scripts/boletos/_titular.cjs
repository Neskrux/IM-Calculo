// Resolve qual cadastro/venda uma linha da planilha de cobranças representa.
//
// Clientes que entram pelo contrato do Sienge (sales-contracts) chegam SEM CPF — o
// payload do contrato só traz nome e código. Quando o mesmo cliente também tem um
// cadastro antigo/manual COM CPF (ligado a uma venda excluída), a busca por CPF cai no
// cadastro errado e a cobrança some como "sem venda ativa" (caso nov/2026: 1506 D,
// 1502 D, 901 D, 1507 D, 906 A, 510 C).
//
// Regra: se pelo CPF não há venda ativa na unidade, procura a venda ATIVA da unidade
// da planilha (com a letra da torre) e aceita o titular se ele estiver SEM CPF/CNPJ e
// tiver o MESMO nome (sem acento/caixa/espaço). Ambíguo ou nome diferente → fora.
// O CPF do boleto continua vindo da planilha.

const dig = (s) => String(s ?? '').replace(/\D/g, '')
const normNome = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()
const normUni = (s) => String(s ?? '').toUpperCase().replace(/^FIGUEIRA\s*/, '').replace(/\s+/g, '')

function ativa(v) { return v.excluido !== true && v.status !== 'distrato' }

/**
 * @returns {{ cli, vendasCli, viaNome: boolean }}  cli pode ser null (não achou ninguém)
 */
function resolverTitular({ cpfD, unidadePlanilha, nomePlanilha, cliPorCpf, dbClientes, dbVendas }) {
  const mUni = String(unidadePlanilha ?? '').match(/(\d+)\s*([A-Za-z]?)\s*$/)
  const uniDig = mUni?.[1]
  let cli = cliPorCpf.get(cpfD) ?? null
  let vendasCli = cli
    ? dbVendas.filter(v => String(v.cliente_id) === String(cli.id) && ativa(v) &&
        (!uniDig || String(v.unidade ?? '').replace(/\D/g, '') === uniDig))
    : []
  if (vendasCli.length > 0 || !mUni) return { cli, vendasCli, viaNome: false }

  const nomeAlvo = normNome(nomePlanilha || cli?.nome_completo)
  if (!nomeAlvo) return { cli, vendasCli, viaNome: false }
  const uniAlvo = normUni(`${mUni[1]}${mUni[2] ?? ''}`)
  const porId = new Map(dbClientes.map(c => [String(c.id), c]))
  const cands = dbVendas.filter(v => ativa(v) && normUni(v.unidade) === uniAlvo).filter(v => {
    const t = porId.get(String(v.cliente_id))
    if (!t) return false
    const docT = dig(t.cpf) || dig(t.cnpj)
    return (!docT || docT === cpfD) && normNome(t.nome_completo) === nomeAlvo
  })
  if (cands.length !== 1) return { cli, vendasCli, viaNome: false }
  return { cli: porId.get(String(cands[0].cliente_id)), vendasCli: cands, viaNome: true }
}

// Data da planilha → 'AAAA-MM-DD'. Gêmeo de dataPlanilhaISO em src/utils/titularPlanilha.js.
// Aceita "20/11/2026", "2026-11-20", Date e o NÚMERO de série do Excel (46346 = 20/11/2026).
const dataPlanilhaISO = (s) => {
  if (s instanceof Date) return isNaN(s) ? null : s.toISOString().slice(0, 10)
  const txt = String(s ?? '').trim()
  if (typeof s === 'number' || /^\d{5}(\.\d+)?$/.test(txt)) {
    const n = Math.floor(Number(s))
    if (n < 20000 || n > 80000) return null
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10)
  }
  const br = txt.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  const iso = txt.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

module.exports = { resolverTitular, normNome, dataPlanilhaISO }
