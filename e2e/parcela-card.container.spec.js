import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Contrato de LAYOUT do card de parcela do corretor (comissão-first).
// Lê o CSS REAL do componente (ParcelaCard.css) e o injeta, então o teste
// falha se o layout regredir na folha de verdade (não é uma cópia paralela).
const __dirname = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(__dirname, '../src/components/corretor/ParcelaCard.css'), 'utf8')

// Espelha a saída do ParcelaCard.jsx (status pago).
const CARD = `
  <div class="parcela-card pago">
    <div class="parcela-card-top">
      <span class="parcela-card-tipo">Entrada · Parcela 1</span>
      <span class="parcela-card-badges"><span class="status-pill pago">Pago</span></span>
    </div>
    <div class="parcela-card-comissao-label">Minha comissão</div>
    <div class="parcela-card-comissao">R$ 392,48</div>
    <div class="parcela-card-rodape">
      <span>pago em 20/03/2026</span><span class="parcela-card-sep">·</span>
      <span class="parcela-card-valor">valor da parcela R$ 1.962,39</span>
    </div>
  </div>`

async function mount(page, width) {
  await page.setContent(`<div style="width:${width}px">${CARD}</div>`)
  await page.addStyleTag({ content: css })
}

const fontPx = (page, sel) =>
  page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

test.describe('ParcelaCard — contrato comissão-first', () => {
  // Cenário BDD: "card lidera com a comissão do corretor, valor da parcela é contexto"
  test('comissão é o herói: rótulo presente e maior que o valor da parcela', async ({ page }) => {
    await mount(page, 320)

    await expect(page.locator('.parcela-card-comissao-label')).toHaveText('Minha comissão')
    await expect(page.locator('.parcela-card-comissao')).toHaveText('R$ 392,48')

    // a comissão (herói) é tipograficamente maior que o valor da parcela (rodapé)
    const comissao = await fontPx(page, '.parcela-card-comissao')
    const rodape = await fontPx(page, '.parcela-card-valor')
    expect(comissao).toBeGreaterThan(rodape)
  })

  test('sem scroll horizontal num container estreito (320px)', async ({ page }) => {
    await mount(page, 320)
    const overflow = await page
      .locator('.parcela-card')
      .evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
