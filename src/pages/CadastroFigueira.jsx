// Formulário público de Cadastro de Negociação — Figueira Garcia (SC)
// Réplica do /cadastro-negociacao do RH, hospedada no IM-Calculo. PÚBLICO (sem login).
// Visual = padrão do app (modal-content / form-group / input-currency / file-upload-button).
// Spec: docs/specs/2026-06-12-cadastro-publico-parceria-figueira-S1-spec.md
import { useEffect, useRef, useState } from 'react'
import { Upload, FileText, X } from 'lucide-react'
import '../styles/ClienteDashboard.css'

const PROXY = import.meta.env.VITE_PARCERIA_PROXY_URL || ''
// Sem proxy configurado → MODO TESTE: form funciona sem backend (uploads/envio simulados).
const MOCK = !PROXY
// Figueira (SC) no RH — a PROD resolve por empreendimento_id (UUID), não por sienge_enterprise_id.
const FIGUEIRA_EMP_ID = import.meta.env.VITE_FIGUEIRA_EMP_ID || '2b1db83a-cce3-4d72-8444-ae7a3d8e4f98'

// "1.234,56" (o R$ vem do currency-prefix)
const fmtMoney = (v) => {
  const n = String(v).replace(/\D/g, '')
  if (!n) return ''
  return (Number(n) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const parseNum = (v) => Number(String(v).replace(/\D/g, '')) / 100
const onlyDigits = (v, max) => String(v).replace(/\D/g, '').slice(0, max)
const validaCPF = (cpf) => {
  const c = String(cpf).replace(/\D/g, '')
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false
  let s = 0
  for (let i = 0; i < 9; i++) s += +c[i] * (10 - i)
  let d = (s * 10) % 11 % 10
  if (d !== +c[9]) return false
  s = 0
  for (let i = 0; i < 10; i++) s += +c[i] * (11 - i)
  d = (s * 10) % 11 % 10
  return d === +c[10]
}

// ── Normalização + segurança (form PÚBLICO) ────────────────────────────────
const sanitize = (s, max = 200) => {
  const semCtrl = String(s ?? '').split('').filter((ch) => {
    const n = ch.charCodeAt(0)
    return n >= 32 && n !== 127
  }).join('')
  return semCtrl.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
}
const CONECTORES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del'])
const titleCaseNome = (s) =>
  sanitize(s, 80).toLowerCase().split(' ')
    .map((w, i) => (i > 0 && CONECTORES.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
const NAME_KEYS = ['corretor_nome', 'corretor_sobrenome', 'cliente_nome', 'cliente_sobrenome', 'cliente_nome_pai', 'cliente_nome_mae', 'cliente_empresa', 'cliente_profissao', 'cliente_cidade', 'conjuge_nome', 'conjuge_sobrenome', 'conjuge_profissao', 'conjuge_empresa', 'corretor_imobiliaria']
const EMAIL_KEYS = ['corretor_email', 'cliente_email']
const SKIP_KEYS = new Set(['assinatura_data_url'])
const normalizePayload = (p) => {
  const out = {}
  for (const [k, v] of Object.entries(p)) {
    if (typeof v !== 'string' || SKIP_KEYS.has(k)) { out[k] = v; continue }
    if (EMAIL_KEYS.includes(k)) out[k] = sanitize(v, 120).toLowerCase()
    else if (NAME_KEYS.includes(k)) out[k] = titleCaseNome(v)
    else out[k] = sanitize(v, k === 'observacoes_finais' ? 1000 : 200)
  }
  return out
}

const pageWrap = { minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }

const TERMO_TEXT = `Ao preencher e enviar este formulário, o corretor declara, sob sua responsabilidade, que todas as informações prestadas são verdadeiras, completas e atualizadas, sem qualquer omissão de fatos relevantes para a negociação e elaboração do contrato. Declara ainda que possui inscrição ativa e regularizada no Conselho Regional de Corretores de Imóveis (CRECI) e que anexou a carteira profissional e a certidão de regularidade atualizada emitida pelo órgão competente. O corretor afirma que explicou ao cliente todos os detalhes da negociação, incluindo as condições da proposta, a forma de contratação da incorporadora, todos os cenários possíveis de financiamento e seus impactos, bem como os riscos e obrigações assumidos ao contratar um financiamento. Nos empreendimentos que ainda não possuem o registro da incorporação, esclareceu ao cliente que a reserva caracteriza uma modalidade de investimento, que o cliente assume a posição de investidor conforme as regras do Termo de Reserva vigente, que o empreendimento encontra-se em fase final de projeto e aguarda aprovação dos órgãos públicos para registro da incorporação, e que o cliente está ciente dos riscos e condições envolvidos até a emissão do registro. O corretor também informou ao cliente que, após o registro da incorporação, será feito o distrato do Termo de Reserva e celebrado um novo Contrato de Compra e Venda tradicional, com novas condições comerciais previstas em lei. Explicou e alertou que todos os empreendimentos da IM Incorporadora devem ser financiados exclusivamente pela Caixa Econômica Federal, não sendo aceitos financiamentos por outros bancos, financeiras, consórcios ou cartas de crédito. Informou que o cliente será responsável pelo pagamento das despesas de documentação (registro, escritura, ITBI) assim que assinar o financiamento com a Caixa, que o cliente pagará juros de obra proporcionais à evolução da construção durante o período de obras e que essas parcelas são atualizadas conforme o andamento da obra. O corretor declara ter apresentado ao cliente a simulação correta do financiamento habitacional no modelo de Apoio à Produção (Imóvel na Planta), realizada no Portal de Empreendimentos da Caixa Econômica Federal, esclarecendo ao cliente que simulações tradicionais de financiamento pós-chaves não se aplicam para imóveis na planta e que as condições e taxas podem variar conforme o perfil do cliente e a evolução da obra. Reconhece que a responsabilidade pelo enquadramento financeiro, aprovação de crédito e cumprimento das condições do financiamento é exclusiva do cliente. O corretor declara ciência de que qualquer divergência, omissão ou informação falsa poderá acarretar no cancelamento da negociação, perda da reserva da unidade e responsabilização por eventuais prejuízos.`

// ── Campos reutilizáveis (NÍVEL DE MÓDULO — não recriar no render, senão o input perde foco) ──
function MoneyField({ label, req, value, onChange }) {
  return (
    <div className="form-group">
      <label>{label}{req ? ' *' : ''}</label>
      <div className="input-currency">
        <span className="currency-prefix">R$</span>
        <input type="text" inputMode="numeric" autoComplete="new-password" autoCorrect="off" placeholder="0,00" value={value} onChange={onChange} />
      </div>
    </div>
  )
}
// Suporta VÁRIOS arquivos por documento (frente/verso etc.): botão "Adicionar mais um" + lista removível.
function UploadField({ label, req, files = [], onPick, onRemove }) {
  return (
    <div className="form-group">
      <label>{label}{req ? ' *' : ''}</label>
      <label className="file-upload-label" style={{ position: 'relative' }}>
        <input type="file" accept="image/*,.pdf" multiple className="file-upload-input" onChange={onPick} />
        <span className="file-upload-button"><Upload size={16} />{files.length ? 'Adicionar mais um' : 'Escolher arquivo(s)'}</span>
      </label>
      {files.map((f, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6, padding: '8px 12px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, fontSize: 13 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.85)', overflow: 'hidden' }}>
            <FileText size={15} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</span>
          </span>
          <button type="button" onClick={() => onRemove(i)} aria-label="Remover" style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', display: 'flex' }}><X size={16} /></button>
        </div>
      ))}
    </div>
  )
}

export default function CadastroFigueira() {
  const [step, setStep] = useState(1)
  const [empreendimentoId, setEmpId] = useState(FIGUEIRA_EMP_ID)
  const [empNome, setEmpNome] = useState('Figueira Garcia')
  const [form, setForm] = useState({
    regiao: 'SC',
    forma_pagamento_entrada: 'vista',
    cliente_estado_civil: 'solteiro',
    melhor_dia_pagamento: '10',
    utiliza_fgts: 'nao',
    primeiro_imovel: 'sim',
    cliente_fgts_subsidio_pos_2005: 'nao',
    cliente_fgts_3anos: 'nao',
    tem_complemento_renda: 'nao',
    termo_aceito: false,
  })
  const [docs, setDocs] = useState({}) // { [key]: [ref, ...] }
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [sucesso, setSucesso] = useState(null)
  // iOS/Safari: 'new-password' é o ÚNICO token que de fato suprime o AutoFill de contato/
  // endereço (o popover "Manage addresses…" que tampa o teclado). 'autocomplete=off' é
  // IGNORADO pelo iOS em campos rotulados como nome/endereço. Sem <form> nesta tela, isso
  // não dispara o sheet de "Strong Password". email/tel ficam com seus tokens (já abrem).
  const noFill = { autoComplete: 'new-password', autoCorrect: 'off', spellCheck: false }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
  const setMoney = (k) => (e) => setForm((f) => ({ ...f, [k]: fmtMoney(e.target.value) }))
  // setTimeout(0): adia o title-case pra DEPOIS da troca de foco — senão o setState
  // síncrono no onBlur "engole" o teclado do próximo campo no iOS.
  const blurName = (k) => () => setTimeout(() => setForm((f) => ({ ...f, [k]: titleCaseNome(f[k] || '') })), 0)
  const onPick = (k, tipo) => async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // permite re-selecionar o mesmo arquivo
    for (const f of files) await upload(k, tipo, f)
  }
  const removeDoc = (k, idx) => setDocs((d) => ({ ...d, [k]: (d[k] || []).filter((_, i) => i !== idx) }))
  // ViaCEP: preenche endereço/cidade/estado automaticamente (complemento fica manual)
  const buscarCep = async (cep) => {
    const c = String(cep).replace(/\D/g, '')
    if (c.length !== 8) return
    try {
      const r = await fetch(`https://viacep.com.br/ws/${c}/json/`)
      const d = await r.json()
      if (!d || d.erro) return
      setForm((f) => ({
        ...f,
        cliente_endereco: d.logradouro || f.cliente_endereco,
        cliente_cidade: d.localidade || f.cliente_cidade,
        cliente_estado: d.uf || f.cliente_estado,
      }))
    } catch { /* CEP indisponível — segue manual */ }
  }
  const casado = ['casado', 'uniao_estavel'].includes(form.cliente_estado_civil)
  const fpe = form.forma_pagamento_entrada
  const temParcela = ['parcelada', 'parcelas_sinal', 'parcelas_sinal_baloes'].includes(fpe)
  const temSinal = ['parcelas_sinal', 'parcelas_sinal_baloes'].includes(fpe)
  const temBalao = fpe === 'parcelas_sinal_baloes'

  useEffect(() => {
    if (MOCK) { setEmpId('mock-figueira-sc'); setEmpNome('Figueira Garcia'); return }
    fetch(`${PROXY}/empreendimentos?regiao=SC`)
      .then((r) => r.json())
      .then((list) => {
        const arr = Array.isArray(list) ? list : list?.data || []
        const fig = arr.find((e) => String(e.sienge_enterprise_id) === '2104') ||
          arr.find((e) => /figueira/i.test(e.nome || e.name || '')) || arr[0]
        if (fig) { setEmpId(fig.id); setEmpNome(fig.nome || fig.name || 'Figueira Garcia') }
      })
      .catch(() => {})
  }, [])

  async function upload(key, tipo, file) {
    if (!file) return
    let ref
    if (MOCK) {
      ref = { tipo, url: 'mock://' + file.name, path: 'mock', file_name: file.name, mime_type: file.type, file_size: file.size }
    } else {
      try {
        const fd = new FormData()
        fd.append('file', file); fd.append('tipo', tipo)
        const r = await fetch(`${PROXY}/upload`, { method: 'POST', body: fd })
        if (!r.ok) return setErro(`Falha no upload de ${tipo} (HTTP ${r.status})`)
        ref = { tipo, ...(await r.json()) }
      } catch (err) {
        return setErro(`Falha no upload de ${tipo}: ${err.message}. (O proxy/edge está no ar?)`)
      }
    }
    setDocs((d) => ({ ...d, [key]: [...(d[key] || []), ref] }))
  }

  function validar(n) {
    setErro('')
    if (n === 1) {
      if (!form.corretor_nome || !form.corretor_sobrenome || !form.corretor_creci || !form.corretor_telefone || !form.corretor_email || !form.corretor_pix) return 'Preencha os campos obrigatórios do corretor.'
      if (!docs.creci?.length) return 'Anexe o CRECI.'
    }
    if (n === 2) {
      if (!form.cliente_nome || !form.cliente_sobrenome || !form.cliente_cpf || !form.cliente_rg || !form.cliente_data_nascimento ||
        !form.cliente_nome_pai || !form.cliente_nome_mae || !form.cliente_profissao || !form.cliente_empresa || !form.cliente_renda ||
        !form.cliente_email || !form.cliente_telefone || !form.cliente_endereco) return 'Preencha os campos obrigatórios do cliente.'
      if (!validaCPF(form.cliente_cpf)) return 'CPF do cliente inválido.'
      if (!docs.rg_cpf_cliente?.length || !docs.comp_residencia_cliente?.length || !docs.comp_renda_cliente?.length) return 'Anexe RG/CPF, comprovante de residência e de renda.'
      if (form.tem_complemento_renda === 'sim' && (!form.complemento_renda_info || !docs.rg_cpf_complemento?.length || !docs.comp_residencia_complemento?.length || !docs.comp_renda_complemento?.length)) return 'Preencha as informações e os documentos do complemento de renda.'
      // Cônjuge é OPCIONAL (preencher só se compor renda/for coproponente); valida o CPF apenas se preenchido.
      if (casado && form.conjuge_cpf && !validaCPF(form.conjuge_cpf)) return 'CPF do cônjuge inválido.'
    }
    if (n === 3) {
      if (!empreendimentoId) return 'Empreendimento (Figueira) não carregou — confira a conexão com o RH.'
      if (!form.imovel_unidade_reservada || !form.imovel_valor || !form.entrada_valor || !form.financiado_valor) return 'Preencha imóvel, entrada e valor financiado.'
      if (!docs.simulacao_financiamento?.length) return 'Anexe a simulação de financiamento.'
    }
    if (n === 4) {
      if (!docs.creci?.length || !docs.rg_cpf_cliente?.length || !docs.comp_residencia_cliente?.length || !docs.comp_renda_cliente?.length || !docs.simulacao_financiamento?.length) return 'Faltam documentos obrigatórios — volte aos passos e reanexe (confira se o proxy está no ar).'
      if (!form.termo_aceito) return 'Você precisa aceitar o Termo.'
      if (!form.assinatura_data_url) return 'Assine no campo indicado.'
    }
    return ''
  }
  const next = () => { const e = validar(step); if (e) return setErro(e); setStep((s) => s + 1) }
  const back = () => { setErro(''); setStep((s) => s - 1) }

  async function enviar() {
    const e = validar(4); if (e) return setErro(e)
    setEnviando(true); setErro('')
    if (MOCK) { setSucesso({ card_id: 'MOCK-LOCAL' }); setEnviando(false); return }
    try {
      const payload = normalizePayload({
        ...form,
        regiao: 'SC', empreendimento_id: empreendimentoId, sienge_enterprise_id: 2104,
        imovel_valor: parseNum(form.imovel_valor),
        entrada_valor: parseNum(form.entrada_valor),
        financiado_valor: parseNum(form.financiado_valor),
        cliente_renda: form.cliente_renda ? parseNum(form.cliente_renda) : undefined,
        conjuge_renda: form.conjuge_renda ? parseNum(form.conjuge_renda) : undefined,
        parcelado_valor: form.parcelado_valor ? parseNum(form.parcelado_valor) : undefined,
        parcelado_qtd: form.parcelado_qtd ? Number(form.parcelado_qtd) : undefined,
        sinal_valor: form.sinal_valor || undefined, // RH guarda como TEXTO — não converter
        balao_valor: form.balao_valor ? parseNum(form.balao_valor) : undefined,
        balao_qtd: form.balao_qtd ? Number(form.balao_qtd) : undefined,
        fgts_valor: form.fgts_valor ? parseNum(form.fgts_valor) : undefined,
        melhor_dia_pagamento: Number(form.melhor_dia_pagamento) || undefined,
        utiliza_fgts: form.utiliza_fgts === 'sim',
        primeiro_imovel: form.primeiro_imovel === 'sim',
        tem_complemento_renda: form.tem_complemento_renda === 'sim',
        cliente_fgts_3anos: form.cliente_fgts_3anos === 'sim',
        cliente_fgts_subsidio_pos_2005: form.cliente_fgts_subsidio_pos_2005 === 'sim',
        documentos: Object.values(docs).flat(),
      })
      const r = await fetch(`${PROXY}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || `Erro ${r.status}`)
      setSucesso({ card_id: data.card_id, warning: data.warning, nDocs: payload.documentos.length })
    } catch (err) { setErro(err.message || 'Falha ao enviar.') }
    finally { setEnviando(false) }
  }

  if (sucesso) {
    return (
      <div style={pageWrap}>
        <div className="modal-content" style={{ maxWidth: 560, width: '100%' }}>
          <div className="modal-header"><h2>Negociação enviada ✓</h2></div>
          <div className="modal-body">
            <p>Recebemos sua negociação do <b>{empNome}</b>.</p>
            <p>Protocolo: <b>{sucesso.card_id || '—'}</b></p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>{sucesso.nDocs ?? 0} documento(s) enviado(s).</p>
            {sucesso.warning && <div style={{ color: '#c9a962', fontSize: 13, marginTop: 8 }}>⚠️ {sucesso.warning}</div>}
            <small className="form-hint">Você receberá a confirmação no contato informado.</small>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={pageWrap} className="cf-root">
      <style>{`
        .cf-root .modal-footer .btn-primary { color: #1a1a1a !important; font-weight: 700; }
        .cf-root .cf-termo {
          flex: 0 0 auto;  /* modal-body é flex column c/ max-height: NÃO encolher (senão vira 2 linhas) */
          padding: 16px; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
          max-height: clamp(220px, 42vh, 380px); overflow-y: auto; -webkit-overflow-scrolling: touch;
          font-size: 14.5px; line-height: 1.75; color: rgba(255,255,255,0.9);
          text-align: justify; background: rgba(255,255,255,0.02);
        }
        @media (max-width: 600px) {
          .cf-root .form-row { flex-direction: column; gap: 0; }
          .cf-root .modal-footer { flex-direction: column-reverse; gap: 10px; }
          .cf-root .modal-footer button { width: 100%; justify-content: center; padding: 14px 16px; font-size: 15px; }
          .cf-root .cf-termo { text-align: left; font-size: 15px; line-height: 1.8; max-height: 50vh; padding: 14px; }
        }
      `}</style>
      <div className="modal-content" style={{ maxWidth: 760, width: '100%' }}>
        <div className="modal-header"><h2>Cadastro de Negociação — {empNome}</h2></div>
        <div className="modal-body">
          <small className="form-hint" style={{ display: 'block', marginBottom: 14 }}>
            Passo {step} de 4 — {['Dados do corretor', 'Dados do cliente', 'Dados da negociação', 'Termo e assinatura'][step - 1]} · Região: <b>SC</b>
          </small>
          {MOCK && (
            <div style={{ background: 'rgba(201,169,98,0.12)', border: '1px solid #c9a962', color: '#c9a962', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 14 }}>
              ⚠️ Modo teste — backend não configurado (<code>VITE_PARCERIA_PROXY_URL</code>). Uploads e envio são simulados; nada vai pro funil ainda.
            </div>
          )}

          {step === 1 && (
            <>
              <div className="form-row">
                <div className="form-group"><label>Nome do corretor *</label><input type="text" {...noFill} value={form.corretor_nome || ''} onChange={set('corretor_nome')} onBlur={blurName('corretor_nome')} /></div>
                <div className="form-group"><label>Sobrenome *</label><input type="text" {...noFill} value={form.corretor_sobrenome || ''} onChange={set('corretor_sobrenome')} onBlur={blurName('corretor_sobrenome')} /></div>
              </div>
              <div className="form-group"><label>CRECI *</label><input type="text" {...noFill} value={form.corretor_creci || ''} onChange={set('corretor_creci')} maxLength={20} /></div>
              <UploadField label="Foto/PDF da carteira do CRECI (frente/verso) + Certidão de Regularidade" req files={docs.creci} onPick={onPick('creci', 'creci')} onRemove={(i) => removeDoc('creci', i)} />
              <div className="form-row">
                <div className="form-group"><label>Telefone (WhatsApp) *</label><input type="tel" inputMode="tel" autoComplete="tel" value={form.corretor_telefone || ''} onChange={set('corretor_telefone')} maxLength={20} /></div>
                <div className="form-group"><label>E-mail *</label><input type="email" inputMode="email" autoComplete="email" value={form.corretor_email || ''} onChange={set('corretor_email')} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Nome da imobiliária (se houver)</label><input type="text" {...noFill} value={form.corretor_imobiliaria || ''} onChange={set('corretor_imobiliaria')} onBlur={blurName('corretor_imobiliaria')} /></div>
                <div className="form-group"><label>PIX para comissão *</label><input type="text" {...noFill} value={form.corretor_pix || ''} onChange={set('corretor_pix')} /></div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="form-row">
                <div className="form-group"><label>Nome do cliente *</label><input type="text" {...noFill} value={form.cliente_nome || ''} onChange={set('cliente_nome')} onBlur={blurName('cliente_nome')} /></div>
                <div className="form-group"><label>Sobrenome *</label><input type="text" {...noFill} value={form.cliente_sobrenome || ''} onChange={set('cliente_sobrenome')} onBlur={blurName('cliente_sobrenome')} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>CPF *</label><input type="text" {...noFill} value={form.cliente_cpf || ''} onChange={(e) => setForm((f) => ({ ...f, cliente_cpf: onlyDigits(e.target.value, 11) }))} inputMode="numeric" /></div>
                <div className="form-group"><label>RG *</label><input type="text" {...noFill} value={form.cliente_rg || ''} onChange={set('cliente_rg')} maxLength={15} /></div>
                <div className="form-group"><label>Data de nascimento *</label><input type="date" autoComplete="new-password" value={form.cliente_data_nascimento || ''} onChange={set('cliente_data_nascimento')} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Nome do pai *</label><input type="text" {...noFill} value={form.cliente_nome_pai || ''} onChange={set('cliente_nome_pai')} onBlur={blurName('cliente_nome_pai')} /></div>
                <div className="form-group"><label>Nome da mãe *</label><input type="text" {...noFill} value={form.cliente_nome_mae || ''} onChange={set('cliente_nome_mae')} onBlur={blurName('cliente_nome_mae')} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Estado civil *</label>
                  <select value={form.cliente_estado_civil} onChange={set('cliente_estado_civil')}>
                    <option value="solteiro">Solteiro(a)</option><option value="casado">Casado(a)</option>
                    <option value="divorciado">Divorciado(a)</option><option value="viuvo">Viúvo(a)</option><option value="uniao_estavel">União estável</option>
                  </select>
                </div>
                <div className="form-group"><label>Profissão *</label><input type="text" {...noFill} value={form.cliente_profissao || ''} onChange={set('cliente_profissao')} onBlur={blurName('cliente_profissao')} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Empresa onde trabalha *</label><input type="text" {...noFill} value={form.cliente_empresa || ''} onChange={set('cliente_empresa')} onBlur={blurName('cliente_empresa')} /></div>
                <MoneyField label="Renda mensal" req value={form.cliente_renda || ''} onChange={setMoney('cliente_renda')} />
              </div>
              <div className="form-row">
                <div className="form-group"><label>E-mail *</label><input type="email" inputMode="email" autoComplete="email" value={form.cliente_email || ''} onChange={set('cliente_email')} /></div>
                <div className="form-group"><label>Telefone (WhatsApp) *</label><input type="tel" inputMode="tel" autoComplete="tel" value={form.cliente_telefone || ''} onChange={set('cliente_telefone')} maxLength={20} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>CEP</label><input type="text" {...noFill} value={form.cliente_cep || ''} onChange={(e) => { const v = onlyDigits(e.target.value, 8); setForm((f) => ({ ...f, cliente_cep: v })); if (v.length === 8) buscarCep(v) }} inputMode="numeric" placeholder="Só números" /></div>
                <div className="form-group"><label>Endereço *</label><input type="text" {...noFill} value={form.cliente_endereco || ''} onChange={set('cliente_endereco')} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Complemento</label><input type="text" {...noFill} value={form.cliente_endereco_cont || ''} onChange={set('cliente_endereco_cont')} /></div>
                <div className="form-group"><label>Cidade</label><input type="text" {...noFill} value={form.cliente_cidade || ''} onChange={set('cliente_cidade')} onBlur={blurName('cliente_cidade')} /></div>
                <div className="form-group"><label>Estado</label><input type="text" {...noFill} value={form.cliente_estado || ''} onChange={(e) => set('cliente_estado')(e.target.value.toUpperCase())} maxLength={2} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Possui 3 anos sob regime do FGTS?</label>
                  <select value={form.cliente_fgts_3anos || 'nao'} onChange={set('cliente_fgts_3anos')}><option value="nao">Não</option><option value="sim">Sim</option></select>
                </div>
                <div className="form-group"><label>Já beneficiado com subsídio do FGTS após 16/05/05? *</label>
                  <select value={form.cliente_fgts_subsidio_pos_2005} onChange={set('cliente_fgts_subsidio_pos_2005')}><option value="nao">Não</option><option value="sim">Sim</option></select>
                </div>
              </div>

              <div className="section-divider"><span>Documentos do cliente</span></div>
              <UploadField label="Foto/PDF do RG e CPF (frente e verso)" req files={docs.rg_cpf_cliente} onPick={onPick('rg_cpf_cliente', 'rg')} onRemove={(i) => removeDoc('rg_cpf_cliente', i)} />
              <UploadField label="Comprovante de residência" req files={docs.comp_residencia_cliente} onPick={onPick('comp_residencia_cliente', 'comprovante_residencia')} onRemove={(i) => removeDoc('comp_residencia_cliente', i)} />
              <UploadField label="Comprovante de renda" req files={docs.comp_renda_cliente} onPick={onPick('comp_renda_cliente', 'comprovante_renda')} onRemove={(i) => removeDoc('comp_renda_cliente', i)} />
              <UploadField label="Certidão de casamento / união estável (se aplicável)" files={docs.certidao_casamento} onPick={onPick('certidao_casamento', 'certidao_casamento')} onRemove={(i) => removeDoc('certidao_casamento', i)} />

              <div className="section-divider"><span>Complemento de renda</span></div>
              <div className="form-group"><label>Haverá complemento de renda? *</label>
                <select value={form.tem_complemento_renda || 'nao'} onChange={set('tem_complemento_renda')}><option value="nao">Não</option><option value="sim">Sim</option></select>
              </div>
              {form.tem_complemento_renda === 'sim' && (
                <>
                  <div className="form-group"><label>Informações da(s) pessoa(s) que vão complementar a renda *</label><textarea {...noFill} value={form.complemento_renda_info || ''} onChange={set('complemento_renda_info')} /></div>
                  <UploadField label="RG e CPF do complementador" req files={docs.rg_cpf_complemento} onPick={onPick('rg_cpf_complemento', 'doc_complemento_rg_cpf')} onRemove={(i) => removeDoc('rg_cpf_complemento', i)} />
                  <UploadField label="Comprovante de residência do complementador" req files={docs.comp_residencia_complemento} onPick={onPick('comp_residencia_complemento', 'doc_complemento_residencia')} onRemove={(i) => removeDoc('comp_residencia_complemento', i)} />
                  <UploadField label="Comprovante de renda do complementador" req files={docs.comp_renda_complemento} onPick={onPick('comp_renda_complemento', 'doc_complemento_renda')} onRemove={(i) => removeDoc('comp_renda_complemento', i)} />
                </>
              )}

              {casado && (
                <>
                  <div className="section-divider"><span>Dados do cônjuge</span></div>
                  <small className="form-hint" style={{ display: 'block', marginBottom: 8 }}>Opcional — preencha apenas se o cônjuge for coproponente / compor renda.</small>
                  <div className="form-row">
                    <div className="form-group"><label>Nome</label><input type="text" {...noFill} value={form.conjuge_nome || ''} onChange={set('conjuge_nome')} onBlur={blurName('conjuge_nome')} /></div>
                    <div className="form-group"><label>Sobrenome</label><input type="text" {...noFill} value={form.conjuge_sobrenome || ''} onChange={set('conjuge_sobrenome')} onBlur={blurName('conjuge_sobrenome')} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label>CPF</label><input type="text" {...noFill} value={form.conjuge_cpf || ''} onChange={(e) => setForm((f) => ({ ...f, conjuge_cpf: onlyDigits(e.target.value, 11) }))} inputMode="numeric" /></div>
                    <div className="form-group"><label>RG</label><input type="text" {...noFill} value={form.conjuge_rg || ''} onChange={set('conjuge_rg')} maxLength={15} /></div>
                    <div className="form-group"><label>Data de nascimento</label><input type="date" autoComplete="new-password" value={form.conjuge_data_nascimento || ''} onChange={set('conjuge_data_nascimento')} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label>Profissão</label><input type="text" {...noFill} value={form.conjuge_profissao || ''} onChange={set('conjuge_profissao')} onBlur={blurName('conjuge_profissao')} /></div>
                    <div className="form-group"><label>Empresa</label><input type="text" {...noFill} value={form.conjuge_empresa || ''} onChange={set('conjuge_empresa')} onBlur={blurName('conjuge_empresa')} /></div>
                  </div>
                  <div className="form-row">
                    <MoneyField label="Renda mensal" value={form.conjuge_renda || ''} onChange={setMoney('conjuge_renda')} />
                    <div className="form-group"><label>Telefone (WhatsApp)</label><input type="tel" inputMode="tel" autoComplete="tel" value={form.conjuge_telefone || ''} onChange={set('conjuge_telefone')} maxLength={20} /></div>
                  </div>
                  <UploadField label="RG e CPF do cônjuge" files={docs.rg_cpf_conjuge} onPick={onPick('rg_cpf_conjuge', 'doc_conjuge')} onRemove={(i) => removeDoc('rg_cpf_conjuge', i)} />
                  <UploadField label="Comprovante de renda do cônjuge" files={docs.comp_renda_conjuge} onPick={onPick('comp_renda_conjuge', 'doc_conjuge_renda')} onRemove={(i) => removeDoc('comp_renda_conjuge', i)} />
                </>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <div className="form-group"><label>Empreendimento</label><input value={empNome} disabled /></div>
              <div className="form-group"><label>Unidade reservada *</label><input type="text" {...noFill} value={form.imovel_unidade_reservada || ''} onChange={set('imovel_unidade_reservada')} maxLength={20} /></div>
              <div className="form-row">
                <MoneyField label="Valor do imóvel" req value={form.imovel_valor || ''} onChange={setMoney('imovel_valor')} />
                <MoneyField label="Valor da entrada" req value={form.entrada_valor || ''} onChange={setMoney('entrada_valor')} />
              </div>
              <div className="section-divider"><span>Condições de pagamento (pro-soluto)</span></div>
              <div className="form-group"><label>Forma de pagamento da entrada *</label>
                <select value={fpe} onChange={set('forma_pagamento_entrada')}>
                  <option value="vista">À vista</option><option value="parcelada">Parcelada</option>
                  <option value="parcelas_sinal">Parcelas + Sinal</option><option value="parcelas_sinal_baloes">Parcelas + Sinal + Balões</option>
                </select>
              </div>
              {temParcela && (
                <div className="form-row">
                  <MoneyField label="Valor das parcelas" req value={form.parcelado_valor || ''} onChange={setMoney('parcelado_valor')} />
                  <div className="form-group"><label>Qtd. de parcelas (máx 53) *</label><input type="text" {...noFill} value={form.parcelado_qtd || ''} onChange={(e) => set('parcelado_qtd')(onlyDigits(e.target.value, 2))} inputMode="numeric" /></div>
                </div>
              )}
              {temSinal && (<><MoneyField label="Valor do sinal" req value={form.sinal_valor || ''} onChange={setMoney('sinal_valor')} /><UploadField label="Comprovante do sinal" req files={docs.comprovante_sinal} onPick={onPick('comprovante_sinal', 'comprovante_sinal')} onRemove={(i) => removeDoc('comprovante_sinal', i)} /></>)}
              {temBalao && (
                <div className="form-row">
                  <div className="form-group"><label>Qtd. de balões *</label><input type="text" {...noFill} value={form.balao_qtd || ''} onChange={(e) => set('balao_qtd')(onlyDigits(e.target.value, 2))} inputMode="numeric" /></div>
                  <MoneyField label="Valor dos balões" req value={form.balao_valor || ''} onChange={setMoney('balao_valor')} />
                </div>
              )}
              <div className="form-row">
                <MoneyField label="Valor a ser financiado" req value={form.financiado_valor || ''} onChange={setMoney('financiado_valor')} />
                <div className="form-group"><label>Melhor dia para pagamento *</label>
                  <select value={form.melhor_dia_pagamento} onChange={set('melhor_dia_pagamento')}><option value="10">Dia 10</option><option value="20">Dia 20</option></select>
                </div>
              </div>
              <UploadField label="Simulação de financiamento (Caixa)" req files={docs.simulacao_financiamento} onPick={onPick('simulacao_financiamento', 'simulacao_financiamento')} onRemove={(i) => removeDoc('simulacao_financiamento', i)} />
              <div className="form-group"><label>Observações finais</label><textarea {...noFill} value={form.observacoes_finais || ''} onChange={set('observacoes_finais')} /></div>
            </>
          )}

          {step === 4 && (
            <>
              <UploadField label="Comprovante de pagamento (se aplicável)" files={docs.comprovante_pagamento} onPick={onPick('comprovante_pagamento', 'comprovante_pagamento')} onRemove={(i) => removeDoc('comprovante_pagamento', i)} />
              <div className="section-divider"><span>Termo de responsabilidade</span></div>
              <small className="form-hint" style={{ display: 'block', marginBottom: 8 }}>Role para ler o termo completo antes de aceitar.</small>
              <div className="cf-termo">
                {TERMO_TEXT}
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0', fontSize: 14 }}>
                <input type="checkbox" checked={form.termo_aceito} onChange={(e) => set('termo_aceito')(e.target.checked)} style={{ width: 'auto' }} />
                Li, compreendi e concordo integralmente com o Termo.
              </label>
              <div className="form-group"><label>Assinatura *</label><SignaturePad onChange={(d) => set('assinatura_data_url')(d)} /></div>
            </>
          )}

          {erro && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 12 }}>{erro}</div>}
        </div>

        <div className="modal-footer">
          {step > 1 ? <button className="btn-secondary" onClick={back}>Voltar</button> : <span />}
          {step < 4
            ? <button className="btn-primary" onClick={next} style={{ color: '#1a1a1a', fontWeight: 700 }}>Próximo</button>
            : <button className="btn-primary" onClick={enviar} disabled={enviando} style={{ color: '#1a1a1a', fontWeight: 700, gap: 8 }}>{enviando ? 'Enviando…' : 'Enviar cadastro'}</button>}
        </div>
      </div>
    </div>
  )
}

function SignaturePad({ onChange }) {
  const ref = useRef(null)
  const drawing = useRef(false)
  useEffect(() => {
    const c = ref.current; const ctx = c.getContext('2d')
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.lineCap = 'round'
    const pos = (e) => { const r = c.getBoundingClientRect(); const t = e.touches?.[0] || e; return [t.clientX - r.left, t.clientY - r.top] }
    const start = (e) => { drawing.current = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y) }
    const move = (e) => { if (!drawing.current) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault() }
    const end = () => { if (drawing.current) { drawing.current = false; onChange(c.toDataURL('image/png')) } }
    c.addEventListener('mousedown', start); c.addEventListener('mousemove', move); window.addEventListener('mouseup', end)
    c.addEventListener('touchstart', start); c.addEventListener('touchmove', move, { passive: false }); window.addEventListener('touchend', end)
    return () => { window.removeEventListener('mouseup', end); window.removeEventListener('touchend', end) }
  }, [onChange])
  const limpar = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); onChange('') }
  return (
    <div>
      <canvas ref={ref} width={700} height={150} style={{ width: '100%', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, touchAction: 'none', background: '#fff' }} />
      <button type="button" className="btn-secondary" style={{ marginTop: 6, padding: '6px 14px', fontSize: 12 }} onClick={limpar}>Limpar assinatura</button>
    </div>
  )
}
