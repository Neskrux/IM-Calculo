import { test, expect } from '@playwright/test'

// Varredura de OVERFLOW HORIZONTAL nas abas do corretor, no aparelho real (414px,
// iPhone 11). Rede de segurança contra o padrão que escapou das fixtures: moeda
// longa em layout fixo/multi-coluna/nowrap. Loga uma vez e visita cada aba.
//
// Credenciais via env (NUNCA commitadas):
//   E2E_CORRETOR_EMAIL / E2E_CORRETOR_PASSWORD

const EMAIL = process.env.E2E_CORRETOR_EMAIL
const PASSWORD = process.env.E2E_CORRETOR_PASSWORD

const TABS = ['dashboard', 'pagamentos', 'relatorios', 'vendas', 'clientes', 'empreendimentos', 'perfil']

const medirOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test.describe('Corretor — sem scroll horizontal (414px)', () => {
  test.skip(!EMAIL || !PASSWORD, 'defina E2E_CORRETOR_EMAIL / E2E_CORRETOR_PASSWORD')
  test.setTimeout(120000)

  test('nenhuma aba estoura a largura no iPhone 11', async ({ page }) => {
    await page.setViewportSize({ width: 414, height: 896 })

    // Login
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(EMAIL)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.locator('.login-button').click()
    await page.waitForURL('**/corretor/**', { timeout: 40000 })

    const problemas = []

    for (const tab of TABS) {
      await page.goto(`/corretor/${tab}`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(500)
      const o = await medirOverflow(page)
      if (o > 1) problemas.push(`${tab}: +${o}px`)
    }

    // Caso aninhado: expandir a 1ª venda em Pagamentos (header de ações + parcelas)
    await page.goto('/corretor/pagamentos')
    await page.waitForLoadState('networkidle').catch(() => {})
    const verPg = page.locator('.btn-ver-pagamentos').first()
    if (await verPg.count()) {
      await verPg.click()
      await page.waitForTimeout(600)
      const o = await medirOverflow(page)
      if (o > 1) problemas.push(`pagamentos(expandido): +${o}px`)
    }

    expect(problemas, `Abas com overflow: ${problemas.join(' · ') || 'nenhuma'}`).toEqual([])
  })
})
