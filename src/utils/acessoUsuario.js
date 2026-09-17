// Regras de acesso (login) de corretor/beneficiário — espelham o que a edge
// `admin-corretor-acesso` valida no servidor, pra tela não oferecer botão que
// vai falhar. A edge continua sendo a autoridade; isto é só o guarda da UI.
//
// Ver: supabase/functions/admin-corretor-acesso/index.ts
//      docs/specs/2026-09-04-spec-papel-coordenador.md

/** Email inventado pelo sync quando o Sienge não traz o do corretor. Não é endereço real. */
export const ehEmailPlaceholder = (email) => {
  const e = String(email || '').trim().toLowerCase()
  return e.endsWith('@sync.local') || e.endsWith('@placeholder.local')
}

export const ehEmailValido = (email) => {
  const e = String(email || '').trim().toLowerCase()
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !ehEmailPlaceholder(e)
}

/** A edge exige no mínimo 6 caracteres em criar e trocar_senha. */
export const SENHA_MIN = 6
export const senhaValida = (senha) => String(senha ?? '').length >= SENHA_MIN

/**
 * Quem pode ter a senha REDEFINIDA pela tela do Admin (ação 'trocar_senha').
 * Exige conta de Auth já existente — sem ela o caminho é 'criar', não 'trocar'.
 * A edge só aceita `tipo` corretor ou beneficiario.
 */
export const podeRedefinirSenha = (usuario) =>
  !!usuario &&
  usuario.tem_acesso_sistema === true &&
  (usuario.tipo === 'corretor' || usuario.tipo === 'beneficiario')

/**
 * Quem pode ter o acesso CRIADO pela tela (ação 'criar'): ainda sem conta e com
 * email real (o placeholder do sync geraria conta que ninguém alcança).
 */
export const podeCriarAcesso = (usuario, emailInformado) =>
  !!usuario &&
  usuario.tem_acesso_sistema !== true &&
  (usuario.tipo === 'corretor' || usuario.tipo === 'beneficiario') &&
  ehEmailValido(emailInformado ?? usuario.email)

/**
 * Ação que a tela deve oferecer pra este usuário. Uma fonte só, pra o rótulo do
 * botão e a chamada da edge nunca discordarem.
 * @returns {'criar'|'trocar_senha'|'bloqueado'}
 */
export const acaoDeAcesso = (usuario, emailInformado) => {
  if (podeRedefinirSenha(usuario)) return 'trocar_senha'
  if (podeCriarAcesso(usuario, emailInformado)) return 'criar'
  return 'bloqueado'
}

/**
 * Motivo legível de bloqueio, pra tela explicar em vez de só desabilitar botão.
 * Devolve null quando não há bloqueio.
 */
export const motivoBloqueioAcesso = (usuario, emailInformado) => {
  if (!usuario) return 'Nenhum cadastro selecionado.'
  if (usuario.tipo !== 'corretor' && usuario.tipo !== 'beneficiario') {
    return `Este cadastro é do tipo "${usuario.tipo}" — o acesso dele não é gerenciado por aqui.`
  }
  if (usuario.tem_acesso_sistema === true) return null
  const email = emailInformado ?? usuario.email
  if (ehEmailPlaceholder(email)) {
    return 'O e-mail do cadastro é temporário (gerado pelo sistema). Informe o e-mail real antes de criar o acesso.'
  }
  if (!ehEmailValido(email)) return 'Informe um e-mail válido para criar o acesso.'
  return null
}
