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
