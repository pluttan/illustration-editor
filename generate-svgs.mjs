// Генерирует .light.svg и .dark.svg для каждой иллюстрации в illustrations/
// Запуск: node generate-svgs.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(__dirname, 'illustrations')

// ─── Должно соответствовать src/App.jsx ──────────────────────────────────
const SCIENCES = {
  math: '#cba6f7', physics: '#89b4fa', chemistry: '#a6e3a1',
  electronics: '#fab387', cs: '#f5c2e7', red: '#f38ba8', default: '#74c7ec',
}
const THEME = {
  light: { bg: '#ffffff', fg: '#000000', muted: '#646464' },
  dark:  { bg: '#1e1e2e', fg: '#cdd6f4', muted: '#7f849c' },
}
function darken(hex, f) {
  const r = Math.round(parseInt(hex.slice(1,3),16) * (1-f))
  const g = Math.round(parseInt(hex.slice(3,5),16) * (1-f))
  const b = Math.round(parseInt(hex.slice(5,7),16) * (1-f))
  return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('')
}
function accentFor(science, theme) {
  const base = SCIENCES[science] || SCIENCES.default
  return theme === 'dark' ? base : darken(base, 0.25)
}
function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${a})`
}
function resolveRole(role, theme, science) {
  if (!role || role === 'none') return null
  const t = THEME[theme]
  const acc = accentFor(science, theme)
  switch (role) {
    case 'fg': return hexToRgba(t.fg, 1)
    case 'bg': return hexToRgba(t.bg, 1)
    case 'muted': return hexToRgba(t.muted, 1)
    case 'accent': return hexToRgba(acc, 1)
    case 'accent-60': return hexToRgba(acc, 0.6)
    case 'accent-40': return hexToRgba(acc, 0.4)
    case 'accent-20': return hexToRgba(acc, 0.2)
    default: return hexToRgba(t.fg, 1)
  }
}
const escapeXml = s => String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]))

function elementBBox(el) {
  switch (el.type) {
    case 'circle': return [el.x-el.radius, el.y-el.radius, el.x+el.radius, el.y+el.radius]
    case 'rect':   return [el.x, el.y, el.x+el.width, el.y+el.height]
    case 'line': case 'arrow': {
      const x1=el.x+el.points[0], y1=el.y+el.points[1], x2=el.x+el.points[2], y2=el.y+el.points[3]
      return [Math.min(x1,x2), Math.min(y1,y2), Math.max(x1,x2), Math.max(y1,y2)]
    }
    case 'bezier': {
      const p = el.points
      const xs = [el.x+p[0], el.x+p[2], el.x+p[4], el.x+p[6]]
      const ys = [el.y+p[1], el.y+p[3], el.y+p[5], el.y+p[7]]
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    }
    case 'text': {
      const w = (el.text?.length||1)*(el.fontSize||10)*0.6, h = el.fontSize||10
      return [el.x-w/2, el.y-h/2, el.x+w/2, el.y+h/2]
    }
    default: return null
  }
}
function computeBBox(elements) {
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity
  for (const el of elements) {
    const bb = elementBBox(el); if (!bb) continue
    if (bb[0]<minX) minX=bb[0]; if (bb[1]<minY) minY=bb[1]
    if (bb[2]>maxX) maxX=bb[2]; if (bb[3]>maxY) maxY=bb[3]
  }
  if (!isFinite(minX)) return { x:0, y:0, w:100, h:100 }
  const pad = 8
  return { x:minX-pad, y:minY-pad, w:(maxX-minX)+2*pad, h:(maxY-minY)+2*pad }
}

function elementsToSVG(elements, theme, science) {
  const t = THEME[theme]
  const bb = computeBBox(elements)
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bb.w}pt" height="${bb.h}pt" viewBox="${bb.x} ${bb.y} ${bb.w} ${bb.h}">`
  for (const el of elements) {
    // Per-element science override lets one figure mix accent hues
    const sci = el.science || science
    const fill = resolveRole(el.fillRole, theme, sci)
    const stroke = resolveRole(el.strokeRole, theme, sci)
    const sw = el.strokeWidth ?? 1
    const dashAttr = el.dash ? ' stroke-dasharray="5 4"' : ''
    const sAttr = stroke ? `stroke="${stroke}" stroke-width="${sw}"${dashAttr}` : ''
    const fAttr = fill ? `fill="${fill}"` : 'fill="none"'
    switch (el.type) {
      case 'circle':
        svg += `<circle cx="${el.x}" cy="${el.y}" r="${el.radius}" ${fAttr} ${sAttr} />`
        break
      case 'rect':
        svg += `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" ${fAttr} ${sAttr} />`
        break
      case 'line': {
        const x1 = el.x+el.points[0], y1 = el.y+el.points[1]
        const x2 = el.x+el.points[2], y2 = el.y+el.points[3]
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${sAttr} />`
        break
      }
      case 'arrow': {
        const x1 = el.x+el.points[0], y1 = el.y+el.points[1]
        const x2 = el.x+el.points[2], y2 = el.y+el.points[3]
        const angle = Math.atan2(y2-y1, x2-x1)
        const sz = 8
        const len = Math.sqrt((x2-x1)**2 + (y2-y1)**2)
        const cut = Math.min(sz, len*0.4)
        const lx2 = x2 - cut*Math.cos(angle)
        const ly2 = y2 - cut*Math.sin(angle)
        svg += `<line x1="${x1}" y1="${y1}" x2="${lx2}" y2="${ly2}" ${sAttr} />`
        const ax1 = x2 - sz*Math.cos(angle - Math.PI/6)
        const ay1 = y2 - sz*Math.sin(angle - Math.PI/6)
        const ax2 = x2 - sz*Math.cos(angle + Math.PI/6)
        const ay2 = y2 - sz*Math.sin(angle + Math.PI/6)
        const tipFill = fill || stroke || hexToRgba(t.fg, 1)
        svg += `<polygon points="${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}" fill="${tipFill}" />`
        break
      }
      case 'bezier': {
        const p = el.points
        const d = `M ${el.x+p[0]} ${el.y+p[1]} C ${el.x+p[2]} ${el.y+p[3]}, ${el.x+p[4]} ${el.y+p[5]}, ${el.x+p[6]} ${el.y+p[7]}`
        svg += `<path d="${d}" fill="none" ${sAttr} />`
        break
      }
      case 'text': {
        const fs = el.fontSize || 10
        const tfill = fill || hexToRgba(t.fg, 1)
        let text = el.text || ''
        let italic = ''
        if (text.startsWith('$') && text.endsWith('$') && text.length > 1) {
          text = text.slice(1, -1)
          italic = ' font-style="italic"'
        }
        const rot = el.rotation ? ` transform="rotate(${el.rotation} ${el.x} ${el.y})"` : ''
        svg += `<text x="${el.x}" y="${el.y}" font-size="${fs}" fill="${tfill}" font-family="serif"${italic} text-anchor="middle" dominant-baseline="middle"${rot}>${escapeXml(text)}</text>`
        break
      }
    }
  }
  svg += '</svg>'
  return svg
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
for (const f of files) {
  const p = path.join(dir, f)
  const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
  const name = f.replace('.json', '')
  fs.writeFileSync(path.join(dir, name + '.light.svg'), elementsToSVG(data.elements, 'light', data.science))
  fs.writeFileSync(path.join(dir, name + '.dark.svg'), elementsToSVG(data.elements, 'dark', data.science))
  console.log('✓', name)
}
console.log(`\nГотово: ${files.length} иллюстраций × 2 темы = ${files.length * 2} SVG`)
