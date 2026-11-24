//! Decoding sound files and the decoded-audio cache.
//!
//! Buffers keep the file's own sample rate (mono stays mono). Converting to the output device's
//! rate happens while mixing, in the same interpolation step that does speed/pitch, so there is
//! no separate resampling pass and no extra memory.
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::Arc;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymErr;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Longest sound we decode (longer files are cut here): 20 minutes.
const MAX_SECONDS: usize = 20 * 60;

pub struct Buffer {
    pub rate: u32,
    pub ch: usize,
    pub frames: usize,
    pub data: Vec<f32>,
}

impl Buffer {
    pub fn duration(&self) -> f64 {
        self.frames as f64 / self.rate.max(1) as f64
    }
    pub fn bytes(&self) -> usize {
        self.data.len() * 4
    }
}

pub fn decode(path: &Path) -> Result<Buffer, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions { enable_gapless: true, ..Default::default() }, &MetadataOptions::default())
        .map_err(|e| format!("unsupported: {e}"))?;
    let mut format = probed.format;
    let track = format.tracks().iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL).ok_or("unsupported: no audio track")?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default()).map_err(|e| format!("unsupported: {e}"))?;
    let mut rate = track.codec_params.sample_rate.unwrap_or(48000);
    let mut out_ch = 0usize;
    let mut data: Vec<f32> = Vec::new();
    let mut sb: Option<SampleBuffer<f32>> = None;
    let mut limit = usize::MAX;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymErr::IoError(_)) | Err(SymErr::ResetRequired) => break,
            Err(e) => {
                if data.is_empty() {
                    return Err(format!("decode: {e}"));
                }
                break;
            }
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymErr::DecodeError(_)) => continue,
            Err(_) => break,
        };
        let spec = *decoded.spec();
        rate = spec.rate;
        let src_ch = spec.channels.count().max(1);
        if out_ch == 0 {
            out_ch = if src_ch == 1 { 1 } else { 2 };
            limit = MAX_SECONDS * rate as usize * out_ch;
        }
        let need = decoded.capacity() as u64;
        if sb.as_ref().map(|b| (b.capacity() as u64) < need * src_ch as u64).unwrap_or(true) {
            sb = Some(SampleBuffer::<f32>::new(need, spec));
        }
        let b = sb.as_mut().unwrap();
        b.copy_interleaved_ref(decoded);
        let s = b.samples();
        if src_ch == 1 {
            data.extend_from_slice(s);
        } else if out_ch == 2 {
            for f in s.chunks_exact(src_ch) {
                data.push(f[0]);
                data.push(f[1]);
            }
        } else {
            for f in s.chunks_exact(src_ch) {
                data.push(f.iter().sum::<f32>() / src_ch as f32);
            }
        }
        if data.len() >= limit {
            data.truncate(limit);
            break;
        }
    }
    if out_ch == 0 || data.is_empty() {
        return Err("decode: no audio".into());
    }
    let frames = data.len() / out_ch;
    data.shrink_to_fit();
    Ok(Buffer { rate, ch: out_ch, frames, data })
}

/// Waveform peaks (0..1) + RMS for loudness normalisation + duration.
pub fn analyse(b: &Buffer, buckets: usize) -> serde_json::Value {
    let buckets = buckets.clamp(8, 400);
    let len = b.frames;
    let per = (len / buckets).max(1);
    let step = (per / 400).max(1);
    let mut peaks = vec![0f64; buckets];
    let (mut sum, mut n) = (0f64, 0u64);
    for (bi, p) in peaks.iter_mut().enumerate() {
        let mut mx = 0f32;
        let end = len.min((bi + 1) * per);
        let mut i = bi * per;
        while i < end {
            for c in 0..b.ch {
                let v = b.data[i * b.ch + c].abs();
                if v > mx {
                    mx = v;
                }
                sum += (v * v) as f64;
                n += 1;
            }
            i += step;
        }
        *p = ((mx.min(1.0) as f64) * 1000.0).round() / 1000.0;
    }
    serde_json::json!({ "peaks": peaks, "rms": if n > 0 { (sum / n as f64).sqrt() } else { 0.0 }, "duration": b.duration() })
}

// ------------------------------------------------------------------ cache

/// Decoded audio is big, so the cache has a byte budget and drops the least-recently-used sounds
/// first. Sounds that are playing, plus pinned files (hotkey / favorite sounds), are never dropped.
pub struct Cache {
    map: HashMap<String, Arc<Buffer>>,
    order: VecDeque<String>,
    bytes: usize,
    pub limit: usize,
    pub pinned: HashSet<String>,
}

static CACHE: Mutex<Option<Cache>> = parking_lot::const_mutex(None);

fn with<R>(f: impl FnOnce(&mut Cache) -> R) -> R {
    let mut g = CACHE.lock();
    let c = g.get_or_insert_with(|| Cache { map: HashMap::new(), order: VecDeque::new(), bytes: 0, limit: 128 << 20, pinned: HashSet::new() });
    f(c)
}

pub fn cached(file: &str) -> Option<Arc<Buffer>> {
    with(|c| {
        let b = c.map.get(file).cloned()?;
        c.order.retain(|f| f != file);
        c.order.push_back(file.to_string());
        Some(b)
    })
}

pub fn is_cached(file: &str) -> bool {
    with(|c| c.map.contains_key(file))
}

pub fn get(dir: &Path, file: &str) -> Result<Arc<Buffer>, String> {
    if let Some(b) = cached(file) {
        return Ok(b);
    }
    let b = Arc::new(decode(&dir.join(file))?);
    with(|c| {
        if let Some(old) = c.map.insert(file.to_string(), b.clone()) {
            c.bytes -= old.bytes();
        }
        c.bytes += b.bytes();
        c.order.retain(|f| f != file);
        c.order.push_back(file.to_string());
    });
    evict(Some(file));
    Ok(b)
}

pub fn evict(keep: Option<&str>) {
    let playing = super::engine::playing_files();
    with(|c| {
        let mut i = 0;
        while c.bytes > c.limit && i < c.order.len() {
            let f = c.order[i].clone();
            if Some(f.as_str()) == keep || playing.contains(&f) || c.pinned.contains(&f) {
                i += 1;
                continue;
            }
            c.order.remove(i);
            if let Some(b) = c.map.remove(&f) {
                c.bytes -= b.bytes();
            }
        }
    });
}

pub fn forget(file: &str) {
    with(|c| {
        if let Some(b) = c.map.remove(file) {
            c.bytes -= b.bytes();
        }
        c.order.retain(|f| f != file);
    });
}

pub fn set_policy(limit: usize, pinned: HashSet<String>) {
    with(|c| {
        c.limit = limit;
        c.pinned = pinned;
    });
    evict(None);
}

pub fn bytes() -> (usize, usize) {
    with(|c| (c.bytes, c.limit))
}

pub fn pinned() -> Vec<String> {
    with(|c| c.pinned.iter().cloned().collect())
}
