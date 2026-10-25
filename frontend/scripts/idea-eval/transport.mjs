/** Limits actual HTTP attempts, including SDK/JEV retries. No headers enter artifacts. */
export function boundedTransport({ maxRequests = 13_500, timeoutMs = 60_000, maxConcurrent = 8, startCount = 0, fetcher = fetch, onRequest = () => {}, secrets = [] } = {}) {
  const controller = new AbortController()
  let count = startCount, active = 0
  const waiting = []
  const enter = async () => { if (active < maxConcurrent) active++; else await new Promise((resume) => waiting.push(resume)) }
  const leave = () => { const next = waiting.shift(); if (next) next(); else active-- }
  const redact = (value) => secrets.filter(Boolean).reduce((s, secret) => s.replaceAll(secret, '[REDACTED]'), String(value))
  const stop = (message) => { if (!controller.signal.aborted) controller.abort(new Error(message)) }
  return {
    get count() { return count },
    get stopped() { return controller.signal.aborted },
    get reason() { return controller.signal.reason?.message },
    stop, redact,
    async fetch(input, init = {}) {
      await enter()
      if (controller.signal.aborted) { leave(); throw controller.signal.reason }
      if (count >= maxRequests) { leave(); stop(`HTTP request limit (${maxRequests}) reached`); throw controller.signal.reason }
      const sequence = ++count
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
      const started = performance.now()
      let response, error
      let body
      try { body = JSON.parse(init.body ?? '{}') } catch { body = { unreadable: true } }
      try {
        response = await fetcher(input, { ...init, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs), ...(init.signal ? [init.signal] : [])]) })
        if (response.status === 401 || response.status === 403) stop(`Authentication rejected by ${new URL(url).hostname} (${response.status})`)
        // Consume a clone while the deadline applies, preserving the caller's response body.
        const responseBody = await response.clone().text()
        let value
        try { value = JSON.parse(redact(responseBody || '{}')) } catch { value = redact(responseBody).slice(0, 1000) }
        onRequest({ sequence, url, request: body, status: response.status, ms: performance.now() - started, response: value })
        return response
      } catch (cause) {
        error = redact(cause instanceof Error ? cause.message : cause)
        onRequest({ sequence, url, request: body, status: response?.status, ms: performance.now() - started, error })
        throw new Error(error)
      } finally { leave() }
    },
  }
}
