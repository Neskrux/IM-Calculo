// Painel do papel COORDENAÇÃO dentro da conta do corretor.
// Spec: docs/specs/2026-09-04-spec-papel-coordenador.md
//
// A tela não faz conta: todo número vem de `resumoCoordenacao` (helper puro e testado
// em comissaoCalculator.test.js). Aqui só há layout e estado vazio.
const formatCurrency = (valor) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0)

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesLabel = (ym) => {
  const [a, m] = String(ym || '').split('-')
  return MESES[Number(m) - 1] ? `${MESES[Number(m) - 1]}/${a}` : ym
}

// Textos do painel. A visão do BENEFICIÁRIO reusa este mesmo painel (spec
// 2026-08-20, § v2) trocando só os rótulos — assim as duas telas nunca divergem.
const ROTULOS_COORDENACAO = {
  carregando: 'Carregando as vendas direcionadas a você…',
  erro: 'Não foi possível carregar a coordenação',
  comissao: 'Comissão de coordenação',
  vendas: 'Vendas direcionadas',
  semPagas: 'Nenhuma parcela paga nas vendas direcionadas ainda.',
  vazio: null, // null = estado vazio próprio da coordenação (abaixo)
}

const PainelCoordenacao = ({ resumo, carregando, erro, mes, setMes, nomeCoordenacao, rotulos }) => {
  const r = { ...ROTULOS_COORDENACAO, ...rotulos }
  if (carregando) {
    return <section className="coord-panel"><p className="coord-msg">{r.carregando}</p></section>
  }

  if (erro) {
    return (
      <section className="coord-panel">
        <p className="coord-msg coord-msg-erro">{r.erro}: {erro}</p>
        <button type="button" onClick={() => window.location.reload()}>Tentar de novo</button>
      </section>
    )
  }

  if (resumo?.vazio && r.vazio) {
    return (
      <section className="coord-panel coord-vazio">
        <h2>{r.vazio.titulo}</h2>
        <p>{r.vazio.texto}</p>
      </section>
    )
  }

  // Estado vazio (caso Matheus Pires, virando coordenador agora). Carteira vazia não é
  // erro nem R$ 0,00 mudo — a tela explica por que ainda não há número.
  if (resumo?.vazio) {
    return (
      <section className="coord-panel coord-vazio">
        <h2>Nenhuma venda direcionada a você ainda</h2>
        <p>
          Você já está com o acesso de coordenação{nomeCoordenacao ? ` (${nomeCoordenacao})` : ''}.
          Assim que o Admin direcionar vendas para você, a comissão de coordenação e o resumo
          da carteira aparecem aqui automaticamente.
        </p>
        <p className="coord-nota">
          Sua carteira como corretor continua em <strong>Corretor</strong>, no seletor acima.
        </p>
      </section>
    )
  }

  return (
    <section className="coord-panel">
      <div className="coord-filtros">
        <label htmlFor="coord-mes">Período</label>
        <select id="coord-mes" value={mes} onChange={(e) => setMes(e.target.value)}>
          <option value="">Todo o período</option>
          {resumo.serieMensal.map(([ym]) => (
            <option key={ym} value={ym}>{mesLabel(ym)}</option>
          ))}
        </select>
      </div>

      {/* A fatia do cargo Coordenadora — o número desta pessoa */}
      <div className="coord-cards">
        <div className="coord-card coord-card-paga">
          <span className="coord-label">{r.comissao} recebida{mes ? ` (${mesLabel(mes)})` : ''}</span>
          <strong>{formatCurrency(resumo.fatiaPaga)}</strong>
        </div>
        <div className="coord-card coord-card-pendente">
          <span className="coord-label">{r.comissao} a receber{mes ? ` (${mesLabel(mes)})` : ''}</span>
          <strong>{formatCurrency(resumo.fatiaPendente)}</strong>
        </div>
      </div>

      {/* Macro neutro — valores de PARCELA, nunca a fatia de outro cargo */}
      <div className="coord-cards">
        <div className="coord-card">
          <span className="coord-label">{r.vendas}</span>
          <strong>{resumo.nVendas}</strong>
        </div>
        <div className="coord-card">
          <span className="coord-label">Parcelas pagas</span>
          <strong>{resumo.nParcelasPagas}</strong>
        </div>
        <div className="coord-card">
          <span className="coord-label">% do pró-soluto recebido</span>
          <strong>{resumo.pctRecebido.toFixed(1)}%</strong>
        </div>
        <div className="coord-card">
          <span className="coord-label">Vencidas em aberto</span>
          <strong>{resumo.nVencidasAbertas}</strong>
          <small>{formatCurrency(resumo.valorVencidoAberto)} em parcelas</small>
        </div>
      </div>

      <div className="coord-serie">
        <span className="coord-label">{r.comissao} por mês (pagas)</span>
        <table>
          <tbody>
            {resumo.serieMensal.map(([ym, valor]) => (
              <tr key={ym}>
                <td>{mesLabel(ym)}</td>
                <td className="coord-serie-valor">{formatCurrency(valor)}</td>
              </tr>
            ))}
            {!resumo.serieMensal.length && (
              <tr><td colSpan={2}>{r.semPagas}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default PainelCoordenacao
