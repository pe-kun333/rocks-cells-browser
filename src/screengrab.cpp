// 窓全体と、その窓があるモニタ（C5）。
//   Windows SDK の C++/WinRT に CreateFreeThreaded があるときだけ Windows.Graphics.Capture を使う（ROCKSCELLS_HAS_WGC）。
//   使えない、項目を作れない、約 2.5 秒でフレームが来ない、例外のときは、画面の BitBlt に落ちる。
//   PrintWindow は使わない（WebView2 の中身が黒く抜けることがある）。
//   OS の黄色い枠は消さない。IsBorderRequired(false) は呼ばない（C6 でも消さない）。
//   中央の録画（C6）は、ここを繰り返し呼ばない。見えているページは DevTools、mp4 は record.cpp。
#include "screengrab.h"

#include <objbase.h>
#include <unknwn.h>
#include <wincodec.h>
#include <wrl/client.h>

#include <cstdint>
#include <cstring>
#include <vector>

#include "storage.h"

#ifdef ROCKSCELLS_HAS_WGC
#include <d3d11.h>
#include <dxgi.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <windows.graphics.capture.interop.h>
// IDirect3DDxgiInterfaceAccess は大域ではなく
// ::Windows::Graphics::DirectX::Direct3D11 にある（winrt:: ではない）
#include <windows.graphics.directx.direct3d11.interop.h>
#endif

using Microsoft::WRL::ComPtr;

namespace {

constexpr int kLongEdge = 1600;
constexpr size_t kMaxJpegBytes = 670000;  // Base64 にすると約 90 万字（面へ渡せる上限の内側）
constexpr int kFrameWaitMs = 2500;

int Longer(int a, int b) { return a > b ? a : b; }

bool WindowHidden(HWND hwnd) {
    if (!IsWindow(hwnd) || !IsWindowVisible(hwnd) || IsIconic(hwnd)) return true;
    RECT bounds{};
    if (!GetWindowRect(hwnd, &bounds)) return true;
    const int spanW = bounds.right - bounds.left;
    const int spanH = bounds.bottom - bounds.top;
    return spanW < 8 || spanH < 8;
}

void Downscale(std::vector<uint8_t>& pixels, int& width, int& height, int edge) {
    const int span = Longer(width, height);
    if (span <= edge || width < 1 || height < 1) return;
    int destW = width >= height ? edge : (width * edge) / height;
    int destH = height > width ? edge : (height * edge) / width;
    if (destW < 1) destW = 1;
    if (destH < 1) destH = 1;
    std::vector<uint8_t> next(static_cast<size_t>(destW) * static_cast<size_t>(destH) * 4);
    for (int y = 0; y < destH; ++y) {
        int srcY = (y * height) / destH;
        if (srcY >= height) srcY = height - 1;
        for (int x = 0; x < destW; ++x) {
            int srcX = (x * width) / destW;
            if (srcX >= width) srcX = width - 1;
            const size_t from = (static_cast<size_t>(srcY) * static_cast<size_t>(width) + static_cast<size_t>(srcX)) * 4;
            const size_t to = (static_cast<size_t>(y) * static_cast<size_t>(destW) + static_cast<size_t>(x)) * 4;
            next[to] = pixels[from];
            next[to + 1] = pixels[from + 1];
            next[to + 2] = pixels[from + 2];
            next[to + 3] = 255;
        }
    }
    pixels.swap(next);
    width = destW;
    height = destH;
}

bool EncodeBgr(const uint8_t* bgr, int width, int height, std::vector<BYTE>& jpeg) {
    ComPtr<IWICImagingFactory> factory;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)))) return false;
    ComPtr<IStream> stream;
    if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream))) return false;
    ComPtr<IWICBitmapEncoder> encoder;
    if (FAILED(factory->CreateEncoder(GUID_ContainerFormatJpeg, nullptr, &encoder))) return false;
    if (FAILED(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache))) return false;
    ComPtr<IPropertyBag2> bag;
    ComPtr<IWICBitmapFrameEncode> frame;
    if (FAILED(encoder->CreateNewFrame(&frame, &bag))) return false;
    if (bag) {
        wchar_t name[] = L"ImageQuality";
        PROPBAG2 option{};
        option.pstrName = name;
        VARIANT quality;
        std::memset(&quality, 0, sizeof(quality));
        quality.vt = VT_R4;
        quality.fltVal = 0.85f;
        bag->Write(1, &option, &quality);
    }
    if (FAILED(frame->Initialize(bag.Get()))) return false;
    if (FAILED(frame->SetSize(static_cast<UINT>(width), static_cast<UINT>(height)))) return false;
    WICPixelFormatGUID format = GUID_WICPixelFormat24bppBGR;
    if (FAILED(frame->SetPixelFormat(&format)) || format != GUID_WICPixelFormat24bppBGR) return false;
    const UINT stride = static_cast<UINT>(width) * 3;
    const UINT bytes = stride * static_cast<UINT>(height);
    if (FAILED(frame->WritePixels(static_cast<UINT>(height), stride, bytes, const_cast<BYTE*>(bgr)))) return false;
    if (FAILED(frame->Commit()) || FAILED(encoder->Commit())) return false;
    STATSTG stat{};
    if (FAILED(stream->Stat(&stat, STATFLAG_NONAME)) || stat.cbSize.QuadPart <= 0 || stat.cbSize.QuadPart > 8 * 1024 * 1024) return false;
    HGLOBAL memory = nullptr;
    if (FAILED(GetHGlobalFromStream(stream.Get(), &memory))) return false;
    const auto* stored = static_cast<const BYTE*>(GlobalLock(memory));
    if (!stored) return false;
    jpeg.assign(stored, stored + static_cast<size_t>(stat.cbSize.QuadPart));
    GlobalUnlock(memory);
    return !jpeg.empty();
}

bool EncodeCapture(std::vector<uint8_t> pixels, int width, int height, std::vector<BYTE>& jpeg) {
    if (width < 1 || height < 1) return false;
    if (static_cast<size_t>(width) * static_cast<size_t>(height) * 4 != pixels.size()) return false;
    Downscale(pixels, width, height, kLongEdge);
    for (int attempt = 0; attempt < 5; ++attempt) {
        std::vector<uint8_t> bgr(static_cast<size_t>(width) * static_cast<size_t>(height) * 3);
        for (int y = 0; y < height; ++y) {
            const uint8_t* src = pixels.data() + static_cast<size_t>(y) * static_cast<size_t>(width) * 4;
            uint8_t* dst = bgr.data() + static_cast<size_t>(y) * static_cast<size_t>(width) * 3;
            for (int x = 0; x < width; ++x) {
                dst[x * 3] = src[x * 4];
                dst[x * 3 + 1] = src[x * 4 + 1];
                dst[x * 3 + 2] = src[x * 4 + 2];
            }
        }
        if (!EncodeBgr(bgr.data(), width, height, jpeg)) return false;
        if (jpeg.size() <= kMaxJpegBytes) return true;
        const int span = Longer(width, height);
        const int nextEdge = span / 2;
        if (nextEdge < 64) return true;  // これ以上縮めても、呼び出し側が tooBig にする
        Downscale(pixels, width, height, nextEdge);
    }
    return !jpeg.empty();
}

bool GrabWithBitBlt(HWND hwnd, bool desktop, std::vector<uint8_t>& pixels, int& width, int& height, const char*& reason) {
    RECT bounds{};
    if (desktop) {
        const HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        MONITORINFO info{};
        info.cbSize = sizeof(info);
        if (!monitor || !GetMonitorInfoW(monitor, &info)) {
            reason = "grab";
            return false;
        }
        bounds = info.rcMonitor;  // 右下は bounds.right と bounds.bottom（far という名前は使わない）
    } else if (!GetWindowRect(hwnd, &bounds)) {
        reason = "hidden";
        return false;
    }
    width = bounds.right - bounds.left;
    height = bounds.bottom - bounds.top;
    if (width < 8 || height < 8 || width > 8192 || height > 8192) {
        reason = desktop ? "grab" : "hidden";
        return false;
    }
    HDC screen = GetDC(nullptr);
    if (!screen) {
        reason = "grab";
        return false;
    }
    HDC memory = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, width, height);
    if (!memory || !bitmap) {
        if (bitmap) DeleteObject(bitmap);
        if (memory) DeleteDC(memory);
        ReleaseDC(nullptr, screen);
        reason = "grab";
        return false;
    }
    HGDIOBJ previous = SelectObject(memory, bitmap);
    const BOOL copied = BitBlt(memory, 0, 0, width, height, screen, bounds.left, bounds.top, SRCCOPY | CAPTUREBLT);
    const size_t stride = static_cast<size_t>(width) * 4;
    std::vector<uint8_t> raw(stride * static_cast<size_t>(height));
    BITMAPINFO header{};
    header.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    header.bmiHeader.biWidth = width;
    header.bmiHeader.biHeight = height;  // 正：下の行から。受け取ってから上から順に並べ直す
    header.bmiHeader.biPlanes = 1;
    header.bmiHeader.biBitCount = 32;
    header.bmiHeader.biCompression = BI_RGB;
    const int rows = GetDIBits(memory, bitmap, 0, static_cast<UINT>(height), raw.data(), &header, DIB_RGB_COLORS);
    SelectObject(memory, previous);
    DeleteObject(bitmap);
    DeleteDC(memory);
    ReleaseDC(nullptr, screen);
    if (!copied || rows == 0) {
        reason = "grab";
        return false;
    }
    pixels.resize(raw.size());
    for (int y = 0; y < height; ++y) {
        std::memcpy(pixels.data() + static_cast<size_t>(y) * stride, raw.data() + static_cast<size_t>(height - 1 - y) * stride, stride);
    }
    return true;
}

#ifdef ROCKSCELLS_HAS_WGC

void EnsureApartment() {
    static const bool once = [] {
        try {
            // このスレッドはすでに STA（main.cpp の CoInitializeEx）。同じ種類の初期化は足すだけで、解除はしない
            // （解除すると、WebView2 が使っている STA まで閉じてしまうことがある）
            winrt::init_apartment(winrt::apartment_type::single_threaded);
        } catch (winrt::hresult_error const&) {
        }
        return true;
    }();
    (void)once;
}

struct WgcSession {
    winrt::Windows::Graphics::Capture::GraphicsCaptureSession session{ nullptr };
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool pool{ nullptr };
    winrt::event_token token{};
    bool listening = false;
    HANDLE event = nullptr;

    WgcSession() { event = CreateEventW(nullptr, FALSE, FALSE, nullptr); }
    ~WgcSession() {
        if (listening && pool) {
            try {
                pool.FrameArrived(token);
            } catch (...) {
            }
        }
        try {
            if (session) session.Close();
        } catch (...) {
        }
        try {
            if (pool) pool.Close();
        } catch (...) {
        }
        if (event) CloseHandle(event);
    }
};

bool ReadTexture(ID3D11Device* device, ID3D11DeviceContext* context, ID3D11Texture2D* source, std::vector<uint8_t>& pixels, int& width, int& height) {
    D3D11_TEXTURE2D_DESC desc{};
    source->GetDesc(&desc);
    if (desc.Width < 8 || desc.Height < 8 || desc.Width > 8192 || desc.Height > 8192) return false;
    D3D11_TEXTURE2D_DESC staging = desc;
    staging.Usage = D3D11_USAGE_STAGING;
    staging.BindFlags = 0;
    staging.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    staging.MiscFlags = 0;
    staging.MipLevels = 1;
    staging.ArraySize = 1;
    staging.SampleDesc.Count = 1;
    staging.SampleDesc.Quality = 0;
    ComPtr<ID3D11Texture2D> copy;
    if (FAILED(device->CreateTexture2D(&staging, nullptr, copy.GetAddressOf()))) return false;
    context->CopyResource(copy.Get(), source);
    D3D11_MAPPED_SUBRESOURCE mapped{};
    if (FAILED(context->Map(copy.Get(), 0, D3D11_MAP_READ, 0, &mapped))) return false;
    width = static_cast<int>(desc.Width);
    height = static_cast<int>(desc.Height);
    const int rowBytes = width * 4;
    if (mapped.RowPitch < static_cast<UINT>(rowBytes) || !mapped.pData) {
        context->Unmap(copy.Get(), 0);
        return false;
    }
    pixels.resize(static_cast<size_t>(rowBytes) * static_cast<size_t>(height));
    const auto* rows = static_cast<const uint8_t*>(mapped.pData);
    for (int y = 0; y < height; ++y) {
        std::memcpy(pixels.data() + static_cast<size_t>(y) * static_cast<size_t>(rowBytes), rows + static_cast<size_t>(y) * mapped.RowPitch, static_cast<size_t>(rowBytes));
    }
    context->Unmap(copy.Get(), 0);
    return true;
}

bool MakeDevice(ComPtr<ID3D11Device>& device, ComPtr<ID3D11DeviceContext>& context) {
    // 機能レベルの配列は渡さない（SDK が古いと 11_1 の定数が無いことがある。選べる範囲はドライバに任せる）
    D3D_FEATURE_LEVEL chosen = D3D_FEATURE_LEVEL_11_0;
    HRESULT created = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION, device.GetAddressOf(), &chosen, context.GetAddressOf());
    if (FAILED(created)) {
        device.Reset();
        context.Reset();
        created = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION, device.GetAddressOf(), &chosen, context.GetAddressOf());
    }
    return SUCCEEDED(created);
}

bool GrabWithGraphicsCapture(HWND hwnd, bool desktop, ScreenGrab& result) {
    try {
        EnsureApartment();
        if (!winrt::Windows::Graphics::Capture::GraphicsCaptureSession::IsSupported()) return false;
        auto factory = winrt::get_activation_factory<winrt::Windows::Graphics::Capture::GraphicsCaptureItem>();
        // IGraphicsCaptureItemInterop は capture.interop.h の大域。winrt:: には置かない
        ComPtr<::IGraphicsCaptureItemInterop> interop;
        auto* factoryUnknown = static_cast<::IUnknown*>(winrt::get_abi(factory));
        if (!factoryUnknown || FAILED(factoryUnknown->QueryInterface(IID_PPV_ARGS(interop.GetAddressOf())))) return false;
        winrt::Windows::Graphics::Capture::GraphicsCaptureItem item{ nullptr };
        if (desktop) {
            const HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            if (!monitor) return false;
            winrt::check_hresult(interop->CreateForMonitor(monitor, winrt::guid_of<winrt::Windows::Graphics::Capture::GraphicsCaptureItem>(), winrt::put_abi(item)));
        } else {
            winrt::check_hresult(interop->CreateForWindow(hwnd, winrt::guid_of<winrt::Windows::Graphics::Capture::GraphicsCaptureItem>(), winrt::put_abi(item)));
        }
        if (!item) return false;
        const auto itemSize = item.Size();
        if (itemSize.Width < 8 || itemSize.Height < 8) return false;

        ComPtr<ID3D11Device> device;
        ComPtr<ID3D11DeviceContext> context;
        if (!MakeDevice(device, context)) return false;
        ComPtr<IDXGIDevice> dxgi;
        if (FAILED(device.As(&dxgi))) return false;
        winrt::com_ptr<::IInspectable> inspectable;
        winrt::check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.Get(), inspectable.put()));
        auto deviceWinrt = inspectable.as<winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice>();

        WgcSession live;
        if (!live.event) return false;
        live.pool = winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool::CreateFreeThreaded(
            deviceWinrt, winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized, 1, itemSize);
        live.session = live.pool.CreateCaptureSession(item);
        // 黄色い枠は消さない。IsBorderRequired(false) は呼ばない。
        const HANDLE notify = live.event;
        live.token = live.pool.FrameArrived([notify](winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const&, winrt::Windows::Foundation::IInspectable const&) {
            if (notify) SetEvent(notify);
        });
        live.listening = true;
        live.session.StartCapture();
        if (WaitForSingleObject(live.event, kFrameWaitMs) != WAIT_OBJECT_0) return false;
        auto frame = live.pool.TryGetNextFrame();
        if (!frame) return false;
        auto surface = frame.Surface();
        // interop ヘッダの COM。winrt::Windows::... の投影とは別の名前空間
        auto access = surface.as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
        ID3D11Texture2D* texture = nullptr;
        const HRESULT got = access->GetInterface(IID_PPV_ARGS(&texture));
        std::vector<uint8_t> pixels;
        int width = 0;
        int height = 0;
        const bool read = SUCCEEDED(got) && texture && ReadTexture(device.Get(), context.Get(), texture, pixels, width, height);
        if (texture) texture->Release();
        frame.Close();
        if (!read || !EncodeCapture(std::move(pixels), width, height, result.jpeg)) return false;
        result.graphicsCapture = true;
        result.error = nullptr;
        return true;
    } catch (winrt::hresult_error const&) {
        return false;
    } catch (...) {
        return false;
    }
}

#endif  // ROCKSCELLS_HAS_WGC

}  // namespace

ScreenGrab GrabBrowser(HWND hwnd, bool desktop) {
    ScreenGrab result;
    if (!desktop && WindowHidden(hwnd)) {
        result.error = "hidden";
        return result;
    }
#ifdef ROCKSCELLS_HAS_WGC
    if (GrabWithGraphicsCapture(hwnd, desktop, result)) {
        if (result.jpeg.size() > kMaxJpegBytes) {
            result.jpeg.clear();
            result.graphicsCapture = false;
            result.error = "tooBig";
        }
        return result;
    }
    result.jpeg.clear();
    result.graphicsCapture = false;
    result.error = nullptr;
#endif
    std::vector<uint8_t> pixels;
    int width = 0;
    int height = 0;
    const char* reason = nullptr;
    if (!GrabWithBitBlt(hwnd, desktop, pixels, width, height, reason) || !EncodeCapture(std::move(pixels), width, height, result.jpeg)) {
        result.error = reason ? reason : "grab";
        result.jpeg.clear();
        return result;
    }
    if (result.jpeg.size() > kMaxJpegBytes) {
        result.jpeg.clear();
        result.error = "tooBig";
        return result;
    }
    return result;
}
