# Building Portal for macOS

The Portal launcher builds for both Windows and macOS via the
`.github/workflows/release.yml` workflow. Pushing a tag of the form
`launcher-v1.4.17` triggers parallel builds on `windows-latest` and
`macos-latest` and uploads both artifacts to a single GitHub Release
that the in-app autoupdater reads from.

## One-time setup: GitHub repository secrets

These power the macOS code-signing + notarization flow. Configure them
under **Settings → Secrets and variables → Actions → New repository secret**.

### 1. Apple Developer credentials

| Secret | Where to get it |
| --- | --- |
| `APPLE_ID` | Your Apple Developer account email. |
| `APPLE_APP_SPECIFIC_PASSWORD` | https://appleid.apple.com → Sign-In and Security → App-Specific Passwords → Generate. **Not** your real Apple ID password. |

> **Team ID** is `GVZRM9Z5SM` — already hardcoded in
> `electron-builder.yml`. It's a public identifier (visible in any
> signed Mac app's signature), so it's fine to commit.

### 2. Code-signing certificate

You need a **Developer ID Application** certificate (not "Mac App
Distribution" — that's only for the App Store). On a Mac, in Xcode:
**Settings → Accounts → Manage Certificates → + → Developer ID Application**.

If you don't have a Mac to generate it on, you can also create the CSR
in the Apple Developer portal directly:

1. https://developer.apple.com/account/resources/certificates/list
2. Add → **Developer ID Application** → upload a CSR (any cert tool can
   produce one — `openssl` works) → download the `.cer`.
3. Combine the `.cer` with its private key into a `.p12`:

   ```bash
   openssl pkcs12 -export \
     -inkey private.key \
     -in DeveloperIDApplication.cer \
     -out DeveloperIDApplication.p12 \
     -password pass:YOUR_P12_PASSWORD
   ```

4. Base64-encode the .p12 and copy that into `CSC_LINK`:

   ```bash
   base64 -i DeveloperIDApplication.p12 | pbcopy
   ```

| Secret | Value |
| --- | --- |
| `CSC_LINK` | base64 of the `.p12` file |
| `CSC_KEY_PASSWORD` | the password you used when exporting the `.p12` |

## Cutting a release

1. Bump the version in `launcher/package.json`.
2. Commit and push:
   ```bash
   git commit -am "launcher v1.4.17"
   git tag launcher-v1.4.17
   git push origin main launcher-v1.4.17
   ```
3. Watch the **Release Launcher** workflow under the Actions tab.
4. When green, the GitHub Release will have:
   - `Portal Setup 1.4.17.exe` — Windows NSIS installer
   - `Portal-1.4.17.dmg`, `Portal-1.4.17-arm64.dmg` — Mac installers
   - `Portal-1.4.17-mac.zip`, `Portal-1.4.17-arm64-mac.zip` — required by autoupdater
   - `latest.yml`, `latest-mac.yml` — autoupdater manifests

5. Manually promote the release from "Draft" to published when you're
   ready to roll it out — the in-app autoupdater only reads published
   releases.

## What employees download

- **Windows kiosks** — `Portal Setup x.x.x.exe`, deployed via Action1.
- **Mac employees** — link them to the latest `.dmg` on the GitHub
  Release page. Apple Silicon Macs (M1+) get the `-arm64.dmg`; older
  Intel Macs get the plain `.dmg`. They drag Portal.app into
  Applications and launch it. Because the build is signed and notarized
  Gatekeeper will not warn.

## Troubleshooting

- **Notarization fails with "altool deprecated"** — make sure
  electron-builder ≥ v25 (we already require ^25.0.0). Older versions
  used the deprecated altool tooling that Apple disabled.
- **"Can't be opened because Apple cannot check it for malicious
  software"** — the build wasn't notarized. Check the Mac job log for
  notarization warnings.
- **Local Mac dev** — `npm run start` works fine on macOS without
  signing. Only release builds need the certificate. To smoke-test a
  Mac build locally without signing, run
  `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir`.
