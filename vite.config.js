import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

const illustrationsDir = path.resolve(__dirname, 'illustrations')
const bookDir = path.resolve(__dirname, '../presentation-charge-to-html')
const chaptersDir = path.join(bookDir, 'chapters')

// Парсим main.typ + главы, чтобы понять порядок глав и порядок иллюстраций в них
function scanChapters() {
  const usage = {}     // name → { chapter, chapterName, order }
  const chapters = []  // [{ id, name, index }] в порядке книги
  try {
    const main = fs.readFileSync(path.join(bookDir, 'main.typ'), 'utf-8')
    // Both volumes: chapters/ (vol 1) and chapters2/ (vol 2)
    const includes = [...main.matchAll(/^\s*#include\s+"(chapters2?)\/([^"]+)\.typ"/gm)]
    includes.forEach((m, index) => {
      const id = m[1] + '/' + m[2]
      const file = path.join(bookDir, m[1], m[2] + '.typ')
      if (!fs.existsSync(file)) return
      const content = fs.readFileSync(file, 'utf-8')
      const titleMatch = content.match(/^=\s+(.+)$/m)
      const chapterName = titleMatch ? titleMatch[1].trim() : id
      chapters.push({ id, name: chapterName, index })
      const uses = [...content.matchAll(/illustration\("([^"]+)"/g)]
      uses.forEach((u, order) => {
        usage[u[1]] = { chapter: id, chapterName, order }
      })
    })
  } catch (e) {
    console.warn('Не смог распарсить главы:', e.message)
  }
  return { usage, chapters }
}

// Автокомпиляция книги: triggerCompile() дёргается из save-эндпоинта после каждого
// сохранения JSON. Дебаунс 300мс + очередь, чтобы не запускать параллельно.
let timer = null
let running = false
let queued = false
let lastStatus = { state: 'idle', ms: 0, err: '' }
const typstBin = path.join(bookDir, 'typst')
const projectRoot = path.resolve(bookDir, '..')

function compileOne(theme, outFile) {
  return new Promise((resolve) => {
    const args = [
      'compile', '--root', projectRoot,
      '--input', `theme=${theme}`,
      path.join(bookDir, 'main.typ'),
      path.join(bookDir, outFile),
    ]
    const proc = spawn(typstBin, args)
    let err = ''
    proc.stderr.on('data', d => { err += d })
    proc.on('exit', code => resolve({ theme, code, err }))
  })
}

function runTypst() {
  if (running) { queued = true; return }
  if (!fs.existsSync(typstBin)) return
  running = true
  lastStatus = { state: 'compiling', ms: 0, err: '' }
  const t0 = Date.now()
  Promise.all([
    compileOne('light', 'main.pdf'),
    compileOne('dark', 'main-dark.pdf'),
  ]).then(results => {
    running = false
    const ms = Date.now() - t0
    const errs = results.filter(r => r.code !== 0)
    if (errs.length === 0) {
      console.log(`[typst] собрано (light+dark) за ${ms}ms`)
      lastStatus = { state: 'ok', ms, err: '' }
    } else {
      const msg = errs.map(e => `${e.theme}: ${e.err}`).join('\n')
      console.error(`[typst] ошибка:\n${msg}`)
      lastStatus = { state: 'error', ms, err: msg.slice(0, 500) }
    }
    if (queued) { queued = false; triggerCompile() }
  })
}
function triggerCompile() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runTypst, 300)
}

function watchTypFiles() {
  // polling вместо fs.watch — надёжно на mounted volumes + не бьёт в EMFILE
  const dirs = [bookDir, chaptersDir, path.join(bookDir, 'chapters2')]
  const mtimes = new Map()
  for (const dir of dirs) {
    try {
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.typ'))) {
        const full = path.join(dir, f)
        mtimes.set(full, fs.statSync(full).mtimeMs)
      }
    } catch (_) {}
  }
  setInterval(() => {
    for (const dir of dirs) {
      try {
        for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.typ'))) {
          const full = path.join(dir, f)
          const mt = fs.statSync(full).mtimeMs
          const prev = mtimes.get(full)
          if (prev !== undefined && mt !== prev) {
            console.log(`[typst-watch] ${f} changed`)
            triggerCompile()
          }
          mtimes.set(full, mt)
        }
      } catch (_) {}
    }
  }, 1000)
  console.log('[typst-watch] следим за .typ файлами (polling)')
}

function illustrationsApi() {
  return {
    name: 'illustrations-api',
    configureServer(server) {
      watchTypFiles()
      server.middlewares.use('/api/status', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(lastStatus))
      })

      server.middlewares.use('/api/list', (_req, res) => {
        const { usage, chapters } = scanChapters()
        const items = fs.readdirSync(illustrationsDir)
          .filter(f => f.endsWith('.json'))
          .map(f => {
            const name = f.replace('.json', '')
            let science = 'default'
            try {
              const raw = JSON.parse(fs.readFileSync(path.join(illustrationsDir, f), 'utf-8'))
              if (!Array.isArray(raw) && raw.science) science = raw.science
            } catch (_) {}
            const u = usage[name]
            return {
              name,
              science,
              chapter: u?.chapter || null,
              chapterName: u?.chapterName || null,
              order: u?.order ?? Infinity,
            }
          })
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ items, chapters }))
      })

      server.middlewares.use('/api/load/', (req, res) => {
        const name = decodeURIComponent(req.url.replace(/^\//, ''))
        const filePath = path.join(illustrationsDir, name + '.json')
        if (fs.existsSync(filePath)) {
          res.setHeader('Content-Type', 'application/json')
          res.end(fs.readFileSync(filePath, 'utf-8'))
        } else {
          res.statusCode = 404
          res.end('not found')
        }
      })

      server.middlewares.use('/api/save/', (req, res) => {
        if (req.method !== 'PUT') { res.statusCode = 405; res.end(); return }
        const name = decodeURIComponent(req.url.replace(/^\//, ''))
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const payload = JSON.parse(body)
            // Поддерживаем и новый формат { data, lightSVG, darkSVG }, и старый (просто data)
            if (payload && payload.data && payload.lightSVG !== undefined) {
              fs.writeFileSync(path.join(illustrationsDir, name + '.json'), JSON.stringify(payload.data, null, 2))
              fs.writeFileSync(path.join(illustrationsDir, name + '.light.svg'), payload.lightSVG)
              fs.writeFileSync(path.join(illustrationsDir, name + '.dark.svg'), payload.darkSVG)
            } else {
              fs.writeFileSync(path.join(illustrationsDir, name + '.json'), JSON.stringify(payload, null, 2))
            }
          } catch (e) {
            console.error('save failed:', e.message)
          }
          triggerCompile()
          res.end('ok')
        })
      })

      server.middlewares.use('/api/delete/', (req, res) => {
        if (req.method !== 'DELETE') { res.statusCode = 405; res.end(); return }
        const name = decodeURIComponent(req.url.replace(/^\//, ''))
        for (const ext of ['.json', '.light.svg', '.dark.svg']) {
          const p = path.join(illustrationsDir, name + ext)
          if (fs.existsSync(p)) fs.unlinkSync(p)
        }
        triggerCompile()
        res.end('ok')
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), illustrationsApi()],
})
