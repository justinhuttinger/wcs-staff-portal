// Keeps a printed memo on one side of one 8.5x11 sheet, however long it is. The
// memo is laid out wider than the page and scaled back down, so text wraps for
// the smaller size instead of getting clipped.

// Letter minus the 0.4in margins in the @page rule below, at 96px per inch, less
// a little room because browsers round when paginating.
export const PRINT_WIDTH = 739
export const PRINT_HEIGHT = 950
const MIN_SCALE = 0.25
const STEP = 0.01

// The largest scale at which the memo fits. heightAt(width) is the memo's height
// when laid out at that width. Never scales above 1: short memos stay full size.
export function printScale(heightAt, { width = PRINT_WIDTH, height = PRINT_HEIGHT } = {}) {
  for (let scale = 1; scale > MIN_SCALE; scale -= STEP) {
    if (heightAt(width / scale) * scale <= height) return scale
  }
  return MIN_SCALE
}

// Measures a hidden copy so the screen doesn't jump, then sets what the print CSS
// reads. Runs for the Print button and for Ctrl+P, through beforeprint.
export function fitMemoForPrint() {
  const memo = document.querySelector('.memo-print')
  if (!memo) return
  const copy = memo.cloneNode(true)
  copy.classList.add('memo-print-measure')
  copy.style.cssText = 'position:fixed;left:-99999px;top:0;padding:0;visibility:hidden;'
  document.body.appendChild(copy)
  const scale = printScale((width) => {
    copy.style.width = `${width}px`
    return copy.scrollHeight
  })
  copy.remove()
  memo.style.setProperty('--memo-print-scale', scale)
  memo.style.setProperty('--memo-print-width', `${PRINT_WIDTH / scale}px`)
}

export const MEMO_CSS = `
  .memo-display { font-family: 'WCSDisplay', Impact, sans-serif; font-weight: 400; }
  @media print {
    html, body { height: 10.2in !important; min-height: 0 !important; overflow: hidden !important; }
    body * { visibility: hidden; }
    .memo-print, .memo-print * { visibility: visible; }
    .memo-print {
      position: fixed; left: 0; top: 0; margin: 0; padding: 0; border-radius: 0;
      width: var(--memo-print-width, 100%);
      transform: scale(var(--memo-print-scale, 1));
      transform-origin: top left;
    }
    .memo-print-measure { display: none !important; }
    .no-print { display: none !important; }
    @page { margin: 0.4in; size: letter portrait; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`
