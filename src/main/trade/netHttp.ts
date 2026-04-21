import { net, session } from 'electron'

export type NetHttpResponse = {
  status: number
  statusText?: string
  headers: Record<string, string | string[]>
  url: string
  text: string
}

function normalizeHeaders(h: Record<string, string | string[]>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Milliseconds to wait before retrying after 429 / 503 (honours Retry-After when present). */
function backoffMsForRateLimit(headers: Record<string, string | string[]>, attemptIndex: number): number {
  const ra = headers['retry-after']
  const raw = Array.isArray(ra) ? ra[0] : ra
  if (raw) {
    const sec = parseInt(String(raw).trim(), 10)
    if (!Number.isNaN(sec) && sec > 0) return Math.min(sec * 1000, 120_000)
  }
  const base = 1200 * 2 ** attemptIndex
  return Math.min(base, 30_000)
}

/**
 * Same as {@link netRequestText}, but retries on 429 (and transient 503) with backoff.
 * PoE trade endpoints rate-limit aggressively when many requests run back-to-back.
 */
export async function netRequestTextWithRetry(
  opts: {
    url: string
    method?: 'GET' | 'POST'
    headers?: Record<string, string>
    body?: string
  },
  retryOpts?: { maxAttempts?: number }
): Promise<NetHttpResponse> {
  const maxAttempts = Math.max(1, retryOpts?.maxAttempts ?? 6)
  let last: NetHttpResponse | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await netRequestText(opts)
    if (last.status === 429 || last.status === 503) {
      if (attempt + 1 >= maxAttempts) break
      const wait = backoffMsForRateLimit(last.headers, attempt)
      console.warn(`[netHttp] ${last.status} on ${opts.method ?? 'GET'} ${opts.url.slice(0, 80)}… — retry in ${wait}ms (${attempt + 1}/${maxAttempts})`)
      await sleep(wait)
      continue
    }
    return last
  }
  return last!
}

export async function netRequestText(opts: {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}): Promise<NetHttpResponse> {
  const ses = session.defaultSession
  const request = net.request({
    method: opts.method ?? 'GET',
    url: opts.url,
    session: ses
  })

  const headers = opts.headers ?? {}
  for (const [k, v] of Object.entries(headers)) request.setHeader(k, v)

  return await new Promise<NetHttpResponse>((resolve, reject) => {
    request.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: response.statusCode,
          statusText: response.statusMessage,
          headers: normalizeHeaders(response.headers as any),
          url: opts.url,
          text
        })
      })
      response.on('error', (e) => reject(e))
    })
    request.on('error', (e) => reject(e))

    if (opts.body) request.write(opts.body)
    request.end()
  })
}

export async function netRequestJson<T>(opts: {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
}): Promise<{ status: number; headers: Record<string, string | string[]>; url: string; json?: T; text: string }> {
  const bodyString =
    opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
  const res = await netRequestTextWithRetry({
    url: opts.url,
    method: opts.method,
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers ?? {})
    },
    body: bodyString
  })

  let json: T | undefined
  try {
    json = JSON.parse(res.text) as T
  } catch {
    // ignore; caller can inspect .text
  }

  return { status: res.status, headers: res.headers, url: res.url, json, text: res.text }
}

