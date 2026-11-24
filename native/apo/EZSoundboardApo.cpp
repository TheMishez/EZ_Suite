// EZSoundboardApo.dll - an Audio Processing Object (APO) that Windows loads into a microphone's
// audio pipeline (inside audiodg.exe). It passes your real voice through untouched and adds
// the sound mix that EZ Soundboard writes into shared memory. Every app recording the mic
// (CS2, Discord, OBS...) therefore hears your voice + the sounds, with no virtual cable.
//
// Realtime rules: APOProcess never allocates, locks, or does I/O.

#include <windows.h>
#include <unknwn.h>
#include <audioenginebaseapo.h>
#include <audiomediatype.h>
#include <new>
#include "../common/shared.h"

#ifndef APOERR_FORMAT_NOT_SUPPORTED
#define APOERR_FORMAT_NOT_SUPPORTED ((HRESULT)0x887D0003L)
#endif
#ifndef APOERR_APO_LOCKED
#define APOERR_APO_LOCKED ((HRESULT)0x887D0005L)
#endif

// KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
static const GUID MP_SUBTYPE_FLOAT = { 0x00000003, 0x0000, 0x0010, { 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71 } };

static void DebugGuid(const wchar_t* what, REFGUID g, long long v = 0) {
    wchar_t gs[64];
    StringFromGUID2(g, gs, 64);
    wchar_t m[200];
    swprintf_s(m, 200, L"%s %s ->", what, gs);
    mpDebug(L"apo", m, v);
}

static volatile LONG g_objects = 0;
static volatile LONG g_locks = 0;

static bool IsFloatFormat(IAudioMediaType* t, UNCOMPRESSEDAUDIOFORMAT* out) {
    if (!t) return false;
    UNCOMPRESSEDAUDIOFORMAT u = {};
    if (FAILED(t->GetUncompressedAudioFormat(&u))) return false;
    if (out) *out = u;
    return IsEqualGUID(u.guidFormatType, MP_SUBTYPE_FLOAT) && u.dwBytesPerSampleContainer == 4 && u.dwSamplesPerFrame > 0;
}

static HRESULT CheckFormat(IAudioMediaType* opposite, IAudioMediaType* requested, IAudioMediaType** supported) {
    if (!requested || !supported) return E_POINTER;
    *supported = nullptr;
    UNCOMPRESSEDAUDIOFORMAT r = {};
    if (!IsFloatFormat(requested, &r)) return APOERR_FORMAT_NOT_SUPPORTED;
    if (opposite) {
        UNCOMPRESSEDAUDIOFORMAT o = {};
        if (IsFloatFormat(opposite, &o) &&
            (o.dwSamplesPerFrame != r.dwSamplesPerFrame || o.fFramesPerSecond != r.fFramesPerSecond)) {
            // We don't convert formats: input and output must be identical.
            opposite->AddRef();
            *supported = opposite;
            return S_FALSE;
        }
    }
    requested->AddRef();
    *supported = requested;
    return S_OK;
}

class EZSoundboardApo final :
    public IAudioProcessingObject,
    public IAudioProcessingObjectRT,
    public IAudioProcessingObjectConfiguration,
    public IAudioSystemEffects2 {
public:
    // The audio engine creates APOs *aggregated* (it passes an outer IUnknown), exactly like
    // Microsoft's SwapAPO sample. So we implement the standard COM aggregation pattern:
    // a private "inner" IUnknown owns the reference count, and the IUnknown methods on our
    // public interfaces delegate to the outer object (or to the inner one when not aggregated).
    explicit EZSoundboardApo(IUnknown* outer) {
        InterlockedIncrement(&g_objects);
        m_inner.self = this;
        m_outer = outer ? outer : static_cast<IUnknown*>(&m_inner);
        mpDebug(L"apo", outer ? L"object created (aggregated)" : L"object created", 0);
    }
    ~EZSoundboardApo() { CloseShared(); InterlockedDecrement(&g_objects); }

    struct Inner : public IUnknown {
        EZSoundboardApo* self = nullptr;
        STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override { return self->NDQueryInterface(riid, ppv); }
        STDMETHODIMP_(ULONG) AddRef() override { return (ULONG)InterlockedIncrement(&self->m_ref); }
        STDMETHODIMP_(ULONG) Release() override {
            LONG r = InterlockedDecrement(&self->m_ref);
            if (r == 0) delete self;
            return (ULONG)r;
        }
    };
    Inner m_inner;
    IUnknown* m_outer = nullptr;

    HRESULT NDQueryInterface(REFIID riid, void** ppv) {
        if (!ppv) return E_POINTER;
        *ppv = nullptr;
        if (riid == __uuidof(IUnknown)) {
            *ppv = static_cast<IUnknown*>(&m_inner);
            m_inner.AddRef();
            return S_OK;
        }
        if (riid == __uuidof(IAudioProcessingObject))
            *ppv = static_cast<IAudioProcessingObject*>(this);
        else if (riid == __uuidof(IAudioProcessingObjectRT))
            *ppv = static_cast<IAudioProcessingObjectRT*>(this);
        else if (riid == __uuidof(IAudioProcessingObjectConfiguration))
            *ppv = static_cast<IAudioProcessingObjectConfiguration*>(this);
        else if (riid == __uuidof(IAudioSystemEffects) || riid == __uuidof(IAudioSystemEffects2))
            *ppv = static_cast<IAudioSystemEffects2*>(this);
        else {
            wchar_t g[64];
            StringFromGUID2(riid, g, 64);
            wchar_t m[128];
            swprintf_s(m, 128, L"QueryInterface not supported: %s", g);
            mpDebug(L"apo", m, 0);
            return E_NOINTERFACE;
        }
        static_cast<IUnknown*>(*ppv)->AddRef(); // delegates to the outer object
        return S_OK;
    }

    // ---------- IUnknown (delegating) ----------
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override { return m_outer->QueryInterface(riid, ppv); }
    STDMETHODIMP_(ULONG) AddRef() override { return m_outer->AddRef(); }
    STDMETHODIMP_(ULONG) Release() override { return m_outer->Release(); }

    // ---------- IAudioProcessingObject ----------
    STDMETHODIMP Reset() override { m_synced = false; return S_OK; }
    STDMETHODIMP GetLatency(HNSTIME* pTime) override {
        if (!pTime) return E_POINTER;
        *pTime = 0;
        return S_OK;
    }
    STDMETHODIMP GetRegistrationProperties(APO_REG_PROPERTIES** ppRegProps) override {
        mpDebug(L"apo", L"GetRegistrationProperties called", 0);
        if (!ppRegProps) return E_POINTER;
        auto* p = static_cast<APO_REG_PROPERTIES*>(CoTaskMemAlloc(sizeof(APO_REG_PROPERTIES)));
        if (!p) return E_OUTOFMEMORY;
        ZeroMemory(p, sizeof(*p));
        p->clsid = CLSID_EZSoundboardApo;
        p->Flags = APO_FLAG_DEFAULT;
        wcscpy_s(p->szFriendlyName, L"EZ Soundboard Mic Mixer");
        wcscpy_s(p->szCopyrightInfo, L"Copyright (c) EZGGco");
        p->u32MajorVersion = 1;
        p->u32MinorVersion = 0;
        p->u32MinInputConnections = 1;
        p->u32MaxInputConnections = 1;
        p->u32MinOutputConnections = 1;
        p->u32MaxOutputConnections = 1;
        p->u32MaxInstances = 0xFFFFFFFF;
        p->u32NumAPOInterfaces = 1;
        p->iidAPOInterfaceList[0] = __uuidof(IAudioProcessingObject);
        *ppRegProps = p;
        return S_OK;
    }
    STDMETHODIMP Initialize(UINT32 cb, BYTE* data) override {
        if (data && cb >= sizeof(APOInitSystemEffects2)) {
            auto* init = reinterpret_cast<APOInitSystemEffects2*>(data);
            DebugGuid(L"init: processing mode", init->AudioProcessingMode, 0);
            mpDebug(L"apo", L"init: discovery only =", (long long)init->InitializeForDiscoveryOnly);
        }
        OpenShared();
        if (m_sh) InterlockedExchange64(&m_sh->apoLoadTick, (LONG64)GetTickCount64());
        mpLog(L"apo", m_sh ? L"initialized, shared buffer ok, init bytes" : L"initialized WITHOUT shared buffer, init bytes", (long long)cb);
        return S_OK;
    }
    STDMETHODIMP IsInputFormatSupported(IAudioMediaType* opp, IAudioMediaType* req, IAudioMediaType** sup) override {
        HRESULT hr = CheckFormat(opp, req, sup);
        mpDebug(L"apo", L"IsInputFormatSupported ->", (long long)(unsigned long)hr);
        return hr;
    }
    STDMETHODIMP IsOutputFormatSupported(IAudioMediaType* opp, IAudioMediaType* req, IAudioMediaType** sup) override {
        HRESULT hr = CheckFormat(opp, req, sup);
        mpDebug(L"apo", L"IsOutputFormatSupported ->", (long long)(unsigned long)hr);
        return hr;
    }
    STDMETHODIMP GetInputChannelCount(UINT32* pu32ChannelCount) override {
        if (!pu32ChannelCount) return E_POINTER;
        *pu32ChannelCount = m_channels;
        return S_OK;
    }

    // ---------- IAudioProcessingObjectConfiguration ----------
    STDMETHODIMP LockForProcess(UINT32 nIn, APO_CONNECTION_DESCRIPTOR** ppIn,
                                UINT32 nOut, APO_CONNECTION_DESCRIPTOR** ppOut) override {
        HRESULT hr = DoLock(nIn, ppIn, nOut, ppOut);
        if (m_sh) {
            InterlockedExchange(&m_sh->apoLastHr, (LONG)hr);
            if (SUCCEEDED(hr)) InterlockedIncrement(&m_sh->apoLocks);
        }
        mpLog(L"apo", SUCCEEDED(hr) ? L"locked for processing, rate" : L"LOCK FAILED, hr", SUCCEEDED(hr) ? (long long)m_rate : (long long)(unsigned long)hr);
        if (SUCCEEDED(hr)) mpLog(L"apo", L"channels", (long long)m_channels);
        return hr;
    }
    HRESULT DoLock(UINT32 nIn, APO_CONNECTION_DESCRIPTOR** ppIn, UINT32 nOut, APO_CONNECTION_DESCRIPTOR** ppOut) {
        if (m_locked) return APOERR_APO_LOCKED;
        if (nIn < 1 || nOut < 1 || !ppIn || !ppIn[0] || !ppIn[0]->pFormat || !ppOut || !ppOut[0]) return E_INVALIDARG;
        UNCOMPRESSEDAUDIOFORMAT fmt = {};
        if (!IsFloatFormat(ppIn[0]->pFormat, &fmt)) return APOERR_FORMAT_NOT_SUPPORTED;
        m_channels = fmt.dwSamplesPerFrame;
        m_rate = fmt.fFramesPerSecond > 0 ? fmt.fFramesPerSecond : 48000.0f;
        m_synced = false;
        m_voice = 1.0f;
        OpenShared();
        if (m_sh && !m_counted) {
            InterlockedExchange(&m_sh->apoRate, (LONG)m_rate);
            InterlockedExchange(&m_sh->apoChannels, (LONG)m_channels);
            InterlockedIncrement(&m_sh->apoInstances);
            m_counted = true;
        }
        m_locked = true;
        return S_OK;
    }
    STDMETHODIMP UnlockForProcess() override {
        if (!m_locked) return S_OK;
        m_locked = false;
        if (m_sh && m_counted) InterlockedDecrement(&m_sh->apoInstances);
        m_counted = false;
        return S_OK;
    }

    // ---------- IAudioProcessingObjectRT ----------
    STDMETHODIMP_(void) APOProcess(UINT32 nIn, APO_CONNECTION_PROPERTY** ppIn,
                                   UINT32 nOut, APO_CONNECTION_PROPERTY** ppOut) override {
        if (nIn < 1 || nOut < 1 || !ppIn[0] || !ppOut[0]) return;
        if (!m_loggedProcess) { m_loggedProcess = true; mpDebug(L"apo", L"FIRST AUDIO PROCESSED, frames", (long long)ppIn[0]->u32ValidFrameCount); }
        APO_CONNECTION_PROPERTY* in = ppIn[0];
        APO_CONNECTION_PROPERTY* out = ppOut[0];
        const UINT32 frames = in->u32ValidFrameCount;
        const UINT32 ch = m_channels;
        const float* src = reinterpret_cast<const float*>(in->pBuffer);
        float* dst = reinterpret_cast<float*>(out->pBuffer);
        const size_t total = (size_t)frames * ch;
        const bool silentIn = (in->u32BufferFlags == BUFFER_SILENT);

        MPShared* s = m_sh;
        const ULONGLONG now = GetTickCount64();
        bool writerAlive = false;
        LONG64 W = 0;
        if (s && s->magic == MP_MAGIC) {
            InterlockedExchange64(&s->apoTick, (LONG64)now);
            W = mpLoad64(&s->writePos);
            const LONG64 wt = mpLoad64(&s->writerTick);
            writerAlive = wt != 0 && now >= (ULONGLONG)wt && now - (ULONGLONG)wt < 400;
        }

        // 1) your real voice (gain only applies while EZ Soundboard is running)
        float target = 1.0f;
        if (writerAlive) {
            target = mpBitsToFloat(s->voiceGainBits);
            if (!(target >= 0.0f && target <= 4.0f)) target = 1.0f;
        }
        if (silentIn || !src) {
            ZeroMemory(dst, total * sizeof(float));
        } else if (m_voice == 1.0f && target == 1.0f) {
            if (dst != src) CopyMemory(dst, src, total * sizeof(float));
        } else {
            const float g0 = m_voice;
            const float dg = frames ? (target - g0) / (float)frames : 0.0f;
            for (UINT32 f = 0; f < frames; ++f) {
                const float g = g0 + dg * (float)(f + 1);
                for (UINT32 c = 0; c < ch; ++c) dst[(size_t)f * ch + c] = src[(size_t)f * ch + c] * g;
            }
        }
        m_voice = target;

        // 2) add the sound mix from EZ Soundboard
        bool added = false;
        if (writerAlive) {
            const double targetLat = MP_RATE * 0.05;  // 50 ms cushion against IPC jitter
            double lat = (double)W - m_readPos;
            if (!m_synced || lat < 0.0 || lat > MP_RATE * 0.35) {
                m_readPos = (double)W - targetLat;
                if (m_readPos < 0.0) m_readPos = 0.0;
                m_synced = true;
                lat = (double)W - m_readPos;
            }
            // Tiny, inaudible speed correction keeps the two clocks locked together.
            double err = (lat - targetLat) / targetLat;
            if (err > 1.0) err = 1.0;
            if (err < -1.0) err = -1.0;
            const double step = ((double)MP_RATE / (double)m_rate) * (1.0 + err * 0.002);

            for (UINT32 f = 0; f < frames; ++f) {
                if (m_readPos + 1.0 >= (double)W) break; // underrun: wait for more audio
                const LONG64 i = (LONG64)m_readPos;
                const float fr = (float)(m_readPos - (double)i);
                const size_t a = (size_t)(i % MP_RING_FRAMES);
                const size_t b = (size_t)((i + 1) % MP_RING_FRAMES);
                const float L = s->ring[a * 2] * (1.0f - fr) + s->ring[b * 2] * fr;
                const float R = s->ring[a * 2 + 1] * (1.0f - fr) + s->ring[b * 2 + 1] * fr;
                float* o = dst + (size_t)f * ch;
                if (ch == 2) {
                    o[0] += L;
                    o[1] += R;
                } else {
                    const float m = (L + R) * 0.5f;
                    for (UINT32 c = 0; c < ch; ++c) o[c] += m;
                }
                m_readPos += step;
                added = true;
            }
        } else {
            m_synced = false;
        }

        out->u32ValidFrameCount = frames;
        out->u32BufferFlags = (silentIn && !added) ? BUFFER_SILENT : BUFFER_VALID;
    }
    STDMETHODIMP_(UINT32) CalcInputFrames(UINT32 u32OutputFrameCount) override { return u32OutputFrameCount; }
    STDMETHODIMP_(UINT32) CalcOutputFrames(UINT32 u32InputFrameCount) override { return u32InputFrameCount; }

    // ---------- IAudioSystemEffects2 ----------
    STDMETHODIMP GetEffectsList(LPGUID* ppEffectsIds, UINT* pcEffects, HANDLE) override {
        mpDebug(L"apo", L"GetEffectsList called", 0);
        if (!ppEffectsIds || !pcEffects) return E_POINTER;
        *ppEffectsIds = nullptr;
        *pcEffects = 0;
        return S_OK;
    }

private:
    void OpenShared() {
        if (m_sh) return;
        DWORD err = 0;
        m_sh = mpOpenShared(&m_file, &m_map, &err);
        if (!m_sh && !m_loggedFail) {
            mpLog(L"apo", L"could not open shared buffer, error", (long long)err);
            m_loggedFail = true;
        }
    }
    void CloseShared() {
        if (m_sh && m_counted) InterlockedDecrement(&m_sh->apoInstances);
        m_counted = false;
        mpCloseShared(m_sh, m_file, m_map);
        m_sh = nullptr;
        m_file = nullptr;
        m_map = nullptr;
    }

    volatile LONG m_ref = 1;
    bool m_locked = false;
    bool m_counted = false;
    UINT32 m_channels = 2;
    float m_rate = 48000.0f;
    HANDLE m_map = nullptr;
    HANDLE m_file = nullptr;
    bool m_loggedFail = false;
    bool m_loggedProcess = false;
    MPShared* m_sh = nullptr;
    double m_readPos = 0.0;
    bool m_synced = false;
    float m_voice = 1.0f;
};

// ---------------- class factory / DLL exports ----------------
class Factory final : public IClassFactory {
public:
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == __uuidof(IUnknown) || riid == __uuidof(IClassFactory)) {
            *ppv = static_cast<IClassFactory*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        DebugGuid(L"factory QI not supported", riid, (long long)(unsigned long)E_NOINTERFACE);
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() override { return 2; }   // static object
    STDMETHODIMP_(ULONG) Release() override { return 1; }
    STDMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        *ppv = nullptr;
        DebugGuid(outer ? L"CreateInstance (aggregated) for" : L"CreateInstance for", riid, 0);
        if (outer && riid != __uuidof(IUnknown)) return CLASS_E_NOAGGREGATION;
        auto* apo = new (std::nothrow) EZSoundboardApo(outer);
        if (!apo) return E_OUTOFMEMORY;
        HRESULT hr = apo->NDQueryInterface(riid, ppv);
        apo->m_inner.Release(); // drop the creation reference
        mpDebug(L"apo", L"CreateInstance result", (long long)(unsigned long)hr);
        return hr;
    }
    STDMETHODIMP LockServer(BOOL lock) override {
        if (lock) InterlockedIncrement(&g_locks);
        else InterlockedDecrement(&g_locks);
        return S_OK;
    }
};
static Factory g_factory;

STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, LPVOID* ppv) {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    DebugGuid(L"DllGetClassObject clsid", rclsid, 0);
    DebugGuid(L"DllGetClassObject iid", riid, 0);
    if (!IsEqualCLSID(rclsid, CLSID_EZSoundboardApo)) {
        mpDebug(L"apo", L"wrong CLSID, refusing", 0);
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    HRESULT hr = g_factory.QueryInterface(riid, ppv);
    mpDebug(L"apo", L"DllGetClassObject result", (long long)(unsigned long)hr);
    return hr;
}

STDAPI DllCanUnloadNow() {
    return (g_objects == 0 && g_locks == 0) ? S_OK : S_FALSE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        mpDebug(L"apo", L"DLL loaded", 0);
    }
    return TRUE;
}
