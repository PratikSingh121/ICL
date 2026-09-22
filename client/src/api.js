const ROOT = import.meta.env.VITE_API_URL || 'http://localhost:4000'
export const API = `${ROOT.replace(/\/$/, '')}/api`
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || ROOT

export async function api(path, options = {}) {
  const token = localStorage.getItem('icl_token')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 7000)
  try {
    const response = await fetch(`${API}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}), ...options.headers }
    })
    if (!response.ok) throw new Error(`Request failed (${response.status})`)
    return await response.json()
  } finally { clearTimeout(timeout) }
}
