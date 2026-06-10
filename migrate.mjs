// Миграция: hex+opacity → fillRole/strokeRole. Запуск: node migrate.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(__dirname, 'illustrations')

// Известные акцентные hex'ы для наук (в текущих JSON'ах).
const SCIENCE_HEX = {
  math:        ['#9743eb'],
  physics:     ['#2873f4'],
  chemistry:   ['#55c64d'],
  electronics: ['#d67f3e', '#c87340'],
  cs:          ['#d68cb8'],
}
const ALL_SCIENCE_HEX = Object.entries(SCIENCE_HEX).flatMap(([s, hs]) => hs.map(h => [h, s]))

const norm = (s) => (s || '').toLowerCase()

function inferScience(elements) {
  for (const el of elements) {
    for (const c of [el.fill, el.stroke]) {
      const hit = ALL_SCIENCE_HEX.find(([h]) => h === norm(c))
      if (hit) return hit[1]
    }
  }
  return 'default'
}

function isGray(hex) {
  if (!hex || hex.length !== 7) return false
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  // серый: каналы близки и не слишком тёмные/светлые
  const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b))
  return maxDiff < 15 && r > 20 && r < 220
}

function opacityToRole(op) {
  if (op === undefined || op === null || op >= 0.9) return 'accent'
  if (op >= 0.5) return 'accent-60'
  if (op >= 0.35) return 'accent-40'
  return 'accent-20'
}

function colorToRole(hex, opacity, scienceHexes) {
  const c = norm(hex)
  if (!c || c === 'transparent') return 'none'
  if (c === '#000000') return 'fg'
  if (c === '#ffffff' || c === '#fff') return 'bg'
  if (isGray(c)) return 'muted'
  if (scienceHexes.some(h => h === c)) return opacityToRole(opacity)
  // неопознанный цвет — считаем акцентом
  return opacityToRole(opacity)
}

function migrate(name, raw) {
  if (!Array.isArray(raw)) {
    console.log(`  ${name}: уже в новом формате, пропускаю`)
    return raw
  }
  const science = inferScience(raw)
  const sciHexes = SCIENCE_HEX[science] || []
  const elements = raw.map(el => {
    const out = { ...el }
    if (el.fill !== undefined) {
      out.fillRole = colorToRole(el.fill, el.opacity, sciHexes)
    }
    if (el.stroke !== undefined) {
      out.strokeRole = colorToRole(el.stroke, el.opacity, sciHexes)
    }
    // убираем устаревшие поля
    delete out.fill
    delete out.stroke
    delete out.opacity
    return out
  })
  return { science, elements }
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
for (const f of files) {
  const p = path.join(dir, f)
  const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
  const migrated = migrate(f, raw)
  if (migrated !== raw) {
    fs.writeFileSync(p, JSON.stringify(migrated, null, 2))
    console.log(`✓ ${f} → science=${migrated.science}, ${migrated.elements.length} эл.`)
  }
}
console.log(`\nГотово: ${files.length} файлов.`)
