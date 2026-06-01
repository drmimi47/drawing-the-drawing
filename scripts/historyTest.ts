/**
 * Verify undo/redo across graph + lock actions. Run: npx tsx scripts/historyTest.ts
 */
import { useDrawingStore } from '../src/store/drawingStore'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`PASS  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const s = () => useDrawingStore.getState()
const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

// Lock add → undo → redo
s().addLock({ points: square, featherRadius: 40 })
check('lock added', s().lockPolygons.length === 1)
s().undo()
check('undo removes lock', s().lockPolygons.length === 0)
s().redo()
check('redo restores lock', s().lockPolygons.length === 1)

// Lock remove → undo restores it
const id = s().lockPolygons[0].id
s().removeLock(id)
check('lock removed', s().lockPolygons.length === 0)
s().undo()
check('undo restores removed lock', s().lockPolygons.length === 1)

// Stroke commit → undo/redo, locks preserved
s().commitStroke([{ x: 0, y: 0, w: 1 }, { x: 50, y: 0, w: 1 }], '#000')
check('stroke committed', s().graph.strokes.length === 1)
s().undo()
check('undo removes stroke', s().graph.strokes.length === 0)
check('locks preserved through stroke undo', s().lockPolygons.length === 1)
s().redo()
check('redo restores stroke', s().graph.strokes.length === 1)

// revertHistory pops without creating a redo entry
s().beginHistory()
s().addLock({ points: square, featherRadius: 40 }) // (this pushes its own history)
const futureBefore = s().future.length
s().revertHistory()
check('revertHistory creates no redo entry', s().future.length === futureBefore)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
