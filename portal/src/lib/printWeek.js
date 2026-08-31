// Week maths for the print picker.
//
// This file used to build a printable sheet: seven day buckets, publishable
// filters, time labels, the lot. That sheet is gone -- both boards now print
// THEMSELVES via ?print=1, so there is no second rendering to feed. What is
// left is the two things the week picker still needs: which Monday a date
// belongs to, and how to say that week out loud.

// Monday of the week containing `d`, local time.
//
// getDay() is 0=Sun..6=Sat, so Sunday has to walk back six days rather than
// forward one. Getting this wrong puts Sunday's classes on a sheet a week
// early, which is exactly the sort of thing nobody notices until it is on a
// wall.
export function startOfPrintWeek(d) {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  const dow = out.getDay()
  out.setDate(out.getDate() - (dow === 0 ? 6 : dow - 1))
  return out
}

// Label for the week PICKER, not for the sheet. The picker is the one place
// dates belong: choosing "next week" is meaningless without them.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function printWeekLabel(monday) {
  const end = new Date(monday)
  end.setDate(end.getDate() + 6)
  const a = `${MONTHS[monday.getMonth()]} ${monday.getDate()}`
  const b = monday.getMonth() === end.getMonth()
    ? `${end.getDate()}`
    : `${MONTHS[end.getMonth()]} ${end.getDate()}`
  return `${a} - ${b}, ${end.getFullYear()}`
}
