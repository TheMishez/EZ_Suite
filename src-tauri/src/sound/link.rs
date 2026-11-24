//! "Add from link": downloads an audio file from a URL into the sound folder.
//! Works with direct links (…/sound.mp3, Discord attachments), share links that need rewriting
//! (Dropbox, Google Drive, GitHub) and pages that contain one sound, like myinstants.com.
use crate::util;
use serde_json::{json, Value};
use std::io::Read;
use std::path::Path;
use std::time::Duration;
use url::Url;

const MAX_BYTES: u64 = 100 * 1024 * 1024;
const MAX_PAGE: u64 = 3 * 1024 * 1024;

pub struct LinkError(pub String);

fn err<T>(m: &str) -> Result<T, LinkError> {
    Err(LinkError(m.to_string()))
}

fn type_ext(t: &str) -> &'static str {
    match t {
        "audio/mpeg" | "audio/mp3" | "audio/mpeg3" | "audio/x-mpeg-3" => ".mp3",
        "audio/wav" | "audio/x-wav" | "audio/wave" | "audio/vnd.wave" => ".wav",
        "audio/ogg" | "application/ogg" | "audio/vorbis" => ".ogg",
        "audio/flac" | "audio/x-flac" => ".flac",
        "audio/mp4" | "audio/x-m4a" | "audio/m4a" => ".m4a",
        "audio/aac" | "audio/x-aac" => ".aac",
        "audio/opus" => ".opus",
        "audio/webm" | "video/webm" => ".webm",
        "video/mp4" => ".mp4",
        _ => "",
    }
}

const AUDIO_EXTS: &[&str] = &[".mp3", ".wav", ".ogg", ".oga", ".flac", ".m4a", ".aac", ".opus", ".webm", ".mp4"];

fn ext_of(p: &str) -> &'static str {
    let p = p.split(['?', '#']).next().unwrap_or("").to_lowercase();
    AUDIO_EXTS.iter().find(|e| p.ends_with(*e)).copied().unwrap_or("")
}

pub fn normalize_url(input: &str) -> Result<Url, LinkError> {
    let mut s = input.trim().trim_start_matches('<').trim_end_matches('>').to_string();
    if !regex::Regex::new(r"^(?i)[a-z][a-z0-9+.-]*:").unwrap().is_match(&s) {
        s = format!("https://{s}");
    }
    let mut u = Url::parse(&s).map_err(|_| LinkError("That doesn't look like a link".into()))?;
    if u.scheme() != "https" && u.scheme() != "http" {
        return err("Only http and https links work");
    }
    let host = u.host_str().unwrap_or("").to_lowercase();
    let streaming = regex::Regex::new(
        r"(?i)(^|\.)(youtube\.com|youtu\.be|twitch\.tv|tiktok\.com|instagram\.com|soundcloud\.com|spotify\.com|music\.apple\.com|x\.com|twitter\.com)$",
    )
    .unwrap();
    if streaming.is_match(&host) {
        return err("Streaming sites (YouTube, TikTok, Spotify…) can't be downloaded from. Use a direct link to an audio file.");
    }
    if host == "dropbox.com" || host.ends_with(".dropbox.com") {
        let pairs: Vec<(String, String)> = u.query_pairs().filter(|(k, _)| k != "dl" && k != "raw").map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        u.query_pairs_mut().clear().extend_pairs(pairs).append_pair("raw", "1");
    } else if host == "drive.google.com" {
        let re = regex::Regex::new(r"/file/d/([\w-]+)").unwrap();
        let id = re.captures(u.path()).map(|c| c[1].to_string()).or_else(|| u.query_pairs().find(|(k, _)| k == "id").map(|(_, v)| v.into_owned()));
        if let Some(id) = id {
            u = Url::parse(&format!(
                "https://drive.google.com/uc?export=download&id={}",
                url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>()
            ))
            .unwrap();
        }
    } else if host == "github.com" && u.path().contains("/blob/") {
        u = Url::parse(&format!("https://raw.githubusercontent.com{}", u.path().replacen("/blob/", "/", 1))).unwrap();
    }
    Ok(u)
}

fn sniff(b: &[u8]) -> &'static str {
    if b.len() < 12 {
        return "";
    }
    if &b[0..4] == b"RIFF" && &b[8..12] == b"WAVE" {
        return ".wav";
    }
    if &b[0..4] == b"OggS" {
        return ".ogg";
    }
    if &b[0..4] == b"fLaC" {
        return ".flac";
    }
    if &b[0..3] == b"ID3" {
        return ".mp3";
    }
    if &b[4..8] == b"ftyp" {
        return ".m4a";
    }
    if b[0] == 0x1a && b[1] == 0x45 && b[2] == 0xdf && b[3] == 0xa3 {
        return ".webm";
    }
    if b[0] == 0xff && (b[1] & 0xf6) == 0xf0 {
        return ".aac";
    }
    if b[0] == 0xff && (b[1] & 0xe0) == 0xe0 {
        return ".mp3";
    }
    ""
}

fn looks_like_html(b: &[u8]) -> bool {
    let head = String::from_utf8_lossy(&b[..b.len().min(512)]).trim_start().to_lowercase();
    head.starts_with("<!doctype html") || head.starts_with("<html") || head.starts_with("<head") || head.starts_with("<?xml")
}

fn filename_from_disposition(cd: &str) -> String {
    if let Some(c) = regex::Regex::new(r"filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)").unwrap().captures(cd) {
        let raw = c[1].trim().trim_matches('"').to_string();
        if let Ok(d) = urlencoding_decode(&raw) {
            return d;
        }
    }
    regex::Regex::new(r#"(?i)filename\s*=\s*"?([^";]+)"?"#).unwrap().captures(cd).map(|c| c[1].trim().to_string()).unwrap_or_default()
}

fn urlencoding_decode(s: &str) -> Result<String, ()> {
    let bytes: Vec<u8> =
        url::form_urlencoded::parse(format!("x={}", s.replace('+', "%2B")).as_bytes()).next().map(|(_, v)| v.into_owned().into_bytes()).ok_or(())?;
    String::from_utf8(bytes).map_err(|_| ())
}

fn nice_name(raw: &str, host: &str) -> String {
    let mut n = urlencoding_decode(raw).unwrap_or_else(|_| raw.to_string());
    n = n.split(['?', '#']).next().unwrap_or("").rsplit(['/', '\\']).next().unwrap_or("").to_string();
    n = regex::Regex::new(r"(?i)\.[a-z0-9]{2,5}$").unwrap().replace(&n, "").to_string();
    n = regex::Regex::new(r"[_]+").unwrap().replace_all(&n, " ").to_string();
    n = regex::Regex::new(r"\s+").unwrap().replace_all(&n, " ").trim().to_string();
    let generic = regex::Regex::new(r"(?i)^(uc|download|file|raw|index|media|audio)$").unwrap();
    let hexy = regex::Regex::new(r"(?i)^[0-9a-f-]{20,}$").unwrap();
    if n.is_empty() || generic.is_match(&n) || hexy.is_match(&n) {
        n = format!("Sound from {host}");
    }
    n.chars().take(80).collect()
}

/// Finds the sound a web page plays (og:audio, <audio>/<source>, or a link to an audio file).
fn find_audio_in_page(html: &str, page: &Url) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let mut add = |v: &str| {
        let v = v.replace("&amp;", "&").replace("\\/", "/");
        if let Ok(u) = page.join(v.trim()) {
            if (u.scheme() == "https" || u.scheme() == "http") && !ext_of(u.path()).is_empty() && !found.contains(&u.to_string()) {
                found.push(u.to_string());
            }
        }
    };
    let og = regex::Regex::new(r#"(?i)<meta[^>]+(?:property|name)=["'](?:og:audio(?::secure_url|:url)?|twitter:player:stream)["'][^>]*>"#).unwrap();
    let content = regex::Regex::new(r#"(?i)content=["']([^"']+)["']"#).unwrap();
    for m in og.find_iter(html) {
        if let Some(c) = content.captures(m.as_str()) {
            add(&c[1]);
        }
    }
    let tags = regex::Regex::new(r#"(?i)<(?:audio|source)\b[^>]*\bsrc=["']([^"']+)["']"#).unwrap();
    for c in tags.captures_iter(html) {
        add(&c[1]);
    }
    let any = regex::Regex::new(r#"(?i)["'(]((?:https?:)?/?/?[^"'()\s<>]+?\.(?:mp3|wav|ogg|oga|opus|m4a|aac|flac|webm))(?:\?[^"'()\s<>]*)?["')]"#).unwrap();
    for c in any.captures_iter(html).take(50) {
        add(&c[1]);
    }
    found
}

fn fetch(agent: &ureq::Agent, url: &str) -> Result<ureq::Response, LinkError> {
    match agent.get(url).set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) EZSoundboard").set("Accept", "audio/*,video/*;q=0.8,*/*;q=0.5").call() {
        Ok(r) => {
            let len: u64 = r.header("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
            if len > MAX_BYTES {
                return err("That file is too big (over 100 MB)");
            }
            Ok(r)
        }
        Err(ureq::Error::Status(401 | 403, _)) => err("That link needs a login or isn't shared publicly"),
        Err(ureq::Error::Status(404, _)) => err("Nothing was found at that link (404)"),
        Err(ureq::Error::Status(c, _)) => Err(LinkError(format!("The site answered with an error ({c})"))),
        Err(e) => {
            let s = e.to_string();
            if s.contains("timed out") {
                err("The download took too long")
            } else {
                err("Couldn't reach that link. Check the address and your connection.")
            }
        }
    }
}

fn read_body(r: ureq::Response, limit: u64) -> Result<Vec<u8>, LinkError> {
    let mut buf = Vec::new();
    r.into_reader().take(limit + 1).read_to_end(&mut buf).map_err(|_| LinkError("The download was interrupted".into()))?;
    if buf.len() as u64 > limit {
        return err("That file is too big (over 100 MB)");
    }
    Ok(buf)
}

/// Downloads the sound at `input` into `dir`. Returns { id, file, name, source }.
pub fn import(dir: &Path, input: &str) -> Result<Value, LinkError> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(45)).redirects(8).build();
    let mut url = normalize_url(input)?;
    let mut res = fetch(&agent, url.as_str())?;
    let mut ctype = res.content_type().to_lowercase();
    if ctype == "text/html" || ctype == "application/xhtml+xml" {
        let page_url = Url::parse(res.get_url()).unwrap_or_else(|_| url.clone());
        let body = read_body(res, MAX_PAGE)?;
        let html = String::from_utf8_lossy(&body);
        let cands = find_audio_in_page(&html, &page_url);
        let Some(first) = cands.first() else {
            return err("That link opens a web page, not a sound. Right-click the sound's download button and copy the link to the file.");
        };
        url = Url::parse(first).map_err(|_| LinkError("Bad link on that page".into()))?;
        res = fetch(&agent, url.as_str())?;
        ctype = res.content_type().to_lowercase();
    }
    let final_url = res.get_url().to_string();
    let disp = res.header("content-disposition").map(filename_from_disposition).unwrap_or_default();
    let buf = read_body(res, MAX_BYTES)?;
    if buf.len() < 64 {
        return err("The link returned an empty file");
    }
    if looks_like_html(&buf) {
        return err("That link opens a web page, not a sound. Use a direct link to the audio file.");
    }
    let mut ext = sniff(&buf);
    for alt in [type_ext(&ctype), ext_of(&disp), ext_of(&final_url), ext_of(url.path())] {
        if ext.is_empty() {
            ext = alt;
        }
    }
    if ext.is_empty() {
        return err("That link isn't an audio file EZ Soundboard can play (mp3, wav, ogg, flac, m4a, opus, webm)");
    }
    let id = util::new_id();
    let file = format!("{id}{ext}");
    std::fs::write(dir.join(&file), &buf).map_err(|_| LinkError("Couldn't save the file".into()))?;
    let host = url.host_str().unwrap_or("").trim_start_matches("www.").to_string();
    let name_src = if !disp.is_empty() { disp } else { Url::parse(&final_url).map(|u| u.path().to_string()).unwrap_or_default() };
    Ok(json!({ "id": id, "file": file, "name": nice_name(&name_src, &host), "source": url.to_string() }))
}
