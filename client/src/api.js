const ROOT = import.meta.env.VITE_API_URL || 'http://localhost:4000'
export const API = `${ROOT.replace(/\/$/, '')}/api`
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || ROOT

export async function api(path, options = {}) {
  const token = localStorage.getItem('icl_token')
  const controller = new AbortController()
  const { timeoutMs = 7000, ...fetchOptions } = options
  const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await fetch(`${API}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: { 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}), ...fetchOptions.headers }
    })
    const raw = response.status === 204 ? '' : await response.text()
    let payload = null
    if (raw) { try { payload = JSON.parse(raw) } catch { payload = raw } }
    if (!response.ok) throw new Error(payload?.message || payload?.error || (typeof payload === 'string' && payload) || `Request failed (${response.status})`)
    return payload
  } finally { if (timeout) clearTimeout(timeout) }
}
