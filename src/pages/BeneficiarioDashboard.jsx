// Visão do BENEFICIÁRIO (Nohros, Beton, Ferretti, ... — genérica por cargo).
// Spec: docs/specs/2026-08-20-spec-visao-beneficiario.md
//
// O que este dashboard mostra (decisão de negócio 20/08):
//  - a FATIA DO PRÓPRIO CARGO (fatiaCargoDoPagamento — comissao_gerada × pct_cargo/pct_total)
//  - métricas MACRO NEUTRAS (nº de vendas, parcelas, % recebido do pró-soluto)
//  - NUNCA a fatia dos outros cargos.
// Regras respeitadas: totais SEMPRE de pagamentos_prosoluto (visualizacao-totais.md);
// listas >1000 paginadas com ordenação determinística (leitura-de-listas-e-refetch.md).
import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { fetchAllPaginated } from '../utils/supabaseQuery'
import { fatiaCargoDoPagamento, isPago, isPendente, isAtivo, isVendaAtiva, dataEfetiva } from '../utils/comissaoCalculator'
import { gerarRelatorioBeneficiarioPDF } from '../utils/relatorioBeneficiarioPDF'

const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)
const mesLabel = (ym) => {
  const [a, m] = ym.split('-')
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${nomes[Number(m) - 1]}/${a}`
}

const BeneficiarioDashboard = () => {
  const { userProfile, signOut } = useAuth()
  const cargo = userProfile?.cargo_beneficiario || ''

  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)
  const [vendas, setVendas] = useState([])
  const [pagamentos, setPagamentos] = useState([])
  const [cargos, setCargos] = useState([])
  const [coordenadoras, setCoordenadoras] = useState([])
  const [empreendimentos, setEmpreendimentos] = useState([])
  const [empSel, setEmpSel] = useState('')
  const [mesSel, setMesSel] = useState('') // '' = tudo; 'YYYY-MM' = um mês
  const [gerandoPdf, setGerandoPdf] = useState(false)

  useEffect(() => {
    if (!cargo) { setCarregando(false); return }
    const carregar = async () => {
      try {
        // 1. Empreendimentos onde o cargo existe (escopo do beneficiário)
        const { data: cargosData, error: e1 } = await supabase
          .from('cargos_empreendimento')
          .select('empreendimento_id, nome_cargo, tipo_corretor, percentual')
        if (e1) throw e1
        const empIds = [...new Set((cargosData || []).filter(c => c.nome_cargo === cargo).map(c => c.empreendimento_id))]
        if (!empIds.length) throw new Error(`Cargo "${cargo}" não existe em nenhum empreendimento — verifique o cadastro.`)
        setCargos(cargosData || [])

        const [{ data: empsData, error: e2 }, { data: coordsData, error: e3 }] = await Promise.all([
          supabase.from('empreendimentos').select('id, nome').in('id', empIds),
          supabase.from('coordenadoras').select('*'),
        ])
        if (e2) throw e2
        if (e3) throw e3
        setEmpreendimentos(empsData || [])
        setCoordenadoras(coordsData || [])

        // 2. Vendas ativas do escopo (paginado, ordenação determinística)
        const vendasData = await fetchAllPaginated((from, to) =>
          supabase.from('vendas')
            .select('id, unidade, empreendimento_id, tipo_corretor, coordenadora_id, coordenadora_taxa, valor_pro_soluto, valor_venda, fator_comissao, status, situacao_contrato, data_distrato, excluido')
            .in('empreendimento_id', empIds)
            .or('excluido.eq.false,excluido.is.null')
            .order('id', { ascending: true })
            .range(from, to)
        )
        const ativas = vendasData.filter(v => isVendaAtiva(v) && v.situacao_contrato !== '3' && !v.data_distrato)
        setVendas(ativas)

        // 3. Parcelas das vendas ativas (paginado, concorrência — pode passar de 14k linhas)
        const vendaIds = ativas.map(v => v.id)
        const pags = []
        const LOTE = 100 // .in() com lista gigante estoura URL — fatiar por lote de vendas
        for (let i = 0; i < vendaIds.length; i += LOTE) {
          const ids = vendaIds.slice(i, i + LOTE)
          const parte = await fetchAllPaginated((from, to) =>
            supabase.from('pagamentos_prosoluto')
              .select('id, venda_id, tipo, numero_parcela, valor, status, data_prevista, data_pagamento, comissao_gerada, percentual_comissao_total, fator_comissao_aplicado')
              .in('venda_id', ids)
              .order('data_prevista', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to),
            { concurrency: 4 }
          )
          pags.push(...parte)
        }
        setPagamentos(pags)
      } catch (err) {
        setErro(err.message || String(err))
      } finally {
        setCarregando(false)
      }
    }
    carregar()
  }, [cargo])

  const vendasVisiveis = useMemo(
    () => empSel ? vendas.filter(v => String(v.empreendimento_id) === String(empSel)) : vendas,
    [vendas, empSel]
  )
  const vendaPorId = useMemo(() => new Map(vendasVisiveis.map(v => [v.id, v])), [vendasVisiveis])

  const calc = useMemo(() => {
    const pagsVisiveis = pagamentos.filter(p => vendaPorId.has(p.venda_id))
    const ativos = pagsVisiveis.filter(isAtivo)
    const fatia = (p) => fatiaCargoDoPagamento(p, vendaPorId.get(p.venda_id), cargo, cargos, coordenadoras)

    // Macro neutro (valores de PARCELA, nunca comissão de outros cargos)
    const valorTotal = ativos.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0)
    const valorPago = ativos.filter(isPago).reduce((s, p) => s + (parseFloat(p.valor) || 0), 0)
    const hoje = new Date().toISOString().slice(0, 10)
    const vencidasAbertas = ativos.filter(p => isPendente(p) && p.data_prevista && p.data_prevista < hoje)

    // Fatia do cargo
    const noMes = (p) => !mesSel || (dataEfetiva(p) || '').slice(0, 7) === mesSel
    const fatiaPaga = ativos.filter(isPago).filter(noMes).reduce((s, p) => s + fatia(p), 0)
    const fatiaPendente = ativos.filter(isPendente).filter(noMes).reduce((s, p) => s + fatia(p), 0)

    // Série mensal (últimos 13 meses com movimento) da fatia PAGA por data_pagamento
    const porMes = new Map()
    for (const p of ativos.filter(isPago)) {
      const ym = (p.data_pagamento || '').slice(0, 7)
      if (!ym) continue
      porMes.set(ym, (porMes.get(ym) || 0) + fatia(p))
    }
    const serieMensal = [...porMes.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 13)

    return {
      nVendas: vendasVisiveis.length,
      nParcelasPagas: ativos.filter(isPago).length,
      nParcelasPendentes: ativos.filter(isPendente).length,
      pctRecebido: valorTotal > 0 ? (valorPago / valorTotal) * 100 : 0,
      nVencidasAbertas: vencidasAbertas.length,
      valorVencidoAberto: vencidasAbertas.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0),
      fatiaPaga, fatiaPendente,
      serieMensal,
    }
  }, [pagamentos, vendaPorId, vendasVisiveis, cargo, cargos, coordenadoras, mesSel])

  const gerarPdf = async () => {
    setGerandoPdf(true)
    try {
      gerarRelatorioBeneficiarioPDF({
        cargo,
        nomeUsuario: userProfile?.nome || cargo,
        vendas: vendasVisiveis,
        pagamentos: pagamentos.filter(p => vendaPorId.has(p.venda_id)),
        cargos, coordenadoras,
        mes: mesSel || null,
        empreendimentoNome: empSel
          ? (empreendimentos.find(e => String(e.id) === String(empSel))?.nome || '')
          : empreendimentos.map(e => e.nome).join(', '),
      })
    } finally {
      setGerandoPdf(false)
    }
  }

  const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '18px 20px', minWidth: 180, flex: 1 }
  const label = { fontSize: 12, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }
  const num = { fontSize: 22, fontWeight: 700, color: '#0f172a' }

  if (carregando) return <div style={{ padding: 40, fontFamily: 'inherit' }}>Carregando…</div>
  if (erro) return (
    <div style={{ padding: 40 }}>
      <p style={{ color: '#b91c1c' }}>Erro ao carregar: {erro}</p>
      <button onClick={() => window.location.reload()}>Tentar de novo</button>
    </div>
  )

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 20px', background: '#f8fafc', minHeight: '100vh' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>Painel {cargo}</h1>
          <small style={{ color: '#64748b' }}>
            {userProfile?.nome} · {empreendimentos.map(e => e.nome).join(' · ')}
          </small>
        </div>
        <button onClick={signOut} style={{ border: '1px solid #e2e8f0', background: '#fff', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}>
          Sair
        </button>
      </header>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {empreendimentos.length > 1 && (
          <select value={empSel} onChange={e => setEmpSel(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <option value="">Todos os empreendimentos</option>
            {empreendimentos.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        )}
        <select value={mesSel} onChange={e => setMesSel(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <option value="">Todo o período</option>
          {calc.serieMensal.map(([ym]) => <option key={ym} value={ym}>{mesLabel(ym)}</option>)}
        </select>
        <button onClick={gerarPdf} disabled={gerandoPdf} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#0f172a', color: '#fff', cursor: 'pointer' }}>
          {gerandoPdf ? 'Gerando…' : 'Gerar relatório PDF'}
        </button>
      </div>

      {/* Fatia do cargo — o número do beneficiário */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ ...card, borderLeft: '4px solid #16a34a' }}>
          <div style={label}>Comissão {cargo} recebida{mesSel ? ` (${mesLabel(mesSel)})` : ''}</div>
          <div style={{ ...num, color: '#16a34a' }}>{fmt(calc.fatiaPaga)}</div>
        </div>
        <div style={{ ...card, borderLeft: '4px solid #f59e0b' }}>
          <div style={label}>Comissão {cargo} a receber{mesSel ? ` (${mesLabel(mesSel)})` : ''}</div>
          <div style={{ ...num, color: '#b45309' }}>{fmt(calc.fatiaPendente)}</div>
        </div>
      </div>

      {/* Macro neutro */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={card}><div style={label}>Vendas ativas</div><div style={num}>{calc.nVendas}</div></div>
        <div style={card}><div style={label}>Parcelas pagas</div><div style={num}>{calc.nParcelasPagas}</div></div>
        <div style={card}><div style={label}>% do pró-soluto recebido</div><div style={num}>{calc.pctRecebido.toFixed(1)}%</div></div>
        <div style={card}>
          <div style={label}>Vencidas em aberto</div>
          <div style={num}>{calc.nVencidasAbertas}</div>
          <small style={{ color: '#64748b' }}>{fmt(calc.valorVencidoAberto)} em parcelas</small>
        </div>
      </div>

      {/* Série mensal da fatia */}
      <div style={{ ...card, flex: 'none', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ ...label, marginBottom: 12 }}>Comissão {cargo} por mês (pagas)</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
            <tbody>
              {calc.serieMensal.map(([ym, valor]) => (
                <tr key={ym} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 4px', color: '#334155' }}>{mesLabel(ym)}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 600 }}>{fmt(valor)}</td>
                </tr>
              ))}
              {!calc.serieMensal.length && <tr><td style={{ padding: 8, color: '#64748b' }}>Sem pagamentos ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default BeneficiarioDashboard
