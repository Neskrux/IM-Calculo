function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '')
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value) {
  const normalized = normalizeText(value)
  return normalized ? normalized.split(' ') : []
}

function formatCpf(digits) {
  const clean = digitsOnly(digits)
  if (clean.length !== 11) {
    return clean
  }

  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9)}`
}

function buildCpfVariants(cpf) {
  const clean = digitsOnly(cpf)
  if (!clean) {
    return []
  }

  return Array.from(new Set([clean, formatCpf(clean)]))
}

function calculateTokenScore(a, b) {
  const tokensA = tokenize(a)
  const tokensB = tokenize(b)

  if (tokensA.length === 0 || tokensB.length === 0) {
    return 0
  }

  const setA = new Set(tokensA)
  const setB = new Set(tokensB)
  let intersection = 0

  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1
    }
  }

  const union = new Set([...setA, ...setB]).size
  return union === 0 ? 0 : intersection / union
}

module.exports = {
  buildCpfVariants,
  calculateTokenScore,
  digitsOnly,
  normalizeText,
  tokenize
}
