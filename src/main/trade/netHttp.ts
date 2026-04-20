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
  const res = await netRequestText({
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

