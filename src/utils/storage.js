export const safeGet = (key) => {
  try { return localStorage.getItem(key) } catch { return null }
}
export const safeSet = (key, val) => {
  try { localStorage.setItem(key, val); return true } catch { return false }
}
export const safeRemove = (key) => {
  try { localStorage.removeItem(key); return true } catch { return false }
}
