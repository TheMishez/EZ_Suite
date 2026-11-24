//! The audio engine (replaces the two Web Audio contexts of the Electron app).
//!
//!  sounds ─► monitor bus ─► "you hear" volume ───────────────────────► headphones (WASAPI)
//!  sounds ─► mic bus ─► to-mic gate ─► limiter ─► "they hear" volume ─┬─► mic plugin (direct mode)
//!  real mic ─► (noise suppression) ─► voice volume ─► duck ───────────┴─► virtual cable (cable mode)
//!
//! Everything runs in this process on WASAPI's own audio threads (MMCSS "Pro Audio"):
//!  - No resampling pass: each voice reads its buffer at (file rate / device rate × speed) with
//!    cubic interpolation, which also does speed/pitch.
//!  - Sleeps when idle: a few seconds after the last sound, every stream is stopped and the
//!    engine uses no CPU at all. Playing a sound starts them again.
//!  - The realtime callbacks never allocate or do I/O. They share the mixer with the control
//!    thread through a short lock.
use super::apo;
use super::decode::Buffer;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::{Duration, Instant};

const MON: usize = 0;
const MIC: usize = 1;
const FADE_SECONDS: f64 = 0.03;

// ------------------------------------------------------------------ settings

#[derive(Clone, PartialEq, Debug)]
pub struct EngineSettings {
    pub direct: bool,
    pub monitor_device: String,
    pub mic_out_device: String,
    pub mic_in_device: String,
    pub passthrough: bool,
    pub noise_suppression: bool,
    pub voice_volume: f32,
    pub monitor_volume: f32,
    pub mic_out_volume: f32,
    pub sounds_to_mic: bool,
    pub limiter: bool,
    pub duck: bool,
    pub duck_level: f32,
    pub power_save: bool,
}

impl EngineSettings {
    pub fn from_json(s: &Value) -> Self {
        let f = |k: &str, d: f64| s.get(k).and_then(Value::as_f64).filter(|v| v.is_finite()).unwrap_or(d) as f32;
        let b = |k: &str, d: bool| s.get(k).and_then(Value::as_bool).unwrap_or(d);
        let st = |k: &str| s.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        EngineSettings {
            direct: st("micMode") == "direct",
            monitor_device: st("monitorDevice"),
            mic_out_device: st("micOutDevice"),
            mic_in_device: st("micInDevice"),
            passthrough: b("passthrough", true),
            noise_suppression: b("noiseSuppression", false),
            voice_volume: f("voiceVolume", 1.0).clamp(0.0, 2.0),
            monitor_volume: f("monitorVolume", 0.7).clamp(0.0, 1.5),
            mic_out_volume: f("micOutVolume", 1.0).clamp(0.0, 2.0),
            sounds_to_mic: b("soundsToMic", true),
            limiter: b("limiter", true),
            duck: b("duck", false),
            duck_level: f("duckLevel", 0.35).clamp(0.0, 1.0),
            power_save: b("powerSave", true),
        }
    }
}

// ------------------------------------------------------------------ voices + mixer

pub struct PlayParams {
    pub sound_id: String,
    pub name: String,
    pub file: String,
    pub buf: Arc<Buffer>,
    pub trim_start: f64,
    pub trim_end: Option<f64>,
    pub speed: f64,
    pub gain: f32,
    pub looping: bool,
    pub to_mic: bool,
    pub delay_s: f64,
}

struct Voice {
    id: u64,
    sound_id: String,
    name: String,
    file: String,
    buf: Arc<Buffer>,
    start: f64,
    end: f64,
    speed: f64,
    target: f32,
    gain: [f32; 2],
    looping: bool,
    to_mic: bool,
    pos: [f64; 2],
    delay: [f64; 2], // seconds still to wait before starting, per bus
    done: [bool; 2],
    fade: [f64; 2], // seconds of fade-out left; < 0 = not stopping
    stopping: bool,
    started_ms: f64,
    length: f64,
}

struct Mixer {
    voices: Vec<Voice>,
    next_id: u64,
    st: EngineSettings,
    gate: f32,
    lim_gain: f32,
    duck_gain: f32,
    bus_active: [bool; 2],
    version: u64,
}

static MIXER: Mutex<Option<Mixer>> = parking_lot::const_mutex(None);

fn mix<R>(f: impl FnOnce(&mut Mixer) -> R) -> R {
    let mut g = MIXER.lock();
    let m = g.get_or_insert_with(|| Mixer {
        voices: Vec::new(),
        next_id: 1,
        st: EngineSettings::from_json(&Value::Null),
        gate: 1.0,
        lim_gain: 1.0,
        duck_gain: 1.0,
        bus_active: [false; 2],
        version: 0,
    });
    f(m)
}

#[inline]
fn sample(b: &Buffer, pos: f64, start: f64, end: f64, looping: bool) -> (f32, f32) {
    // 4-point cubic (Catmull-Rom) interpolation
    let n = b.frames as i64;
    let i = pos.floor() as i64;
    let t = (pos - i as f64) as f32;
    let lo = start.floor() as i64;
    let hi = (end.ceil() as i64).min(n) - 1;
    let idx = |k: i64| -> usize {
        let mut k = k;
        if looping && hi > lo {
            let span = hi - lo + 1;
            if k > hi {
                k = lo + (k - lo) % span;
            } else if k < lo {
                k = hi - (lo - k - 1) % span;
            }
        }
        k.clamp(0, n - 1) as usize
    };
    let (i0, i1, i2, i3) = (idx(i - 1), idx(i), idx(i + 1), idx(i + 2));
    let cr = |a: f32, b0: f32, c: f32, d: f32| -> f32 {
        let t2 = t * t;
        let t3 = t2 * t;
        0.5 * ((2.0 * b0) + (-a + c) * t + (2.0 * a - 5.0 * b0 + 4.0 * c - d) * t2 + (-a + 3.0 * b0 - 3.0 * c + d) * t3)
    };
    if b.ch == 1 {
        let d = &b.data;
        let v = cr(d[i0], d[i1], d[i2], d[i3]);
        (v, v)
    } else {
        let d = &b.data;
        (cr(d[i0 * 2], d[i1 * 2], d[i2 * 2], d[i3 * 2]), cr(d[i0 * 2 + 1], d[i1 * 2 + 1], d[i2 * 2 + 1], d[i3 * 2 + 1]))
    }
}

impl Mixer {
    /// Adds every voice on `bus` into `out` (interleaved stereo, `frames` long, at `rate` Hz).
    fn render_voices(&mut self, bus: usize, out: &mut [f32], frames: usize, rate: f64) {
        let dt = 1.0 / rate;
        let smooth = (1.0 - (-dt / 0.02).exp()) as f32; // ~20 ms volume smoothing
        for v in self.voices.iter_mut() {
            if bus == MIC && !v.to_mic {
                continue;
            }
            if v.done[bus] {
                continue;
            }
            let step = v.speed * v.buf.rate as f64 / rate;
            let mut pos = v.pos[bus];
            let mut g = v.gain[bus];
            for f in 0..frames {
                if v.delay[bus] > 0.0 {
                    v.delay[bus] -= dt;
                    continue;
                }
                if pos >= v.end {
                    if v.looping && v.end > v.start {
                        pos = v.start + (pos - v.end) % (v.end - v.start);
                    } else {
                        v.done[bus] = true;
                        break;
                    }
                }
                let mut fg = 1.0f32;
                if v.fade[bus] >= 0.0 {
                    fg = (v.fade[bus] / FADE_SECONDS) as f32;
                    v.fade[bus] -= dt;
                    if v.fade[bus] <= 0.0 {
                        v.done[bus] = true;
                        break;
                    }
                }
                g += (v.target - g) * smooth;
                let (l, r) = sample(&v.buf, pos, v.start, v.end, v.looping);
                out[f * 2] += l * g * fg;
                out[f * 2 + 1] += r * g * fg;
                pos += step;
            }
            v.pos[bus] = pos;
            v.gain[bus] = g;
        }
    }

    fn mic_voice_count(&self) -> usize {
        self.voices.iter().filter(|v| v.to_mic && !v.stopping).count()
    }

    fn ducking(&self) -> bool {
        self.st.duck && self.mic_voice_count() > 0
    }

    /// The "they hear" chain: gate, limiter, master. `voice` (cable mode) is mono mic audio.
    fn render_mic(&mut self, out: &mut [f32], frames: usize, rate: f64, voice: Option<&[f32]>) {
        for s in out.iter_mut().take(frames * 2) {
            *s = 0.0;
        }
        self.render_voices(MIC, out, frames, rate);
        let dt = 1.0 / rate;
        let k = (1.0 - (-dt / 0.01).exp()) as f32;
        let att = (1.0 - (-dt / 0.002).exp()) as f32;
        let rel = (1.0 - (-dt / 0.12).exp()) as f32;
        let gate_t = if self.st.sounds_to_mic { 1.0 } else { 0.0 };
        let thr = 0.794f32; // -2 dBFS
        let master = self.st.mic_out_volume;
        let duck_t = if self.ducking() { self.st.duck_level } else { 1.0 };
        let dk = (1.0 - (-dt / 0.06).exp()) as f32;
        let vv = self.st.voice_volume;
        for f in 0..frames {
            self.gate += (gate_t - self.gate) * k;
            let mut l = out[f * 2] * self.gate;
            let mut r = out[f * 2 + 1] * self.gate;
            if self.st.limiter {
                let peak = l.abs().max(r.abs());
                let want = if peak > thr { thr / peak } else { 1.0 };
                if want < self.lim_gain {
                    self.lim_gain += (want - self.lim_gain) * att;
                } else {
                    self.lim_gain += (want - self.lim_gain) * rel;
                }
                l *= self.lim_gain;
                r *= self.lim_gain;
            }
            l *= master;
            r *= master;
            if let Some(vc) = voice {
                self.duck_gain += (duck_t - self.duck_gain) * dk;
                let v = vc.get(f).copied().unwrap_or(0.0) * vv * self.duck_gain;
                l += v;
                r += v;
            }
            out[f * 2] = l;
            out[f * 2 + 1] = r;
        }
    }
}

// ------------------------------------------------------------------ meters

static PEAK_MON: AtomicU32 = AtomicU32::new(0);
static PEAK_MIC: AtomicU32 = AtomicU32::new(0);
static PEAK_VOICE: AtomicU32 = AtomicU32::new(0);

fn bump(a: &AtomicU32, v: f32) {
    let cur = f32::from_bits(a.load(Ordering::Relaxed));
    if v > cur {
        a.store(v.to_bits(), Ordering::Relaxed);
    }
}

fn peak_of(buf: &[f32]) -> f32 {
    buf.iter().fold(0.0f32, |m, v| m.max(v.abs()))
}

/// Peaks since the last call (the UI polls this while it's on screen).
pub fn levels() -> Value {
    let take = |a: &AtomicU32| f32::from_bits(a.swap(0, Ordering::Relaxed));
    json!({ "mon": take(&PEAK_MON), "mic": take(&PEAK_MIC), "voice": take(&PEAK_VOICE) })
}

// ------------------------------------------------------------------ mic input ring

/// Mono mic audio from the capture thread to the cable output thread.
struct MicRing {
    buf: Box<[AtomicU32]>,
    write: AtomicU64,
    rate: AtomicU32,
}

impl MicRing {
    fn new() -> Self {
        let n = 48000 * 2;
        MicRing { buf: (0..n).map(|_| AtomicU32::new(0)).collect::<Vec<_>>().into_boxed_slice(), write: AtomicU64::new(0), rate: AtomicU32::new(48000) }
    }
    fn push(&self, s: &[f32]) {
        let n = self.buf.len() as u64;
        let w = self.write.load(Ordering::Relaxed);
        for (i, v) in s.iter().enumerate() {
            self.buf[((w + i as u64) % n) as usize].store(v.to_bits(), Ordering::Relaxed);
        }
        self.write.store(w + s.len() as u64, Ordering::Release);
    }
    fn get(&self, i: u64) -> f32 {
        f32::from_bits(self.buf[(i % self.buf.len() as u64) as usize].load(Ordering::Relaxed))
    }
}

/// Reads the ring at the output's rate, keeping ~25 ms of cushion with a tiny, inaudible speed
/// correction (the mic and the cable run on different clocks).
struct MicReader {
    pos: f64,
    synced: bool,
}

impl MicReader {
    fn read(&mut self, ring: &MicRing, out: &mut [f32], out_rate: f64) {
        let in_rate = ring.rate.load(Ordering::Relaxed) as f64;
        let w = ring.write.load(Ordering::Acquire) as f64;
        let target = in_rate * 0.025;
        let mut lat = w - self.pos;
        if !self.synced || lat < 0.0 || lat > in_rate * 0.3 {
            self.pos = (w - target).max(0.0);
            self.synced = true;
            lat = w - self.pos;
        }
        let err = ((lat - target) / target).clamp(-1.0, 1.0);
        let step = in_rate / out_rate * (1.0 + err * 0.002);
        for o in out.iter_mut() {
            if self.pos + 1.0 >= w {
                *o = 0.0;
                continue;
            }
            let i = self.pos.floor();
            let t = (self.pos - i) as f32;
            let a = ring.get(i as u64);
            let b = ring.get(i as u64 + 1);
            *o = a + (b - a) * t;
            self.pos += step;
        }
    }
}

// ------------------------------------------------------------------ control thread

enum Cmd {
    Apply(EngineSettings),
    Wake,
    UiVisible(bool),
    Rebuild,
}

struct Ctl {
    tx: Mutex<mpsc::Sender<Cmd>>,
}

static CTL: OnceLock<Ctl> = OnceLock::new();
static AWAKE: AtomicBool = AtomicBool::new(false);
static LAST_SOUND_MS: AtomicI64 = AtomicI64::new(0);
static ROUTE_OK: AtomicU32 = AtomicU32::new(1); // bit 1 monitor ok, 2 mic ok, 4 mic input ok
static APO_FRAMES: AtomicI64 = AtomicI64::new(0);
static APO_STATUS: Mutex<Option<Value>> = parking_lot::const_mutex(None);

fn send(c: Cmd) {
    if let Some(ctl) = CTL.get() {
        let _ = ctl.tx.lock().send(c);
    }
}

pub fn start() {
    let (tx, rx) = mpsc::channel::<Cmd>();
    let _ = CTL.set(Ctl { tx: Mutex::new(tx.clone()) });
    std::thread::Builder::new().name("sb-audio".into()).spawn(move || control(rx, tx)).expect("audio thread");
}

pub fn apply(st: EngineSettings) {
    send(Cmd::Apply(st));
}

/// Starts the streams if they're asleep (returns quickly; streams start in a few ms).
pub fn wake() {
    LAST_SOUND_MS.store(crate::util::now_ms() as i64, Ordering::Relaxed);
    if !AWAKE.load(Ordering::Acquire) {
        send(Cmd::Wake);
        // Give WASAPI a moment so the very start of the sound isn't lost.
        for _ in 0..30 {
            if AWAKE.load(Ordering::Acquire) {
                break;
            }
            std::thread::sleep(Duration::from_millis(3));
        }
    }
}

pub fn set_ui_visible(on: bool) {
    send(Cmd::UiVisible(on));
}

pub fn rebuild() {
    send(Cmd::Rebuild);
}

pub fn is_awake() -> bool {
    AWAKE.load(Ordering::Acquire)
}

pub fn route_ok() -> (bool, bool, bool) {
    let r = ROUTE_OK.load(Ordering::Relaxed);
    (r & 1 != 0, r & 2 != 0, r & 4 != 0)
}

pub fn apo_status() -> Value {
    APO_STATUS.lock().clone().unwrap_or_else(|| json!({ "mapped": false, "apoAgeMs": -1 }))
}

#[derive(Default)]
struct Streams {
    monitor: Option<cpal::Stream>,
    mic_out: Option<cpal::Stream>,
    mic_in: Option<cpal::Stream>,
    direct: Option<DirectWriter>,
    key: String,
}

struct DirectWriter {
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl Drop for DirectWriter {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

fn control(rx: mpsc::Receiver<Cmd>, tx: mpsc::Sender<Cmd>) {
    let mut st = EngineSettings::from_json(&Value::Null);
    let mut have_settings = false;
    let mut ui_visible = true;
    let mut streams = Streams::default();
    let ring = Arc::new(MicRing::new());
    let shared: Arc<Mutex<Option<apo::Shared>>> = Arc::new(Mutex::new(None));
    let mut last_open_try = Instant::now() - Duration::from_secs(10);
    let mut last_status = Instant::now();
    let mut last_voice_gain = -1.0f32;
    let mut last_version = 0u64;
    loop {
        let busy = !mix(|m| m.voices.is_empty());
        let wait = if busy || ui_visible { 20 } else { 500 };
        match rx.recv_timeout(Duration::from_millis(wait)) {
            Ok(Cmd::Apply(s)) => {
                st = s;
                have_settings = true;
                mix(|m| m.st = st.clone());
            }
            Ok(Cmd::Wake) => {
                LAST_SOUND_MS.store(crate::util::now_ms() as i64, Ordering::Relaxed);
            }
            Ok(Cmd::UiVisible(v)) => ui_visible = v,
            Ok(Cmd::Rebuild) => streams.key.clear(),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => break,
        }
        if !have_settings {
            continue;
        }
        let now = crate::util::now_ms();

        // ---- finished voices, the PTT release, ducking, the UI's voice list
        finish_voices(now);
        let ver = mix(|m| m.version);
        if ver != last_version {
            last_version = ver;
            super::on_voices_changed();
        }
        let has_voices = !mix(|m| m.voices.is_empty());
        if has_voices {
            LAST_SOUND_MS.store(now as i64, Ordering::Relaxed);
        }

        // ---- what should be running
        let idle_ms = now - LAST_SOUND_MS.load(Ordering::Relaxed) as f64;
        let sleepy = st.power_save && !has_voices && idle_ms > 4000.0;
        // Cable mode with your voice passed through: the mic side must keep running.
        let mic_must_run = !st.direct && st.passthrough && !st.mic_out_device.is_empty();
        let want_monitor = !sleepy;
        let want_mic_side = !sleepy || mic_must_run;
        let want_mic_in = if st.direct { ui_visible } else { st.passthrough && !st.mic_out_device.is_empty() || ui_visible };
        let key = format!(
            "{}|{}|{}|{}|{}|{}|{}|{}|{}",
            want_monitor, want_mic_side, want_mic_in, st.direct, st.monitor_device, st.mic_out_device, st.mic_in_device, st.noise_suppression, st.passthrough
        );
        if key != streams.key {
            streams.key = key;
            rebuild_streams(&mut streams, &st, want_monitor, want_mic_side, want_mic_in, &ring, &shared, &tx);
            let awake = streams.monitor.is_some() || streams.mic_out.is_some() || streams.direct.is_some();
            AWAKE.store(awake, Ordering::Release);
            crate::perf::refresh();
        }

        // ---- direct mode: the plugin's shared buffer and your voice level (ducking only)
        if st.direct {
            if shared.lock().is_none() && last_open_try.elapsed() > Duration::from_millis(500) {
                last_open_try = Instant::now();
                match apo::Shared::open() {
                    Ok(s) => {
                        *shared.lock() = Some(s);
                        last_voice_gain = -1.0;
                    }
                    Err(e) => {
                        *APO_STATUS.lock() = Some(json!({ "mapped": false, "openErr": e, "apoAgeMs": -1, "loadAgeMs": -1 }));
                    }
                }
            }
            let g = mix(|m| if m.ducking() { m.st.duck_level } else { 1.0 });
            let g = (g * 1000.0).round() / 1000.0;
            if g != last_voice_gain {
                if let Some(s) = shared.lock().as_ref() {
                    s.set_voice_gain(g);
                    last_voice_gain = g;
                }
            }
            if last_status.elapsed() > Duration::from_millis(500) {
                last_status = Instant::now();
                if let Some(s) = shared.lock().as_ref() {
                    let v = s.status(APO_FRAMES.load(Ordering::Relaxed));
                    *APO_STATUS.lock() = Some(v.clone());
                    if ui_visible {
                        crate::util::emit("sb-apo-status", v);
                    }
                }
            }
        } else if shared.lock().is_some() {
            *shared.lock() = None; // drop resets the voice gain to normal
        }
    }
}

/// Removes voices that have finished on every running bus. Returns true when the list changed.
fn finish_voices(now: f64) -> bool {
    mix(|m| {
        let active = m.bus_active;
        let before = m.voices.len();
        m.voices.retain(|v| {
            let mon_done = v.done[MON] || !active[MON];
            let mic_done = !v.to_mic || v.done[MIC] || !active[MIC];
            let all_done = mon_done && mic_done && (active[MON] || active[MIC]);
            // Safety net: no bus running at all (no device) → let it end on time.
            let overdue = !v.looping && now - v.started_ms > (v.length + 1.0) * 1000.0;
            let stopped_dead = v.stopping && !active[MON] && !active[MIC];
            !(all_done || overdue || stopped_dead)
        });
        let changed = m.voices.len() != before;
        if changed {
            m.version += 1;
        }
        changed
    })
}

fn find_output(host: &cpal::Host, name: &str) -> Option<cpal::Device> {
    if name.is_empty() || name == "default" {
        return host.default_output_device();
    }
    host.output_devices().ok()?.find(|d| d.name().map(|n| n == name).unwrap_or(false))
}

fn find_input(host: &cpal::Host, name: &str) -> Option<cpal::Device> {
    if name.is_empty() || name == "default" {
        return host.default_input_device();
    }
    host.input_devices().ok()?.find(|d| d.name().map(|n| n == name).unwrap_or(false)).or_else(|| host.default_input_device())
}

#[allow(clippy::too_many_arguments)]
fn rebuild_streams(
    s: &mut Streams,
    st: &EngineSettings,
    want_monitor: bool,
    want_mic_side: bool,
    want_mic_in: bool,
    ring: &Arc<MicRing>,
    shared: &Arc<Mutex<Option<apo::Shared>>>,
    tx: &mpsc::Sender<Cmd>,
) {
    s.monitor = None;
    s.mic_out = None;
    s.mic_in = None;
    s.direct = None;
    mix(|m| m.bus_active = [false, false]);
    let host = cpal::default_host();
    let mut ok = 0u32;

    if want_monitor {
        let monitor_dev = find_output(&host, &st.monitor_device).or_else(|| host.default_output_device());
        if let Some(d) = monitor_dev {
            match output_stream(&d, MON, tx.clone(), None) {
                Ok(stream) => {
                    s.monitor = Some(stream);
                    ok |= 1;
                }
                Err(e) => crate::util::log(format!("monitor stream: {e}")),
            }
        }
    } else {
        ok |= 1;
    }

    if want_mic_in {
        if let Some(d) = find_input(&host, if st.direct { "default" } else { &st.mic_in_device }) {
            match input_stream(&d, ring.clone(), !st.direct && st.noise_suppression, tx.clone()) {
                Ok(stream) => {
                    s.mic_in = Some(stream);
                    ok |= 4;
                }
                Err(e) => crate::util::log(format!("mic input: {e}")),
            }
        }
    } else {
        ok |= 4;
    }

    if want_mic_side {
        if st.direct {
            s.direct = Some(start_direct(shared.clone()));
            mix(|m| m.bus_active[MIC] = true);
            ok |= 2;
        } else if !st.mic_out_device.is_empty() {
            if let Some(d) = find_output(&host, &st.mic_out_device) {
                let voice = if st.passthrough { Some(ring.clone()) } else { None };
                match output_stream(&d, MIC, tx.clone(), voice) {
                    Ok(stream) => {
                        s.mic_out = Some(stream);
                        ok |= 2;
                    }
                    Err(e) => crate::util::log(format!("mic output: {e}")),
                }
            }
        }
    } else if st.direct || !st.mic_out_device.is_empty() {
        ok |= 2;
    }
    if !st.direct && st.mic_out_device.is_empty() {
        ok &= !2;
    }
    ROUTE_OK.store(ok, Ordering::Relaxed);
    crate::util::emit("sb-route", json!({ "monitor": ok & 1 != 0, "mic": ok & 2 != 0, "micInput": ok & 4 != 0 }));
}

fn output_stream(dev: &cpal::Device, bus: usize, tx: mpsc::Sender<Cmd>, voice: Option<Arc<MicRing>>) -> Result<cpal::Stream, String> {
    let cfg = dev.default_output_config().map_err(|e| e.to_string())?;
    let fmt = cfg.sample_format();
    let config: cpal::StreamConfig = cfg.into();
    let ch = config.channels as usize;
    let rate = config.sample_rate.0 as f64;
    let mut r2 = OutRender { bus, rate, stereo: vec![0.0; 48000], voice_buf: vec![0.0; 24000], reader: MicReader { pos: 0.0, synced: false }, voice };
    let err_tx = Mutex::new(tx);
    let err_fn = move |e: cpal::StreamError| {
        crate::util::log(format!("output stream error: {e}"));
        let _ = err_tx.lock().send(Cmd::Rebuild);
    };
    let stream = match fmt {
        cpal::SampleFormat::F32 => dev.build_output_stream(
            &config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let frames = data.len() / ch;
                r2.render(frames);
                write_frames(data, ch, &r2.stereo, |v| v);
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => dev.build_output_stream(
            &config,
            move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                let frames = data.len() / ch;
                r2.render(frames);
                write_frames(data, ch, &r2.stereo, |v| (v.clamp(-1.0, 1.0) * 32767.0) as i16);
            },
            err_fn,
            None,
        ),
        other => return Err(format!("unsupported output format {other:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    mix(|m| m.bus_active[bus] = true);
    Ok(stream)
}

struct OutRender {
    bus: usize,
    rate: f64,
    stereo: Vec<f32>,
    voice_buf: Vec<f32>,
    reader: MicReader,
    voice: Option<Arc<MicRing>>,
}

impl OutRender {
    fn render(&mut self, frames: usize) {
        crate::perf::audio_thread();
        if self.stereo.len() < frames * 2 {
            self.stereo.resize(frames * 2, 0.0); // only if WASAPI asks for an unusually big block
        }
        let rate = self.rate;
        let out = &mut self.stereo[..frames * 2];
        if self.bus == MON {
            out.iter_mut().for_each(|s| *s = 0.0);
            mix(|m| {
                m.render_voices(MON, out, frames, rate);
                let v = m.st.monitor_volume;
                out.iter_mut().for_each(|s| *s *= v);
            });
            bump(&PEAK_MON, peak_of(out));
        } else {
            let vb = match self.voice.as_ref() {
                Some(ring) => {
                    if self.voice_buf.len() < frames {
                        self.voice_buf.resize(frames, 0.0);
                    }
                    self.reader.read(ring, &mut self.voice_buf[..frames], rate);
                    Some(&self.voice_buf[..frames])
                }
                None => None,
            };
            mix(|m| m.render_mic(out, frames, rate, vb));
            bump(&PEAK_MIC, peak_of(out));
        }
    }
}

fn write_frames<T: Copy>(data: &mut [T], ch: usize, src: &[f32], conv: impl Fn(f32) -> T) {
    for (f, frame) in data.chunks_exact_mut(ch).enumerate() {
        let l = src[f * 2];
        let r = src[f * 2 + 1];
        match ch {
            1 => frame[0] = conv((l + r) * 0.5),
            _ => {
                frame[0] = conv(l);
                frame[1] = conv(r);
                for x in frame.iter_mut().skip(2) {
                    *x = conv(0.0);
                }
            }
        }
    }
}

fn input_stream(dev: &cpal::Device, ring: Arc<MicRing>, ns: bool, tx: mpsc::Sender<Cmd>) -> Result<cpal::Stream, String> {
    let cfg = dev.default_input_config().map_err(|e| e.to_string())?;
    let fmt = cfg.sample_format();
    let config: cpal::StreamConfig = cfg.into();
    let ch = config.channels as usize;
    let rate = config.sample_rate.0;
    ring.rate.store(rate, Ordering::Relaxed);
    // RNNoise works on 10 ms blocks at 48 kHz.
    let use_ns = ns && rate == 48000;
    let mut denoise = if use_ns { Some(nnnoiseless::DenoiseState::new()) } else { None };
    let mut mono: Vec<f32> = vec![0.0; 48000];
    let mut ns_in = [0f32; 480];
    let mut ns_out = [0f32; 480];
    let mut ns_fill = 0usize;
    let err_tx = Mutex::new(tx);
    let err_fn = move |e: cpal::StreamError| {
        crate::util::log(format!("input stream error: {e}"));
        let _ = err_tx.lock().send(Cmd::Rebuild);
    };
    let mut handle = move |frames: usize, get: &dyn Fn(usize) -> f32| {
        crate::perf::audio_thread();
        if mono.len() < frames {
            mono.resize(frames, 0.0);
        }
        for (f, m) in mono.iter_mut().enumerate().take(frames) {
            let mut acc = 0.0;
            for c in 0..ch {
                acc += get(f * ch + c);
            }
            *m = acc / ch as f32;
        }
        bump(&PEAK_VOICE, peak_of(&mono[..frames]));
        match denoise.as_mut() {
            Some(d) => {
                for &v in &mono[..frames] {
                    ns_in[ns_fill] = v * 32767.0;
                    ns_fill += 1;
                    if ns_fill == 480 {
                        d.process_frame(&mut ns_out, &ns_in);
                        for o in ns_out.iter_mut() {
                            *o /= 32767.0;
                        }
                        ring.push(&ns_out);
                        ns_fill = 0;
                    }
                }
            }
            None => ring.push(&mono[..frames]),
        }
    };
    let stream = match fmt {
        cpal::SampleFormat::F32 => {
            dev.build_input_stream(&config, move |data: &[f32], _: &cpal::InputCallbackInfo| handle(data.len() / ch, &|i| data[i]), err_fn, None)
        }
        cpal::SampleFormat::I16 => dev.build_input_stream(
            &config,
            move |data: &[i16], _: &cpal::InputCallbackInfo| handle(data.len() / ch, &|i| data[i] as f32 / 32768.0),
            err_fn,
            None,
        ),
        other => return Err(format!("unsupported input format {other:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(stream)
}

/// Direct mode: renders the mic bus at 48 kHz in 10 ms blocks and streams it into the plugin.
fn start_direct(shared: Arc<Mutex<Option<apo::Shared>>>) -> DirectWriter {
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let handle = std::thread::Builder::new()
        .name("sb-direct".into())
        .spawn(move || {
            crate::perf::audio_thread();
            let block = 480usize;
            let mut buf = vec![0f32; block * 2];
            let t0 = Instant::now();
            let mut produced: u64 = 0;
            let mut silent = 0u32;
            while !stop2.load(Ordering::Acquire) {
                let due = (t0.elapsed().as_secs_f64() * apo::RATE as f64) as u64;
                if due > produced + apo::RATE as u64 / 5 {
                    produced = due - block as u64; // fell far behind (PC asleep?): skip ahead
                }
                while produced + block as u64 <= due {
                    mix(|m| m.render_mic(&mut buf, block, apo::RATE as f64, None));
                    produced += block as u64;
                    let p = peak_of(&buf);
                    bump(&PEAK_MIC, p);
                    // Nothing playing for a while: stop streaming silence (the plugin notices).
                    silent = if p < 1e-5 { silent + 1 } else { 0 };
                    if silent < 50 {
                        if let Some(s) = shared.lock().as_ref() {
                            s.write(&buf);
                            APO_FRAMES.fetch_add(block as i64, Ordering::Relaxed);
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(4));
            }
        })
        .ok();
    DirectWriter { stop, handle }
}

// ------------------------------------------------------------------ public voice API

pub fn play(p: PlayParams) -> u64 {
    let b = &p.buf;
    let dur = b.duration();
    let ts = p.trim_start.max(0.0).min((dur - 0.01).max(0.0));
    let te = p.trim_end.map(|e| e.max(ts + 0.01).min(dur)).unwrap_or(dur);
    let rate = b.rate as f64;
    let speed = p.speed.clamp(0.25, 3.0);
    let now = crate::util::now_ms();
    mix(|m| {
        let id = m.next_id;
        m.next_id += 1;
        let to_mic = p.to_mic;
        m.voices.push(Voice {
            id,
            sound_id: p.sound_id,
            name: p.name,
            file: p.file,
            buf: p.buf.clone(),
            start: ts * rate,
            end: te * rate,
            speed,
            target: p.gain,
            gain: [p.gain, p.gain],
            looping: p.looping,
            to_mic,
            pos: [ts * rate, ts * rate],
            delay: [p.delay_s, p.delay_s],
            done: [false, !to_mic],
            fade: [-1.0, -1.0],
            stopping: false,
            started_ms: now + p.delay_s * 1000.0,
            length: (te - ts) / speed,
        });
        m.version += 1;
        id
    })
}

pub fn stop(id: u64) {
    mix(|m| {
        for v in m.voices.iter_mut().filter(|v| v.id == id && !v.stopping) {
            v.stopping = true;
            v.fade = [FADE_SECONDS, FADE_SECONDS];
            if v.delay[MON] > 0.0 {
                v.done = [true, true];
            }
        }
        m.version += 1;
    });
}

pub fn stop_sound(sound_id: &str) {
    let ids: Vec<u64> = mix(|m| m.voices.iter().filter(|v| v.sound_id == sound_id).map(|v| v.id).collect());
    for id in ids {
        stop(id);
    }
}

pub fn stop_all() {
    let ids: Vec<u64> = mix(|m| m.voices.iter().map(|v| v.id).collect());
    for id in ids {
        stop(id);
    }
}

pub fn set_sound_gain(sound_id: &str, gain: f32) {
    mix(|m| {
        for v in m.voices.iter_mut().filter(|v| v.sound_id == sound_id) {
            v.target = gain;
        }
    });
}

pub fn voices_for(sound_id: &str) -> usize {
    mix(|m| m.voices.iter().filter(|v| v.sound_id == sound_id && !v.stopping).count())
}

pub fn mic_voice_count() -> usize {
    mix(|m| m.mic_voice_count())
}

pub fn voice_count() -> usize {
    mix(|m| m.voices.len())
}

pub fn playing_files() -> HashSet<String> {
    mix(|m| m.voices.iter().map(|v| v.file.clone()).collect())
}

/// For the UI: what's playing, with what it needs to draw progress itself.
pub fn voices_json() -> Value {
    mix(|m| {
        Value::Array(
            m.voices
                .iter()
                .filter(|v| !v.stopping)
                .map(|v| {
                    json!({
                        "id": v.id, "soundId": v.sound_id, "name": v.name, "toMic": v.to_mic,
                        "startedAt": v.started_ms, "length": v.length, "loop": v.looping,
                    })
                })
                .collect(),
        )
    })
}

pub fn playing_sound_ids() -> Vec<String> {
    let mut v: Vec<String> = mix(|m| m.voices.iter().filter(|v| !v.stopping).map(|v| v.sound_id.clone()).collect());
    v.sort();
    v.dedup();
    v
}

// ------------------------------------------------------------------ devices

pub fn devices() -> Value {
    let host = cpal::default_host();
    let names = |it: Option<Vec<cpal::Device>>| -> Vec<String> { it.unwrap_or_default().iter().filter_map(|d| d.name().ok()).collect() };
    let outs = names(host.output_devices().ok().map(|i| i.collect()));
    let ins = names(host.input_devices().ok().map(|i| i.collect()));
    let def_out = host.default_output_device().and_then(|d| d.name().ok()).unwrap_or_default();
    let def_in = host.default_input_device().and_then(|d| d.name().ok()).unwrap_or_default();
    let list = |v: &[String], def: &str| -> Vec<Value> {
        let mut out = vec![json!({ "deviceId": "default", "label": format!("Default - {def}") })];
        out.extend(v.iter().map(|n| json!({ "deviceId": n, "label": n })));
        out
    };
    json!({ "inputs": list(&ins, &def_in), "outputs": list(&outs, &def_out) })
}
