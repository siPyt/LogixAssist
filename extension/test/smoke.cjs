// Smoke test for the bridge server using a fake model (no VS Code needed).
const assert = require('node:assert/strict')
const http = require('node:http')
const { createBridge, originMatches } = require('../out/server.js')

const PORT = 47999
const TOKEN = 'test-token-123'
const ORIGIN = 'http://localhost:5173'

let aborted = false
const provider = {
  async listModels() {
    const m = { id: 'x', name: 'Claude Sonnet 5.5', family: 'claude-sonnet-5.5', vendor: 'copilot' }
    return { models: [m], selected: m }
  },
  async chat(messages, { signal, modelId }, onDelta) {
    if (messages[0].content === 'fail') throw new Error('boom')
    if (messages[0].content === 'slow') {
      await new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          aborted = true
          resolve()
        })
      })
      return { model: 'slow' }
    }
    onDelta('Hel')
    onDelta('lo ' + messages[messages.length - 1].content)
    return { model: modelId ?? 'Claude Sonnet 5.5' }
  },
}

function request(path, { method = 'GET', headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method, headers: { ...(host ? { host } : {}), ...headers } },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
      },
    )
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

const auth = { authorization: `Bearer ${TOKEN}`, origin: ORIGIN, 'content-type': 'application/json' }
const chatBody = (content) => JSON.stringify({ messages: [{ role: 'user', content }] })

let step = 'start'
const watchdog = setTimeout(() => {
  console.error(`TIMEOUT during step: ${step}`)
  process.exit(2)
}, 20000)

async function main() {
  const server = createBridge({
    port: PORT,
    getToken: () => TOKEN,
    getAllowedOrigins: () => [ORIGIN, 'https://*.vercel.app'],
    provider,
  })
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

  try {
    // origin matching
    assert.equal(originMatches('https://logix.vercel.app', 'https://*.vercel.app'), true)
    assert.equal(originMatches('https://evil.com', 'https://*.vercel.app'), false)
    assert.equal(originMatches('https://vercel.app.evil.com', 'https://*.vercel.app'), false)

    // health is open to allowed origins, with CORS + private network headers
    let r = await request('/health', { headers: { origin: ORIGIN } })
    assert.equal(r.status, 200)
    assert.equal(r.headers['access-control-allow-origin'], ORIGIN)
    assert.equal(r.headers['access-control-allow-private-network'], 'true')

    // preflight
    r = await request('/chat', { method: 'OPTIONS', headers: { origin: ORIGIN } })
    assert.equal(r.status, 204)

    // blocked origin and blocked host
    r = await request('/health', { headers: { origin: 'https://evil.com' } })
    assert.equal(r.status, 403)
    assert.equal(r.headers['access-control-allow-origin'], undefined)
    r = await request('/health', { host: 'evil.com' })
    assert.equal(r.status, 403)

    // token required for models and chat
    r = await request('/models', { headers: { origin: ORIGIN } })
    assert.equal(r.status, 401)
    r = await request('/chat', { method: 'POST', headers: { origin: ORIGIN, authorization: 'Bearer wrong' }, body: chatBody('hi') })
    assert.equal(r.status, 401)

    // models
    r = await request('/models', { headers: auth })
    assert.equal(r.status, 200)
    assert.equal(JSON.parse(r.body).selected.name, 'Claude Sonnet 5.5')

    // streaming chat
    r = await request('/chat', { method: 'POST', headers: auth, body: chatBody('world') })
    assert.equal(r.status, 200)
    assert.match(r.headers['content-type'], /text\/event-stream/)
    const events = r.body.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')))
    assert.deepEqual(events.map((e) => e.delta).filter(Boolean).join(''), 'Hello world')
    assert.equal(events[events.length - 1].done, true)

    // provider error is reported in-stream
    r = await request('/chat', { method: 'POST', headers: auth, body: chatBody('fail') })
    assert.match(r.body, /"error":"boom"/)

    // validation
    r = await request('/chat', { method: 'POST', headers: auth, body: '{"messages":[]}' })
    assert.equal(r.status, 400)
    r = await request('/chat', { method: 'POST', headers: auth, body: 'not json' })
    assert.equal(r.status, 400)
    r = await request('/chat', { method: 'POST', headers: auth, body: JSON.stringify({ messages: [{ role: 'system', content: 'x' }] }) })
    assert.equal(r.status, 400)
    step = 'oversized body'
    r = await request('/chat', { method: 'POST', headers: auth, body: 'x'.repeat(300 * 1024) }).catch(() => ({ status: 413 }))
    assert.equal(r.status, 413)
    r = await request('/nope', { headers: auth })
    assert.equal(r.status, 404)

    step = 'client disconnect'
    // client disconnect aborts the model request
    await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/chat', method: 'POST', headers: auth }, (res) => {
        res.on('data', () => {})
        setTimeout(() => req.destroy(), 100)
        res.on('close', resolve)
      })
      req.on('error', () => {})
      req.end(chatBody('slow'))
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(aborted, true)

    console.log('bridge smoke test: all checks passed')
  } finally {
    clearTimeout(watchdog)
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
