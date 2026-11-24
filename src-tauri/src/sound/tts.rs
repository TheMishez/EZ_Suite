//! Text-to-speech with the voices already on Windows: nothing to install.
//!  - "winrt:" voices: the modern Windows voices (Settings → Time & language → Speech)
//!  - "sapi:"  voices: the classic desktop voices (System.Speech)
//! Speech is written to a .wav in the sound folder, then played like any other sound.
//! Text and settings reach PowerShell through environment variables, never through the command
//! line, so nothing typed can be run as code. PowerShell only runs while you use TTS.
use crate::util;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::path::Path;

pub const MAX_CHARS: usize = 1000;

const LIST_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$out = @()
try {
  $null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer,Windows.Media.SpeechSynthesis,ContentType=WindowsRuntime]
  $def = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::DefaultVoice
  foreach ($v in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices) {
    $out += [pscustomobject]@{ id = 'winrt:' + $v.Id; name = $v.DisplayName; lang = $v.Language; gender = [string]$v.Gender; isDefault = ($def -ne $null -and $def.Id -eq $v.Id) }
  }
} catch {}
try {
  Add-Type -AssemblyName System.Speech
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  foreach ($v in $s.GetInstalledVoices()) {
    if ($v.Enabled) {
      $i = $v.VoiceInfo
      $out += [pscustomobject]@{ id = 'sapi:' + $i.Name; name = $i.Name; lang = $i.Culture.Name; gender = [string]$i.Gender; isDefault = $false }
    }
  }
  $s.Dispose()
} catch {}
ConvertTo-Json -Compress -InputObject @($out)
"#;

const SPEAK_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$text = $env:EZSB_TTS_TEXT
$voice = [string]$env:EZSB_TTS_VOICE
$rate = [double]::Parse($env:EZSB_TTS_RATE, [Globalization.CultureInfo]::InvariantCulture)
$outFile = $env:EZSB_TTS_OUT
if ($voice.StartsWith('sapi:') -or $voice -eq '') {
  Add-Type -AssemblyName System.Speech
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  if ($voice.StartsWith('sapi:')) { $s.SelectVoice($voice.Substring(5)) }
  $s.Rate = [int][Math]::Round([Math]::Max(-10, [Math]::Min(10, 10 * [Math]::Log($rate, 3))))
  $s.SetOutputToWaveFile($outFile)
  $s.Speak($text)
  $s.SetOutputToNull()
  $s.Dispose()
} else {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer,Windows.Media.SpeechSynthesis,ContentType=WindowsRuntime]
  $null = [Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  function Await($op, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $null = $task.Wait(-1)
    $task.Result
  }
  $s = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  $id = $voice.Substring(6)
  $v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Id -eq $id } | Select-Object -First 1
  if ($v -ne $null) { $s.Voice = $v }
  try { $s.Options.SpeakingRate = [Math]::Max(0.5, [Math]::Min(6.0, $rate)) } catch {}
  $stream = Await ($s.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $size = [uint32]$stream.Size
  $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
  $null = Await ($reader.LoadAsync($size)) ([uint32])
  $bytes = New-Object byte[] $size
  $reader.ReadBytes($bytes)
  [IO.File]::WriteAllBytes($outFile, $bytes)
  $reader.Dispose()
  $stream.Dispose()
  $s.Dispose()
}
'ok'
"#;

fn run_ps(script: &str, env: &[(&str, String)], timeout_s: u64) -> Result<String, String> {
    use std::io::Read;
    let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let enc = base64(&utf16);
    let mut cmd = util::hidden_command("powershell.exe");
    cmd.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &enc]);
    for (k, v) in env {
        cmd.env(k, v);
    }
    cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                let mut err = String::new();
                if let Some(mut o) = child.stdout.take() {
                    let _ = o.read_to_string(&mut out);
                }
                if let Some(mut e) = child.stderr.take() {
                    let _ = e.read_to_string(&mut err);
                }
                if status.success() {
                    return Ok(out);
                }
                let first = err.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").to_string();
                return Err(if first.is_empty() { format!("PowerShell exited with {:?}", status.code()) } else { first });
            }
            Ok(None) => {
                if start.elapsed().as_secs() > timeout_s {
                    let _ = child.kill();
                    return Err("Text-to-speech took too long".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(30));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        s.push(T[(n >> 18) as usize & 63] as char);
        s.push(T[(n >> 12) as usize & 63] as char);
        s.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        s.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    s
}

static VOICES: Mutex<Option<Value>> = parking_lot::const_mutex(None);

/// [{ id, name, lang, gender, isDefault }]: modern voices first, duplicates removed.
pub fn voices(refresh: bool) -> Value {
    if !refresh {
        if let Some(v) = VOICES.lock().clone() {
            return v;
        }
    }
    let raw = match run_ps(LIST_SCRIPT, &[], 20) {
        Ok(r) => r,
        Err(e) => {
            util::log(format!("tts voices failed: {e}"));
            return json!([]);
        }
    };
    let j: Value = serde_json::from_str(raw.trim()).unwrap_or(json!([]));
    let list = match j {
        Value::Array(a) => a,
        v @ Value::Object(_) => vec![v],
        _ => vec![],
    };
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    let re1 = regex::Regex::new(r"(?i)\s+Desktop$").unwrap();
    let re2 = regex::Regex::new(r"\s+-\s+.*$").unwrap();
    for v in list {
        let (id, name) = (util::jstr(&v, "id").to_string(), util::jstr(&v, "name").to_string());
        if id.is_empty() || name.is_empty() {
            continue;
        }
        let key = re2.replace(&re1.replace(&name, ""), "").to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        out.push(json!({ "id": id, "name": name, "lang": util::jstr(&v, "lang"), "gender": util::jstr(&v, "gender"), "isDefault": util::jbool(&v, "isDefault", false) }));
    }
    let v = Value::Array(out);
    *VOICES.lock() = Some(v.clone());
    v
}

/// Speaks `text` into a new tts-xxxxxxxxxxxx.wav in `dir`. Returns the file name.
pub fn speak(dir: &Path, text: &str, voice: &str, rate: f64) -> Result<String, String> {
    let text: String = text
        .chars()
        .map(|c| if (c as u32) < 0x20 && c != '\n' && c != '\r' && c != '\t' { ' ' } else { c })
        .collect::<String>()
        .trim()
        .chars()
        .take(MAX_CHARS)
        .collect();
    if text.is_empty() {
        return Err("Type something to say".into());
    }
    let voice_ok = (voice.starts_with("winrt:") || voice.starts_with("sapi:")) && voice.len() < 310 && !voice.contains(['\r', '\n']);
    let voice = if voice_ok { voice.to_string() } else { String::new() };
    let rate = if rate.is_finite() { rate.clamp(0.5, 3.0) } else { 1.0 };
    let file = format!("tts-{}.wav", util::new_id());
    let full = dir.join(&file);
    let run = |v: &str| {
        run_ps(
            SPEAK_SCRIPT,
            &[
                ("EZSB_TTS_TEXT", text.clone()),
                ("EZSB_TTS_VOICE", v.to_string()),
                ("EZSB_TTS_RATE", format!("{rate}")),
                ("EZSB_TTS_OUT", full.to_string_lossy().to_string()),
            ],
            30,
        )
    };
    if let Err(e) = run(&voice) {
        if voice.is_empty() {
            return Err(e);
        }
        util::log(format!("tts with {voice} failed ({e}), using the default voice"));
        run("")?; // that voice is gone or broken: use the Windows default
    }
    match std::fs::metadata(&full) {
        Ok(m) if m.len() >= 100 => Ok(file),
        _ => Err("Windows didn't produce any speech".into()),
    }
}

pub fn is_tts_file(name: &str) -> bool {
    name.len() == 20 && name.starts_with("tts-") && name.ends_with(".wav") && name[4..16].chars().all(|c| c.is_ascii_hexdigit())
}

/// Speech files that were never saved to the board are deleted at start-up and quit.
pub fn cleanup(dir: &Path) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if is_tts_file(&n) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}
