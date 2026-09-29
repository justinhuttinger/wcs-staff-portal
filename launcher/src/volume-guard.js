// WCS ABC: hold the PC at this station's alert volume so check-in and call
// alerts are never silent (or blasting).
//
// Before every alert cue (alert-sound.js) and once a minute, the Windows
// default output device is unmuted and set to EXACTLY the station's level:
// C:\WCS\config.json `alert_volume` (0-100, default 75), set per PC from the
// WCS ABC Admin window. Exact, not a minimum (Justin, 2026-09-29), so staff
// can't turn it up or down for long. It can't reach a speaker's own knob or a
// monitor's buttons.
//
// Windows' volume lives behind the Core Audio COM API, which Node can't call.
// One hidden PowerShell process compiles a tiny C# wrapper once at startup and
// then answers one request per stdin line, so each check is instant (no
// per-alert PowerShell startup or compile).
const { spawn } = require('child_process')
const { readConfig } = require('./config')

const DEFAULT_VOLUME = 75
const CHECK_MS = 60 * 1000
const REPLY_TIMEOUT_MS = 400

const HELPER = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out uint c);
  int SetMasterVolumeLevel(float l, ref Guid g); int SetMasterVolumeLevelScalar(float l, ref Guid g);
  int GetMasterVolumeLevel(out float l); int GetMasterVolumeLevelScalar(out float l);
  int SetChannelVolumeLevel(uint n, float l, ref Guid g); int SetChannelVolumeLevelScalar(uint n, float l, ref Guid g);
  int GetChannelVolumeLevel(uint n, out float l); int GetChannelVolumeLevelScalar(uint n, out float l);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
  int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }
public static class WcsVolume {
  static IAudioEndpointVolume Endpoint() {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
    IMMDevice dev;
    Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 0, out dev)); // render, console
    var iid = typeof(IAudioEndpointVolume).GUID;
    object o;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o)); // CLSCTX_ALL
    return (IAudioEndpointVolume)o;
  }
  public static string Get() {
    var v = Endpoint(); bool m; float l;
    v.GetMute(out m); v.GetMasterVolumeLevelScalar(out l);
    return "muted=" + m + " level=" + Math.Round(l * 100);
  }
  public static string Set(float target) {
    var v = Endpoint(); var g = Guid.Empty; bool m; float l;
    v.GetMute(out m); v.GetMasterVolumeLevelScalar(out l);
    string r = "";
    if (m) { v.SetMute(false, ref g); r += "unmuted "; }
    if (Math.Abs(l - target) > 0.005) { v.SetMasterVolumeLevelScalar(target, ref g); r += "set " + Math.Round(l * 100) + "->" + Math.Round(target * 100); }
    return r.Length > 0 ? r.Trim() : "ok";
  }
}
'@
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    if ($line -eq 'get') { $out = [WcsVolume]::Get() } else { $out = [WcsVolume]::Set([float]$line) }
  } catch { $out = 'err ' + $_.Exception.Message }
  [Console]::Out.WriteLine($out); [Console]::Out.Flush()
}
`

let child = null
let log = () => {}
let buffer = ''
let waiters = []
let timer = null
let restarts = 0

function startHelper() {
  const encoded = Buffer.from(HELPER, 'utf16le').toString('base64')
  child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (d) => {
    buffer += d.toString()
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      if (!line) continue
      if (line !== 'ok' && line !== 'ready') log('[volume] ' + line)
      const w = waiters.shift()
      if (w && line !== 'ready') w(line)
    }
  })
  child.stderr.on('data', (d) => {
    const t = String(d).trim()
    // PowerShell's serialized progress records, not errors.
    if (t && !/^#< CLIXML|<Objs /.test(t)) log('[volume] stderr ' + t.slice(0, 300))
  })
  child.on('exit', (code) => {
    log('[volume] helper exited ' + code)
    child = null
    waiters.splice(0).forEach(w => w(null))
    // Come back unless it keeps dying.
    if (++restarts <= 5) setTimeout(startHelper, 30 * 1000)
  })
}

function send(cmd) {
  if (!child || !child.stdin.writable) return Promise.resolve(null)
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    waiters.push(finish)
    child.stdin.write(cmd + '\n')
    // Never hold an alert back for long: play regardless after the timeout.
    setTimeout(() => finish(null), REPLY_TIMEOUT_MS)
  })
}

// This station's level, 0-100 (config.json alert_volume, else DEFAULT_VOLUME).
function targetPercent() {
  const v = Number((readConfig() || {}).alert_volume)
  return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : DEFAULT_VOLUME
}

// Unmute + set to exactly `pct` (0-100). Resolves quickly either way.
function setLevel(pct) { return send(String(Math.min(100, Math.max(0, Number(pct) || 0)) / 100)) }

// Unmute + hold this station's level.
function ensure() { return setLevel(targetPercent()) }

// Current state, for the log: "muted=False level=40".
function get() { return send('get') }

function start(logger) {
  if (process.platform !== 'win32' || child) return
  log = logger || log
  startHelper()
  // Log where the PC started, then enforce the floor right away.
  get().then(ensure)
  timer = setInterval(ensure, CHECK_MS)
}

function stop() {
  clearInterval(timer)
  restarts = 99 // no respawn on the way out
  if (child) try { child.kill() } catch {}
}

module.exports = { start, stop, ensure, get, setLevel, targetPercent, DEFAULT_VOLUME }
