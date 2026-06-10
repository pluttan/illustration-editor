// Заменяет placeholder-тексты "≈ curve (...)" на настоящие bezier-элементы.
// Данные кривых восстановлены из оригинального cetz-кода глав.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(__dirname, 'illustrations')

// cetz: bezier(start, end, cp1, cp2) в cetz-координатах (y вверх, unit = 1)
// editor: x=300+40*cx, y=300-40*cy
const cetzToEditor = (cx, cy) => ({ x: 300 + 40 * cx, y: 300 - 40 * cy })

// Создаёт элемент bezier из cetz-точек
function makeBezier(start, end, cp1, cp2, role, strokeWidth = 1.5, id) {
  const s = cetzToEditor(start[0], start[1])
  const e = cetzToEditor(end[0], end[1])
  const c1 = cetzToEditor(cp1[0], cp1[1])
  const c2 = cetzToEditor(cp2[0], cp2[1])
  return {
    id,
    type: 'bezier',
    x: s.x,
    y: s.y,
    points: [
      0, 0,
      Math.round(c1.x - s.x), Math.round(c1.y - s.y),
      Math.round(c2.x - s.x), Math.round(c2.y - s.y),
      Math.round(e.x - s.x), Math.round(e.y - s.y),
    ],
    strokeWidth,
    draggable: true,
    strokeRole: role,
  }
}

// Карта: filename → [{placeholder_text, bezier_params}]
const FIXES = {
  'Секущая и касательная.json': [
    {
      find: '≈ curve (график)',
      bezier: { start: [0.5, 0.5], end: [5.5, 3.2], cp1: [2, 0.3], cp2: [3.5, 4.5], role: 'fg', w: 1.5 },
    },
  ],
  'Три процесса с одинаковым средним, но совершенно разным поведением.json': [
    {
      find: '≈ curve (вниз, потом вверх)',
      bezier: { start: [0.5, 0.8], end: [4, 3], cp1: [1.5, -0.5], cp2: [2.5, 4.5], role: 'accent-40', w: 1 },
    },
  ],
  'Знак производной и поведение функции.json': [
    {
      find: '≈ curve (растёт)',
      bezier: { start: [0.5, 0.5], end: [3.5, 3], cp1: [1.5, 0.5], cp2: [2.5, 3.5], role: 'fg', w: 1.5 },
    },
    {
      find: '≈ curve (убывает)',
      bezier: { start: [3.5, 3], end: [6.5, 0.5], cp1: [4.5, 2.5], cp2: [5.5, 0.5], role: 'fg', w: 1.5 },
    },
  ],
  'Интеграл — площадь под графиком.json': [
    {
      find: '≈ curve (график функции)',
      bezier: { start: [0.5, 1.2], end: [5.5, 2], cp1: [2, 3.2], cp2: [4, 0.8], role: 'fg', w: 1.5 },
    },
  ],
  'Равноускоренное движение_ x, v, a.json': [
    {
      find: '≈ curve (парабола)',
      bezier: { start: [0.1, 0.1], end: [1.9, 2.3], cp1: [0.5, 0.1], cp2: [1.2, 0.5], role: 'accent', w: 1.2 },
    },
  ],
}

for (const [file, fixes] of Object.entries(FIXES)) {
  const p = path.join(dir, file)
  if (!fs.existsSync(p)) { console.log(`пропуск ${file}: не найден`); continue }
  const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
  let maxId = data.elements.reduce((m, e) => Math.max(m, parseInt(e.id?.split('-')[1] || '0')), 0)
  for (const fix of fixes) {
    const idx = data.elements.findIndex(e => e.type === 'text' && e.text === fix.find)
    if (idx === -1) { console.log(`  ${file}: не нашёл "${fix.find}"`); continue }
    const b = fix.bezier
    const id = `el-${++maxId}`
    data.elements[idx] = makeBezier(b.start, b.end, b.cp1, b.cp2, b.role, b.w, id)
    console.log(`  ${file}: заменил "${fix.find}" на безье`)
  }
  fs.writeFileSync(p, JSON.stringify(data, null, 2))
}
console.log('\nГотово.')
