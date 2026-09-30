import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Circle,
  Ellipse,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Path,
  Rect,
  Stage,
  Transformer,
} from 'react-konva'
import type Konva from 'konva'
import {
  Brush,
  ChevronDown,
  ChevronUp,
  Circle as CircleIcon,
  Copy,
  Download,
  Eraser,
  Eye,
  EyeOff,
  FileImage,
  FolderOpen,
  Hand,
  Layers3,
  Maximize2,
  MousePointer2,
  PaintBucket,
  PenTool,
  Pipette,
  Plus,
  Redo2,
  RectangleHorizontal,
  Save,
  Slash,
  Trash2,
  Undo2,
  WandSparkles,
} from 'lucide-react'

const APP_VERSION = '0.4.0-alpha'
const PALETTE_STORAGE_KEY = 'vitral-palette'
const LEGACY_PALETTE_STORAGE_KEY = 'vitral-palette-v03'
const DEFAULT_PALETTE = ['#111111','#ffffff','#f7c948','#f97068','#6ac3ff','#5ed59c','#a97cff','#ff9bd2','#ff7f50','#2b6cb0','#2d3748','#f6ad55']
const AUTOSAVE_DB = 'vitral-studio-db'
const AUTOSAVE_STORE = 'projects'
const AUTOSAVE_KEY = 'autosave'

type Tool = 'select' | 'brush' | 'eraser' | 'fill' | 'eyedropper' | 'pen' | 'lasso' | 'rect' | 'ellipse' | 'line' | 'pan'
type Pt = { x: number; y: number; p?: number }
type LayerRole = 'paint' | 'lineart' | 'normal'
type FillMode = 'solid' | 'gradient' | 'glass'
type FillStyleSpec = {
  mode: FillMode
  color1: string
  color2: string
  angle: number
  texture: number
}

type BezierNode = Pt & {
  in?: Pt
  out?: Pt
}

type BaseItem = {
  id: string
  x: number
  y: number
  rotation?: number
  scaleX?: number
  scaleY?: number
}

type StrokeItem = BaseItem & { kind: 'stroke'; points: Pt[]; color: string; size: number; erase?: boolean; composite?: GlobalCompositeOperation }
type RectItem = BaseItem & { kind: 'rect'; width: number; height: number; color: string; size: number; fill?: string }
type EllipseItem = BaseItem & { kind: 'ellipse'; radiusX: number; radiusY: number; color: string; size: number; fill?: string }
type LineItem = BaseItem & { kind: 'line'; points: number[]; color: string; size: number }
type PathItem = BaseItem & { kind: 'path'; nodes: BezierNode[]; color: string; size: number; closed?: boolean; fill?: string }
type ImageItem = BaseItem & { kind: 'image'; dataUrl: string; width: number; height: number; label?: string; fillRegion?: boolean; fillStyle?: FillStyleSpec }
type Item = StrokeItem | RectItem | EllipseItem | LineItem | PathItem | ImageItem

type ArtLayer = {
  id: string
  name: string
  role: LayerRole
  visible: boolean
  locked: boolean
  alphaLock?: boolean
  opacity: number
  items: Item[]
}

type DocState = {
  version: 4
  width: number
  height: number
  name: string
  layers: ArtLayer[]
  activeLayerId: string
}

type SavedProject = {
  app: 'Vitral Studio'
  version: string
  savedAt: string
  document: DocState
}

const makeId = () => crypto.randomUUID()

const initialDoc = (width = 1200, height = 800): DocState => {
  const ink = makeId()
  const color = makeId()
  return {
    version: 4,
    width,
    height,
    name: 'Sin título',
    activeLayerId: ink,
    layers: [
      { id: color, name: 'Color', role: 'paint', visible: true, locked: false, alphaLock: false, opacity: 1, items: [] },
      { id: ink, name: 'Lineart', role: 'lineart', visible: true, locked: false, alphaLock: false, opacity: 1, items: [] },
    ],
  }
}

function migrateDoc(value: any): DocState | null {
  if (!value || !Array.isArray(value.layers)) return null
  if ([2, 3, 4].includes(Number(value.version)) && typeof value.width === 'number' && typeof value.height === 'number') {
    return {
      version: 4,
      width: Number(value.width) || 1200,
      height: Number(value.height) || 800,
      name: value.name || 'Proyecto importado',
      activeLayerId: value.activeLayerId || value.layers[value.layers.length - 1]?.id,
      layers: value.layers.map((layer: any) => ({
        ...layer,
        role: layer.role || (/lineart|tinta/i.test(layer.name || '') ? 'lineart' : /color/i.test(layer.name || '') ? 'paint' : 'normal'),
        opacity: typeof layer.opacity === 'number' ? layer.opacity : 1,
        visible: layer.visible !== false,
        locked: !!layer.locked,
        alphaLock: !!layer.alphaLock,
        items: Array.isArray(layer.items) ? layer.items : [],
      })),
    }
  }
  // Compatibilidad con el MVP v0.1 y documentos sin versión explícita.
  return {
    version: 4,
    width: Number(value.width) || 1200,
    height: Number(value.height) || 800,
    name: value.name || 'Proyecto importado',
    activeLayerId: value.activeLayerId || value.layers[value.layers.length - 1]?.id,
    layers: value.layers.map((layer: any) => ({
      ...layer,
      role: layer.role || (/lineart|tinta/i.test(layer.name || '') ? 'lineart' : /color/i.test(layer.name || '') ? 'paint' : 'normal'),
      opacity: typeof layer.opacity === 'number' ? layer.opacity : 1,
      visible: layer.visible !== false,
      locked: !!layer.locked,
      alphaLock: !!layer.alphaLock,
      items: Array.isArray(layer.items) ? layer.items : [],
    })),
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUTOSAVE_DB, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE)) db.createObjectStore(AUTOSAVE_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE, 'readonly')
    const req = tx.objectStore(AUTOSAVE_STORE).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

async function idbPut<T>(key: string, value: T): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE, 'readwrite')
    tx.objectStore(AUTOSAVE_STORE).put(value, key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

function pointInPolygon(point: Pt, polygon: Pt[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 0.00001) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function itemBounds(item: Item) {
  if (item.kind === 'rect' || item.kind === 'image') return { x: item.x, y: item.y, w: item.width, h: item.height }
  if (item.kind === 'ellipse') return { x: item.x - item.radiusX, y: item.y - item.radiusY, w: item.radiusX * 2, h: item.radiusY * 2 }
  if (item.kind === 'line') {
    const [x1, y1, x2, y2] = item.points
    return { x: item.x + Math.min(x1, x2), y: item.y + Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
  }
  const pts = item.kind === 'path' ? item.nodes : item.points
  if (!pts.length) return { x: item.x, y: item.y, w: 1, h: 1 }
  const xs = pts.map((p) => p.x + item.x)
  const ys = pts.map((p) => p.y + item.y)
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

function lassoHitsItem(item: Item, polygon: Pt[]) {
  const b = itemBounds(item)
  const corners = [
    { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h },
    { x: b.x + b.w / 2, y: b.y + b.h / 2 },
  ]
  if (corners.some((p) => pointInPolygon(p, polygon))) return true
  return polygon.some((p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)
}

function curveData(nodes: BezierNode[], closed = false) {
  if (!nodes.length) return ''
  let d = `M ${nodes[0].x} ${nodes[0].y}`
  const segment = (a: BezierNode, b: BezierNode) => {
    const c1 = a.out ? { x: a.x + a.out.x, y: a.y + a.out.y } : { x: a.x, y: a.y }
    const c2 = b.in ? { x: b.x + b.in.x, y: b.y + b.in.y } : { x: b.x, y: b.y }
    const hasHandles = !!a.out || !!b.in
    return hasHandles
      ? ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`
      : ` L ${b.x} ${b.y}`
  }
  for (let i = 0; i < nodes.length - 1; i++) d += segment(nodes[i], nodes[i + 1])
  if (closed && nodes.length > 2) d += segment(nodes[nodes.length - 1], nodes[0]) + ' Z'
  return d
}

function HexSwatch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="color-chip" title="Color actual">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <span style={{ background: value }} />
    </label>
  )
}

function CanvasImage({ item, draggable, selected, selectable, onSelect, onDragStart, onDragEnd, nodeRef }: {
  item: ImageItem
  draggable: boolean
  selected: boolean
  selectable: boolean
  onSelect: () => void
  onDragStart: () => void
  onDragEnd: (node: Konva.Image) => void
  nodeRef: (node: Konva.Image | null) => void
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    const image = new Image()
    image.onload = () => setImg(image)
    image.src = item.dataUrl
  }, [item.dataUrl])
  if (!img) return null
  return (
    <>
      <KonvaImage
        ref={nodeRef}
        image={img}
        x={item.x}
        y={item.y}
        width={item.width}
        height={item.height}
        rotation={item.rotation ?? 0}
        scaleX={item.scaleX ?? 1}
        scaleY={item.scaleY ?? 1}
        draggable={draggable}
        listening={selectable}
        onPointerDown={(e) => { e.cancelBubble = true; onSelect() }}
        onDragStart={onDragStart}
        onDragEnd={(e) => onDragEnd(e.target as Konva.Image)}
      />
      {selected && !draggable && <Rect x={item.x} y={item.y} width={item.width} height={item.height} stroke="#7c5cff" dash={[8, 5]} listening={false} />}
    </>
  )
}

type FillResult = { dataUrl: string; escaped: boolean; x: number; y: number; width: number; height: number }

type RGB = { r: number; g: number; b: number }

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '').padEnd(6, '0').slice(0, 6)
  return {
    r: parseInt(clean.slice(0, 2), 16) || 0,
    g: parseInt(clean.slice(2, 4), 16) || 0,
    b: parseInt(clean.slice(4, 6), 16) || 0,
  }
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t))
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k),
  }
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function deterministicNoise(x: number, y: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123
  return value - Math.floor(value)
}

function styledPixel(style: FillStyleSpec, x: number, y: number, width: number, height: number): RGB {
  const a = hexToRgb(style.color1)
  const b = hexToRgb(style.color2)
  if (style.mode === 'solid') return a

  const radians = (style.angle * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const nx = width <= 1 ? 0 : x / (width - 1) - 0.5
  const ny = height <= 1 ? 0 : y / (height - 1) - 0.5
  const extent = Math.max(0.0001, Math.abs(cos) + Math.abs(sin))
  const t = Math.max(0, Math.min(1, 0.5 + (nx * cos + ny * sin) / extent))
  const mixed = mixRgb(a, b, t)
  if (style.mode === 'gradient') return mixed

  const amount = Math.max(0, Math.min(1, style.texture / 100))
  const grain = (deterministicNoise(x, y) - 0.5) * 34 * amount
  const wave = Math.sin((x + y * 0.7) * 0.095) * 8 * amount
  const band = Math.exp(-Math.pow((t - 0.28) / 0.085, 2)) * 32 * amount
  const shade = grain + wave + band
  return { r: clampByte(mixed.r + shade), g: clampByte(mixed.g + shade), b: clampByte(mixed.b + shade) }
}

function restyleMaskedCanvas(canvas: HTMLCanvasElement, style: FillStyleSpec) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4
      if (data.data[idx + 3] === 0) continue
      const rgb = styledPixel(style, x, y, canvas.width, canvas.height)
      data.data[idx] = rgb.r
      data.data[idx + 1] = rgb.g
      data.data[idx + 2] = rgb.b
    }
  }
  ctx.putImageData(data, 0, 0)
  return canvas.toDataURL('image/png')
}

function restyleFillDataUrl(dataUrl: string, width: number, height: number, style: FillStyleSpec): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width))
      canvas.height = Math.max(1, Math.round(height))
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(restyleMaskedCanvas(canvas, style))
    }
    image.onerror = () => reject(new Error('No se pudo leer la región'))
    image.src = dataUrl
  })
}

function floodFillFromCanvas(source: HTMLCanvasElement, x: number, y: number, style: FillStyleSpec, closeGap: number): FillResult | null {
  const w = source.width
  const h = source.height
  const srcCtx = source.getContext('2d', { willReadFrequently: true })!
  const src = srcCtx.getImageData(0, 0, w, h)
  const boundary = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = src.data[i * 4]
    const g = src.data[i * 4 + 1]
    const b = src.data[i * 4 + 2]
    const a = src.data[i * 4 + 3]
    const lum = r * 0.2126 + g * 0.7152 + b * 0.0722
    if (a > 35 && lum < 125) boundary[i] = 1
  }

  if (closeGap > 0) {
    const expanded = boundary.slice()
    const radius = Math.min(10, Math.max(1, closeGap))
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        if (!boundary[yy * w + xx]) continue
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy > radius * radius) continue
            const nx = xx + dx, ny = yy + dy
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) expanded[ny * w + nx] = 1
          }
        }
      }
    }
    boundary.set(expanded)
  }

  const sx = Math.max(0, Math.min(w - 1, Math.round(x)))
  const sy = Math.max(0, Math.min(h - 1, Math.round(y)))
  if (boundary[sy * w + sx]) return null

  const visited = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  let head = 0, tail = 0
  queue[tail++] = sy * w + sx
  visited[sy * w + sx] = 1
  let minX = sx, maxX = sx, minY = sy, maxY = sy, filled = 0

  while (head < tail) {
    const idx = queue[head++]
    const cx = idx % w
    const cy = Math.floor(idx / w)
    filled++
    if (cx < minX) minX = cx
    if (cx > maxX) maxX = cx
    if (cy < minY) minY = cy
    if (cy > maxY) maxY = cy
    const neighbors = [idx + 1, idx - 1, idx + w, idx - w]
    for (const ni of neighbors) {
      if (ni < 0 || ni >= w * h || visited[ni] || boundary[ni]) continue
      const nx = ni % w
      const ny = Math.floor(ni / w)
      if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue
      visited[ni] = 1
      queue[tail++] = ni
    }
  }

  const escaped = filled > w * h * 0.92
  const pad = Math.max(1, closeGap + 1)
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad)
  const outW = maxX - minX + 1
  const outH = maxY - minY + 1
  const out = document.createElement('canvas')
  out.width = outW; out.height = outH
  const outCtx = out.getContext('2d')!
  const outData = outCtx.createImageData(outW, outH)

  for (let yy = minY; yy <= maxY; yy++) {
    for (let xx = minX; xx <= maxX; xx++) {
      const srcIdx = yy * w + xx
      if (!visited[srcIdx]) continue
      const localX = xx - minX
      const localY = yy - minY
      const outIdx = (localY * outW + localX) * 4
      const rgb = styledPixel(style, localX, localY, outW, outH)
      outData.data[outIdx] = rgb.r
      outData.data[outIdx + 1] = rgb.g
      outData.data[outIdx + 2] = rgb.b
      outData.data[outIdx + 3] = 255
    }
  }
  outCtx.putImageData(outData, 0, 0)
  return { dataUrl: out.toDataURL('image/png'), escaped, x: minX, y: minY, width: outW, height: outH }
}

const tools: Array<{ id: Tool; label: string; icon: typeof Brush }> = [
  { id: 'select', label: 'Seleccionar', icon: MousePointer2 },
  { id: 'brush', label: 'Lápiz', icon: Brush },
  { id: 'eraser', label: 'Borrador', icon: Eraser },
  { id: 'fill', label: 'Relleno', icon: PaintBucket },
  { id: 'eyedropper', label: 'Cuentagotas', icon: Pipette },
  { id: 'pen', label: 'Vector', icon: PenTool },
  { id: 'lasso', label: 'Lazo', icon: WandSparkles },
  { id: 'rect', label: 'Rectángulo', icon: RectangleHorizontal },
  { id: 'ellipse', label: 'Elipse', icon: CircleIcon },
  { id: 'line', label: 'Línea', icon: Slash },
  { id: 'pan', label: 'Mover lienzo', icon: Hand },
]

export default function App() {
  const [doc, setDoc] = useState<DocState>(() => initialDoc())
  const [tool, setTool] = useState<Tool>('brush')
  const [color, setColor] = useState('#111111')
  const [color2, setColor2] = useState('#f7c948')
  const [fillMode, setFillMode] = useState<FillMode>('solid')
  const [gradientAngle, setGradientAngle] = useState(45)
  const [glassTexture, setGlassTexture] = useState(45)
  const [size, setSize] = useState(10)
  const [closeGap, setCloseGap] = useState(2)
  const [fingerDraw, setFingerDraw] = useState(true)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [draftStroke, setDraftStroke] = useState<StrokeItem | null>(null)
  const [draftShape, setDraftShape] = useState<Item | null>(null)
  const [penDraft, setPenDraft] = useState<PathItem | null>(null)
  const [lasso, setLasso] = useState<Pt[]>([])
  const [zoom, setZoom] = useState(0.8)
  const [stagePos, setStagePos] = useState({ x: 40, y: 40 })
  const [viewport, setViewport] = useState({ width: 900, height: 700 })
  const [toast, setToast] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'loading' | 'saved' | 'saving' | 'error'>('loading')
  const [layersOpen, setLayersOpen] = useState(false)
  const [palette, setPalette] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(PALETTE_STORAGE_KEY) ?? localStorage.getItem(LEGACY_PALETTE_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : DEFAULT_PALETTE
    } catch {
      return DEFAULT_PALETTE
    }
  })

  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const drawingRef = useRef(false)
  const startPointRef = useRef<Pt | null>(null)
  const panRef = useRef<{ pointer: Pt; stage: Pt } | null>(null)
  const penHandleRef = useRef<{ index: number; anchor: Pt } | null>(null)
  const pinchRef = useRef<{ distance: number; center: Pt; zoom: number; stage: Pt } | null>(null)
  const pastRef = useRef<DocState[]>([])
  const futureRef = useRef<DocState[]>([])
  const dragSnapshotRef = useRef<DocState | null>(null)
  const itemRefs = useRef<Record<string, Konva.Node | null>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const projectRef = useRef<HTMLInputElement>(null)
  const hydratedRef = useRef(false)
  const firstFitRef = useRef(false)

  const activeLayer = doc.layers.find((l) => l.id === doc.activeLayerId)
  const canDraw = !!activeLayer && !activeLayer.locked && activeLayer.visible
  const selectedPath = useMemo(() => {
    if (selectedIds.length !== 1) return null
    for (const layer of doc.layers) {
      const item = layer.items.find((it) => it.id === selectedIds[0])
      if (item?.kind === 'path') return { item, layer }
    }
    return null
  }, [doc, selectedIds])
  const selectedFill = useMemo(() => {
    if (selectedIds.length !== 1) return null
    for (const layer of doc.layers) {
      const item = layer.items.find((it) => it.id === selectedIds[0])
      if (item?.kind === 'image' && item.fillRegion) return { item, layer }
    }
    return null
  }, [doc, selectedIds])

  const currentFillStyle: FillStyleSpec = { mode: fillMode, color1: color, color2, angle: gradientAngle, texture: glassTexture }

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 1900)
  }

  const addCurrentColorToPalette = () => {
    setPalette((current) => current.includes(color) ? current : [color, ...current].slice(0, 18))
    notify('Color guardado en paleta')
  }

  const removePaletteColor = (hex: string) => {
    setPalette((current) => current.filter((value) => value !== hex))
  }

  useEffect(() => {
    const style = selectedFill?.item.fillStyle
    if (!style) return
    setFillMode(style.mode)
    setColor(style.color1)
    setColor2(style.color2)
    setGradientAngle(style.angle)
    setGlassTexture(style.texture)
  }, [selectedFill?.item.id])

  const commit = (recipe: (current: DocState) => DocState) => {
    setDoc((current) => {
      pastRef.current.push(structuredClone(current))
      if (pastRef.current.length > 80) pastRef.current.shift()
      futureRef.current = []
      return recipe(current)
    })
  }

  const undo = () => {
    const previous = pastRef.current.pop()
    if (!previous) return
    futureRef.current.push(structuredClone(doc))
    setDoc(previous)
    setSelectedIds([])
  }

  const redo = () => {
    const next = futureRef.current.pop()
    if (!next) return
    pastRef.current.push(structuredClone(doc))
    setDoc(next)
    setSelectedIds([])
  }

  useEffect(() => {
    let active = true
    idbGet<SavedProject>(AUTOSAVE_KEY).then((saved) => {
      if (!active) return
      const migrated = migrateDoc(saved?.document)
      if (migrated) setDoc(migrated)
      hydratedRef.current = true
      setSaveState('saved')
    }).catch(() => {
      hydratedRef.current = true
      setSaveState('error')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    try { localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(palette)) } catch {}
  }, [palette])

  useEffect(() => {
    if (!hydratedRef.current) return
    setSaveState('saving')
    const timer = window.setTimeout(() => {
      const payload: SavedProject = { app: 'Vitral Studio', version: APP_VERSION, savedAt: new Date().toISOString(), document: doc }
      idbPut(AUTOSAVE_KEY, payload).then(() => setSaveState('saved')).catch(() => setSaveState('error'))
    }, 700)
    return () => window.clearTimeout(timer)
  }, [doc])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      setViewport({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fitCanvasFor = (width: number, height: number) => {
    const margin = 36
    const z = Math.min((viewport.width - margin * 2) / width, (viewport.height - margin * 2) / height, 1.5)
    const nextZoom = Math.max(0.12, z)
    setZoom(nextZoom)
    setStagePos({ x: (viewport.width - width * nextZoom) / 2, y: (viewport.height - height * nextZoom) / 2 })
  }

  const fitCanvas = () => fitCanvasFor(doc.width, doc.height)

  useEffect(() => {
    if (viewport.width < 10 || viewport.height < 10 || firstFitRef.current) return
    firstFitRef.current = true
    window.setTimeout(fitCanvas, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.width, viewport.height])

  useEffect(() => {
    const transformer = transformerRef.current
    if (!transformer || tool !== 'select') return
    const nodes = selectedIds.map((sid) => itemRefs.current[sid]).filter(Boolean) as Konva.Node[]
    transformer.nodes(nodes)
    transformer.getLayer()?.batchDraw()
  }, [selectedIds, tool, doc])

  const docPoint = (): Pt | null => {
    const stage = stageRef.current
    if (!stage) return null
    const pos = stage.getPointerPosition()
    if (!pos) return null
    const transform = stage.getAbsoluteTransform().copy().invert()
    return transform.point(pos)
  }

  const isTouchPointer = (evt: any) => evt?.evt?.pointerType === 'touch' || evt?.evt?.touches

  const beginPan = (evt: any) => {
    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    if (!stage || !pointer) return
    panRef.current = { pointer, stage: { x: stage.x(), y: stage.y() } }
    evt.evt?.preventDefault?.()
  }

  const movePan = () => {
    const stage = stageRef.current
    const p = stage?.getPointerPosition()
    if (!stage || !p || !panRef.current) return
    setStagePos({ x: panRef.current.stage.x + p.x - panRef.current.pointer.x, y: panRef.current.stage.y + p.y - panRef.current.pointer.y })
  }

  const addItemToLayer = (layerId: string, item: Item) => {
    const layer = doc.layers.find((l) => l.id === layerId)
    if (!layer || layer.locked || !layer.visible) return
    commit((current) => ({
      ...current,
      layers: current.layers.map((l) => l.id === layerId ? { ...l, items: [...l.items, item] } : l),
    }))
  }

  const addItem = (item: Item) => {
    if (!canDraw || !activeLayer) return
    addItemToLayer(activeLayer.id, item)
  }

  const handlePointerDown = (evt: any) => {
    const pt = docPoint()
    if (!pt) return
    if (tool === 'pan' || (isTouchPointer(evt) && !fingerDraw)) {
      beginPan(evt)
      return
    }
    if (!canDraw && tool !== 'select' && tool !== 'lasso' && tool !== 'fill') {
      notify('La capa activa está bloqueada u oculta')
      return
    }
    if (tool === 'select') {
      if (evt.target === stageRef.current) setSelectedIds([])
      return
    }
    if (tool === 'fill') {
      fillAt(pt)
      return
    }
    if (tool === 'eyedropper') {
      pickColorAt(pt)
      return
    }
    if (tool === 'pen') {
      const nextNode: BezierNode = { ...pt }
      setPenDraft((current) => {
        const nodes = current ? [...current.nodes, nextNode] : [nextNode]
        penHandleRef.current = { index: nodes.length - 1, anchor: pt }
        return current
          ? { ...current, nodes }
          : { id: makeId(), kind: 'path', nodes, x: 0, y: 0, color, size, closed: false }
      })
      drawingRef.current = true
      return
    }

    drawingRef.current = true
    startPointRef.current = pt
    if (tool === 'brush' || tool === 'eraser') {
      const pressure = evt?.evt?.pressure && evt.evt.pressure > 0 ? evt.evt.pressure : 0.7
      setDraftStroke({ id: makeId(), kind: 'stroke', x: 0, y: 0, points: [{ ...pt, p: pressure }], color, size, erase: tool === 'eraser', composite: tool === 'brush' && activeLayer?.alphaLock ? 'source-atop' : 'source-over' })
    } else if (tool === 'lasso') {
      setLasso([pt])
    } else if (tool === 'rect') {
      setDraftShape({ id: makeId(), kind: 'rect', x: pt.x, y: pt.y, width: 0, height: 0, color, size })
    } else if (tool === 'ellipse') {
      setDraftShape({ id: makeId(), kind: 'ellipse', x: pt.x, y: pt.y, radiusX: 0, radiusY: 0, color, size })
    } else if (tool === 'line') {
      setDraftShape({ id: makeId(), kind: 'line', x: 0, y: 0, points: [pt.x, pt.y, pt.x, pt.y], color, size })
    }
  }

  const handlePointerMove = (evt: any) => {
    if (pinchRef.current) return
    if (panRef.current) { movePan(); return }
    if (!drawingRef.current) return
    const pt = docPoint()
    if (!pt) return
    if (tool === 'pen' && penHandleRef.current) {
      const { index, anchor } = penHandleRef.current
      const dx = pt.x - anchor.x, dy = pt.y - anchor.y
      if (Math.hypot(dx, dy) > 2) {
        setPenDraft((draft) => draft ? {
          ...draft,
          nodes: draft.nodes.map((n, i) => i === index ? { ...n, out: { x: dx, y: dy }, in: { x: -dx, y: -dy } } : n),
        } : draft)
      }
      return
    }
    if (tool === 'brush' || tool === 'eraser') {
      const pressure = evt?.evt?.pressure && evt.evt.pressure > 0 ? evt.evt.pressure : 0.7
      setDraftStroke((s) => s ? { ...s, points: [...s.points, { ...pt, p: pressure }] } : s)
    } else if (tool === 'lasso') {
      setLasso((p) => [...p, pt])
    } else if (draftShape && startPointRef.current) {
      const start = startPointRef.current
      if (draftShape.kind === 'rect') {
        setDraftShape({ ...draftShape, x: Math.min(start.x, pt.x), y: Math.min(start.y, pt.y), width: Math.abs(pt.x - start.x), height: Math.abs(pt.y - start.y) })
      } else if (draftShape.kind === 'ellipse') {
        setDraftShape({ ...draftShape, x: (start.x + pt.x) / 2, y: (start.y + pt.y) / 2, radiusX: Math.abs(pt.x - start.x) / 2, radiusY: Math.abs(pt.y - start.y) / 2 })
      } else if (draftShape.kind === 'line') {
        setDraftShape({ ...draftShape, points: [start.x, start.y, pt.x, pt.y] })
      }
    }
  }

  const handlePointerUp = () => {
    if (panRef.current) { panRef.current = null; return }
    if (!drawingRef.current) return
    drawingRef.current = false
    if (tool === 'pen') { penHandleRef.current = null; return }
    if (draftStroke && draftStroke.points.length > 1) addItem(draftStroke)
    if (draftShape) addItem(draftShape)
    if (tool === 'lasso' && lasso.length > 2) {
      const selected: string[] = []
      doc.layers.filter((l) => l.visible && !l.locked).forEach((layer) => layer.items.forEach((item) => {
        if (lassoHitsItem(item, lasso)) selected.push(item.id)
      }))
      setSelectedIds(selected)
      if (selected.length) notify(`${selected.length} elemento${selected.length > 1 ? 's' : ''} seleccionado${selected.length > 1 ? 's' : ''}`)
    }
    setDraftStroke(null)
    setDraftShape(null)
    setLasso([])
    startPointRef.current = null
  }

  const finishPen = () => {
    if (penDraft && penDraft.nodes.length >= 2) addItem(penDraft)
    setPenDraft(null)
    penHandleRef.current = null
    drawingRef.current = false
  }

  const cancelDrafts = () => {
    setPenDraft(null); setLasso([]); setDraftShape(null); setDraftStroke(null)
    drawingRef.current = false; penHandleRef.current = null
  }

  const handleTouchStart = (e: any) => {
    const touches = e.evt?.touches
    if (!touches || touches.length < 2) return
    e.evt.preventDefault()
    cancelDrafts()
    const [a, b] = [touches[0], touches[1]]
    const rect = stageRef.current?.container().getBoundingClientRect()
    if (!rect) return
    const pa = { x: a.clientX - rect.left, y: a.clientY - rect.top }
    const pb = { x: b.clientX - rect.left, y: b.clientY - rect.top }
    const center = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
    const distance = Math.hypot(pb.x - pa.x, pb.y - pa.y)
    pinchRef.current = { distance, center, zoom, stage: stagePos }
  }

  const handleTouchMove = (e: any) => {
    const touches = e.evt?.touches
    if (!touches || touches.length < 2 || !pinchRef.current) return
    e.evt.preventDefault()
    const [a, b] = [touches[0], touches[1]]
    const rect = stageRef.current?.container().getBoundingClientRect()
    if (!rect) return
    const pa = { x: a.clientX - rect.left, y: a.clientY - rect.top }
    const pb = { x: b.clientX - rect.left, y: b.clientY - rect.top }
    const center = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
    const distance = Math.hypot(pb.x - pa.x, pb.y - pa.y)
    const start = pinchRef.current
    const nextZoom = Math.max(0.12, Math.min(6, start.zoom * (distance / Math.max(1, start.distance))))
    const docAtCenter = { x: (start.center.x - start.stage.x) / start.zoom, y: (start.center.y - start.stage.y) / start.zoom }
    setZoom(nextZoom)
    setStagePos({ x: center.x - docAtCenter.x * nextZoom, y: center.y - docAtCenter.y * nextZoom })
  }

  const handleTouchEnd = (e: any) => {
    if ((e.evt?.touches?.length ?? 0) < 2) pinchRef.current = null
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow() }
      if (e.key === 'Enter' && penDraft) finishPen()
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length) { e.preventDefault(); deleteSelected() }
      if (e.key === 'Escape') cancelDrafts()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const snapshotStage = (boundaryOnly = false) => {
    const stage = stageRef.current
    if (!stage) return null
    const old = { x: stage.x(), y: stage.y(), sx: stage.scaleX(), sy: stage.scaleY(), width: stage.width(), height: stage.height() }
    const changed: Array<{ node: Konva.Node; visible: boolean }> = []
    stage.getChildren().forEach((node) => {
      const name = node.name()
      const artLayer = doc.layers.find((l) => `art-layer-${l.id}` === name)
      const shouldHide = name === 'overlay' || (boundaryOnly && artLayer?.role === 'paint')
      if (shouldHide) { changed.push({ node, visible: node.visible() }); node.visible(false) }
    })
    stage.size({ width: doc.width, height: doc.height })
    stage.position({ x: 0, y: 0 })
    stage.scale({ x: 1, y: 1 })
    stage.batchDraw()
    const canvas = stage.toCanvas({ x: 0, y: 0, width: doc.width, height: doc.height, pixelRatio: 1 })
    changed.forEach(({ node, visible }) => node.visible(visible))
    stage.size({ width: old.width, height: old.height })
    stage.position({ x: old.x, y: old.y })
    stage.scale({ x: old.sx, y: old.sy })
    stage.batchDraw()
    return canvas
  }

  const pickColorAt = (pt: Pt) => {
    const canvas = snapshotStage(false)
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    const x = Math.max(0, Math.min(canvas.width - 1, Math.round(pt.x)))
    const y = Math.max(0, Math.min(canvas.height - 1, Math.round(pt.y)))
    const pixel = ctx.getImageData(x, y, 1, 1).data
    if (pixel[3] < 5) {
      notify('No hay color en ese punto')
      return
    }
    const next = '#' + [pixel[0], pixel[1], pixel[2]].map((v) => v.toString(16).padStart(2, '0')).join('')
    setColor(next)
    notify(`Color capturado ${next.toUpperCase()}`)
  }

  const fillAt = (pt: Pt) => {
    const paintLayer = activeLayer?.role === 'paint' && !activeLayer.locked && activeLayer.visible
      ? activeLayer
      : [...doc.layers].reverse().find((l) => l.role === 'paint' && l.visible && !l.locked)
    if (!paintLayer) { notify('Necesitas una capa de tipo Color editable'); return }
    const canvas = snapshotStage(true)
    if (!canvas) return
    const style = { ...currentFillStyle }
    const result = floodFillFromCanvas(canvas, pt.x, pt.y, style, closeGap)
    if (!result) { notify('Tocaste una línea; prueba dentro de una zona'); return }
    addItemToLayer(paintLayer.id, {
      id: makeId(), kind: 'image', x: result.x, y: result.y, width: result.width, height: result.height,
      dataUrl: result.dataUrl, label: style.mode === 'glass' ? 'Vitral' : style.mode === 'gradient' ? 'Degradado' : 'Relleno', fillRegion: true, fillStyle: style,
    })
    if (doc.activeLayerId !== paintLayer.id) setDoc((current) => ({ ...current, activeLayerId: paintLayer.id }))
    notify(result.escaped ? 'El relleno escapó: sube “Cerrar huecos”' : 'Zona coloreada')
  }

  const applyStyleToSelectedFill = async () => {
    if (!selectedFill || selectedFill.layer.locked) return
    const style = { ...currentFillStyle }
    try {
      const dataUrl = await restyleFillDataUrl(selectedFill.item.dataUrl, selectedFill.item.width, selectedFill.item.height, style)
      commit((current) => ({
        ...current,
        layers: current.layers.map((layer) => layer.id === selectedFill.layer.id ? {
          ...layer,
          items: layer.items.map((item) => item.id === selectedFill.item.id && item.kind === 'image' ? { ...item, dataUrl, fillStyle: style, label: style.mode === 'glass' ? 'Vitral' : style.mode === 'gradient' ? 'Degradado' : 'Relleno' } : item),
        } : layer),
      }))
      notify('Estilo aplicado a la región')
    } catch {
      notify('No se pudo actualizar la región')
    }
  }

  const exportPng = () => {
    const canvas = snapshotStage(false)
    if (!canvas) return
    const a = document.createElement('a')
    a.download = `${doc.name.replace(/[^a-z0-9-_áéíóúñ ]/gi, '').trim() || 'vitral-studio'}.png`
    a.href = canvas.toDataURL('image/png')
    a.click()
  }

  const saveNow = async () => {
    setSaveState('saving')
    try {
      await idbPut(AUTOSAVE_KEY, { app: 'Vitral Studio', version: APP_VERSION, savedAt: new Date().toISOString(), document: doc } satisfies SavedProject)
      setSaveState('saved')
      notify('Proyecto guardado en este dispositivo')
    } catch {
      setSaveState('error')
      notify('No se pudo guardar localmente')
    }
  }

  const downloadProject = () => {
    const payload: SavedProject = { app: 'Vitral Studio', version: APP_VERSION, savedAt: new Date().toISOString(), document: doc }
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${doc.name.replace(/[^a-z0-9-_áéíóúñ ]/gi, '').trim() || 'vitral-proyecto'}.vitral`
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const openProject = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        const migrated = migrateDoc(parsed.document ?? parsed)
        if (!migrated) throw new Error('Formato inválido')
        pastRef.current.push(structuredClone(doc))
        futureRef.current = []
        setDoc(migrated)
        setSelectedIds([])
        firstFitRef.current = false
        notify('Proyecto abierto')
        window.setTimeout(() => fitCanvasFor(migrated.width, migrated.height), 50)
      } catch {
        notify('Este archivo no es un proyecto Vitral válido')
      }
    }
    reader.readAsText(file)
  }

  const newProject = () => {
    const rawW = window.prompt('Ancho del lienzo en px', String(doc.width))
    if (rawW === null) return
    const rawH = window.prompt('Alto del lienzo en px', String(doc.height))
    if (rawH === null) return
    const width = Math.max(256, Math.min(6000, Number(rawW) || 1200))
    const height = Math.max(256, Math.min(6000, Number(rawH) || 800))
    if (doc.layers.some((l) => l.items.length) && !window.confirm('Se creará un proyecto nuevo. El proyecto actual seguirá en el historial de deshacer, pero conviene guardarlo primero. ¿Continuar?')) return
    pastRef.current.push(structuredClone(doc))
    futureRef.current = []
    setDoc(initialDoc(width, height))
    setSelectedIds([])
    firstFitRef.current = false
    window.setTimeout(() => fitCanvasFor(width, height), 50)
  }

  const importImage = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const image = new Image()
      image.onload = () => {
        const scale = Math.min(doc.width / image.width, doc.height / image.height, 1)
        const width = image.width * scale
        const height = image.height * scale
        const newLayerId = makeId()
        commit((current) => ({
          ...current,
          activeLayerId: newLayerId,
          layers: [
            ...current.layers,
            {
              id: newLayerId, name: 'Lineart importado', role: 'lineart', visible: true, locked: false, opacity: 1,
              items: [{ id: makeId(), kind: 'image', x: (current.width - width) / 2, y: (current.height - height) / 2, width, height, dataUrl: src, label: file.name }],
            },
          ],
        }))
        notify('Imagen importada como Lineart')
      }
      image.src = src
    }
    reader.readAsDataURL(file)
  }

  const addLayer = () => {
    const layerId = makeId()
    commit((current) => ({
      ...current,
      activeLayerId: layerId,
      layers: [...current.layers, { id: layerId, name: `Capa ${current.layers.length + 1}`, role: 'normal', visible: true, locked: false, alphaLock: false, opacity: 1, items: [] }],
    }))
  }

  const updateLayer = (layerId: string, patch: Partial<ArtLayer>) => {
    commit((current) => ({ ...current, layers: current.layers.map((l) => l.id === layerId ? { ...l, ...patch } : l) }))
  }

  const removeLayer = (layerId: string) => {
    if (doc.layers.length <= 1) return
    commit((current) => {
      const layers = current.layers.filter((l) => l.id !== layerId)
      return { ...current, layers, activeLayerId: current.activeLayerId === layerId ? layers[layers.length - 1].id : current.activeLayerId }
    })
    setSelectedIds([])
  }

  const duplicateLayer = (layerId: string) => {
    commit((current) => {
      const index = current.layers.findIndex((l) => l.id === layerId)
      if (index < 0) return current
      const source = current.layers[index]
      const copyId = makeId()
      const copy: ArtLayer = { ...structuredClone(source), id: copyId, name: `${source.name} copia`, items: source.items.map((item) => ({ ...item, id: makeId() })) }
      const layers = [...current.layers]
      layers.splice(index + 1, 0, copy)
      return { ...current, layers, activeLayerId: copyId }
    })
  }

  const moveLayer = (layerId: string, delta: -1 | 1) => {
    commit((current) => {
      const index = current.layers.findIndex((l) => l.id === layerId)
      const next = index + delta
      if (index < 0 || next < 0 || next >= current.layers.length) return current
      const layers = [...current.layers]
      ;[layers[index], layers[next]] = [layers[next], layers[index]]
      return { ...current, layers }
    })
  }

  const deleteSelected = () => {
    if (!selectedIds.length) return
    commit((current) => ({
      ...current,
      layers: current.layers.map((l) => l.locked ? l : { ...l, items: l.items.filter((item) => !selectedIds.includes(item.id)) }),
    }))
    setSelectedIds([])
  }

  const updateItemTransform = (layerId: string, itemId: string, node: Konva.Node) => {
    const layer = doc.layers.find((l) => l.id === layerId)
    if (!layer || layer.locked) return
    const before = dragSnapshotRef.current
    if (before) pastRef.current.push(before)
    dragSnapshotRef.current = null
    futureRef.current = []
    const patch = {
      x: node.x(), y: node.y(), rotation: node.rotation(), scaleX: node.scaleX(), scaleY: node.scaleY(),
    }
    setDoc((current) => ({
      ...current,
      layers: current.layers.map((l) => l.id === layerId ? { ...l, items: l.items.map((i) => i.id === itemId ? { ...i, ...patch } : i) } : l),
    }))
  }

  const updateSelectedTransforms = () => {
    if (!dragSnapshotRef.current) return
    const snapshot = dragSnapshotRef.current
    dragSnapshotRef.current = null
    pastRef.current.push(snapshot)
    futureRef.current = []
    setDoc((current) => ({
      ...current,
      layers: current.layers.map((layer) => layer.locked ? layer : {
        ...layer,
        items: layer.items.map((item) => {
          if (!selectedIds.includes(item.id)) return item
          const node = itemRefs.current[item.id]
          if (!node) return item
          return { ...item, x: node.x(), y: node.y(), rotation: node.rotation(), scaleX: node.scaleX(), scaleY: node.scaleY() }
        }),
      }),
    }))
  }

  const changePathNode = (layerId: string, itemId: string, index: number, patch: Partial<BezierNode>, live = true) => {
    const layer = doc.layers.find((l) => l.id === layerId)
    if (!layer || layer.locked) return
    if (!live && dragSnapshotRef.current) {
      pastRef.current.push(dragSnapshotRef.current)
      dragSnapshotRef.current = null
      futureRef.current = []
    }
    setDoc((current) => ({
      ...current,
      layers: current.layers.map((l) => l.id === layerId ? {
        ...l,
        items: l.items.map((i) => i.id === itemId && i.kind === 'path'
          ? { ...i, nodes: i.nodes.map((n, idx) => idx === index ? { ...n, ...patch } : n) }
          : i),
      } : l),
    }))
  }

  const changePathHandle = (layerId: string, itemId: string, index: number, key: 'in' | 'out', absolutePt: Pt, live = true) => {
    const layer = doc.layers.find((l) => l.id === layerId)
    const path = layer?.items.find((i) => i.id === itemId && i.kind === 'path') as PathItem | undefined
    const node = path?.nodes[index]
    if (!layer || layer.locked || !path || !node) return
    changePathNode(layerId, itemId, index, { [key]: { x: absolutePt.x - path.x - node.x, y: absolutePt.y - path.y - node.y } }, live)
  }

  const togglePathClosed = () => {
    if (!selectedPath) return
    commit((current) => ({ ...current, layers: current.layers.map((l) => l.id === selectedPath.layer.id ? { ...l, items: l.items.map((it) => it.id === selectedPath.item.id && it.kind === 'path' ? { ...it, closed: !it.closed } : it) } : l) }))
  }

  const togglePathFill = () => {
    if (!selectedPath) return
    commit((current) => ({ ...current, layers: current.layers.map((l) => l.id === selectedPath.layer.id ? { ...l, items: l.items.map((it) => it.id === selectedPath.item.id && it.kind === 'path' ? { ...it, fill: it.fill ? undefined : color, closed: true } : it) } : l) }))
  }

  const wheelZoom = (e: any) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const oldScale = stage.scaleX()
    const pointer = stage.getPointerPosition()!
    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale }
    const direction = e.evt.deltaY > 0 ? -1 : 1
    const newScale = Math.max(0.12, Math.min(6, oldScale * (direction > 0 ? 1.08 : 1 / 1.08)))
    setZoom(newScale)
    setStagePos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale })
  }

  const registerNode = (itemId: string, node: Konva.Node | null) => { itemRefs.current[itemId] = node }
  const layerEditable = (layerId: string) => !!doc.layers.find((l) => l.id === layerId && l.visible && !l.locked)
  const selectItem = (itemId: string, layerId: string, additive: boolean) => {
    if (tool !== 'select' || !layerEditable(layerId)) return
    setSelectedIds((current) => additive ? (current.includes(itemId) ? current.filter((v) => v !== itemId) : [...current, itemId]) : [itemId])
  }

  const transformProps = (item: Item) => ({ rotation: item.rotation ?? 0, scaleX: item.scaleX ?? 1, scaleY: item.scaleY ?? 1 })

  const renderStroke = (item: StrokeItem, selected: boolean, layerId: string, draggable: boolean) => {
    const segments = []
    for (let i = 1; i < item.points.length; i++) {
      const a = item.points[i - 1], b = item.points[i]
      const pressure = ((a.p ?? 0.7) + (b.p ?? 0.7)) / 2
      const width = item.size * (0.45 + pressure * 0.75)
      segments.push(<Line key={`${item.id}-${i}`} points={[a.x, a.y, b.x, b.y]} stroke={item.color} strokeWidth={width} lineCap="round" lineJoin="round" globalCompositeOperation={item.erase ? 'destination-out' : (item.composite ?? 'source-over')} listening={false} />)
    }
    return (
      <Group
        key={item.id}
        ref={(n) => registerNode(item.id, n)}
        x={item.x} y={item.y} {...transformProps(item)}
        draggable={draggable}
        listening={tool === 'select' && layerEditable(layerId)}
        onPointerDown={(e) => { e.cancelBubble = true; selectItem(item.id, layerId, !!(e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey)) }}
        onDragStart={() => { dragSnapshotRef.current = structuredClone(doc) }}
        onDragEnd={(e) => updateItemTransform(layerId, item.id, e.target as Konva.Node)}
      >
        {segments}
        {selected && <Circle x={0} y={0} radius={5 / zoom} fill="#7c5cff" listening={false} />}
      </Group>
    )
  }

  const renderItem = (item: Item, layerId: string) => {
    const selected = selectedIds.includes(item.id)
    const draggable = tool === 'select' && selected && layerEditable(layerId)
    const commonSelect = (e: any) => { e.cancelBubble = true; selectItem(item.id, layerId, !!(e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey)) }
    const onStart = () => { dragSnapshotRef.current = structuredClone(doc) }
    if (item.kind === 'stroke') return renderStroke(item, selected, layerId, draggable)
    if (item.kind === 'image') return <CanvasImage key={item.id} item={item} selected={selected} selectable={tool === 'select' && layerEditable(layerId)} draggable={draggable}
      nodeRef={(n) => registerNode(item.id, n)} onSelect={() => selectItem(item.id, layerId, false)} onDragStart={onStart}
      onDragEnd={(node) => updateItemTransform(layerId, item.id, node)} />
    if (item.kind === 'rect') return (
      <Rect key={item.id} ref={(n) => registerNode(item.id, n)} x={item.x} y={item.y} width={item.width} height={item.height} {...transformProps(item)} stroke={item.color} strokeWidth={item.size} fill={item.fill}
        draggable={draggable} listening={tool === 'select' && layerEditable(layerId)} onPointerDown={commonSelect} onDragStart={onStart} onDragEnd={(e) => updateItemTransform(layerId, item.id, e.target as Konva.Node)}
        shadowColor={selected ? '#7c5cff' : undefined} shadowBlur={selected ? 7 / zoom : 0} />
    )
    if (item.kind === 'ellipse') return (
      <Ellipse key={item.id} ref={(n) => registerNode(item.id, n)} x={item.x} y={item.y} radiusX={item.radiusX} radiusY={item.radiusY} {...transformProps(item)} stroke={item.color} strokeWidth={item.size} fill={item.fill}
        draggable={draggable} listening={tool === 'select' && layerEditable(layerId)} onPointerDown={commonSelect} onDragStart={onStart} onDragEnd={(e) => updateItemTransform(layerId, item.id, e.target as Konva.Node)}
        shadowColor={selected ? '#7c5cff' : undefined} shadowBlur={selected ? 7 / zoom : 0} />
    )
    if (item.kind === 'line') return (
      <Line key={item.id} ref={(n) => registerNode(item.id, n)} x={item.x} y={item.y} points={item.points} {...transformProps(item)} stroke={item.color} strokeWidth={item.size} lineCap="round"
        draggable={draggable} listening={tool === 'select' && layerEditable(layerId)} onPointerDown={commonSelect} onDragStart={onStart} onDragEnd={(e) => updateItemTransform(layerId, item.id, e.target as Konva.Node)}
        shadowColor={selected ? '#7c5cff' : undefined} shadowBlur={selected ? 7 / zoom : 0} />
    )
    const path = item as PathItem
    return (
      <Group key={item.id}>
        <Path
          ref={(n) => registerNode(item.id, n)}
          x={path.x} y={path.y} {...transformProps(path)} data={curveData(path.nodes, path.closed)} stroke={path.color} strokeWidth={path.size} fill={path.fill}
          lineCap="round" lineJoin="round" draggable={draggable} listening={tool === 'select' && layerEditable(layerId)} onPointerDown={commonSelect}
          onDragStart={onStart} onDragEnd={(e) => updateItemTransform(layerId, item.id, e.target as Konva.Node)}
          shadowColor={selected ? '#7c5cff' : undefined} shadowBlur={selected ? 7 / zoom : 0}
        />
        {selected && tool === 'select' && layerEditable(layerId) && path.nodes.map((n, index) => {
          const anchor = { x: path.x + n.x, y: path.y + n.y }
          const inPt = n.in ? { x: anchor.x + n.in.x, y: anchor.y + n.in.y } : null
          const outPt = n.out ? { x: anchor.x + n.out.x, y: anchor.y + n.out.y } : null
          return <Group key={`${path.id}-node-${index}`}>
            {inPt && <Line points={[anchor.x, anchor.y, inPt.x, inPt.y]} stroke="#9aa0b4" strokeWidth={1 / zoom} listening={false} />}
            {outPt && <Line points={[anchor.x, anchor.y, outPt.x, outPt.y]} stroke="#9aa0b4" strokeWidth={1 / zoom} listening={false} />}
            {inPt && <Circle x={inPt.x} y={inPt.y} radius={5 / zoom} fill="#191b22" stroke="#b9aaff" strokeWidth={1.5 / zoom} draggable
              onDragStart={() => { dragSnapshotRef.current = structuredClone(doc) }}
              onDragMove={(e) => changePathHandle(layerId, path.id, index, 'in', { x: e.target.x(), y: e.target.y() }, true)}
              onDragEnd={(e) => changePathHandle(layerId, path.id, index, 'in', { x: e.target.x(), y: e.target.y() }, false)} />}
            {outPt && <Circle x={outPt.x} y={outPt.y} radius={5 / zoom} fill="#191b22" stroke="#b9aaff" strokeWidth={1.5 / zoom} draggable
              onDragStart={() => { dragSnapshotRef.current = structuredClone(doc) }}
              onDragMove={(e) => changePathHandle(layerId, path.id, index, 'out', { x: e.target.x(), y: e.target.y() }, true)}
              onDragEnd={(e) => changePathHandle(layerId, path.id, index, 'out', { x: e.target.x(), y: e.target.y() }, false)} />}
            <Circle x={anchor.x} y={anchor.y} radius={7 / zoom} fill="#fff" stroke="#7c5cff" strokeWidth={2 / zoom} draggable
              onDragStart={() => { dragSnapshotRef.current = structuredClone(doc) }}
              onDragMove={(e) => changePathNode(layerId, path.id, index, { x: e.target.x() - path.x, y: e.target.y() - path.y }, true)}
              onDragEnd={(e) => changePathNode(layerId, path.id, index, { x: e.target.x() - path.x, y: e.target.y() - path.y }, false)} />
          </Group>
        })}
      </Group>
    )
  }

  const draft = useMemo(() => {
    if (draftStroke) return renderStroke(draftStroke, false, doc.activeLayerId, false)
    if (!draftShape) return null
    if (draftShape.kind === 'rect') return <Rect {...draftShape} stroke={draftShape.color} strokeWidth={draftShape.size} dash={[8, 5]} listening={false} />
    if (draftShape.kind === 'ellipse') return <Ellipse x={draftShape.x} y={draftShape.y} radiusX={draftShape.radiusX} radiusY={draftShape.radiusY} stroke={draftShape.color} strokeWidth={draftShape.size} dash={[8, 5]} listening={false} />
    if (draftShape.kind === 'line') return <Line points={draftShape.points} stroke={draftShape.color} strokeWidth={draftShape.size} lineCap="round" listening={false} />
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStroke, draftShape, zoom])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">V</div><div><strong>Vitral Studio</strong><span>v0.4 · vidrio + degradados</span></div></div>
        <div className="top-actions">
          <button onClick={newProject} title="Proyecto nuevo"><Plus size={18} /><span>Nuevo</span></button>
          <button onClick={() => projectRef.current?.click()} title="Abrir proyecto"><FolderOpen size={18} /><span>Abrir</span></button>
          <button onClick={saveNow} title="Guardar localmente"><Save size={18} /><span>{saveState === 'saving' ? 'Guardando…' : saveState === 'error' ? 'Error' : 'Guardado'}</span></button>
          <button onClick={downloadProject} title="Descargar proyecto editable"><Download size={18} /><span>.vitral</span></button>
          <div className="divider" />
          <button onClick={undo} title="Deshacer"><Undo2 size={18} /></button>
          <button onClick={redo} title="Rehacer"><Redo2 size={18} /></button>
          <button onClick={() => fileRef.current?.click()} title="Importar imagen"><FileImage size={18} /><span>Imagen</span></button>
          <button onClick={exportPng} className="primary"><Download size={18} /><span>PNG</span></button>
          <button className="mobile-layers" onClick={() => setLayersOpen((v) => !v)}><Layers3 size={18} /></button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importImage(f); e.currentTarget.value = '' }} />
          <input ref={projectRef} type="file" accept=".vitral,.json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openProject(f); e.currentTarget.value = '' }} />
        </div>
      </header>

      <aside className="toolbar">
        {tools.map(({ id: toolId, label, icon: Icon }) => (
          <button key={toolId} className={tool === toolId ? 'active' : ''} onClick={() => { if (tool === 'pen' && toolId !== 'pen') finishPen(); setTool(toolId) }} title={label}>
            <Icon size={21} /><span>{label}</span>
          </button>
        ))}
      </aside>

      <main className="workspace">
        <div className="propertybar">
          <HexSwatch value={color} onChange={setColor} />
          <div className="palette-strip">
            {palette.map((swatch) => (
              <button
                key={swatch}
                className={`swatch ${color.toLowerCase() === swatch.toLowerCase() ? 'active' : ''}`}
                style={{ background: swatch }}
                title={swatch}
                onClick={() => setColor(swatch)}
                onContextMenu={(e) => { e.preventDefault(); removePaletteColor(swatch) }}
              />
            ))}
            <button className="mini-action" onClick={addCurrentColorToPalette} title="Guardar color actual">+</button>
          </div>
          {tool === 'fill' || selectedFill ? <>
            <label className="fill-mode-control">Estilo
              <select value={fillMode} onChange={(e) => setFillMode(e.target.value as FillMode)}>
                <option value="solid">Sólido</option>
                <option value="gradient">Degradado</option>
                <option value="glass">Vidrio</option>
              </select>
            </label>
            {fillMode !== 'solid' && <><span className="color-b-label">B</span><HexSwatch value={color2} onChange={setColor2} /></>}
            {fillMode !== 'solid' && <label>Ángulo <input type="range" min="0" max="360" value={gradientAngle} onChange={(e) => setGradientAngle(Number(e.target.value))} /><b>{gradientAngle}°</b></label>}
            {fillMode === 'glass' && <label>Vidrio <input type="range" min="0" max="100" value={glassTexture} onChange={(e) => setGlassTexture(Number(e.target.value))} /><b>{glassTexture}%</b></label>}
            {selectedFill && <button className="apply-fill-style" onClick={applyStyleToSelectedFill}>Aplicar a región</button>}
          </> : null}
          <label>Grosor <input type="range" min="1" max="100" value={size} onChange={(e) => setSize(Number(e.target.value))} /><b>{size}px</b></label>
          {tool === 'fill' && <label>Cerrar huecos <input type="range" min="0" max="10" value={closeGap} onChange={(e) => setCloseGap(Number(e.target.value))} /><b>{closeGap}px</b></label>}
          <button className={fingerDraw ? 'toggle on' : 'toggle'} onClick={() => setFingerDraw((v) => !v)}>Dedo dibuja <span>{fingerDraw ? 'ON' : 'OFF'}</span></button>
          {activeLayer && activeLayer.role === 'paint' && <button className={activeLayer.alphaLock ? 'toggle on' : 'toggle'} onClick={() => updateLayer(activeLayer.id, { alphaLock: !activeLayer.alphaLock })}>Alpha Lock <span>{activeLayer.alphaLock ? 'ON' : 'OFF'}</span></button>}
          {tool === 'pen' && penDraft && <button className="finish-pen" onClick={finishPen}>Terminar vector</button>}
          {selectedPath && <>
            <button onClick={togglePathClosed}>{selectedPath.item.closed ? 'Abrir trazado' : 'Cerrar trazado'}</button>
            <button onClick={togglePathFill}>{selectedPath.item.fill ? 'Quitar relleno' : 'Rellenar vector'}</button>
          </>}
          <button onClick={fitCanvas} title="Ajustar lienzo"><Maximize2 size={16} /> Ajustar</button>
          <span className="doc-readout">{doc.width}×{doc.height}</span>
          <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
        </div>

        <div className="canvas-viewport" ref={viewportRef}>
          <Stage
            ref={stageRef}
            width={viewport.width}
            height={viewport.height}
            x={stagePos.x}
            y={stagePos.y}
            scaleX={zoom}
            scaleY={zoom}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onWheel={wheelZoom}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onDblClick={() => tool === 'pen' && finishPen()}
            className="konva-stage"
          >
            <Layer name="background" listening={false}><Rect x={0} y={0} width={doc.width} height={doc.height} fill="#ffffff" shadowColor="#000" shadowBlur={30} shadowOpacity={0.22} /></Layer>
            {doc.layers.map((layer) => (
              <Layer key={layer.id} name={`art-layer-${layer.id}`} visible={layer.visible} opacity={layer.opacity} listening={!layer.locked}>
                {layer.items.map((item) => renderItem(item, layer.id))}
              </Layer>
            ))}
            <Layer name="overlay">
              {draft}
              {penDraft && <>
                <Path data={curveData(penDraft.nodes, penDraft.closed)} stroke={penDraft.color} strokeWidth={penDraft.size} fill={penDraft.fill} lineCap="round" lineJoin="round" listening={false} />
                {penDraft.nodes.map((n, i) => <Circle key={i} x={n.x} y={n.y} radius={5 / zoom} fill="#fff" stroke="#7c5cff" strokeWidth={2 / zoom} listening={false} />)}
              </>}
              {lasso.length > 1 && <Line points={lasso.flatMap((p) => [p.x, p.y])} stroke="#7c5cff" strokeWidth={2 / zoom} dash={[8 / zoom, 6 / zoom]} closed listening={false} />}
              {tool === 'select' && <Transformer
                ref={transformerRef}
                rotateEnabled
                flipEnabled
                keepRatio={false}
                anchorSize={9 / zoom}
                anchorStrokeWidth={1.5 / zoom}
                borderStroke="#7c5cff"
                anchorStroke="#7c5cff"
                anchorFill="#ffffff"
                onTransformStart={() => { dragSnapshotRef.current = structuredClone(doc) }}
                onTransformEnd={updateSelectedTransforms}
              />}
            </Layer>
          </Stage>
        </div>
      </main>

      <aside className={`layers-panel ${layersOpen ? 'open' : ''}`}>
        <div className="panel-title"><span><Layers3 size={18} /> Capas</span><button onClick={addLayer} title="Nueva capa"><Plus size={18} /></button></div>
        <div className="layer-list">
          {[...doc.layers].reverse().map((layer) => {
            const actualIndex = doc.layers.findIndex((l) => l.id === layer.id)
            return (
              <div key={layer.id} className={`layer-row ${doc.activeLayerId === layer.id ? 'active' : ''}`} onClick={() => { setDoc((current) => ({ ...current, activeLayerId: layer.id })); setSelectedIds([]) }}>
                <button className="visibility" onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }) }}>{layer.visible ? <Eye size={17} /> : <EyeOff size={17} />}</button>
                <div className={`layer-thumb role-${layer.role}`}>{layer.items.length ? layer.items.length : '·'}</div>
                <div className="layer-meta">
                  <input value={layer.name} onClick={(e) => e.stopPropagation()} onChange={(e) => setDoc((current) => ({ ...current, layers: current.layers.map((l) => l.id === layer.id ? { ...l, name: e.target.value } : l) }))} />
                  <select value={layer.role} onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); updateLayer(layer.id, { role: e.target.value as LayerRole }) }}>
                    <option value="normal">Normal</option><option value="lineart">Lineart</option><option value="paint">Color</option>
                  </select>
                </div>
                <div className="layer-actions">
                  <button title="Subir" disabled={actualIndex === doc.layers.length - 1} onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 1) }}><ChevronUp size={14} /></button>
                  <button title="Bajar" disabled={actualIndex === 0} onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, -1) }}><ChevronDown size={14} /></button>
                  <button title="Duplicar" onClick={(e) => { e.stopPropagation(); duplicateLayer(layer.id) }}><Copy size={14} /></button>
                </div>
                <button className={layer.locked ? 'lock on' : 'lock'} onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { locked: !layer.locked }); setSelectedIds([]) }}>{layer.locked ? '🔒' : '🔓'}</button>
                <button className="remove" onClick={(e) => { e.stopPropagation(); removeLayer(layer.id) }}><Trash2 size={15} /></button>
              </div>
            )
          })}
        </div>
        <div className="layer-controls">
          <label>Opacidad <input type="range" min="0" max="100" value={Math.round((activeLayer?.opacity ?? 1) * 100)} onChange={(e) => activeLayer && setDoc((current) => ({ ...current, layers: current.layers.map((l) => l.id === activeLayer.id ? { ...l, opacity: Number(e.target.value) / 100 } : l) }))} /></label>
          {activeLayer && activeLayer.role === 'paint' && <label className="alpha-row">Alpha Lock <input type="checkbox" checked={!!activeLayer.alphaLock} onChange={(e) => updateLayer(activeLayer.id, { alphaLock: e.target.checked })} /></label>}
        </div>
        <div className="tip-card">
          <strong>Flujo vitral v0.4</strong>
          <p>En <b>Relleno</b> puedes elegir Sólido, Degradado o Vidrio. El modo Vidrio mezcla dos colores y añade variación luminosa. Selecciona un relleno existente para cambiar su estilo después. <b>Alpha Lock</b> sigue disponible para sombrear sin salirte.</p>
        </div>
      </aside>

      {selectedIds.length > 0 && <div className="selection-float"><b>{selectedIds.length}</b> seleccionado{selectedIds.length > 1 ? 's' : ''}<span>· arrastra handles para escalar/rotar</span><button onClick={deleteSelected}><Trash2 size={16} /> Borrar</button></div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
