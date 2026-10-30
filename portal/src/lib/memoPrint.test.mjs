import test from 'node:test'
import assert from 'node:assert'
import { printScale, PRINT_WIDTH, PRINT_HEIGHT } from './memoPrint.js'

// Text area is fixed, so a wider layout is proportionally shorter.
const memoOfArea = (area) => (width) => area / width

test('a short memo stays full size', () => {
  assert.strictEqual(printScale(() => 400), 1)
})

test('a long memo scales down until it fits the page', () => {
  const heightAt = memoOfArea(PRINT_WIDTH * PRINT_HEIGHT * 2)
  const scale = printScale(heightAt)
  assert.ok(scale < 1)
  assert.ok(heightAt(PRINT_WIDTH / scale) * scale <= PRINT_HEIGHT)
})

test('it uses the largest scale that fits, not just any', () => {
  const heightAt = memoOfArea(PRINT_WIDTH * PRINT_HEIGHT * 2)
  const scale = printScale(heightAt)
  const bigger = scale + 0.02
  assert.ok(heightAt(PRINT_WIDTH / bigger) * bigger > PRINT_HEIGHT)
})

test('an absurdly long memo stops at the floor rather than looping forever', () => {
  assert.strictEqual(printScale(() => 1e9), 0.25)
})
