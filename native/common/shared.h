// Shared-memory contract between the EZ Soundboard app (via ezsb-bridge.exe) and the
// EZSoundboardApo.dll plugin that Windows loads into the microphone's audio pipeline.
//
// The app writes its finished sound mix (48 kHz, stereo, float) into a ring buffer as a
// timeline: writePos only ever grows. Every plugin instance (one per app recording the mic,
// e.g. CS2 + Discord at the same time) keeps its OWN read cursor, so every app gets the full
// sound - unlike Soundpad, overlapping sounds and multiple voice apps are no problem.
#pragma once
#include <windows.h>
#include <sddl.h>
#include <stdint.h>
#include <string.h>
#include <stdio.h>

// Shared buffer = a small file in %ProgramData%\EZSoundboard mapped into memory by both sides.
// (A named "Global\\" section can't be shared between Windows' protected audio service and a
// normal app, but a file with an open ACL can - and views of the same file are coherent.)
#define MP_FILE_SDDL     L"D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;LS)(A;;FA;;;NS)(A;;FA;;;WD)(A;;FA;;;AC)(A;;FA;;;S-1-15-2-2)(A;;FA;;;WR)(A;;FA;;;RC)(A;;FA;;;S-1-5-80-2676549577-1911656217-2625096541-4178041876-1366760775)S:(ML;OICI;NW;;;LW)"
#define MP_MAGIC         0x4D504144u   // 'MPAD'
#define MP_VERSION       1u
#define MP_RATE          48000
#define MP_RING_FRAMES   (MP_RATE * 2)  // 2 seconds of stereo audio

// {6EDE81E0-9BA8-41F6-A8BD-6E21436D8999}
static const GUID CLSID_EZSoundboardApo =
    { 0x6ede81e0, 0x9ba8, 0x41f6, { 0xa8, 0xbd, 0x6e, 0x21, 0x43, 0x6d, 0x89, 0x99 } };
#define MP_CLSID_STR L"{6EDE81E0-9BA8-41F6-A8BD-6E21436D8999}"

#pragma pack(push, 8)
struct MPShared {
    uint32_t magic;
    uint32_t version;
    volatile LONG64 writePos;      // absolute frames written by the app (monotonic)
    volatile LONG64 writerTick;    // GetTickCount64() of the app's last write
    volatile LONG64 apoTick;       // GetTickCount64() of the plugin's last process call
    volatile LONG   voiceGainBits; // float bits: gain applied to the real mic (1 = normal)
    volatile LONG   apoRate;       // info: sample rate the mic runs at
    volatile LONG   apoChannels;   // info: mic channel count
    volatile LONG   apoInstances;  // info: plugin instances currently processing
    volatile LONG64 apoLoadTick;   // info: last time the plugin was created/initialized
    volatile LONG   apoLocks;      // info: total successful LockForProcess calls
    volatile LONG   apoLastHr;     // info: last LockForProcess result
    uint32_t reserved[12];
    float ring[MP_RING_FRAMES * 2];
};
#pragma pack(pop)

static inline LONG64 mpLoad64(volatile LONG64* p) { return InterlockedCompareExchange64(p, 0, 0); }
static inline float mpBitsToFloat(LONG b) { float f; memcpy(&f, &b, 4); return f; }
static inline LONG mpFloatToBits(float f) { LONG b; memcpy(&b, &f, 4); return b; }

// Plain path lookup (no shell APIs - those fail inside the locked-down audio service).
static inline bool mpPaths(wchar_t* dir, size_t dn, wchar_t* file, size_t fn) {
    wchar_t base[MAX_PATH] = L"";
    DWORD n = GetEnvironmentVariableW(L"ProgramData", base, MAX_PATH);
    if (n == 0 || n >= MAX_PATH) {
        // Fallback: <system drive>\ProgramData
        wchar_t win[MAX_PATH] = L"C:\\";
        if (GetSystemWindowsDirectoryW(win, MAX_PATH) >= 2) win[2] = 0; // "C:"
        swprintf_s(base, MAX_PATH, L"%s\\ProgramData", win);
    }
    swprintf_s(dir, dn, L"%s\\EZSoundboard", base);
    swprintf_s(file, fn, L"%s\\EZSoundboard\\mixbuffer.bin", base);
    return true;
}

// Debug messages visible live with Microsoft's DebugView (Capture Global Win32).
static inline void mpDebug(const wchar_t* who, const wchar_t* msg, long long v) {
    wchar_t line[400];
    swprintf_s(line, 400, L"[EZSB %s pid %lu] %s %lld\n", who, GetCurrentProcessId(), msg, v);
    OutputDebugStringW(line);
}

// Opens (or creates) the shared buffer. Returns nullptr on failure; *err gets GetLastError().
static inline MPShared* mpOpenShared(HANDLE* fileOut, HANDLE* mapOut, DWORD* err) {
    *fileOut = nullptr;
    *mapOut = nullptr;
    if (err) *err = 0;
    wchar_t dir[MAX_PATH], path[MAX_PATH];
    if (!mpPaths(dir, MAX_PATH, path, MAX_PATH)) { if (err) *err = ERROR_PATH_NOT_FOUND; return nullptr; }
    PSECURITY_DESCRIPTOR sd = nullptr;
    ConvertStringSecurityDescriptorToSecurityDescriptorW(MP_FILE_SDDL, SDDL_REVISION_1, &sd, nullptr);
    SECURITY_ATTRIBUTES sa = { sizeof(sa), sd, FALSE };
    CreateDirectoryW(dir, sd ? &sa : nullptr);
    HANDLE f = CreateFileW(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                           sd ? &sa : nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL | FILE_ATTRIBUTE_TEMPORARY, nullptr);
    DWORD e = GetLastError();
    if (sd) LocalFree(sd);
    if (f == INVALID_HANDLE_VALUE) { if (err) *err = e; return nullptr; }
    HANDLE m = CreateFileMappingW(f, nullptr, PAGE_READWRITE, 0, (DWORD)sizeof(MPShared), nullptr);
    if (!m) { if (err) *err = GetLastError(); CloseHandle(f); return nullptr; }
    MPShared* s = static_cast<MPShared*>(MapViewOfFile(m, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, sizeof(MPShared)));
    if (!s) { if (err) *err = GetLastError(); CloseHandle(m); CloseHandle(f); return nullptr; }
    if (s->magic != MP_MAGIC) {
        InterlockedExchange(&s->voiceGainBits, mpFloatToBits(1.0f));
        s->version = MP_VERSION;
        MemoryBarrier();
        s->magic = MP_MAGIC;
    }
    *fileOut = f;
    *mapOut = m;
    return s;
}
static inline void mpCloseShared(MPShared* s, HANDLE f, HANDLE m) {
    if (s) UnmapViewOfFile(s);
    if (m) CloseHandle(m);
    if (f) CloseHandle(f);
}

// Small diagnostic log next to the buffer (never called from the realtime audio path).
static inline void mpLog(const wchar_t* who, const wchar_t* msg, long long v) {
    mpDebug(who, msg, v);
    wchar_t dir[MAX_PATH], path[MAX_PATH];
    if (!mpPaths(dir, MAX_PATH, path, MAX_PATH)) return;
    wchar_t logp[MAX_PATH];
    swprintf_s(logp, MAX_PATH, L"%s\\%s.log", dir, who);
    HANDLE h = CreateFileW(logp, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return;
    LARGE_INTEGER sz;
    if (GetFileSizeEx(h, &sz) && sz.QuadPart > 512 * 1024) { CloseHandle(h); DeleteFileW(logp); return; }
    SYSTEMTIME t;
    GetLocalTime(&t);
    char line[512];
    int n = sprintf_s(line, "%04d-%02d-%02d %02d:%02d:%02d [pid %lu] %ls %lld\r\n", t.wYear, t.wMonth, t.wDay, t.wHour,
                      t.wMinute, t.wSecond, GetCurrentProcessId(), msg, v);
    DWORD w;
    if (n > 0) WriteFile(h, line, (DWORD)n, &w, nullptr);
    CloseHandle(h);
}

