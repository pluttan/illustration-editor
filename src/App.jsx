import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Stage, Layer, Circle, Rect, Line, Arrow, Text, Path, Transformer } from 'react-konva'
import './index.css'

// ─── Цветовая модель, синхронная с template.typ ────────────────────────────
const SCIENCES = {
  math:        '#cba6f7',
  physics:     '#89b4fa',
  chemistry:   '#a6e3a1',
  electronics: '#fab387',
  cs:          '#f5c2e7',
  red:         '#f38ba8', // extra accent hue (Catppuccin red), not a discipline
  default:     '#74c7ec',
}

const THEME = {
  light: { bg: '#ffffff', fg: '#000000', muted: '#646464' },
  dark:  { bg: '#1e1e2e', fg: '#cdd6f4', muted: '#7f849c' },
}

// Typst .darken(25%) перемножает RGB-каналы на 0.75
function darken(hex, factor) {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * (1 - factor))
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * (1 - factor))
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * (1 - factor))
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
}

function accentFor(science, theme) {
  const base = SCIENCES[science] || SCIENCES.default
  return theme === 'dark' ? base : darken(base, 0.25)
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

const ROLES = ['none', 'fg', 'bg', 'muted', 'accent', 'accent-60', 'accent-40', 'accent-20']

function resolveRole(role, theme, science) {
  if (!role || role === 'none') return null
  const t = THEME[theme]
  const acc = accentFor(science, theme)
  switch (role) {
    case 'fg':        return hexToRgba(t.fg, 1)
    case 'bg':        return hexToRgba(t.bg, 1)
    case 'muted':     return hexToRgba(t.muted, 1)
    case 'accent':    return hexToRgba(acc, 1)
    case 'accent-60': return hexToRgba(acc, 0.6)
    case 'accent-40': return hexToRgba(acc, 0.4)
    case 'accent-20': return hexToRgba(acc, 0.2)
    default:          return hexToRgba(t.fg, 1)
  }
}

// Превью-цвет для сводки-чипа (на сайдбаре): всегда светлая тема + текущая наука
function rolePreview(role, science) {
  return resolveRole(role, 'light', science) || 'transparent'
}

// ─── Инструменты / значения по умолчанию ───────────────────────────────────
const TOOLS = ['select', 'circle', 'rect', 'line', 'arrow', 'bezier', 'text']
const TOOL_LABELS = {
  select: 'Sel', circle: 'O', rect: '[]',
  line: '/', arrow: '->', bezier: '~', text: 'T',
}

let idCounter = 1
const newId = () => `el-${idCounter++}`

const defaultProps = {
  circle: { radius: 30, fillRole: 'accent', strokeRole: 'fg', strokeWidth: 1 },
  rect:   { width: 80, height: 60, fillRole: 'accent-40', strokeRole: 'fg', strokeWidth: 1 },
  line:   { points: [0, 0, 100, 0], strokeRole: 'fg', strokeWidth: 1.5 },
  arrow:  { points: [0, 0, 100, 0], strokeRole: 'fg', fillRole: 'fg', strokeWidth: 1.5 },
  bezier: { points: [0, 0, 33, -40, 66, -40, 100, 0], strokeRole: 'fg', strokeWidth: 1.5 },
  text:   { text: 'Метка', fontSize: 16, fillRole: 'fg' },
}

const DEFAULT_GRID_SIZE = 20

// ─── SVG-экспорт (клиент рендерит то же, что видит) ───────────────────────
function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;' }[c]))
}

// Bounding box для элемента
function elementBBox(el) {
  switch (el.type) {
    case 'circle': return [el.x - el.radius, el.y - el.radius, el.x + el.radius, el.y + el.radius]
    case 'rect':   return [el.x, el.y, el.x + el.width, el.y + el.height]
    case 'line': case 'arrow': {
      const x1 = el.x + el.points[0], y1 = el.y + el.points[1]
      const x2 = el.x + el.points[2], y2 = el.y + el.points[3]
      return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
    }
    case 'bezier': {
      const p = el.points
      const xs = [el.x + p[0], el.x + p[2], el.x + p[4], el.x + p[6]]
      const ys = [el.y + p[1], el.y + p[3], el.y + p[5], el.y + p[7]]
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    }
    case 'text': {
      const w = (el.text?.length || 1) * (el.fontSize || 10) * 0.6
      const h = el.fontSize || 10
      return [el.x - w / 2, el.y - h / 2, el.x + w / 2, el.y + h / 2]
    }
    default: return null
  }
}

function computeBBox(elements) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const el of elements) {
    const bb = elementBBox(el)
    if (!bb) continue
    if (bb[0] < minX) minX = bb[0]
    if (bb[1] < minY) minY = bb[1]
    if (bb[2] > maxX) maxX = bb[2]
    if (bb[3] > maxY) maxY = bb[3]
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 100, h: 100 }
  const pad = 8
  return { x: minX - pad, y: minY - pad, w: (maxX - minX) + 2 * pad, h: (maxY - minY) + 2 * pad }
}

function elementsToSVG(elements, theme, science) {
  const t = THEME[theme]
  const bb = computeBBox(elements)
  // 1 editor px ≈ 1pt в книге → иллюстрации сохраняют естественный размер
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bb.w}pt" height="${bb.h}pt" viewBox="${bb.x} ${bb.y} ${bb.w} ${bb.h}">`
  for (const el of elements) {
    // Per-element science override lets one figure mix accent hues.
    // fillHex/strokeHex are raw theme-independent colors (physical light colors etc.)
    const sci = el.science || science
    const fill = el.fillHex ? hexToRgba(el.fillHex, 1) : resolveRole(el.fillRole, theme, sci)
    const stroke = el.strokeHex ? hexToRgba(el.strokeHex, 1) : resolveRole(el.strokeRole, theme, sci)
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
        const x1 = el.x + el.points[0], y1 = el.y + el.points[1]
        const x2 = el.x + el.points[2], y2 = el.y + el.points[3]
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${sAttr} />`
        break
      }
      case 'arrow': {
        const x1 = el.x + el.points[0], y1 = el.y + el.points[1]
        const x2 = el.x + el.points[2], y2 = el.y + el.points[3]
        const angle = Math.atan2(y2 - y1, x2 - x1)
        const sz = 8
        // Укорачиваем линию чтобы не торчала из-под наконечника
        const len = Math.sqrt((x2-x1)**2 + (y2-y1)**2)
        const cut = Math.min(sz, len * 0.4)
        const lx2 = x2 - cut * Math.cos(angle)
        const ly2 = y2 - cut * Math.sin(angle)
        svg += `<line x1="${x1}" y1="${y1}" x2="${lx2}" y2="${ly2}" ${sAttr} />`
        const ax1 = x2 - sz * Math.cos(angle - Math.PI / 6)
        const ay1 = y2 - sz * Math.sin(angle - Math.PI / 6)
        const ax2 = x2 - sz * Math.cos(angle + Math.PI / 6)
        const ay2 = y2 - sz * Math.sin(angle + Math.PI / 6)
        const tipFill = fill || stroke || hexToRgba(t.fg, 1)
        svg += `<polygon points="${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}" fill="${tipFill}" />`
        break
      }
      case 'bezier': {
        const p = el.points
        const d = `M ${el.x + p[0]} ${el.y + p[1]} C ${el.x + p[2]} ${el.y + p[3]}, ${el.x + p[4]} ${el.y + p[5]}, ${el.x + p[6]} ${el.y + p[7]}`
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

const api = {
  status: () => fetch('/api/status').then(r => r.json()).catch(() => null),
  list: () => fetch('/api/list').then(r => r.json()),
  load: (name) => fetch(`/api/load/${encodeURIComponent(name)}`).then(r => r.json()),
  save: (name, data) => {
    const body = {
      data,
      lightSVG: elementsToSVG(data.elements, 'light', data.science),
      darkSVG: elementsToSVG(data.elements, 'dark', data.science),
    }
    return fetch(`/api/save/${encodeURIComponent(name)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  },
  remove: (name) => fetch(`/api/delete/${encodeURIComponent(name)}`, { method: 'DELETE' }),
}

// ─── Миграция старого формата ──────────────────────────────────────────────
// Старый: массив элементов с hex `fill`/`stroke`.
// Новый:  { science, elements: [{..., fillRole, strokeRole}] }.
function normalizeLoaded(raw) {
  if (Array.isArray(raw)) {
    return { science: 'default', elements: raw.map(migrateElement) }
  }
  return {
    science: raw.science || 'default',
    elements: (raw.elements || []).map(migrateElement),
  }
}
function migrateElement(el) {
  // Если роль уже задана — оставляем как есть.
  if (el.fillRole !== undefined || el.strokeRole !== undefined) return el
  // Попробуем угадать роль из hex-значений регенерированных файлов.
  const guessRole = (hex) => {
    if (!hex) return undefined
    const h = hex.toLowerCase()
    if (h === '#000000' || h === '#ffffff' || h === '#cdd6f4') return 'fg'
    if (h === '#646464' || h === '#7f849c' || h.startsWith('#7') || h.startsWith('#8') || h.startsWith('#9')) return 'muted'
    return 'accent' // всё цветное считаем акцентом
  }
  return {
    ...el,
    fillRole:   el.fill   !== undefined ? guessRole(el.fill)   : undefined,
    strokeRole: el.stroke !== undefined ? guessRole(el.stroke) : undefined,
  }
}

// ─── Сетка ─────────────────────────────────────────────────────────────────
function Grid({ width, height, scale, theme, step, offset }) {
  const lines = []
  const color = theme === 'dark' ? '#2a2a3a' : '#e0e0e0'
  // Видимая область в мировых координатах
  const left = -offset.x / scale
  const top = -offset.y / scale
  const right = left + width / scale
  const bottom = top + height / scale
  // Выровнять по шагу
  const x0 = Math.floor(left / step) * step
  const y0 = Math.floor(top / step) * step
  // Ограничение: не рисовать слишком много линий (при очень маленьком scale)
  const maxLines = 200
  if ((right - x0) / step > maxLines || (bottom - y0) / step > maxLines) return null
  const sw = Math.max(0.25, 0.5 / scale)
  for (let x = x0; x <= right; x += step) {
    lines.push(<Line key={`v${x}`} points={[x, top, x, bottom]} stroke={color} strokeWidth={sw} listening={false} />)
  }
  for (let y = y0; y <= bottom; y += step) {
    lines.push(<Line key={`h${y}`} points={[left, y, right, y]} stroke={color} strokeWidth={sw} listening={false} />)
  }
  return <>{lines}</>
}

// ─── Редактируемый текст ───────────────────────────────────────────────────
function EditableText({ el, isSelected, onSelect, onDragEnd, onUpdate, draggable, fill }) {
  const textRef = useRef(null)
  const trRef = useRef(null)

  useEffect(() => {
    if (isSelected && trRef.current && textRef.current) {
      trRef.current.nodes([textRef.current])
      trRef.current.getLayer().batchDraw()
    }
  }, [isSelected])

  const handleDblClick = () => {
    const textNode = textRef.current
    if (!textNode) return
    const stage = textNode.getStage()
    const textPos = textNode.absolutePosition()
    const areaPos = { x: stage.container().offsetLeft + textPos.x, y: stage.container().offsetTop + textPos.y }

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.value = el.text
    Object.assign(textarea.style, {
      position: 'absolute', top: areaPos.y + 'px', left: areaPos.x + 'px',
      fontSize: el.fontSize * stage.scaleX() + 'px', border: '1px solid #2980b9',
      padding: '2px', margin: '0', overflow: 'hidden', background: 'white',
      outline: 'none', resize: 'none', fontFamily: 'sans-serif', lineHeight: '1.2',
      width: Math.max(100, textNode.width() * stage.scaleX()) + 'px', zIndex: '1000',
    })
    textarea.focus()

    const finish = () => {
      onUpdate(el.id, { text: textarea.value })
      document.body.removeChild(textarea)
    }
    textarea.addEventListener('blur', finish)
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textarea.blur() }
      if (e.key === 'Escape') { textarea.blur() }
    })
  }

  const handleTransform = () => {
    const node = textRef.current
    if (!node) return
    onUpdate(el.id, { rotation: Math.round(node.rotation()) })
  }

  return (
    <>
      <Text
        ref={textRef}
        x={el.x} y={el.y}
        text={el.text}
        fontSize={el.fontSize}
        fill={fill || '#000'}
        rotation={el.rotation || 0}
        draggable={draggable}
        onClick={(e) => onSelect(e)}
        onDblClick={handleDblClick}
        onDragEnd={onDragEnd}
        onTransformEnd={handleTransform}
      />
      {isSelected && <Transformer ref={trRef} enabledAnchors={[]} rotateEnabled={true} rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]} boundBoxFunc={(_, n) => n} />}
    </>
  )
}

// ─── Главное приложение ────────────────────────────────────────────────────
// ── localStorage-персист ──
const LS_KEY = 'illustrator-editor-state'
const loadPrefs = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') } catch (_) { return {} }
}
const savePrefs = (patch) => {
  try {
    const cur = loadPrefs()
    localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...patch }))
  } catch (_) {}
}

function App() {
  const prefs = loadPrefs()
  const [tabs, setTabs] = useState([])
  const [activeTab, setActiveTab] = useState(prefs.activeTab || null)
  const [science, setScience] = useState('default')
  const [elements, setElements] = useState([])
  const [tool, setTool] = useState('select')
  const [selectedIds, setSelectedIds] = useState([])
  const [drawStart, setDrawStart] = useState(null)
  const [rubberBand, setRubberBand] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [stageScale, setStageScale] = useState(1)
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 })
  const [showGrid, setShowGrid] = useState(true)
  const [snapToGrid, setSnapToGrid] = useState(false)
  const [theme, setTheme] = useState(prefs.theme || 'light')
  const [gridSize, setGridSize] = useState(prefs.gridSize || DEFAULT_GRID_SIZE)
  const stageRef = useRef(null)
  const saveTimeout = useRef(null)

  // Сохраняем настройки в localStorage
  useEffect(() => { savePrefs({ theme }) }, [theme])
  useEffect(() => { if (activeTab) savePrefs({ activeTab }) }, [activeTab])
  useEffect(() => { savePrefs({ gridSize }) }, [gridSize])

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const selectedEl = selectedId ? elements.find(e => e.id === selectedId) : null
  // Обёртка для совместимости: setSelectedId(x) → единичный селект или сброс
  const setSelectedId = (id) => setSelectedIds(id ? [id] : [])
  const toggleSelection = (id) => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )
  const themeColors = THEME[theme]

  const [collapsed, setCollapsedRaw] = useState(prefs.collapsed || {})
  const setCollapsed = (fn) => setCollapsedRaw(c => {
    const next = typeof fn === 'function' ? fn(c) : fn
    savePrefs({ collapsed: next })
    return next
  })
  const [chapters, setChapters] = useState([])
  const [compileStatus, setCompileStatus] = useState(null)

  // Опрашиваем статус компиляции
  useEffect(() => {
    const poll = () => api.status().then(s => setCompileStatus(s))
    poll()
    const id = setInterval(poll, 1000)
    return () => clearInterval(id)
  }, [])

  // ── Загрузка списка иллюстраций (с информацией о главах) ──
  useEffect(() => {
    api.list().then(data => {
      const items = data.items || []
      setTabs(items)
      setChapters(data.chapters || [])
      // Восстанавливаем activeTab если он ещё существует, иначе первый по порядку
      const saved = prefs.activeTab
      const existsSaved = saved && items.find(i => i.name === saved)
      if (!existsSaved && items.length > 0) {
        const sorted = [...items].sort((a, b) => {
          const ca = data.chapters.findIndex(c => c.id === a.chapter)
          const cb = data.chapters.findIndex(c => c.id === b.chapter)
          if (ca !== cb) return (ca === -1 ? 999 : ca) - (cb === -1 ? 999 : cb)
          return a.order - b.order
        })
        setActiveTab(sorted[0].name)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Загрузка активной иллюстрации ──
  useEffect(() => {
    if (!activeTab) { setElements([]); setScience('default'); return }
    api.load(activeTab).then(raw => {
      const data = normalizeLoaded(raw)
      setScience(data.science)
      setElements(data.elements)
      // Чистим историю при смене иллюстрации
      history.current = { past: [], future: [] }
      const maxId = data.elements.reduce((m, e) => Math.max(m, parseInt(e.id?.split('-')[1] || '0')), 0)
      idCounter = maxId + 1
      // Восстанавливаем pan/zoom для этой иллюстрации
      const views = loadPrefs().views || {}
      const v = views[activeTab]
      if (v) {
        setStageScale(v.scale || 1)
        setStagePos(v.pos || { x: 0, y: 0 })
      } else {
        setStageScale(1)
        setStagePos({ x: 0, y: 0 })
      }
    }).catch(() => { setElements([]); setScience('default') })
  }, [activeTab])

  // Сохраняем pan/zoom с дебаунсом
  const viewSaveTimer = useRef(null)
  useEffect(() => {
    if (!activeTab) return
    if (viewSaveTimer.current) clearTimeout(viewSaveTimer.current)
    viewSaveTimer.current = setTimeout(() => {
      const views = loadPrefs().views || {}
      views[activeTab] = { scale: stageScale, pos: stagePos }
      savePrefs({ views })
    }, 400)
  }, [stageScale, stagePos, activeTab])

  // ── История для Ctrl+Z (с дебаунсом — коалесим быстрые правки) ──
  const history = useRef({ past: [], future: [] })
  const historyTimer = useRef(null)
  const pendingHistory = useRef(null)
  const pushHistoryDebounced = (prevState) => {
    // Запомнить ПЕРВЫЙ prev во время серии быстрых правок
    if (pendingHistory.current === null) pendingHistory.current = prevState
    if (historyTimer.current) clearTimeout(historyTimer.current)
    historyTimer.current = setTimeout(() => {
      history.current.past.push(pendingHistory.current)
      if (history.current.past.length > 100) history.current.past.shift()
      history.current.future = []
      pendingHistory.current = null
    }, 250)
  }
  const flushHistory = () => {
    if (historyTimer.current) { clearTimeout(historyTimer.current); historyTimer.current = null }
    if (pendingHistory.current !== null) {
      history.current.past.push(pendingHistory.current)
      if (history.current.past.length > 100) history.current.past.shift()
      history.current.future = []
      pendingHistory.current = null
    }
  }

  // ── Автосохранение ──
  const scheduleAutoSave = useCallback((els, sci) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(() => {
      if (activeTab) api.save(activeTab, { science: sci, elements: els })
      setDirty(false)
    }, 500)
    setDirty(true)
  }, [activeTab])

  const updateElements = useCallback((updater) => {
    setElements(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (next !== prev) pushHistoryDebounced(prev)
      scheduleAutoSave(next, science)
      return next
    })
  }, [scheduleAutoSave, science])

  const undo = useCallback(() => {
    flushHistory()
    if (history.current.past.length === 0) return
    setElements(prev => {
      const last = history.current.past.pop()
      history.current.future.push(prev)
      scheduleAutoSave(last, science)
      return last
    })
  }, [scheduleAutoSave, science])

  const redo = useCallback(() => {
    flushHistory()
    if (history.current.future.length === 0) return
    setElements(prev => {
      const next = history.current.future.pop()
      history.current.past.push(prev)
      scheduleAutoSave(next, science)
      return next
    })
  }, [scheduleAutoSave, science])

  const changeScience = useCallback((newSci) => {
    setScience(newSci)
    scheduleAutoSave(elements, newSci)
    // Обновить фолдер активной вкладки
    setTabs(prev => prev.map(t => t.name === activeTab ? { ...t, science: newSci } : t))
  }, [elements, scheduleAutoSave, activeTab])

  // ── Клавиатура: Delete, копипаст ──
  const clipboard = useRef(null)
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      // Удаление
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        updateElements(prev => prev.filter(el => !selectedIds.includes(el.id)))
        setSelectedIds([])
        return
      }
      // Copy (несколько)
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selectedIds.length > 0) {
        clipboard.current = elements.filter(x => selectedIds.includes(x.id))
        return
      }
      // Paste (вставляем всё из буфера)
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && clipboard.current) {
        const src = clipboard.current
        const list = Array.isArray(src) ? src : [src]
        const copies = list.map(s => ({ ...s, id: newId(), x: (s.x || 0) + 20, y: (s.y || 0) + 20 }))
        updateElements(prev => [...prev, ...copies])
        setSelectedIds(copies.map(c => c.id))
        return
      }
      // Undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
        setSelectedIds([])
        return
      }
      // Redo
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
        setSelectedIds([])
        return
      }
      // Duplicate
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && selectedId) {
        e.preventDefault()
        const src = elements.find(x => x.id === selectedId)
        if (src) {
          const copy = { ...src, id: newId(), x: (src.x || 0) + 20, y: (src.y || 0) + 20 }
          updateElements(prev => [...prev, copy])
          setSelectedId(copy.id)
        }
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedIds, updateElements, elements, undo, redo])

  // ── Вкладки ──
  const switchTab = (name) => {
    if (activeTab && dirty) api.save(activeTab, { science, elements })
    setActiveTab(name)
    setSelectedId(null)
  }

  const addTab = async (initialScience = 'default') => {
    const name = prompt('Название иллюстрации:')
    if (!name) return
    await api.save(name, { science: initialScience, elements: [] })
    setTabs(prev => [...prev, { name, science: initialScience }])
    switchTab(name)
  }

  const renameTab = async (oldName) => {
    const newName = prompt('Новое имя:', oldName)
    if (!newName || newName === oldName) return
    const data = await api.load(oldName)
    await api.save(newName, data)
    await api.remove(oldName)
    setTabs(prev => prev.map(t => t.name === oldName ? { ...t, name: newName } : t))
    if (activeTab === oldName) setActiveTab(newName)
  }

  const deleteTab = async (name) => {
    if (!confirm(`Удалить «${name}»?`)) return
    await api.remove(name)
    setTabs(prev => prev.filter(t => t.name !== name))
    if (activeTab === name) {
      const remaining = tabs.filter(t => t.name !== name)
      setActiveTab(remaining[0]?.name || null)
    }
    setSelectedId(null)
  }

  // ── Snap ──
  const snap = (val) => snapToGrid ? Math.round(val / gridSize) * gridSize : val

  // ── Операции с элементами ──
  const addElement = useCallback((type, x, y, extra = {}) => {
    const el = { id: newId(), type, x: snap(x), y: snap(y), ...defaultProps[type], ...extra, draggable: true }
    updateElements(prev => [...prev, el])
    setSelectedId(el.id)
    setTool('select')
  }, [updateElements, snapToGrid])

  const updateElement = useCallback((id, props) => {
    updateElements(prev => prev.map(e => e.id === id ? { ...e, ...props } : e))
  }, [updateElements])

  const deleteElement = useCallback((id) => {
    updateElements(prev => prev.filter(e => e.id !== id))
    if (selectedId === id) setSelectedId(null)
  }, [selectedId, updateElements])

  // ── Пан/зум/резиновая рамка ──
  const [isPanning, setIsPanning] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const panStart = useRef(null)
  const rubberStart = useRef(null)
  const rubberAdditive = useRef(false)

  // Space = зажатый режим пана
  useEffect(() => {
    const kd = (e) => {
      if (e.code === 'Space' && !e.repeat && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault()
        setSpaceHeld(true)
      }
    }
    const ku = (e) => { if (e.code === 'Space') setSpaceHeld(false) }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }
  }, [])

  const worldXY = (stage) => {
    const p = stage.getPointerPosition()
    return { x: (p.x - stagePos.x) / stageScale, y: (p.y - stagePos.y) / stageScale }
  }

  const handleStageMouseDown = (e) => {
    const stage = e.target.getStage()
    // Пан всегда, если держим Space/Alt/среднюю кнопку — даже поверх элементов
    if (spaceHeld || e.evt.altKey || e.evt.button === 1) {
      const p = stage.getPointerPosition()
      setIsPanning(true)
      panStart.current = { x: p.x - stagePos.x, y: p.y - stagePos.y }
      e.evt.preventDefault()
      return
    }
    if (tool === 'select') {
      if (e.target === stage) {
        if (!e.evt.shiftKey) setSelectedIds([])
        rubberAdditive.current = e.evt.shiftKey
        const { x, y } = worldXY(stage)
        rubberStart.current = { x, y }
        setRubberBand({ x, y, w: 0, h: 0 })
      }
      return
    }
    const { x, y } = worldXY(stage)
    if (tool === 'line' || tool === 'arrow' || tool === 'bezier') {
      setDrawStart({ x: snap(x), y: snap(y) })
    } else {
      addElement(tool, x, y)
    }
  }

  const handleStageMouseMove = (e) => {
    const stage = e.target.getStage()
    if (isPanning && panStart.current) {
      const p = stage.getPointerPosition()
      setStagePos({ x: p.x - panStart.current.x, y: p.y - panStart.current.y })
      return
    }
    if (rubberStart.current) {
      const { x, y } = worldXY(stage)
      const rx = Math.min(rubberStart.current.x, x)
      const ry = Math.min(rubberStart.current.y, y)
      const rw = Math.abs(x - rubberStart.current.x)
      const rh = Math.abs(y - rubberStart.current.y)
      setRubberBand({ x: rx, y: ry, w: rw, h: rh })
      return
    }
  }

  // Проверка: попадает ли bbox элемента в рамку
  const rectsIntersect = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

  const handleStageMouseUp = (e) => {
    if (isPanning) { setIsPanning(false); panStart.current = null; return }
    if (rubberStart.current) {
      const rb = rubberBand
      rubberStart.current = null
      setRubberBand(null)
      if (rb && (rb.w > 2 || rb.h > 2)) {
        const hits = elements.filter(el => {
          const bb = elementBBox(el)
          return bb && rectsIntersect({ x: bb[0], y: bb[1], w: bb[2]-bb[0], h: bb[3]-bb[1] }, rb)
        }).map(el => el.id)
        setSelectedIds(prev => rubberAdditive.current ? Array.from(new Set([...prev, ...hits])) : hits)
      }
      return
    }
    if (!drawStart) return
    const stage = e.target.getStage()
    const { x, y } = worldXY(stage)
    const dx = snap(x) - drawStart.x
    const dy = snap(y) - drawStart.y
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      if (tool === 'bezier') {
        // Две контрольные точки по перпендикуляру к линии, выгибают вверх
        const perpX = -dy * 0.3
        const perpY = dx * 0.3
        const cp1x = Math.round(dx / 3 + perpX)
        const cp1y = Math.round(dy / 3 + perpY)
        const cp2x = Math.round(dx * 2 / 3 + perpX)
        const cp2y = Math.round(dy * 2 / 3 + perpY)
        addElement('bezier', drawStart.x, drawStart.y, { points: [0, 0, cp1x, cp1y, cp2x, cp2y, dx, dy] })
      } else {
        addElement(tool, drawStart.x, drawStart.y, { points: [0, 0, dx, dy] })
      }
    }
    setDrawStart(null)
  }

  const handleWheel = (e) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    const oldScale = stage.scaleX()
    const pointer = stage.getPointerPosition()
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    }
    const direction = e.evt.deltaY > 0 ? -1 : 1
    const newScale = Math.max(0.1, Math.min(10, direction > 0 ? oldScale * 1.1 : oldScale / 1.1))
    setStageScale(newScale)
    setStagePos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale })
  }

  const handleDragEnd = (id, e) => {
    updateElement(id, { x: snap(e.target.x()), y: snap(e.target.y()) })
  }

  const handleTransformEnd = (id, e) => {
    const node = e.target
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)
    const el = elements.find(el => el.id === id)
    if (!el) return
    const updates = { x: node.x(), y: node.y() }
    if (el.type === 'circle') updates.radius = Math.max(5, el.radius * Math.max(scaleX, scaleY))
    if (el.type === 'rect') { updates.width = Math.max(5, el.width * scaleX); updates.height = Math.max(5, el.height * scaleY) }
    updateElement(id, updates)
  }

  // ── Разрешение цвета по роли (el.science — переопределение, el.*Hex — сырой цвет) ──
  const resolveFill = (el) => {
    if (el.fillHex) return hexToRgba(el.fillHex, 1)
    if (el.fillRole !== undefined) return resolveRole(el.fillRole, theme, el.science || science)
    return el.fill // старый формат
  }
  const resolveStroke = (el) => {
    if (el.strokeHex) return hexToRgba(el.strokeHex, 1)
    if (el.strokeRole !== undefined) return resolveRole(el.strokeRole, theme, el.science || science)
    return el.stroke
  }

  // ── Рендер элементов ──
  const renderElementWithId = (el) => {
    // Если мультиселект — перетаскивает Transformer; индивидуально не двигаем
    const isMulti = selectedIds.length > 1
    const isDraggable = tool === 'select' && (!isMulti || !selectedIds.includes(el.id))
    const isSelected = selectedIds.includes(el.id)
    const fill = resolveFill(el)
    const stroke = resolveStroke(el)
    const handleClick = (e) => {
      if (e.evt.shiftKey) toggleSelection(el.id)
      else setSelectedId(el.id)
    }

    if (el.type === 'text') {
      return <EditableText key={el.id} el={el} isSelected={isSelected} draggable={isDraggable}
        fill={fill}
        onSelect={handleClick}
        onDragEnd={(e) => handleDragEnd(el.id, e)}
        onUpdate={updateElement} />
    }

    const common = {
      key: el.id, id: el.id, x: el.x, y: el.y, draggable: isDraggable,
      onClick: handleClick,
      onDragEnd: (e) => handleDragEnd(el.id, e),
      onTransformEnd: (e) => handleTransformEnd(el.id, e),
    }
    const strokeW = el.strokeWidth ?? 1
    const dash = el.dash ? [5, 4] : undefined
    switch (el.type) {
      case 'circle': return <Circle {...common} radius={el.radius} fill={fill} stroke={stroke} strokeWidth={strokeW} />
      case 'rect':   return <Rect   {...common} width={el.width} height={el.height} fill={fill} stroke={stroke} strokeWidth={strokeW} />
      case 'line':   return <Line   {...common} points={el.points} stroke={stroke} strokeWidth={strokeW} dash={dash} hitStrokeWidth={10} />
      case 'arrow':  return <Arrow  {...common} points={el.points} stroke={stroke} strokeWidth={strokeW} dash={dash} fill={fill} pointerLength={8} pointerWidth={6} hitStrokeWidth={10} />
      case 'bezier': {
        const p = el.points
        const d = `M 0 0 C ${p[2]} ${p[3]}, ${p[4]} ${p[5]}, ${p[6]} ${p[7]}`
        return <Path {...common} data={d} stroke={stroke} strokeWidth={strokeW} dash={dash} hitStrokeWidth={10} />
      }
      default: return null
    }
  }

  // ── Трансформер ──
  const trRef = useRef(null)
  const isMulti = selectedIds.length > 1
  const singleEligible = selectedEl?.type === 'circle' || selectedEl?.type === 'rect'
  const useTransformer = isMulti || singleEligible

  useEffect(() => {
    if (!trRef.current || !useTransformer) { if (trRef.current) trRef.current.nodes([]); return }
    const stage = trRef.current.getStage()
    const nodes = selectedIds.map(id => stage.findOne(`#${id}`)).filter(Boolean)
    trRef.current.nodes(nodes)
    trRef.current.getLayer().batchDraw()
  }, [selectedIds, elements, useTransformer])

  // При групповом перетаскивании через Transformer — обновить координаты всех элементов
  const handleGroupDragEnd = useCallback(() => {
    if (!isMulti) return
    const stage = trRef.current?.getStage()
    if (!stage) return
    updateElements(prev => prev.map(el => {
      if (!selectedIds.includes(el.id)) return el
      const node = stage.findOne(`#${el.id}`)
      if (!node) return el
      return { ...el, x: Math.round(node.x()), y: Math.round(node.y()) }
    }))
  }, [isMulti, selectedIds, updateElements])

  // ── Данные для ручек выбранного line/arrow/bezier ──
  const pointHandlesData = useMemo(() => {
    if (!selectedEl) return null
    const t = selectedEl.type
    if (t !== 'line' && t !== 'arrow' && t !== 'bezier') return null
    const p = selectedEl.points
    const ex = selectedEl.x
    const ey = selectedEl.y
    const schema = t === 'bezier'
      ? [{ i: 0, kind: 'end' }, { i: 2, kind: 'cp' }, { i: 4, kind: 'cp' }, { i: 6, kind: 'end' }]
      : [{ i: 0, kind: 'end' }, { i: 2, kind: 'end' }]
    const handles = schema.map(s => ({ ...s, x: ex + p[s.i], y: ey + p[s.i + 1] }))
    return { t, ex, ey, p, handles }
  }, [selectedEl])

  const updatePoint = useCallback((idx, ax, ay, finalize = false) => {
    if (!selectedEl) return
    const newPts = [...selectedEl.points]
    let dx = ax - selectedEl.x
    let dy = ay - selectedEl.y
    if (finalize) { dx = Math.round(snap(dx + selectedEl.x) - selectedEl.x); dy = Math.round(snap(dy + selectedEl.y) - selectedEl.y) }
    newPts[idx] = dx
    newPts[idx + 1] = dy
    updateElement(selectedId, { points: newPts })
  }, [selectedEl, selectedId, snapToGrid, updateElement])

  // ── Виджет палитры ──
  const PaletteSwatches = ({ current, onPick }) => (
    <div className="palette">
      {ROLES.map(r => {
        const color = r === 'none' ? null : rolePreview(r, science)
        return (
          <button key={r}
            className={`swatch ${current === r ? 'active' : ''}`}
            title={r}
            onClick={() => onPick(r)}
            style={{ background: color || '#fff', backgroundImage: r === 'none' ? 'linear-gradient(45deg, transparent 45%, #e74c3c 45% 55%, transparent 55%)' : undefined }}
          />
        )
      })}
    </div>
  )

  const canvasStyle = useMemo(() => ({
    background: themeColors.bg,
    cursor: isPanning ? 'grabbing' : spaceHeld ? 'grab' : tool === 'select' ? 'default' : 'crosshair',
  }), [themeColors.bg, isPanning, spaceHeld, tool])

  // SVG-предпросмотр (то, что уйдёт в книгу)
  const previewSVG = useMemo(() => elementsToSVG(elements, theme, science), [elements, theme, science])
  const previewOppositeSVG = useMemo(() => elementsToSVG(elements, theme === 'light' ? 'dark' : 'light', science), [elements, theme, science])
  const [previewFull, setPreviewFull] = useState(false)

  return (
    <>
      <div className="sidebar">
        <h2>
          Иллюстрации {dirty && <span style={{ color: '#f39c12' }}>*</span>}
          {compileStatus && (
            <span style={{
              marginLeft: 8, fontSize: 9, fontWeight: 'normal',
              color: compileStatus.state === 'ok' ? '#27ae60'
                : compileStatus.state === 'compiling' ? '#f39c12'
                : compileStatus.state === 'error' ? '#e74c3c' : '#555',
              textTransform: 'none', letterSpacing: 0,
            }} title={compileStatus.err}>
              {compileStatus.state === 'ok' && `✓ ${compileStatus.ms}мс`}
              {compileStatus.state === 'compiling' && '⏳ typst'}
              {compileStatus.state === 'error' && '✗ ошибка'}
              {compileStatus.state === 'idle' && '—'}
            </span>
          )}
        </h2>
        <div className="tabs-list">
          {[...chapters, { id: null, name: 'Не используется' }].map(ch => {
            const items = tabs
              .filter(t => t.chapter === ch.id)
              .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
            if (items.length === 0) return null
            const key = ch.id || '__unused__'
            const isOpen = !collapsed[key]
            // Цвет названия главы — акцент науки самой первой иллюстрации в ней
            const sciColor = items[0] ? accentFor(items[0].science, 'light') : '#8892b0'
            return (
              <div key={key} className="folder">
                <div className="folder-header" onClick={() => setCollapsed(c => ({ ...c, [key]: isOpen }))}>
                  <span className="caret">{isOpen ? '▾' : '▸'}</span>
                  <span className="folder-name" style={{ color: sciColor }}>{ch.name}</span>
                  <span className="folder-count">{items.length}</span>
                  <button className="folder-add" title="Новая иллюстрация" onClick={(e) => { e.stopPropagation(); addTab(items[0]?.science || 'default') }}>+</button>
                </div>
                {isOpen && items.map(t => (
                  <div key={t.name} className={`tab-item ${t.name === activeTab ? 'active' : ''}`} onClick={() => switchTab(t.name)}>
                    <span className="tab-name" onDoubleClick={() => renameTab(t.name)}>{t.name}</span>
                    <span className="del" onClick={(e) => { e.stopPropagation(); deleteTab(t.name) }}>x</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        <h2>Тема</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`btn ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')} style={{ flex: 1 }}>Light</button>
          <button className={`btn ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')} style={{ flex: 1 }}>Dark</button>
        </div>

        <h2>Наука</h2>
        <select
          value={science}
          onChange={e => changeScience(e.target.value)}
          style={{ width: '100%', padding: '4px 6px', background: '#0f0f23', border: '1px solid #2a2a4a', color: '#e0e0e0', borderRadius: 3, fontSize: 12 }}
        >
          {Object.keys(SCIENCES).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
          <div style={{ width: 20, height: 20, background: accentFor(science, 'light'), borderRadius: 3, border: '1px solid #2a2a4a' }} title="light" />
          <div style={{ width: 20, height: 20, background: accentFor(science, 'dark'), borderRadius: 3, border: '1px solid #2a2a4a' }} title="dark" />
          <span style={{ fontSize: 10, color: '#8892b0' }}>акценты</span>
        </div>

        <h2>Инструменты</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {TOOLS.map(t => (
            <button key={t} className={`btn ${tool === t ? 'active' : ''}`} onClick={() => setTool(t)}>
              {TOOL_LABELS[t]}
            </button>
          ))}
        </div>

        <h2>Вид</h2>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setStageScale(s => Math.min(10, s * 1.3))}>+</button>
          <button className="btn" onClick={() => setStageScale(s => Math.max(0.1, s / 1.3))}>-</button>
          <button className="btn" onClick={() => { setStageScale(1); setStagePos({ x: 0, y: 0 }) }}>Reset</button>
          <span style={{ fontSize: 11, color: '#8892b0' }}>{Math.round(stageScale * 100)}%</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
          <label style={{ fontSize: 11, color: '#8892b0', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> Сетка
          </label>
          <label style={{ fontSize: 11, color: '#8892b0', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={snapToGrid} onChange={e => setSnapToGrid(e.target.checked)} /> Snap
          </label>
          <label style={{ fontSize: 11, color: '#8892b0', display: 'flex', alignItems: 'center', gap: 4 }}>
            шаг <input type="number" min={1} max={200} value={gridSize} onChange={e => setGridSize(Math.max(1, +e.target.value || 1))} style={{ width: 40, padding: '1px 3px', background: '#0f0f23', border: '1px solid #2a2a4a', color: '#e0e0e0', borderRadius: 2, fontSize: 11 }} />
          </label>
        </div>

        <h2>Элементы</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' }}>
          {elements.map(el => (
            <div key={el.id} className={`element-item ${selectedId === el.id ? 'selected' : ''}`} onClick={() => setSelectedId(el.id)}>
              <span>{el.type}{el.type === 'text' ? `: "${el.text.slice(0, 12)}"` : ''} ({Math.round(el.x)}, {Math.round(el.y)})</span>
              <span className="del" onClick={(e) => { e.stopPropagation(); deleteElement(el.id) }}>x</span>
            </div>
          ))}
        </div>

        {selectedEl && (
          <>
            <h2>Свойства</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="prop-row"><label>x</label><input type="number" value={Math.round(selectedEl.x)} onChange={e => updateElement(selectedId, { x: +e.target.value })} /></div>
              <div className="prop-row"><label>y</label><input type="number" value={Math.round(selectedEl.y)} onChange={e => updateElement(selectedId, { y: +e.target.value })} /></div>
              {selectedEl.type === 'circle' && <div className="prop-row"><label>r</label><input type="number" value={Math.round(selectedEl.radius)} onChange={e => updateElement(selectedId, { radius: +e.target.value })} /></div>}
              {selectedEl.type === 'rect' && <>
                <div className="prop-row"><label>w</label><input type="number" value={Math.round(selectedEl.width)} onChange={e => updateElement(selectedId, { width: +e.target.value })} /></div>
                <div className="prop-row"><label>h</label><input type="number" value={Math.round(selectedEl.height)} onChange={e => updateElement(selectedId, { height: +e.target.value })} /></div>
              </>}
              {selectedEl.type === 'text' && <>
                <div className="prop-row"><label>text</label><input value={selectedEl.text} onChange={e => updateElement(selectedId, { text: e.target.value })} /></div>
                <div className="prop-row"><label>size</label><input type="number" value={selectedEl.fontSize} onChange={e => updateElement(selectedId, { fontSize: +e.target.value })} /></div>
                <div className="prop-row"><label>rot°</label><input type="number" value={selectedEl.rotation || 0} step={15} onChange={e => updateElement(selectedId, { rotation: +e.target.value })} /></div>
              </>}

              {(selectedEl.type === 'circle' || selectedEl.type === 'rect' || selectedEl.type === 'arrow' || selectedEl.type === 'text') && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 10, color: '#8892b0', marginBottom: 2 }}>fill</div>
                  <PaletteSwatches
                    current={selectedEl.fillRole}
                    onPick={(r) => updateElement(selectedId, { fillRole: r })}
                  />
                </div>
              )}
              {selectedEl.type !== 'text' && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 10, color: '#8892b0', marginBottom: 2 }}>stroke</div>
                  <PaletteSwatches
                    current={selectedEl.strokeRole}
                    onPick={(r) => updateElement(selectedId, { strokeRole: r })}
                  />
                </div>
              )}
              {selectedEl.strokeWidth !== undefined && <div className="prop-row"><label>sWidth</label><input type="number" value={selectedEl.strokeWidth} step={0.5} onChange={e => updateElement(selectedId, { strokeWidth: +e.target.value })} /></div>}
              <div className="prop-row">
                <label>наука</label>
                <select
                  value={selectedEl.science || ''}
                  onChange={e => updateElement(selectedId, { science: e.target.value || undefined })}
                  style={{ flex: 1, padding: '2px 4px', background: '#0f0f23', border: '1px solid #2a2a4a', color: '#e0e0e0', borderRadius: 3, fontSize: 11 }}
                >
                  <option value="">как у рисунка</option>
                  {Object.keys(SCIENCES).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {(selectedEl.type === 'line' || selectedEl.type === 'arrow' || selectedEl.type === 'bezier') && (
                <label style={{ fontSize: 11, color: '#8892b0', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={!!selectedEl.dash} onChange={e => updateElement(selectedId, { dash: e.target.checked || undefined })} /> пунктир
                </label>
              )}
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <button className="btn" style={{ flex: 1, fontSize: 10, padding: '3px 6px' }} title="На передний план" onClick={() => updateElements(prev => { const i = prev.findIndex(e => e.id === selectedId); if (i < 0 || i === prev.length - 1) return prev; const n = [...prev]; n.push(n.splice(i, 1)[0]); return n })}>▲ Выше</button>
                <button className="btn" style={{ flex: 1, fontSize: 10, padding: '3px 6px' }} title="На задний план" onClick={() => updateElements(prev => { const i = prev.findIndex(e => e.id === selectedId); if (i <= 0) return prev; const n = [...prev]; n.unshift(n.splice(i, 1)[0]); return n })}>▼ Ниже</button>
              </div>
              <button className="btn" style={{ marginTop: 4, color: '#e74c3c', borderColor: '#c0392b' }} onClick={() => deleteElement(selectedId)}>Удалить элемент</button>
            </div>
          </>
        )}
      </div>

      <div className="canvas-area" style={canvasStyle}>
        {previewFull && (
          <div className="preview-fullscreen" onClick={() => setPreviewFull(false)}>
            <div className="preview-full-row">
              <div className="preview-full-cell" style={{ background: THEME.light.bg }}>
                <div className="preview-label" style={{ color: THEME.light.muted }}>light</div>
                <div className="preview-svg" dangerouslySetInnerHTML={{ __html: theme === 'light' ? previewSVG : previewOppositeSVG }} />
              </div>
              <div className="preview-full-cell" style={{ background: THEME.dark.bg }}>
                <div className="preview-label" style={{ color: THEME.dark.muted }}>dark</div>
                <div className="preview-svg" dangerouslySetInnerHTML={{ __html: theme === 'dark' ? previewSVG : previewOppositeSVG }} />
              </div>
            </div>
          </div>
        )}
        <div className="preview-panel" onClick={() => setPreviewFull(true)} style={{ cursor: 'pointer', pointerEvents: 'auto' }}>
          <div className="preview-title">SVG-предпросмотр (для книги)</div>
          <div className="preview-row">
            <div className="preview-cell" style={{ background: THEME.light.bg }}>
              <div className="preview-label" style={{ color: THEME.light.muted }}>light</div>
              <div className="preview-svg" dangerouslySetInnerHTML={{ __html: theme === 'light' ? previewSVG : previewOppositeSVG }} />
            </div>
            <div className="preview-cell" style={{ background: THEME.dark.bg }}>
              <div className="preview-label" style={{ color: THEME.dark.muted }}>dark</div>
              <div className="preview-svg" dangerouslySetInnerHTML={{ __html: theme === 'dark' ? previewSVG : previewOppositeSVG }} />
            </div>
          </div>
        </div>
        <Stage
          ref={stageRef}
          width={window.innerWidth - 260}
          height={window.innerHeight}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePos.x}
          y={stagePos.y}
          onWheel={handleWheel}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          style={canvasStyle}
        >
          <Layer>
            {showGrid && <Grid width={window.innerWidth - 260} height={window.innerHeight} scale={stageScale} theme={theme} step={gridSize} offset={stagePos} />}
            {elements.map(renderElementWithId)}
            {rubberBand && (
              <Rect x={rubberBand.x} y={rubberBand.y} width={rubberBand.w} height={rubberBand.h}
                stroke="#2980b9" strokeWidth={0.5 / stageScale} dash={[4 / stageScale, 4 / stageScale]}
                fill="rgba(41,128,185,0.1)" listening={false} />
            )}
            {useTransformer && <Transformer
              ref={trRef}
              rotateEnabled={false}
              resizeEnabled={!isMulti}
              borderStroke="#2980b9" anchorStroke="#2980b9" anchorFill="#fff" anchorSize={8}
              boundBoxFunc={(_, n) => ({ ...n, width: Math.max(10, n.width), height: Math.max(10, n.height) })}
              onDragEnd={handleGroupDragEnd}
            />}
            {pointHandlesData && (
              <>
                {pointHandlesData.t === 'bezier' && (
                  <>
                    <Line
                      points={[pointHandlesData.handles[0].x, pointHandlesData.handles[0].y, pointHandlesData.handles[1].x, pointHandlesData.handles[1].y]}
                      stroke="#2980b9" strokeWidth={0.5 / stageScale} dash={[3, 3]} listening={false}
                    />
                    <Line
                      points={[pointHandlesData.handles[3].x, pointHandlesData.handles[3].y, pointHandlesData.handles[2].x, pointHandlesData.handles[2].y]}
                      stroke="#2980b9" strokeWidth={0.5 / stageScale} dash={[3, 3]} listening={false}
                    />
                  </>
                )}
                {pointHandlesData.handles.map(h => (
                  <Circle
                    key={`handle-${h.i}`}
                    x={h.x} y={h.y}
                    radius={5 / stageScale}
                    fill={h.kind === 'cp' ? '#fff' : '#2980b9'}
                    stroke="#2980b9"
                    strokeWidth={1 / stageScale}
                    draggable
                    onDragMove={(e) => updatePoint(h.i, e.target.x(), e.target.y(), false)}
                    onDragEnd={(e) => updatePoint(h.i, e.target.x(), e.target.y(), true)}
                  />
                ))}
              </>
            )}
          </Layer>
        </Stage>
      </div>
    </>
  )
}

export default App
