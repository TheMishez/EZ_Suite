// ezsb-mic-setup.exe - installs / removes the EZ Soundboard plugin on microphones.
//
//   ezsb-mic-setup list                          (no admin) JSON list of mics + status
//   ezsb-mic-setup install default|<guid>...     (admin)    enable on mics
//   ezsb-mic-setup uninstall all|<guid>...       (admin)    restore mics exactly as they were
//   ezsb-mic-setup apply --enable a,b --disable c (admin)   used by the app's Microphones tab
//   ezsb-mic-setup restart                       (admin)    restart Windows Audio
// Flags: --no-restart, --unregister (with uninstall all), --efx (default) | --sfx | --legacy (effect slot)
//
// What "install" does (same idea as Soundpad / Equalizer APO):
//  1. registers EZSoundboardApo.dll as a COM class + audio processing object
//  2. backs up the mic's effect slots to HKLM\SOFTWARE\EZGG\EZSoundboard\ApoBackup\<guid>
//  3. points the mic's stream-effect slot at our plugin and makes sure effects are enabled
//  4. restarts the Windows Audio service so the change takes effect

#include <windows.h>
#include <aclapi.h>
#include <mmdeviceapi.h>
#include <audioenginebaseapo.h>
#include <string>
#include <vector>
#include <cstdio>
#include "../common/shared.h"

static const std::wstring MM_CAPTURE = L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture\\";
static const std::wstring BACKUP_ROOT = L"SOFTWARE\\EZGG\\EZSoundboard\\ApoBackup";
static const wchar_t* V_LFX = L"{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},1";
static const wchar_t* V_GFX = L"{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},2";
static const wchar_t* V_SFX = L"{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},5";
static const wchar_t* V_MFX = L"{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},6";
static const wchar_t* V_CMFX = L"{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},14";
static const wchar_t* V_CSFX = L"{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},13";
// Endpoint effect (EFX): one instance on the mic itself, applied to every app recording it,
// including apps that record in "raw" mode (Discord / Chromium), which skip stream effects.
static const wchar_t* V_EFX = L"{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},7";
static const wchar_t* V_CEFX = L"{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},15";
static const wchar_t* V_EFX_MODES = L"{d3993a3f-99c2-4402-b5ec-a92a0367664b},7";
static const wchar_t* MODE_DEFAULT = L"{C18E2F7E-933D-4965-B7D1-1EEF228D2AF3}";
static const wchar_t* MODE_RAW = L"{9E90EA20-B493-4FD1-A1A8-7E1361A956CF}";
static const wchar_t* MODE_COMMS = L"{98951333-B9CD-48B1-A0A3-FF40682D73F7}";
static const wchar_t* V_SYSFX = L"{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5";
static const PROPERTYKEY MP_PKEY_FriendlyName = { { 0xa45c254e, 0xdf1c, 0x4efd, { 0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0 } }, 14 };

/* ---------------- small utils ---------------- */
static std::string Utf8(const std::wstring& w) {
    if (w.empty()) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string s(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], n, nullptr, nullptr);
    return s;
}
static std::string Json(const std::wstring& w) {
    std::string s = Utf8(w), o = "\"";
    for (char c : s) {
        if (c == '"' || c == '\\') { o += '\\'; o += c; }
        else if ((unsigned char)c < 0x20) { char b[8]; sprintf_s(b, "\\u%04x", c); o += b; }
        else o += c;
    }
    return o + "\"";
}
static bool IEq(const std::wstring& a, const std::wstring& b) { return _wcsicmp(a.c_str(), b.c_str()) == 0; }
static std::vector<std::wstring> Split(const std::wstring& s) {
    std::vector<std::wstring> out;
    size_t start = 0;
    while (start <= s.size()) {
        size_t c = s.find(L',', start);
        std::wstring part = s.substr(start, c == std::wstring::npos ? std::wstring::npos : c - start);
        if (!part.empty()) out.push_back(part);
        if (c == std::wstring::npos) break;
        start = c + 1;
    }
    return out;
}
static std::wstring ExeDir() {
    wchar_t buf[MAX_PATH * 2];
    DWORD n = GetModuleFileNameW(nullptr, buf, (DWORD)(sizeof(buf) / sizeof(buf[0])));
    std::wstring p(buf, n);
    size_t s = p.find_last_of(L"\\/");
    return s == std::wstring::npos ? L"" : p.substr(0, s + 1);
}
static void Log(const std::wstring& msg) {
    wchar_t pd[MAX_PATH];
    if (!GetEnvironmentVariableW(L"ProgramData", pd, MAX_PATH)) return;
    std::wstring dir = std::wstring(pd) + L"\\EZSoundboard";
    CreateDirectoryW(dir.c_str(), nullptr);
    FILE* f = nullptr;
    if (_wfopen_s(&f, (dir + L"\\setup.log").c_str(), L"a, ccs=UTF-8") == 0 && f) {
        SYSTEMTIME t; GetLocalTime(&t);
        fwprintf(f, L"%04d-%02d-%02d %02d:%02d:%02d  %s\n", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, msg.c_str());
        fclose(f);
    }
}
static bool IsElevated() {
    HANDLE tok = nullptr;
    TOKEN_ELEVATION e = {};
    DWORD sz = 0;
    bool r = false;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &tok)) {
        if (GetTokenInformation(tok, TokenElevation, &e, sizeof(e), &sz)) r = e.TokenIsElevated != 0;
        CloseHandle(tok);
    }
    return r;
}
static void EnablePriv(const wchar_t* name) {
    HANDLE tok;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &tok)) return;
    TOKEN_PRIVILEGES tp = {};
    tp.PrivilegeCount = 1;
    if (LookupPrivilegeValueW(nullptr, name, &tp.Privileges[0].Luid)) {
        tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
        AdjustTokenPrivileges(tok, FALSE, &tp, 0, nullptr, nullptr);
    }
    CloseHandle(tok);
}

/* ---------------- registry ---------------- */
struct RegVal { bool exists = false; DWORD type = 0; std::vector<BYTE> data; };

static RegVal ReadVal(HKEY h, const wchar_t* name) {
    RegVal v;
    DWORD t = 0, sz = 0;
    if (!h || RegQueryValueExW(h, name, nullptr, &t, nullptr, &sz) != ERROR_SUCCESS) return v;
    v.data.resize(sz ? sz : 1);
    if (RegQueryValueExW(h, name, nullptr, &t, v.data.data(), &sz) != ERROR_SUCCESS) return RegVal{};
    v.data.resize(sz);
    v.type = t;
    v.exists = true;
    return v;
}
static LONG WriteVal(HKEY h, const wchar_t* name, const RegVal& v) {
    if (!v.exists) {
        LONG r = RegDeleteValueW(h, name);
        return r == ERROR_FILE_NOT_FOUND ? ERROR_SUCCESS : r;
    }
    return RegSetValueExW(h, name, 0, v.type, v.data.empty() ? nullptr : v.data.data(), (DWORD)v.data.size());
}
static RegVal SzVal(const std::wstring& s, DWORD type = REG_SZ) {
    RegVal v;
    v.exists = true;
    v.type = type;
    std::wstring z = s;
    z.push_back(L'\0');
    if (type == REG_MULTI_SZ) z.push_back(L'\0');
    v.data.assign(reinterpret_cast<const BYTE*>(z.data()), reinterpret_cast<const BYTE*>(z.data() + z.size()));
    return v;
}
static RegVal MultiSzVal(const std::vector<std::wstring>& items) {
    RegVal v;
    v.exists = true;
    v.type = REG_MULTI_SZ;
    std::wstring z;
    for (const auto& it : items) { z += it; z.push_back(L'\0'); }
    z.push_back(L'\0');
    v.data.assign(reinterpret_cast<const BYTE*>(z.data()), reinterpret_cast<const BYTE*>(z.data() + z.size()));
    return v;
}
static RegVal DwordVal(DWORD d) {
    RegVal v;
    v.exists = true;
    v.type = REG_DWORD;
    v.data.assign(reinterpret_cast<BYTE*>(&d), reinterpret_cast<BYTE*>(&d) + 4);
    return v;
}
static std::wstring ValStr(const RegVal& v) {
    if (!v.exists || (v.type != REG_SZ && v.type != REG_MULTI_SZ) || v.data.size() < 2) return L"";
    return std::wstring(reinterpret_cast<const wchar_t*>(v.data.data())); // first string
}
static HKEY OpenRead(const std::wstring& path) {
    HKEY h = nullptr;
    if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, path.c_str(), 0, KEY_READ | KEY_WOW64_64KEY, &h) != ERROR_SUCCESS) return nullptr;
    return h;
}

// Audio endpoint keys are owned by the audio service; admins can't write them directly.
// First try backup/restore semantics (ACLs bypassed), then fall back to taking ownership
// and granting Administrators full control (what Equalizer APO's configurator does).
static bool GrantAdmins(const std::wstring& path) {
    std::wstring obj = L"MACHINE\\" + path;
    PSID admins = nullptr;
    SID_IDENTIFIER_AUTHORITY nt = SECURITY_NT_AUTHORITY;
    if (!AllocateAndInitializeSid(&nt, 2, SECURITY_BUILTIN_DOMAIN_RID, DOMAIN_ALIAS_RID_ADMINS, 0, 0, 0, 0, 0, 0, &admins)) return false;
    SetNamedSecurityInfoW(&obj[0], SE_REGISTRY_KEY, OWNER_SECURITY_INFORMATION, admins, nullptr, nullptr, nullptr);
    PACL oldDacl = nullptr, newDacl = nullptr;
    PSECURITY_DESCRIPTOR sd = nullptr;
    bool ok = false;
    if (GetNamedSecurityInfoW(obj.c_str(), SE_REGISTRY_KEY, DACL_SECURITY_INFORMATION, nullptr, nullptr, &oldDacl, nullptr, &sd) == ERROR_SUCCESS) {
        EXPLICIT_ACCESSW ea = {};
        ea.grfAccessPermissions = KEY_ALL_ACCESS;
        ea.grfAccessMode = GRANT_ACCESS;
        ea.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
        ea.Trustee.TrusteeForm = TRUSTEE_IS_SID;
        ea.Trustee.TrusteeType = TRUSTEE_IS_GROUP;
        ea.Trustee.ptstrName = reinterpret_cast<LPWSTR>(admins);
        if (SetEntriesInAclW(1, &ea, oldDacl, &newDacl) == ERROR_SUCCESS) {
            ok = SetNamedSecurityInfoW(&obj[0], SE_REGISTRY_KEY, DACL_SECURITY_INFORMATION, nullptr, nullptr, newDacl, nullptr) == ERROR_SUCCESS;
            LocalFree(newDacl);
        }
        LocalFree(sd);
    }
    FreeSid(admins);
    return ok;
}
static HKEY OpenWrite(const std::wstring& path) {
    HKEY h = nullptr;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, path.c_str(), 0, nullptr, REG_OPTION_BACKUP_RESTORE,
                        KEY_ALL_ACCESS | KEY_WOW64_64KEY, nullptr, &h, nullptr) == ERROR_SUCCESS) return h;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, path.c_str(), 0, nullptr, 0,
                        KEY_ALL_ACCESS | KEY_WOW64_64KEY, nullptr, &h, nullptr) == ERROR_SUCCESS) return h;
    return nullptr;
}
// Write a value to a protected endpoint key, escalating permissions only if needed.
static bool WriteProtected(const std::wstring& path, const wchar_t* name, const RegVal& v) {
    HKEY h = OpenWrite(path);
    LONG r = h ? WriteVal(h, name, v) : ERROR_ACCESS_DENIED;
    if (h) RegCloseKey(h);
    if (r == ERROR_SUCCESS) return true;
    Log(L"direct write denied, taking ownership of " + path);
    if (!GrantAdmins(path)) return false;
    h = OpenWrite(path);
    r = h ? WriteVal(h, name, v) : ERROR_ACCESS_DENIED;
    if (h) RegCloseKey(h);
    return r == ERROR_SUCCESS;
}

/* ---------------- shared buffer file ---------------- */
// Pre-create %ProgramData%\EZSoundboard and the shared buffer with an ACL that both the Windows
// audio service (where the plugin runs) and the normal-user app can read/write.
static bool EnsureSharedFile() {
    wchar_t dir[MAX_PATH], path[MAX_PATH];
    if (!mpPaths(dir, MAX_PATH, path, MAX_PATH)) return false;
    CreateDirectoryW(dir, nullptr);
    PSECURITY_DESCRIPTOR sd = nullptr;
    if (ConvertStringSecurityDescriptorToSecurityDescriptorW(MP_FILE_SDDL, SDDL_REVISION_1, &sd, nullptr)) {
        const SECURITY_INFORMATION si = DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION;
        SetFileSecurityW(dir, si, sd);
        if (GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES) SetFileSecurityW(path, si, sd);
        wchar_t logp[MAX_PATH];
        for (const wchar_t* nm : { L"apo.log", L"bridge.log", L"setup.log" }) {
            swprintf_s(logp, MAX_PATH, L"%s\\%s", dir, nm);
            if (GetFileAttributesW(logp) != INVALID_FILE_ATTRIBUTES) SetFileSecurityW(logp, si, sd);
        }
        LocalFree(sd);
    }
    HANDLE f = nullptr, m = nullptr;
    DWORD err = 0;
    MPShared* sh = mpOpenShared(&f, &m, &err);
    if (!sh) {
        Log(L"could not create shared buffer, error " + std::to_wstring(err));
        return false;
    }
    mpCloseShared(sh, f, m);
    Log(L"shared buffer ready");
    return true;
}

/* ---------------- COM / APO registration ---------------- */
static bool SetStr(const std::wstring& path, const wchar_t* name, const std::wstring& val) {
    HKEY h = nullptr;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, path.c_str(), 0, nullptr, 0, KEY_ALL_ACCESS | KEY_WOW64_64KEY, nullptr, &h, nullptr) != ERROR_SUCCESS) return false;
    LONG r = WriteVal(h, name, SzVal(val));
    RegCloseKey(h);
    return r == ERROR_SUCCESS;
}
static bool SetDword(HKEY h, const wchar_t* name, DWORD d) { return WriteVal(h, name, DwordVal(d)) == ERROR_SUCCESS; }

static bool RegisterPlugin() {
    std::wstring dll = ExeDir() + L"EZSoundboardApo.dll";
    if (GetFileAttributesW(dll.c_str()) == INVALID_FILE_ATTRIBUTES) {
        Log(L"missing " + dll);
        return false;
    }
    std::wstring clsidKey = L"SOFTWARE\\Classes\\CLSID\\" + std::wstring(MP_CLSID_STR);
    bool ok = SetStr(clsidKey, nullptr, L"EZ Soundboard Mic Mixer");
    ok &= SetStr(clsidKey + L"\\InprocServer32", nullptr, dll);
    ok &= SetStr(clsidKey + L"\\InprocServer32", L"ThreadingModel", L"Both");

    wchar_t iid[64];
    StringFromGUID2(__uuidof(IAudioProcessingObject), iid, 64);
    std::wstring apoKey = L"SOFTWARE\\Classes\\AudioEngine\\AudioProcessingObjects\\" + std::wstring(MP_CLSID_STR);
    HKEY h = nullptr;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, apoKey.c_str(), 0, nullptr, 0, KEY_ALL_ACCESS | KEY_WOW64_64KEY, nullptr, &h, nullptr) != ERROR_SUCCESS) return false;
    ok &= WriteVal(h, L"FriendlyName", SzVal(L"EZ Soundboard Mic Mixer")) == ERROR_SUCCESS;
    ok &= WriteVal(h, L"Copyright", SzVal(L"Copyright (c) EZGGco")) == ERROR_SUCCESS;
    ok &= SetDword(h, L"MajorVersion", 1);
    ok &= SetDword(h, L"MinorVersion", 0);
    ok &= SetDword(h, L"Flags", APO_FLAG_DEFAULT);
    ok &= SetDword(h, L"MinInputConnections", 1);
    ok &= SetDword(h, L"MaxInputConnections", 1);
    ok &= SetDword(h, L"MinOutputConnections", 1);
    ok &= SetDword(h, L"MaxOutputConnections", 1);
    ok &= SetDword(h, L"MaxInstances", 0xFFFFFFFF);
    ok &= SetDword(h, L"NumAPOInterfaces", 1);
    ok &= WriteVal(h, L"APOInterface0", SzVal(iid)) == ERROR_SUCCESS;
    RegCloseKey(h);
    Log(ok ? L"registered plugin" : L"plugin registration incomplete");
    EnsureSharedFile();
    return ok;
}
static void UnregisterPlugin() {
    RegDeleteTreeW(HKEY_LOCAL_MACHINE, (L"SOFTWARE\\Classes\\CLSID\\" + std::wstring(MP_CLSID_STR)).c_str());
    RegDeleteTreeW(HKEY_LOCAL_MACHINE, (L"SOFTWARE\\Classes\\AudioEngine\\AudioProcessingObjects\\" + std::wstring(MP_CLSID_STR)).c_str());
    Log(L"unregistered plugin");
}
static bool IsRegistered() {
    HKEY h = OpenRead(L"SOFTWARE\\Classes\\AudioEngine\\AudioProcessingObjects\\" + std::wstring(MP_CLSID_STR));
    if (!h) return false;
    RegCloseKey(h);
    return true;
}

/* ---------------- devices ---------------- */
struct Mic { std::wstring guid, name; bool isDefault = false, isDefaultComm = false; };

static std::wstring GuidFromId(const std::wstring& id) {
    size_t p = id.rfind(L"}.{");
    return p == std::wstring::npos ? id : id.substr(p + 2);
}
static std::wstring DefaultGuid(IMMDeviceEnumerator* en, ERole role) {
    IMMDevice* d = nullptr;
    std::wstring g;
    if (SUCCEEDED(en->GetDefaultAudioEndpoint(eCapture, role, &d)) && d) {
        LPWSTR id = nullptr;
        if (SUCCEEDED(d->GetId(&id)) && id) { g = GuidFromId(id); CoTaskMemFree(id); }
        d->Release();
    }
    return g;
}
static std::vector<Mic> ListMics() {
    std::vector<Mic> out;
    IMMDeviceEnumerator* en = nullptr;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void**)&en))) return out;
    std::wstring defC = DefaultGuid(en, eConsole), defM = DefaultGuid(en, eCommunications);
    IMMDeviceCollection* col = nullptr;
    if (SUCCEEDED(en->EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, &col)) && col) {
        UINT n = 0;
        col->GetCount(&n);
        for (UINT i = 0; i < n; ++i) {
            IMMDevice* d = nullptr;
            if (FAILED(col->Item(i, &d)) || !d) continue;
            Mic m;
            LPWSTR id = nullptr;
            if (SUCCEEDED(d->GetId(&id)) && id) { m.guid = GuidFromId(id); CoTaskMemFree(id); }
            IPropertyStore* ps = nullptr;
            if (SUCCEEDED(d->OpenPropertyStore(STGM_READ, &ps)) && ps) {
                PROPVARIANT pv;
                PropVariantInit(&pv);
                if (SUCCEEDED(ps->GetValue(MP_PKEY_FriendlyName, &pv)) && pv.vt == VT_LPWSTR && pv.pwszVal) m.name = pv.pwszVal;
                PropVariantClear(&pv);
                ps->Release();
            }
            m.isDefault = IEq(m.guid, defC);
            m.isDefaultComm = IEq(m.guid, defM);
            out.push_back(m);
            d->Release();
        }
        col->Release();
    }
    en->Release();
    return out;
}

static bool IsInstalledOn(const std::wstring& guid) {
    HKEY h = OpenRead(MM_CAPTURE + guid + L"\\FxProperties");
    if (!h) return false;
    bool r = IEq(ValStr(ReadVal(h, V_SFX)), MP_CLSID_STR) || IEq(ValStr(ReadVal(h, V_LFX)), MP_CLSID_STR) ||
             IEq(ValStr(ReadVal(h, V_CSFX)), MP_CLSID_STR) || IEq(ValStr(ReadVal(h, V_EFX)), MP_CLSID_STR) ||
             IEq(ValStr(ReadVal(h, V_CEFX)), MP_CLSID_STR);
    RegCloseKey(h);
    return r;
}
static bool EnhancementsDisabled(const std::wstring& guid) {
    HKEY h = OpenRead(MM_CAPTURE + guid + L"\\Properties");
    if (!h) return false;
    RegVal v = ReadVal(h, V_SYSFX);
    RegCloseKey(h);
    return v.exists && v.type == REG_DWORD && v.data.size() >= 4 && *reinterpret_cast<DWORD*>(v.data.data()) != 0;
}

/* ---------------- install / uninstall one mic ---------------- */
struct Slot { const wchar_t* sub; const wchar_t* name; };
static const Slot SLOTS[] = { { L"\\FxProperties", V_SFX }, { L"\\FxProperties", V_LFX }, { L"\\FxProperties", V_CSFX },
                               { L"\\FxProperties", V_GFX }, { L"\\FxProperties", V_MFX }, { L"\\FxProperties", V_CMFX },
                               { L"\\FxProperties", V_EFX }, { L"\\FxProperties", V_CEFX }, { L"\\FxProperties", V_EFX_MODES },
                               { L"\\Properties", V_SYSFX } };

static void SaveBackup(const std::wstring& guid) {
    std::wstring bk = BACKUP_ROOT + L"\\" + guid;
    HKEY test = OpenRead(bk);
    if (test) { RegCloseKey(test); return; } // keep the very first (original) backup
    HKEY b = nullptr;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, bk.c_str(), 0, nullptr, 0, KEY_ALL_ACCESS | KEY_WOW64_64KEY, nullptr, &b, nullptr) != ERROR_SUCCESS) return;
    for (const Slot& s : SLOTS) {
        HKEY h = OpenRead(MM_CAPTURE + guid + s.sub);
        RegVal v = ReadVal(h, s.name);
        if (h) RegCloseKey(h);
        std::wstring key = std::wstring(s.sub + 1) + L"|" + s.name;
        if (v.exists && !IEq(ValStr(v), MP_CLSID_STR)) WriteVal(b, key.c_str(), v);
        else WriteVal(b, (L"absent|" + key).c_str(), DwordVal(1));
    }
    RegCloseKey(b);
}

static bool UninstallOn(const std::wstring& guid);
static bool IsInstalledOn(const std::wstring& guid);

enum class Slot_ { Efx, Sfx, Lfx };
static bool g_keepEffects = false;

static bool InstallOn(const std::wstring& guid, Slot_ slot) {
    // Start from the mic's original settings (undo any earlier EZ Soundboard install first),
    // so switching slots never leaves the plugin in two places.
    if (IsInstalledOn(guid)) UninstallOn(guid);
    SaveBackup(guid);
    const std::wstring fx = MM_CAPTURE + guid + L"\\FxProperties";
    const std::wstring props = MM_CAPTURE + guid + L"\\Properties";
    HKEY h = OpenRead(fx);
    RegVal compS = ReadVal(h, V_CSFX), compE = ReadVal(h, V_CEFX);
    if (h) RegCloseKey(h);
    bool ok = true;
    // Keep the voice untouched. Our plugin needs Windows "Audio enhancements" switched on, which
    // would also wake up the default Windows/driver voice effects (AGC, noise suppression...) and
    // make the mic sound worse. So, like Soundpad, we remove the other effects from the mic: the voice
    // is passed through exactly as the hardware delivers it and only our sounds are added.
    // (Everything is backed up and restored on uninstall. --keep-effects keeps them instead.)
    bool cleanMode = !g_keepEffects;
    if (cleanMode && slot == Slot_::Efx) {
        for (const wchar_t* v : { V_LFX, V_GFX, V_SFX, V_MFX, V_CSFX, V_CMFX })
            ok &= WriteProtected(fx, v, RegVal{});
        Log(L"removed other mic effects so the voice stays untouched on " + guid);
    }
    if (slot == Slot_::Efx) {
        ok &= WriteProtected(fx, V_EFX, SzVal(MP_CLSID_STR));
        if (compE.exists) ok &= WriteProtected(fx, V_CEFX, SzVal(MP_CLSID_STR, REG_MULTI_SZ));
        ok &= WriteProtected(fx, V_EFX_MODES, MultiSzVal({ MODE_DEFAULT, MODE_RAW, MODE_COMMS }));
    } else if (slot == Slot_::Sfx) {
        ok &= WriteProtected(fx, V_SFX, SzVal(MP_CLSID_STR));
        if (compS.exists) ok &= WriteProtected(fx, V_CSFX, SzVal(MP_CLSID_STR, REG_MULTI_SZ));
    } else {
        ok &= WriteProtected(fx, V_LFX, SzVal(MP_CLSID_STR));
    }
    // Make sure "Audio enhancements" are on for this mic, otherwise Windows skips all effects.
    ok &= WriteProtected(props, V_SYSFX, DwordVal(0));
    const wchar_t* name = slot == Slot_::Efx ? L"endpoint slot" : slot == Slot_::Sfx ? L"stream slot" : L"legacy slot";
    Log((ok ? L"installed (" : L"FAILED install (") + std::wstring(name) + L") on " + guid);
    return ok;
}

static bool UninstallOn(const std::wstring& guid) {
    const std::wstring bk = BACKUP_ROOT + L"\\" + guid;
    HKEY b = OpenRead(bk);
    bool ok = true;
    for (const Slot& s : SLOTS) {
        const std::wstring path = MM_CAPTURE + guid + s.sub;
        const std::wstring key = std::wstring(s.sub + 1) + L"|" + s.name;
        RegVal orig;
        if (b) {
            orig = ReadVal(b, key.c_str());
            if (!orig.exists && !ReadVal(b, (L"absent|" + key).c_str()).exists) continue; // not backed up: leave alone
        } else {
            // No backup: only remove values that point at us.
            HKEY h = OpenRead(path);
            RegVal cur = ReadVal(h, s.name);
            if (h) RegCloseKey(h);
            if (!IEq(ValStr(cur), MP_CLSID_STR)) continue;
        }
        ok &= WriteProtected(path, s.name, orig); // orig.exists==false => delete
    }
    if (b) RegCloseKey(b);
    if (ok) RegDeleteTreeW(HKEY_LOCAL_MACHINE, bk.c_str());
    Log((ok ? L"removed from " : L"FAILED removal from ") + guid);
    return ok;
}

/* ---------------- Windows Audio service ---------------- */
static bool RestartAudio() {
    SC_HANDLE scm = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
    if (!scm) return false;
    SC_HANDLE svc = OpenServiceW(scm, L"Audiosrv", SERVICE_STOP | SERVICE_START | SERVICE_QUERY_STATUS);
    bool ok = false;
    if (svc) {
        SERVICE_STATUS st = {};
        ControlService(svc, SERVICE_CONTROL_STOP, &st);
        for (int i = 0; i < 100; ++i) {
            if (QueryServiceStatus(svc, &st) && st.dwCurrentState == SERVICE_STOPPED) break;
            Sleep(100);
        }
        ok = StartServiceW(svc, 0, nullptr) || GetLastError() == ERROR_SERVICE_ALREADY_RUNNING;
        CloseServiceHandle(svc);
    }
    CloseServiceHandle(scm);
    Log(ok ? L"restarted Windows Audio" : L"could not restart Windows Audio");
    return ok;
}

static std::vector<std::wstring> BackedUpGuids() {
    std::vector<std::wstring> out;
    HKEY h = OpenRead(BACKUP_ROOT);
    if (!h) return out;
    wchar_t name[256];
    for (DWORD i = 0;; ++i) {
        DWORD len = 256;
        if (RegEnumKeyExW(h, i, name, &len, nullptr, nullptr, nullptr, nullptr) != ERROR_SUCCESS) break;
        out.push_back(name);
    }
    RegCloseKey(h);
    return out;
}

/* ---------------- migration from the old "Mishez Pad" name ---------------- */
static void MigrateLegacyBackups() {
    const wchar_t* legacy = L"SOFTWARE\\MishezPad\\ApoBackup";
    HKEY oldk = OpenRead(legacy);
    if (!oldk) return;
    HKEY newk = nullptr;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, BACKUP_ROOT.c_str(), 0, nullptr, 0, KEY_ALL_ACCESS | KEY_WOW64_64KEY,
                        nullptr, &newk, nullptr) == ERROR_SUCCESS) {
        if (RegCopyTreeW(oldk, nullptr, newk) == ERROR_SUCCESS) {
            RegCloseKey(oldk);
            oldk = nullptr;
            RegDeleteTreeW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\MishezPad");
            Log(L"migrated mic backups from the old Mishez Pad install");
        }
        RegCloseKey(newk);
    }
    if (oldk) RegCloseKey(oldk);
}

/* ---------------- main ---------------- */
static int Fail(const char* msg, int code = 1) {
    printf("{\"ok\":false,\"error\":\"%s\"}\n", msg);
    return code;
}

int wmain(int argc, wchar_t** argv) {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (argc < 2) return Fail("usage: list | install | uninstall | apply | restart");
    const std::wstring cmd = argv[1];
    bool restart = true, unregister = false;
    Slot_ slot = Slot_::Efx;
    std::vector<std::wstring> targets, enable, disable;
    for (int i = 2; i < argc; ++i) {
        std::wstring a = argv[i];
        if (a == L"--no-restart") restart = false;
        else if (a == L"--unregister") unregister = true;
        else if (a == L"--legacy") slot = Slot_::Lfx;
        else if (a == L"--sfx") slot = Slot_::Sfx;
        else if (a == L"--efx") slot = Slot_::Efx;
        else if (a == L"--keep-effects") g_keepEffects = true;
        else if (a == L"--enable" && i + 1 < argc) { auto v = Split(argv[++i]); enable.insert(enable.end(), v.begin(), v.end()); }
        else if (a == L"--disable" && i + 1 < argc) { auto v = Split(argv[++i]); disable.insert(disable.end(), v.begin(), v.end()); }
        else targets.push_back(a);
    }

    if (cmd == L"list") {
        auto mics = ListMics();
        std::string o = "{\"ok\":true,\"registered\":";
        o += IsRegistered() ? "true" : "false";
        o += ",\"devices\":[";
        for (size_t i = 0; i < mics.size(); ++i) {
            const Mic& m = mics[i];
            if (i) o += ",";
            o += "{\"guid\":" + Json(m.guid) + ",\"name\":" + Json(m.name) +
                 ",\"default\":" + (m.isDefault ? "true" : "false") +
                 ",\"defaultComm\":" + (m.isDefaultComm ? "true" : "false") +
                 ",\"installed\":" + (IsInstalledOn(m.guid) ? "true" : "false") +
                 ",\"enhancementsDisabled\":" + (EnhancementsDisabled(m.guid) ? "true" : "false") + "}";
        }
        o += "]}";
        printf("%s\n", o.c_str());
        return 0;
    }

    if (!IsElevated()) return Fail("administrator rights required", 5);
    EnablePriv(SE_BACKUP_NAME);
    EnablePriv(SE_RESTORE_NAME);
    EnablePriv(SE_TAKE_OWNERSHIP_NAME);
    MigrateLegacyBackups();

    auto resolve = [](const std::vector<std::wstring>& in) {
        std::vector<std::wstring> out;
        for (const auto& t : in) {
            if (IEq(t, L"default")) {
                for (const Mic& m : ListMics())
                    if ((m.isDefault || m.isDefaultComm)) out.push_back(m.guid);
            } else {
                out.push_back(t);
            }
        }
        return out;
    };

    bool ok = true;
    if (cmd == L"restart") {
        ok = RestartAudio();
    } else if (cmd == L"install" || cmd == L"apply") {
        std::vector<std::wstring> on = resolve(cmd == L"install" ? targets : enable);
        std::vector<std::wstring> off = resolve(disable);
        if (!on.empty() && !RegisterPlugin()) return Fail("could not register plugin");
        for (const auto& g : off) ok &= UninstallOn(g);
        for (const auto& g : on) ok &= InstallOn(g, slot);
        if (restart && (!on.empty() || !off.empty())) ok &= RestartAudio();
    } else if (cmd == L"uninstall") {
        std::vector<std::wstring> list;
        bool all = false;
        for (const auto& t : targets) if (IEq(t, L"all")) all = true;
        if (all) {
            list = BackedUpGuids();
            for (const Mic& m : ListMics())
                if (IsInstalledOn(m.guid)) list.push_back(m.guid);
        } else {
            list = resolve(targets);
        }
        for (const auto& g : list) ok &= UninstallOn(g);
        if (unregister) UnregisterPlugin();
        if (restart) ok &= RestartAudio();
    } else {
        return Fail("unknown command");
    }
    printf("{\"ok\":%s}\n", ok ? "true" : "false");
    CoUninitialize();
    return ok ? 0 : 1;
}
