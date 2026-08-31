// Print stylesheet for the schedule sheet.
//
// Same approach as PTSessionsReport's PrintStyles: hide the whole app, reveal
// only the sheet. The portal renders over a dark backdrop, so anything that
// leaks into the print job comes out as a black page.
//
// @page size is injected rather than fixed, because the orientation is the
// user's choice. It has to be in the document BEFORE window.print() is called
// -- a @page rule added while the dialog is open is ignored.
export default function PrintScheduleStyles({ orientation }) {
  const isPortrait = orientation === 'portrait'
  const page = isPortrait ? 'portrait' : 'landscape'
  const margin = isPortrait ? '0.5in' : '0.4in'

  return (
    <style>{`
      /* Hidden until the print job runs. The sheet is rendered twice: once
         portalled to <body> for the printer, and once inside the preview pane
         for the screen. The preview wrapper re-shows its copy; this hides the
         portalled one until printing. */
      .schedule-print-sheet { display: none; }

      @media print {
        @page { size: ${page}; margin: ${margin}; }

        body * { visibility: hidden; }
        .schedule-print-sheet, .schedule-print-sheet * { visibility: visible; }
        .schedule-print-sheet {
          display: block;
          position: absolute; left: 0; top: 0;
          width: 100%;
          background: #fff; color: #000;
        }
        /* The preview copy must go entirely, not just turn invisible: it is
           inside a scaled, scrolling modal, and an invisible-but-laid-out copy
           still reserves its (transformed) box and pushes out blank pages.
           display:none beats the .schedule-print-sheet rule above by
           specificity plus !important, so the portalled copy is unaffected. */
        .ps-preview, .ps-preview * { display: none !important; }
        .no-print { display: none !important; }
      }

      /* ---- Shared ---------------------------------------------------- */
      /* Stated rather than inherited from Tailwind's preflight. Every height
         below is in inches against a known paper size, and content-box would
         add the padding on top of each one -- seven rows came out .15in
         taller apiece that way, which is the difference between one page and
         two. The sheet has to measure the same wherever it is rendered. */
      .schedule-print-sheet, .schedule-print-sheet *, .schedule-print-sheet *::before,
      .schedule-print-sheet *::after { box-sizing: border-box; }

      .schedule-print-sheet {
        font-family: Arial, Helvetica, sans-serif;
        color: #000; background: #fff;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      .ps-head {
        display: flex; align-items: center; gap: .18in;
        border-bottom: 3px solid #e11d2e;
        padding-bottom: .07in; margin-bottom: .12in;
      }
      .ps-head__logo { height: .62in; width: auto; }
      .ps-head__club {
        font-size: 9pt; font-weight: 700; letter-spacing: .14em;
        text-transform: uppercase; color: #e11d2e;
      }
      .ps-head__title {
        font-size: 22pt; font-weight: 800; line-height: 1;
        text-transform: uppercase; margin: .02in 0 0;
      }
      .ps-day__name {
        font-size: 10.5pt; font-weight: 800; text-transform: uppercase;
        letter-spacing: .04em; margin: 0;
      }
      .ps-empty { color: #999; font-size: 9pt; }
      .ps-ev__time { font-weight: 700; font-variant-numeric: tabular-nums; }
      .ps-ev__name { font-weight: 600; }
      .ps-ev__who { color: #444; }

      /* ---- Landscape: seven columns ---------------------------------- */
      /* A wall grid. Columns are equal width and never break across pages --
         a class schedule split down the middle of Wednesday is unusable. */
      /* min-height fills the page rather than leaving the grid floating in the
         top third: a wall sheet with six inches of white under it reads as a
         misprint. It is a FLOOR, not a height -- a heavy week grows past it
         and paginates normally. 8.5in less .8in of margins less the measured
         .84in of header and its margin leaves 6.86in; 6.75in keeps slack. */
      .ps--landscape .ps-week {
        display: grid; grid-template-columns: repeat(7, 1fr); gap: .09in;
        min-height: 6.75in;
      }
      .ps--landscape .ps-day {
        border: 1px solid #d4d4d4; border-radius: 5px; overflow: hidden;
        break-inside: avoid; page-break-inside: avoid;
        display: flex; flex-direction: column;
      }
      .ps--landscape .ps-day__name {
        background: #f1f1ef; border-bottom: 1px solid #d4d4d4;
        padding: .05in .06in; font-size: 9.5pt;
      }
      /* flex:1 makes the column rule run the full height of the box rather
         than stopping under the last class. */
      .ps--landscape .ps-day__body { flex: 1 1 auto; padding: .05in .06in; }
      .ps--landscape .ps-ev {
        display: block; font-size: 8.5pt; line-height: 1.22;
        padding: .035in 0; border-top: 1px solid #ececec;
      }
      .ps--landscape .ps-ev:first-child { border-top: 0; }
      .ps--landscape .ps-ev > span { display: block; }
      .ps--landscape .ps-ev__time { font-size: 8.5pt; }
      .ps--landscape .ps-ev__who { font-size: 7.8pt; }


      /* ---- Portrait: seven rows -------------------------------------- */
      /* Seven columns on 8.5in leaves ~1.1in each, which wraps "Barbell
         Strength" onto three lines. A tall page has rows to spare instead, so
         the day becomes a labelled rail and its classes flow across. */
      .ps--portrait .ps-week { display: block; }
      /* Same floor, shared across seven rows: 11in less 1in of margins less
         .84in of header and margin is ~9.16in, so 1.28in a row fills the page
         and still lands on one. Measured rather than estimated -- the first
         attempt tipped a light week onto a second, near-empty page. Both
         orientations verified at one page by counting /Type /Page in the
         printed PDF. */
      .ps--portrait .ps-day {
        display: flex; align-items: flex-start; gap: .12in;
        border-top: 1px solid #d4d4d4;
        padding: .07in 0;
        min-height: 1.28in;
        break-inside: avoid; page-break-inside: avoid;
      }
      .ps--portrait .ps-day:first-child { border-top: 0; }
      .ps--portrait .ps-day__name {
        flex: 0 0 1.02in; font-size: 10pt; padding-top: .01in;
      }
      .ps--portrait .ps-day__body {
        flex: 1 1 auto;
        display: flex; flex-wrap: wrap; gap: .05in .1in;
      }
      .ps--portrait .ps-ev {
        flex: 0 0 auto; min-width: 1.28in; max-width: 2.1in;
        font-size: 8.5pt; line-height: 1.25;
        border-left: 2.5px solid #e11d2e; padding: 0 .06in .02in .07in;
      }
      .ps--portrait .ps-ev > span { display: block; }
      .ps--portrait .ps-ev__who { font-size: 7.8pt; }
      .ps--portrait .ps-empty { padding-top: .01in; }

      /* ---- On-screen preview ----------------------------------------- */
      /* The preview reuses the sheet markup so what is on screen is what
         comes out of the printer. It is shown by overriding the display:none
         above, scoped to the preview wrapper only. */
      .ps-preview .schedule-print-sheet {
        display: block;
        background: #fff;
        padding: ${isPortrait ? '0.5in' : '0.4in'};
        width: ${isPortrait ? '8.5in' : '11in'};
        min-height: ${isPortrait ? '11in' : '8.5in'};
      }
    `}</style>
  )
}
