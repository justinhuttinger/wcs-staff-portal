# Launcher downloads (R2 + Worker)

Public download and auto-update host for the desktop apps, now that the
GitHub repos (and so GitHub Releases) are private.

```
https://downloads.westcoaststrength.com/portal/latest.yml            Portal Windows update feed
https://downloads.westcoaststrength.com/portal/latest-mac.yml        Portal macOS update feed
https://downloads.westcoaststrength.com/portal/Portal-Setup.exe      latest Windows installer (302 -> versioned file)
https://downloads.westcoaststrength.com/portal/Portal-mac-arm64.dmg  latest Mac, Apple Silicon
https://downloads.westcoaststrength.com/portal/Portal-mac-x64.dmg    latest Mac, Intel
https://downloads.westcoaststrength.com/portal/releases/latest       JSON used by portal/public/download.html
https://downloads.westcoaststrength.com/portal/<versioned file>      installers, blockmaps, mac zips

https://downloads.westcoaststrength.com/abc/abc.yml                  WCS ABC feed (built with `channel: abc`)
https://downloads.westcoaststrength.com/abc/abc-mac.yml
https://downloads.westcoaststrength.com/abc/WCS-ABC-Setup.exe        (+ WCS-ABC-mac-arm64.dmg / WCS-ABC-mac-x64.dmg)
https://downloads.westcoaststrength.com/abc/releases/latest

https://downloads.westcoaststrength.com/kiosk/<file>                 optional: Action1 kiosk scripts (off raw GitHub)
```

Channels are R2 key prefixes (`portal/`, `abc/`, `kiosk/`). The bucket stays
private; only this Worker reads it. Range requests work, so
electron-updater's blockmap differential downloads work.

## One-time setup

```bash
npx wrangler r2 bucket create wcs-launcher-downloads
cd cloudflare/launcher-downloads
# uncomment the "routes" block in wrangler.jsonc (custom domain), then:
npx wrangler deploy
```

GitHub repo secrets used by `.github/workflows/release.yml`:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with **Workers R2 Storage: Edit** on the account |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID that owns the bucket |

## Manual upload (no CI)

```bash
cd launcher/dist
for f in *.exe *.blockmap; do npx wrangler r2 object put "wcs-launcher-downloads/portal/$f" --file "$f" --remote; done
npx wrangler r2 object put wcs-launcher-downloads/portal/latest.yml --file latest.yml --content-type "text/yaml; charset=utf-8" --remote
```

Always upload the feed yml last, so it never points at a missing file. For
WCS ABC use the `abc/` prefix and `abc.yml` / `abc-mac.yml`.

## Installing / updating kiosks (Action1)

`scripts/action1/install-portal.ps1` reads these feeds. Run it as SYSTEM
(Action1 "Run Script") with `-Flavor portal` (default) or `-Flavor abc`. It
updates the app silently and registers the SYSTEM "WCS Portal Updater" task
that keeps it updated from then on. See the script header.
