import { PRINT_DAY_LABELS } from '../../lib/printWeek'
import { printColorFor } from '../../lib/classColors'
import { displayClassName, durationLabel } from '../../lib/weekGrid'

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

export default function PrintScheduleSheet({
  week, title, clubName, orientation, logoSrc, colored = false,
}) {
  const isPortrait = orientation === 'portrait'
  const Line = colored ? EventBlock : EventLine

  return (
    <div className={`schedule-print-sheet ps--${isPortrait ? 'portrait' : 'landscape'}${colored ? ' ps--colored' : ''}`}>
      <header className="ps-head">
        {logoSrc && <img className="ps-head__logo" src={logoSrc} alt="West Coast Strength" />}
        <div className="ps-head__titles">
          <div className="ps-head__club">{clubName}</div>
          <h1 className="ps-head__title">{title}</h1>
        </div>
      </header>

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
    </div>
  )
}
