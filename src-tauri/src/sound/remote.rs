//! Local control for the Stream Deck plugin (and anything else on this PC), on 127.0.0.1:41720.
//!
//! Every request must carry the header "X-EZSB: 1". Browsers can't add that header to a request
//! for another site without a CORS preflight, and the preflight is only answered for pages with
//! no web origin (the Stream Deck plugin runs from local files), so a website can't play sounds
//! on your mic. Requests must also be addressed to this PC by name (blocks DNS rebinding).
//!
//!   GET  /v1/ping | /v1/sounds | /v1/state
//!   POST /v1/play {id|name} · /v1/stop {id} · /v1/stopall · /v1/tts {text, voice?} · /v1/mic {on?}
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub const PORT: u16 = 41720;
const MAX_BODY: usize = 16 * 1024;

static RUNNING: Mutex<Option<Arc<tiny_http::Server>>> = parking_lot::const_mutex(None);
static ERROR: Mutex<String> = parking_lot::const_mutex(String::new());
static STOP: AtomicBool = AtomicBool::new(false);

pub fn status() -> Value {
    json!({ "running": RUNNING.lock().is_some(), "port": PORT, "error": ERROR.lock().clone() })
}

fn emit_status() {
    let mut s = status();
    s["enabled"] = Value::Bool(super::remote_enabled());
    crate::util::emit("sb-remote-status", s);
}

pub fn set_enabled(on: bool) {
    if on {
        start();
    } else {
        stop();
    }
}

fn start() {
    if RUNNING.lock().is_some() {
        return;
    }
    match tiny_http::Server::http(("127.0.0.1", PORT)) {
        Ok(s) => {
            let s = Arc::new(s);
            *RUNNING.lock() = Some(s.clone());
            ERROR.lock().clear();
            STOP.store(false, Ordering::Release);
            std::thread::Builder::new()
                .name("sb-remote".into())
                .spawn(move || {
                    for req in s.incoming_requests() {
                        if STOP.load(Ordering::Acquire) {
                            break;
                        }
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handle(req)));
                    }
                })
                .ok();
        }
        Err(e) => {
            let msg = e.to_string();
            *ERROR.lock() =
                if msg.contains("10048") || msg.to_lowercase().contains("in use") { format!("Port {PORT} is already in use by another program") } else { msg };
        }
    }
    emit_status();
}

fn stop() {
    STOP.store(true, Ordering::Release);
    if let Some(s) = RUNNING.lock().take() {
        s.unblock();
    }
    ERROR.lock().clear();
    emit_status();
}

fn header<'a>(req: &'a tiny_http::Request, name: &str) -> Option<&'a str> {
    req.headers().iter().find(|h| h.field.to_string().eq_ignore_ascii_case(name)).map(|h| h.value.as_str())
}

fn allowed_origin(o: Option<&str>) -> bool {
    match o {
        None => true,
        Some(o) => o == "null" || o.to_ascii_lowercase().starts_with("file://"),
    }
}

fn reply(req: tiny_http::Request, code: u16, body: Value, origin: Option<String>) {
    let mut r = tiny_http::Response::from_string(body.to_string()).with_status_code(code);
    r.add_header(tiny_http::Header::from_bytes("Content-Type", "application/json; charset=utf-8").unwrap());
    r.add_header(tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap());
    if let Some(o) = origin {
        r.add_header(tiny_http::Header::from_bytes("Access-Control-Allow-Origin", o).unwrap());
        r.add_header(tiny_http::Header::from_bytes("Vary", "Origin").unwrap());
    }
    let _ = req.respond(r);
}

fn handle(mut req: tiny_http::Request) {
    let origin = header(&req, "Origin").map(str::to_string);
    let host = header(&req, "Host").unwrap_or("").to_string();
    let host_ok = regex::Regex::new(r"(?i)^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$").unwrap().is_match(&host);
    if !host_ok {
        return reply(req, 403, json!({ "ok": false, "error": "forbidden host" }), None);
    }
    if !allowed_origin(origin.as_deref()) {
        return reply(req, 403, json!({ "ok": false, "error": "forbidden origin" }), None);
    }
    if *req.method() == tiny_http::Method::Options {
        let mut r = tiny_http::Response::empty(204);
        for (k, v) in [
            ("Access-Control-Allow-Origin", origin.clone().unwrap_or_else(|| "*".into())),
            ("Access-Control-Allow-Methods", "GET, POST, OPTIONS".into()),
            ("Access-Control-Allow-Headers", "Content-Type, X-EZSB".into()),
            ("Access-Control-Max-Age", "600".into()),
            ("Vary", "Origin".into()),
        ] {
            r.add_header(tiny_http::Header::from_bytes(k, v).unwrap());
        }
        let _ = req.respond(r);
        return;
    }
    if header(&req, "X-EZSB") != Some("1") {
        return reply(req, 400, json!({ "ok": false, "error": "missing X-EZSB header" }), origin);
    }
    let path = req.url().split('?').next().unwrap_or("").trim_end_matches('/').to_string();
    let get = *req.method() == tiny_http::Method::Get;
    match (get, path.as_str()) {
        (true, "/v1/ping") => return reply(req, 200, json!({ "ok": true, "app": "EZ Soundboard", "version": crate::util::app_version() }), origin),
        (true, "/v1/sounds") => {
            let (sounds, boards) = super::remote_library();
            return reply(req, 200, json!({ "ok": true, "sounds": sounds, "boards": boards }), origin);
        }
        (true, "/v1/state") => {
            return reply(req, 200, json!({ "ok": true, "playing": super::engine::playing_sound_ids(), "soundsToMic": super::sounds_to_mic() }), origin);
        }
        (true, _) => return reply(req, 404, json!({ "ok": false, "error": "not found" }), origin),
        _ => {}
    }
    if *req.method() != tiny_http::Method::Post {
        return reply(req, 404, json!({ "ok": false, "error": "not found" }), origin);
    }
    let mut body = String::new();
    let ok = std::io::Read::take(req.as_reader(), MAX_BODY as u64 + 1).read_to_string(&mut body).is_ok() && body.len() <= MAX_BODY;
    let body: Option<Value> = if !ok {
        None
    } else if body.trim().is_empty() {
        Some(json!({}))
    } else {
        serde_json::from_str(&body).ok()
    };
    let Some(body) = body else { return reply(req, 400, json!({ "ok": false, "error": "bad JSON" }), origin) };
    match path.as_str() {
        "/v1/play" => match super::remote_find(&body) {
            Some((id, name)) => {
                let id2 = id.clone();
                std::thread::spawn(move || super::trigger(&id2, false));
                reply(req, 200, json!({ "ok": true, "id": id, "name": name }), origin)
            }
            None => reply(req, 404, json!({ "ok": false, "error": "sound not found" }), origin),
        },
        "/v1/stop" => {
            match body.get("id").and_then(Value::as_str) {
                Some(id) => super::engine::stop_sound(id),
                None => super::engine::stop_all(),
            }
            reply(req, 200, json!({ "ok": true }), origin)
        }
        "/v1/stopall" => {
            super::engine::stop_all();
            reply(req, 200, json!({ "ok": true }), origin)
        }
        "/v1/tts" => {
            let text: String = crate::util::jstr(&body, "text").trim().chars().take(1000).collect();
            if text.is_empty() {
                return reply(req, 400, json!({ "ok": false, "error": "no text" }), origin);
            }
            let voice: String = crate::util::jstr(&body, "voice").chars().take(300).collect();
            std::thread::spawn(move || super::speak_and_play(&text, &voice));
            reply(req, 200, json!({ "ok": true }), origin)
        }
        "/v1/mic" => {
            super::toggle_sounds_to_mic(body.get("on").and_then(Value::as_bool));
            reply(req, 200, json!({ "ok": true }), origin)
        }
        _ => reply(req, 404, json!({ "ok": false, "error": "not found" }), origin),
    }
}

use std::io::Read as _;
