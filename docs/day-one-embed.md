# Embedding the Day One booking widget

The widget detects that it is inside an iframe and switches to a **compact
layout**: no marketing panel, one week of dates instead of a month grid, and
times as a wrapping grid instead of a tall list. It also posts its height to the
page around it, so the frame can size itself and the visitor never scrolls
inside a scroll.

## Copy-paste

```html
<div style="max-width:720px;margin:0 auto">
  <iframe id="wcs-dayone-frame"
          src="https://book.westcoaststrength.com/dayone/salem"
          title="Book your Day One"
          style="width:100%;height:620px;border:0;display:block"
          loading="lazy"></iframe>
</div>

<script>
(function () {
  var frame = document.getElementById('wcs-dayone-frame')
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'wcs-dayone-height') return
    // Only resize for our own frame: any page can post a message.
    if (frame.contentWindow !== e.source) return
    frame.style.height = e.data.height + 'px'
  })
})()
</script>
```

Swap `salem` for any club: `keizer`, `eugene`, `springfield`, `clackamas`,
`milwaukie`, `medford`.

## Two things that will bite you

**Never use `height: 100%` on the iframe.** If the containing element only has a
`min-height`, a percentage height resolves against nothing and silently collapses
to about 150px — the widget appears as a sliver with its own scrollbar. Always
set a pixel height and let the script above adjust it. The `620px` above is just
a sensible starting value before the first height message arrives.

**If your host strips `<script>`, keep a fixed height.** Some page builders and
lower WordPress.com plans remove inline scripts from custom HTML blocks. Without
the listener the frame will not auto-size, but compact mode is designed to fit a
fixed frame reasonably — use `height:760px` and no script. Check by loading the
published page and confirming the height reacts when you pick a date.

## Forcing a layout

| URL | Layout |
|---|---|
| `…/dayone/salem` | full three-pane outside a frame, compact inside one |
| `…/dayone/salem?embed=1` | compact always — useful for previewing the embed directly |
| `…/dayone/salem?embed=0` | full always, even framed — only if the host really has the room |

## Cancel and reschedule

Those pages are already a single narrow column and need no compact mode. They are
meant to be reached from the links in the appointment notifications rather than
embedded, and they identify the appointment from the URL:

```
https://book.westcoaststrength.com/dayone/salem/cancel?c={{contact.id}}&a={{appointment.id}}
https://book.westcoaststrength.com/dayone/salem/reschedule?c={{contact.id}}&a={{appointment.id}}
```
