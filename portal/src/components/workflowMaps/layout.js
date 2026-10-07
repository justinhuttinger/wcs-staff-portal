// "Tidy up": top-to-bottom layered layout via dagre. Notes are stacked in a
// column to the right of the laid-out steps so they never land on top of one.
import { graphlib, layout } from '@dagrejs/dagre'
import { NODE_WIDTH } from './StepNode'

const height = (n) => n.measured?.height || 110
const width = (n) => n.measured?.width || NODE_WIDTH

export function tidyLayout(nodes, edges) {
  const steps = nodes.filter(n => n.type !== 'note')
  const notes = nodes.filter(n => n.type === 'note')
  const byId = new Map(steps.map(n => [n.id, n]))

  // Outgoing edges in the order their handles are drawn (condition branches
  // left to right), so dagre keeps Yes on the left of No.
  const branchIndex = (e) => (byId.get(e.source)?.data?.branches || []).findIndex(b => b.id === e.sourceHandle)
  const out = new Map()
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue
    if (!out.has(e.source)) out.set(e.source, [])
    out.get(e.source).push(e)
  }
  for (const list of out.values()) list.sort((a, b) => branchIndex(a) - branchIndex(b))

  // dagre seeds its ordering from insertion order: add nodes depth-first from
  // the triggers (then any leftovers) following branch order.
  const order = []
  const seen = new Set()
  const visit = (id) => {
    if (seen.has(id)) return
    seen.add(id)
    order.push(id)
    for (const e of out.get(id) || []) visit(e.target)
  }
  steps.filter(n => n.type === 'trigger').forEach(n => visit(n.id))
  steps.forEach(n => visit(n.id))

  const g = new graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 60, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of order) g.setNode(id, { width: width(byId.get(id)), height: height(byId.get(id)) })
  // dagre's initial ordering walks successors last-added first, so add each
  // node's outgoing edges in reverse to come out left to right.
  for (const id of order) for (const e of [...(out.get(id) || [])].reverse()) g.setEdge(e.source, e.target)
  layout(g)

  const placed = new Map()
  let maxX = 0
  for (const id of order) {
    const p = g.node(id)
    const pos = { x: Math.round(p.x - p.width / 2), y: Math.round(p.y - p.height / 2) }
    placed.set(id, pos)
    maxX = Math.max(maxX, pos.x + p.width)
  }
  let noteY = 20
  for (const n of [...notes].sort((a, b) => a.position.y - b.position.y)) {
    placed.set(n.id, { x: maxX + 80, y: noteY })
    noteY += height(n) + 30
  }
  return nodes.map(n => ({ ...n, position: placed.get(n.id) || n.position }))
}
