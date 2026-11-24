//! The native crosshair window used for static designs.
//!
//! A click-through, topmost layered window that holds one premultiplied bitmap. Once it's
//! shown, Windows' compositor keeps it on screen by itself: no browser engine, no redraws, no
//! CPU. It lives on the input worker thread (which runs a message loop).
use parking_lot::Mutex;

struct Still {
    hwnd: isize,
    /// BGRA, premultiplied, top-down
    bmp: Option<(i32, i32, Vec<u8>)>,
    gen: u64,
    applied: Option<((i32, i32, i32, i32), u8, u64, bool)>,
    shown: bool,
}

static STILL: Mutex<Still> = parking_lot::const_mutex(Still { hwnd: 0, bmp: None, gen: 0, applied: None, shown: false });

pub fn set_bitmap(w: i32, h: i32, rgba: &[u8]) {
    let mut out = vec![0u8; rgba.len()];
    for (o, i) in out.chunks_exact_mut(4).zip(rgba.chunks_exact(4)) {
        let a = i[3] as u32;
        o[0] = ((i[2] as u32 * a + 127) / 255) as u8;
        o[1] = ((i[1] as u32 * a + 127) / 255) as u8;
        o[2] = ((i[0] as u32 * a + 127) / 255) as u8;
        o[3] = a as u8;
    }
    let mut s = STILL.lock();
    s.bmp = Some((w, h, out));
    s.gen += 1;
}

pub fn show(rect: (i32, i32, i32, i32), opacity: f64, hide_capture: bool) {
    let alpha = (opacity.clamp(0.0, 1.0) * 255.0).round() as u8;
    {
        let s = STILL.lock();
        if s.bmp.is_none() {
            return;
        }
        if s.shown && s.applied == Some((rect, alpha, s.gen, hide_capture)) {
            return;
        }
    }
    crate::input::run_on_worker(move || imp::apply(rect, alpha, hide_capture));
}

pub fn hide() {
    if !STILL.lock().shown {
        return;
    }
    crate::input::run_on_worker(imp::hide);
}

pub fn top() {
    imp::top();
}

pub fn destroy() {
    crate::input::run_on_worker(imp::destroy);
}

pub fn register_class() {
    imp::register_class();
}

#[cfg(windows)]
mod imp {
    use super::*;
    use crate::util::wide;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::Graphics::Gdi::*;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    const CLASS: &str = "EZSuiteCrosshair";

    pub fn register_class() {
        unsafe {
            let class = wide(CLASS);
            let mut wc: WNDCLASSEXW = std::mem::zeroed();
            wc.cbSize = std::mem::size_of::<WNDCLASSEXW>() as u32;
            wc.lpfnWndProc = Some(DefWindowProcW);
            wc.hInstance = GetModuleHandleW(null());
            wc.lpszClassName = class.as_ptr();
            RegisterClassExW(&wc);
        }
    }

    fn ensure_window(rect: (i32, i32, i32, i32)) -> HWND {
        let mut s = STILL.lock();
        if s.hwnd != 0 {
            return s.hwnd as HWND;
        }
        unsafe {
            let class = wide(CLASS);
            let title = wide("EZ Crosshair");
            let ex = WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            let h = CreateWindowExW(
                ex,
                class.as_ptr(),
                title.as_ptr(),
                WS_POPUP,
                rect.0,
                rect.1,
                rect.2,
                rect.3,
                null_mut(),
                null_mut(),
                GetModuleHandleW(null()),
                null(),
            );
            s.hwnd = h as isize;
            h
        }
    }

    pub fn apply(rect: (i32, i32, i32, i32), alpha: u8, hide_capture: bool) {
        let hwnd = ensure_window(rect);
        if hwnd.is_null() {
            return;
        }
        let (w, h, gen, pixels) = {
            let s = STILL.lock();
            match &s.bmp {
                Some((w, h, p)) => (*w, *h, s.gen, p.clone()),
                None => return,
            }
        };
        unsafe {
            let screen = GetDC(null_mut());
            let mem = CreateCompatibleDC(screen);
            let mut bmi: BITMAPINFO = std::mem::zeroed();
            bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            bmi.bmiHeader.biWidth = w;
            bmi.bmiHeader.biHeight = -h; // top-down
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = BI_RGB as _;
            let mut bits: *mut core::ffi::c_void = null_mut();
            let dib = CreateDIBSection(screen, &bmi, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
            if !dib.is_null() && !bits.is_null() {
                std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u8, pixels.len());
                let old = SelectObject(mem, dib);
                // The bitmap is drawn at the window size, centred on the target point.
                let dst = POINT { x: rect.0 + (rect.2 - w) / 2, y: rect.1 + (rect.3 - h) / 2 };
                let size = SIZE { cx: w, cy: h };
                let src = POINT { x: 0, y: 0 };
                let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: alpha, AlphaFormat: AC_SRC_ALPHA as u8 };
                UpdateLayeredWindow(hwnd, screen, &dst, &size, mem, &src, 0, &blend, ULW_ALPHA);
                SelectObject(mem, old);
                DeleteObject(dib);
            }
            DeleteDC(mem);
            ReleaseDC(null_mut(), screen);
            SetWindowDisplayAffinity(hwnd, if hide_capture { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE });
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        let mut s = STILL.lock();
        s.applied = Some((rect, alpha, gen, hide_capture));
        s.shown = true;
    }

    pub fn hide() {
        let h = STILL.lock().hwnd;
        if h != 0 {
            unsafe {
                ShowWindow(h as HWND, SW_HIDE);
            }
        }
        let mut s = STILL.lock();
        s.shown = false;
        s.applied = None;
    }

    pub fn top() {
        let (h, shown) = {
            let s = STILL.lock();
            (s.hwnd, s.shown)
        };
        if h != 0 && shown {
            unsafe {
                SetWindowPos(h as HWND, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
            }
        }
    }

    pub fn destroy() {
        let mut s = STILL.lock();
        if s.hwnd != 0 {
            unsafe {
                DestroyWindow(s.hwnd as HWND);
            }
        }
        s.hwnd = 0;
        s.shown = false;
        s.applied = None;
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn register_class() {}
    pub fn apply(_r: (i32, i32, i32, i32), _a: u8, _c: bool) {}
    pub fn hide() {}
    pub fn top() {}
    pub fn destroy() {}
}
