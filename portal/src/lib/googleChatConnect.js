import { googleChat } from './api'

// Open the Google Chat consent popup and resolve when it finishes.
//
// `system: true` links the portal's shared sender (noreply@) instead of the
// caller's own account — the popup forces an account chooser, so the admin
// signs in AS noreply@ rather than as themselves.
//
// Resolves true if the connect reported success, false if the user closed the
// window or it errored. Used both by the explicit "Connect Google Chat" button
// and, on demand, the moment someone assigns or @mentions a ticket while their
// Google account isn't connected yet — so the request to connect fires right
// when they try, not only as a passive banner.
export async function connectGoogleChat({ system = false } = {}) {
  let url
  try {
    ({ url } = system ? await googleChat.systemAuthorizeUrl() : await googleChat.authorizeUrl())
  } catch { return false }
  const popup = window.open(url, 'google-chat-auth', 'width=520,height=640')
  return new Promise((resolve) => {
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      window.removeEventListener('message', onMsg)
      clearInterval(poll)
      resolve(ok)
    }
    const onMsg = (e) => {
      if (e?.data?.type === 'google-chat-auth') {
        try { popup && popup.close() } catch { /* ignore */ }
        finish(!!e.data.ok)
      }
    }
    window.addEventListener('message', onMsg)
    // Resolve (false) if the user dismisses the popup without granting.
    const poll = setInterval(() => { if (!popup || popup.closed) finish(false) }, 600)
  })
}
