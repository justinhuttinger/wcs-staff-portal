import { PRINT_DAY_LABELS, printWeekWindow } from '../../lib/printWeek'
import { printColorFor } from '../../lib/classColors'
import { displayClassName, durationLabel, fmtHour, layoutLanes } from '../../lib/weekGrid'

// The printed sheet itself. Rendered off-screen and only made visible by the
// print stylesheet, the same trick PTSessionsReport uses.
//
// Two layouts, because "landscape and portrait" is a request for two usable
// sheets rather than one sheet rotated:
//
//   landscape  seven columns across, the classic wall grid. A wide page has
//              room for seven readable columns; a tall one does not.
//   portrait   seven rows, day name in a left rail, that day's classes
//              flowing across the width. Seven columns on 8.5in leaves about
//              1.1in each, which breaks "Barbell Strength" across three lines.
//
// No dates anywhere on either. See lib/printWeek.js for why.
//
// Deliberately plain CSS values rather than the portal's Tailwind tokens: this
// renders onto white paper, not onto the portal's dark backdrop, so the theme
// colours would be actively wrong here.

// The length of a slot is carried by its time_label ("6:00 - 7:00 AM" for a
// facility), never as a separate "60 min" line. Printing both says the same
// thing twice and makes the reader do the arithmetic to check they agree.
function EventLine({ ev }) {
  return (
    <div className="ps-ev">
      <span className="ps-ev__time">{ev.time_label}</span>
      <span className="ps-ev__name">{ev.class_name}</span>
      {ev.instructor_name && <span className="ps-ev__who">{ev.instructor_name}</span>}
    </div>
  )
}

// Group X prints as coloured blocks instead, so the sheet on the wall reads
// like the calendar on the screen: same palette, same hash, same trimmed name
// and length pill. A class is findable by its colour in both places, which is
// the whole point of having a stable palette at all.
//
// The time stays. Unlike the on-screen grid, where a block's POSITION says when
// it runs, this is a list -- drop the time and the sheet is unusable.
function EventBlock({ ev }) {
  const label = displayClassName(ev.class_name, ev.duration_minutes)
  const len = durationLabel(ev.duration_minutes)
  const color = printColorFor(label)
  return (
    <div className="ps-ev ps-ev--block" style={{ background: color.bg, borderColor: color.border }}>
      <span className="ps-ev__time">{ev.time_label}</span>
      <span className="ps-ev__name">
        {label}
        {len && <span className="ps-ev__len">{len}</span>}
      </span>
      {ev.instructor_name && <span className="ps-ev__who">{ev.instructor_name}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Time-positioned landscape sheet.
//
// The list version stacked every class flush against the one above it, so a
// 6am class and a 10am class printed as neighbours and the day read as
// continuous. On a wall sheet the shape of the day IS the information: a
// morning block, a gap, an evening block. So the sheet places classes by time,
// exactly as the calendar does.
//
// Sized in inches against the printable area rather than in pixels, because
// this lands on paper and every other measurement in this sheet is already an
// inch.
//
// The budget, which has to hold or the sheet runs onto a second page:
//   landscape page 8.5in - .8in margins = 7.7in
//   - .85in header and its margin
//   - .24in day-name row
//   = 6.61in, of which 6.4 is used and .21in stays as slack.
// The .24in day-name row is stated in PrintScheduleStyles rather than
// inherited, because the hour rail's spacer has to match it exactly -- a
// difference of a hundredth of an inch there offsets every hour label on the
// page. Change one and change the other.
// ---------------------------------------------------------------------------
const GRID_HEIGHT_IN = 6.4

// A block shorter than this cannot fit three lines of 8.5pt text, so the
// instructor is dropped rather than clipped mid-word.
const TIGHT_HEIGHT_IN = 0.34
// Nothing is allowed to print thinner than this, whatever its duration -- a
// 15-minute class at a 15-hour scale is a 0.11in sliver with no readable text.
const MIN_HEIGHT_IN = 0.26

function GridBlock({ ev, window: win, inPerMin }) {
  const label = displayClassName(ev.class_name, ev.duration_minutes)
  const len = durationLabel(ev.duration_minutes)
  const color = printColorFor(label)
  const top = (ev._startMin - win.startMin) * inPerMin
  const height = Math.max(MIN_HEIGHT_IN, (ev._endMin - ev._startMin) * inPerMin)
  // Overlapping classes sit side by side, the same lane treatment the screen
  // grid uses -- two 9am classes must not print on top of each other.
  const lanes = ev._laneCount || 1
  const widthPct = 100 / lanes

  return (
    <div
      className={`ps-block${height < TIGHT_HEIGHT_IN ? ' ps-block--tight' : ''}`}
      style={{
        background: color.bg,
        borderColor: color.border,
        top: `${top}in`,
        height: `${height}in`,
        left: `calc(${(ev._laneIndex || 0) * widthPct}% + 1px)`,
        width: `calc(${widthPct}% - 2px)`,
      }}
    >
      <span className="ps-ev__time">{ev.time_label}</span>
      <span className="ps-ev__name">
        {label}
        {len && <span className="ps-ev__len">{len}</span>}
      </span>
      {ev.instructor_name && <span className="ps-ev__who">{ev.instructor_name}</span>}
    </div>
  )
}

function TimeGridWeek({ week, window: win }) {
  const span = win.endMin - win.startMin
  const inPerMin = GRID_HEIGHT_IN / span
  // Whole hours inside the window, for the rail and the gridlines.
  const hours = []
  for (let m = win.startMin; m <= win.endMin; m += 60) hours.push(m)

  return (
    <div className="ps-week ps-week--grid">
      <div className="ps-rail">
        <div className="ps-rail__spacer" />
        <div className="ps-rail__body" style={{ height: `${GRID_HEIGHT_IN}in` }}>
          {hours.map(m => (
            <span key={m} className="ps-rail__hour" style={{ top: `${(m - win.startMin) * inPerMin}in` }}>
              {fmtHour(Math.floor(m / 60))}
            </span>
          ))}
        </div>
      </div>

      {week.map((day, i) => {
        // Lane assignment mutates, so it runs on the day's own events here
        // rather than in buildPrintWeek, which the plain list also uses.
        const events = layoutLanes(day.events)
        return (
          <section className="ps-day" key={day.date}>
            <h2 className="ps-day__name">{PRINT_DAY_LABELS[i]}</h2>
            <div className="ps-day__body" style={{ height: `${GRID_HEIGHT_IN}in` }}>
              {hours.map(m => (
                <div key={m} className="ps-hourline" style={{ top: `${(m - win.startMin) * inPerMin}in` }} />
              ))}
              {events.map(ev => (
                <GridBlock key={ev.event_id} ev={ev} window={win} inPerMin={inPerMin} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export default function PrintScheduleSheet({
  week, title, clubName, orientation, logoSrc, colored = false,
}) {
  const isPortrait = orientation === 'portrait'
  const Line = colored ? EventBlock : EventLine
  // Landscape only. Portrait is a row per day flowing across the width -- there
  // is no vertical axis there to position a class against, which is the whole
  // reason that layout exists for narrow paper.
  const win = colored && !isPortrait ? printWeekWindow(week) : null

  return (
    <div className={`schedule-print-sheet ps--${isPortrait ? 'portrait' : 'landscape'}${colored ? ' ps--colored' : ''}`}>
      <header className="ps-head">
        {logoSrc && <img className="ps-head__logo" src={logoSrc} alt="West Coast Strength" />}
        <div className="ps-head__titles">
          <div className="ps-head__club">{clubName}</div>
          <h1 className="ps-head__title">{title}</h1>
        </div>
      </header>

      {win ? <TimeGridWeek week={week} window={win} /> : (
      <div className="ps-week">
        {week.map((day, i) => (
          <section className="ps-day" key={day.date}>
            <h2 className="ps-day__name">{PRINT_DAY_LABELS[i]}</h2>
            <div className="ps-day__body">
              {day.events.length === 0
                // An empty column headed "Sunday" says "nothing on Sunday". A
                // missing one says "we forgot Sunday".
                ? <div className="ps-empty">&mdash;</div>
                : day.events.map(ev => <Line key={ev.event_id} ev={ev} />)}
            </div>
          </section>
        ))}
      </div>
      )}
    </div>
  )
}
