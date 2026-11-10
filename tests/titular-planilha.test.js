// Resolução do titular de uma linha da planilha de cobranças (src/utils/titularPlanilha.js
// e o gêmeo scripts/boletos/_titular.cjs). Casos reais de nov/2026.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import { resolverTitular } from '../src/utils/titularPlanilha'

const require = createRequire(import.meta.url)
const { resolverTitular: resolverTitularRobo } = require('../scripts/boletos/_titular.cjs')

const clientes = [
  { id: 'manual', nome_completo: 'Ana Claudia Ventura da Silva', cpf: '089.007.389-92' },
  { id: 'sync', nome_completo: 'ANA CLAUDIA VENTURA DA SILVA', cpf: null },
  { id: 'outra-torre', nome_completo: 'LUCAS PORTO MARTINS', cpf: '086.559.669-75' },
  { id: 'xara', nome_completo: 'ANA CLAUDIA VENTURA DA SILVA', cpf: '111.444.777-35' },
]
const vendas = [
  { id: 'v-excluida', cliente_id: 'manual', unidade: '1506', status: 'pendente', excluido: true },
  { id: 'v-real', cliente_id: 'sync', unidade: '1506 D', status: 'pago', excluido: false },
  { id: 'v-1506A', cliente_id: 'outra-torre', unidade: '1506 A', status: 'pago', excluido: false },
]
const mapa = (cs) => {
  const m = new Map()
  cs.forEach(c => { const d = String(c.cpf ?? '').replace(/\D/g, ''); if (d) m.set(d, c) })
  return m
}

for (const [nome, fn, chaveLista] of [['tela', resolverTitular, 'clientes'], ['robô', resolverTitularRobo, 'dbClientes']]) {
  const base = (over = {}) => fn({
    cpfD: '08900738992', unidadePlanilha: 'FIGUEIRA 1506 D', nomePlanilha: 'ANA CLAUDIA VENTURA DA SILVA',
    cliPorCpf: mapa(clientes), [chaveLista]: clientes,
    [chaveLista === 'clientes' ? 'vendas' : 'dbVendas']: vendas, ...over,
  })

  describe(`resolverTitular (${nome})`, () => {
    it('CPF cai no cadastro antigo sem venda → acha o titular sem CPF de mesmo nome na unidade', () => {
      const r = base()
      expect(r.viaNome).toBe(true)
      expect(r.cli.id).toBe('sync')
      expect(r.vendasCli.map(v => v.id)).toEqual(['v-real'])
    })

    it('respeita a letra da torre: 1506 D não pega a 1506 A', () => {
      const r = base()
      expect(r.vendasCli.some(v => v.id === 'v-1506A')).toBe(false)
    })

    it('CPF inexistente no cadastro (digitado errado) ainda resolve pelo nome da planilha', () => {
      const r = base({ cpfD: '01541855582', cliPorCpf: new Map() })
      expect(r.cli?.id).toBe('sync')
    })

    it('nome diferente → não resolve (não chuta)', () => {
      const r = base({ nomePlanilha: 'OUTRA PESSOA' })
      expect(r.viaNome).toBe(false)
      expect(r.vendasCli).toEqual([])
    })

    it('titular com OUTRO CPF não é aceito mesmo com nome igual (homônimo)', () => {
      const vs = [{ id: 'v-xara', cliente_id: 'xara', unidade: '1506 D', status: 'pago', excluido: false }]
      const r = base({ [chaveLista === 'clientes' ? 'vendas' : 'dbVendas']: vs })
      expect(r.viaNome).toBe(false)
    })

    it('caminho normal (CPF com venda ativa) não muda', () => {
      const r = base({ cpfD: '08655966975', unidadePlanilha: 'FIGUEIRA 1506 A', nomePlanilha: 'LUCAS PORTO MARTINS' })
      expect(r.viaNome).toBe(false)
      expect(r.cli.id).toBe('outra-torre')
    })
  })
}

describe('dataPlanilhaISO (tela e robô)', async () => {
  const { dataPlanilhaISO } = await import('../src/utils/titularPlanilha')
  const { dataPlanilhaISO: robo } = require('../scripts/boletos/_titular.cjs')
  for (const [nome, fn] of [['tela', dataPlanilhaISO], ['robô', robo]]) {
    it(`${nome}: número de série do Excel (1105 B parc 18 = 46346) vira 20/11/2026`, () => {
      expect(fn(46346)).toBe('2026-11-20')
      expect(fn('46346')).toBe('2026-11-20')
    })
    it(`${nome}: texto dd/mm/aaaa, ISO e Date continuam funcionando`, () => {
      expect(fn('20/12/2026')).toBe('2026-12-20')
      expect(fn('2027-01-20')).toBe('2027-01-20')
      expect(fn(new Date(Date.UTC(2027, 1, 20)))).toBe('2027-02-20')
    })
    it(`${nome}: lixo não vira data`, () => {
      expect(fn(1166.66)).toBe(null)
      expect(fn('')).toBe(null)
      expect(fn(null)).toBe(null)
    })
  }
})
