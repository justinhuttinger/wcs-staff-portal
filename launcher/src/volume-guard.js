// WCS ABC: hold the PC at this station's alert volume so check-in and call
// alerts are never silent (or blasting).
//
// Before every alert cue (alert-sound.js) and once a minute, the Windows
// default output device is unmuted and set to EXACTLY the station's level:
// C:\WCS\config.json `alert_volume` (0-100, default 75), set per PC from the
// WCS ABC Admin window. Exact, not a minimum (Justin, 2026-09-29), so staff
// can't turn it up or down for long. It can't reach a speaker's own knob or a
// monitor's buttons. WCS ABC's own Volume Mixer channel is also put back to
// 100% and unmuted: staff at Salem muted it there (2026-10-02), which the
// device level alone never fixed.
//
// Windows' volume lives behind the Core Audio COM API, which Node can't call.
// One hidden PowerShell process compiles a tiny C# wrapper once at startup and
// then answers one request per stdin line, so each check is instant (no
// per-alert PowerShell startup or compile).
const { spawn } = require('child_process')
const path = require('path')
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
[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 { int GetAudioSessionControl(IntPtr a, int b, out IntPtr c); int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c); int GetSessionEnumerator(out IAudioSessionEnumerator e); }
[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator { int GetCount(out int c); int GetSession(int i, out IAudioSessionControl2 s); }
[ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 {
  int GetState(out int s); int GetDisplayName(out IntPtr p); int SetDisplayName(IntPtr a, IntPtr b); int GetIconPath(out IntPtr p);
  int SetIconPath(IntPtr a, IntPtr b); int GetGroupingParam(out Guid g); int SetGroupingParam(IntPtr a, IntPtr b);
  int RegisterAudioSessionNotification(IntPtr p); int UnregisterAudioSessionNotification(IntPtr p);
  int GetSessionIdentifier(out IntPtr p); int GetSessionInstanceIdentifier(out IntPtr p); int GetProcessId(out uint pid);
}
[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume {
  int SetMasterVolume(float l, ref Guid g); int GetMasterVolume(out float l);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}
public static class WcsVolume {
  static IMMDevice Device() {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
    IMMDevice dev;
    Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 0, out dev)); // render, console
    return dev;
  }
  static IAudioEndpointVolume Endpoint() {
    var dev = Device();
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
    try { r += AppSessions(); } catch (Exception e) { r += " app-session err " + e.Message; }
    return r.Length > 0 ? r.Trim() : "ok";
  }
  // This app's own Volume Mixer channel (any session owned by a process with
  // our exe name, i.e. Chromium's audio service): back to 100% and unmuted.
  public static string AppName = "";
  static string AppSessions() {
    if (AppName.Length == 0) return "";
    var iid = typeof(IAudioSessionManager2).GUID;
    object o;
    Marshal.ThrowExceptionForHR(Device().Activate(ref iid, 23, IntPtr.Zero, out o));
    IAudioSessionEnumerator en;
    Marshal.ThrowExceptionForHR(((IAudioSessionManager2)o).GetSessionEnumerator(out en));
    int n; en.GetCount(out n);
    string r = "";
    var g = Guid.Empty;
    for (int i = 0; i < n; i++) {
      IAudioSessionControl2 s; en.GetSession(i, out s);
      uint pid; s.GetProcessId(out pid);
      if (pid == 0) continue;
      string name;
      try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { continue; }
      if (!string.Equals(name, AppName, StringComparison.OrdinalIgnoreCase)) continue;
      var sv = (ISimpleAudioVolume)s; bool m; float l;
      sv.GetMute(out m); sv.GetMasterVolume(out l);
      if (m) { sv.SetMute(false, ref g); r += " app unmuted"; }
      if (l < 0.995f) { sv.SetMasterVolume(1f, ref g); r += " app " + Math.Round(l * 100) + "->100"; }
    }
    return r;
  }
}
'@
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    if ($line.StartsWith('app ')) { [WcsVolume]::AppName = $line.Substring(4); $out = 'ok' }
    elseif ($line -eq 'get') { $out = [WcsVolume]::Get() } else { $out = [WcsVolume]::Set([float]$line) }
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
  // Which process name owns our Volume Mixer channel ("WCS ABC" packaged).
  send('app ' + path.basename(process.execPath, path.extname(process.execPath)))
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
