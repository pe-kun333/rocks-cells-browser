// 中央のページの mp4（C6）。
//   画素はブラウザが DevTools の Page.captureScreenshot で取る（窓全体の Windows.Graphics.Capture ではない）。
//   ここでは JPEG を BGRA にし、NV12 にして IMFSinkWriter で H.264 の mp4 にする。音声は入れない。
//   IDirect3DDxgiInterfaceAccess はこのファイルでは使わない。C5 の画面キャプチャとは別である。
//   使うときは ::Windows::Graphics::DirectX::Direct3D11 であり、winrt:: でも大域でもない（screengrab.cpp）。
//   ヘッダが無いときは ROCKSCELLS_HAS_RECORD を定義せず、下の空実装だけをコンパイルする。
#include "record.h"

#include <cstddef>

#ifndef ROCKSCELLS_HAS_RECORD

namespace record {

bool Available() { return false; }

struct Writer::Impl {};

Writer::Writer() = default;
Writer::~Writer() { delete impl_; }
bool Writer::Begin(const std::filesystem::path&) { return false; }
WriteResult Writer::WriteBgra(const std::uint8_t*, int, int, int, int) { return WriteResult::Failed; }
bool Writer::Poster(std::vector<std::uint8_t>&) const { return false; }
bool Writer::Finalize(std::uint64_t&) { return false; }
void Writer::Abort() {}
int Writer::frames() const { return 0; }
std::uint64_t Writer::estimatedBytes() const { return 0; }
bool DecodeJpeg(const std::uint8_t*, std::size_t, std::vector<std::uint8_t>&, int&, int&) { return false; }

}  // namespace record

#else

#include <objbase.h>
#include <wincodec.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <wrl/client.h>

#include <cstring>

using Microsoft::WRL::ComPtr;

namespace record {
namespace {

constexpr int kBytesPerFrame = kBitrate / 8 / kFps;  // 見積もり。ファイルが確定する前に 80MB で止める
constexpr std::size_t kMaxJpegBytes = 670000;

int Longer(int a, int b) { return a > b ? a : b; }

std::uint8_t ByteOf(int value) {
    if (value < 0) return 0;
    if (value > 255) return 255;
    return static_cast<std::uint8_t>(value);
}

void ScaleBgra(const std::uint8_t* src, int srcW, int srcH, int srcStride, std::vector<std::uint8_t>& dest, int destW, int destH) {
    dest.assign(static_cast<std::size_t>(destW) * static_cast<std::size_t>(destH) * 4, 0);
    if (srcW < 1 || srcH < 1 || destW < 1 || destH < 1) return;
    for (int y = 0; y < destH; ++y) {
        int srcY = (y * srcH) / destH;
        if (srcY >= srcH) srcY = srcH - 1;
        const std::uint8_t* row = src + static_cast<std::size_t>(srcY) * static_cast<std::size_t>(srcStride);
        std::uint8_t* out = dest.data() + (static_cast<std::size_t>(y) * static_cast<std::size_t>(destW) * 4);
        for (int x = 0; x < destW; ++x) {
            int srcX = (x * srcW) / destW;
            if (srcX >= srcW) srcX = srcW - 1;
            const std::uint8_t* px = row + static_cast<std::size_t>(srcX) * 4;
            out[static_cast<std::size_t>(x) * 4] = px[0];
            out[static_cast<std::size_t>(x) * 4 + 1] = px[1];
            out[static_cast<std::size_t>(x) * 4 + 2] = px[2];
            out[static_cast<std::size_t>(x) * 4 + 3] = 255;
        }
    }
}

// 長い辺を edge 以下にし、横も縦も偶数にする（NV12 と H.264）。2 未満にはしない。
bool FitEven(const std::uint8_t* src, int srcW, int srcH, int srcStride, std::vector<std::uint8_t>& dest, int& destW, int& destH, int edge) {
    if (!src || srcW < 2 || srcH < 2 || srcStride < srcW * 4 || edge < 2) return false;
    int fitW = srcW;
    int fitH = srcH;
    const int span = Longer(srcW, srcH);
    if (span > edge) {
        if (srcW >= srcH) {
            fitW = edge;
            fitH = (srcH * edge) / srcW;
        } else {
            fitH = edge;
            fitW = (srcW * edge) / srcH;
        }
    }
    if (fitW % 2) --fitW;
    if (fitH % 2) --fitH;
    if (fitW < 2 || fitH < 2) return false;
    ScaleBgra(src, srcW, srcH, srcStride, dest, fitW, fitH);
    destW = fitW;
    destH = fitH;
    return dest.size() == static_cast<std::size_t>(fitW) * static_cast<std::size_t>(fitH) * 4;
}

void BgraToNv12(const std::uint8_t* bgra, int width, int height, std::uint8_t* nv12) {
    std::uint8_t* yPlane = nv12;
    std::uint8_t* uvPlane = nv12 + static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
    for (int y = 0; y < height; y += 2) {
        for (int x = 0; x < width; x += 2) {
            int uSum = 0;
            int vSum = 0;
            for (int dy = 0; dy < 2; ++dy) {
                for (int dx = 0; dx < 2; ++dx) {
                    const std::uint8_t* px = bgra + (static_cast<std::size_t>(y + dy) * static_cast<std::size_t>(width) + static_cast<std::size_t>(x + dx)) * 4;
                    const int b = px[0];
                    const int g = px[1];
                    const int r = px[2];
                    const int luma = (77 * r + 150 * g + 29 * b) >> 8;
                    const int chromaU = ((-43 * r - 85 * g + 128 * b) >> 8) + 128;
                    const int chromaV = ((128 * r - 107 * g - 21 * b) >> 8) + 128;
                    yPlane[static_cast<std::size_t>(y + dy) * static_cast<std::size_t>(width) + static_cast<std::size_t>(x + dx)] = ByteOf(luma);
                    uSum += chromaU;
                    vSum += chromaV;
                }
            }
            const std::size_t uv = static_cast<std::size_t>(y / 2) * static_cast<std::size_t>(width) + static_cast<std::size_t>(x);
            uvPlane[uv] = ByteOf(uSum / 4);
            uvPlane[uv + 1] = ByteOf(vSum / 4);
        }
    }
}

bool EncodeBgr(const std::uint8_t* bgr, int width, int height, std::vector<std::uint8_t>& jpeg) {
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
    jpeg.assign(stored, stored + static_cast<std::size_t>(stat.cbSize.QuadPart));
    GlobalUnlock(memory);
    return !jpeg.empty();
}

bool EncodePoster(std::vector<std::uint8_t> pixels, int width, int height, std::vector<std::uint8_t>& jpeg) {
    if (width < 2 || height < 2) return false;
    for (int attempt = 0; attempt < 5; ++attempt) {
        std::vector<std::uint8_t> bgr(static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 3);
        for (int y = 0; y < height; ++y) {
            const std::uint8_t* src = pixels.data() + static_cast<std::size_t>(y) * static_cast<std::size_t>(width) * 4;
            std::uint8_t* dst = bgr.data() + static_cast<std::size_t>(y) * static_cast<std::size_t>(width) * 3;
            for (int x = 0; x < width; ++x) {
                dst[static_cast<std::size_t>(x) * 3] = src[static_cast<std::size_t>(x) * 4];
                dst[static_cast<std::size_t>(x) * 3 + 1] = src[static_cast<std::size_t>(x) * 4 + 1];
                dst[static_cast<std::size_t>(x) * 3 + 2] = src[static_cast<std::size_t>(x) * 4 + 2];
            }
        }
        if (!EncodeBgr(bgr.data(), width, height, jpeg)) return false;
        if (jpeg.size() <= kMaxJpegBytes) return true;
        const int span = Longer(width, height);
        const int nextEdge = span / 2;
        if (nextEdge < 64) return true;
        std::vector<std::uint8_t> smaller;
        int nextW = 0;
        int nextH = 0;
        if (!FitEven(pixels.data(), width, height, width * 4, smaller, nextW, nextH, nextEdge)) return !jpeg.empty();
        pixels.swap(smaller);
        width = nextW;
        height = nextH;
    }
    return !jpeg.empty();
}

bool OpenSink(const std::filesystem::path& path, int width, int height, ComPtr<IMFSinkWriter>& sink, DWORD& streamIndex) {
    std::error_code ec;
    std::filesystem::remove(path, ec);
    ComPtr<IMFAttributes> attrs;
    if (FAILED(MFCreateAttributes(&attrs, 2))) return false;
    // ハードウェア変換は DXGI の面を求めることがあり、メモリ上の NV12 を拒む。ソフトウェアの H.264 を使う。
    // GUID は mfreadwrite.h の MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS（ライブラリに実体が無い SDK でも通るように、値をここに書く）
    const GUID enableHardware = {0xa634a91c, 0x822b, 0x41b9, {0xa4, 0x94, 0x4d, 0xe4, 0x64, 0x36, 0x12, 0xb0}};
    if (FAILED(attrs->SetUINT32(enableHardware, FALSE))) return false;
    if (FAILED(MFCreateSinkWriterFromURL(path.c_str(), nullptr, attrs.Get(), &sink))) return false;

    ComPtr<IMFMediaType> outType;
    if (FAILED(MFCreateMediaType(&outType))) return false;
    outType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    outType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
    outType->SetUINT32(MF_MT_AVG_BITRATE, static_cast<UINT32>(kBitrate));
    outType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    if (FAILED(MFSetAttributeSize(outType.Get(), MF_MT_FRAME_SIZE, static_cast<UINT32>(width), static_cast<UINT32>(height)))) return false;
    if (FAILED(MFSetAttributeRatio(outType.Get(), MF_MT_FRAME_RATE, static_cast<UINT32>(kFps), 1))) return false;
    if (FAILED(MFSetAttributeRatio(outType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1))) return false;
    DWORD index = 0;
    if (FAILED(sink->AddStream(outType.Get(), &index))) return false;

    ComPtr<IMFMediaType> inType;
    if (FAILED(MFCreateMediaType(&inType))) return false;
    inType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    inType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
    inType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    if (FAILED(MFSetAttributeSize(inType.Get(), MF_MT_FRAME_SIZE, static_cast<UINT32>(width), static_cast<UINT32>(height)))) return false;
    if (FAILED(MFSetAttributeRatio(inType.Get(), MF_MT_FRAME_RATE, static_cast<UINT32>(kFps), 1))) return false;
    if (FAILED(MFSetAttributeRatio(inType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1))) return false;
    if (FAILED(sink->SetInputMediaType(index, inType.Get(), nullptr))) return false;
    if (FAILED(sink->BeginWriting())) return false;
    streamIndex = index;
    return true;
}

}  // namespace

bool Available() { return true; }

struct Writer::Impl {
    std::filesystem::path path;
    bool mf = false;
    bool kept = false;
    bool opened = false;
    int width = 0;
    int height = 0;
    int frames = 0;
    long long lastStamp = 0;
    std::vector<std::uint8_t> last;
    ComPtr<IMFSinkWriter> sink;
    DWORD streamIndex = 0;
};

Writer::Writer() = default;

Writer::~Writer() {
    Abort();
    delete impl_;
    impl_ = nullptr;
}

bool Writer::Begin(const std::filesystem::path& path) {
    if (path.empty()) return false;
    if (!impl_) impl_ = new Impl();
    if (impl_->mf || impl_->opened) return false;
    if (FAILED(MFStartup(MF_VERSION, MFSTARTUP_FULL))) return false;
    impl_->mf = true;
    impl_->path = path;
    impl_->kept = false;
    return true;
}

WriteResult Writer::WriteBgra(const std::uint8_t* pixels, int width, int height, int stride, int elapsedMs) {
    if (!impl_ || !impl_->mf || !pixels) return WriteResult::Failed;
    const std::uint64_t used = static_cast<std::uint64_t>(impl_->frames) * static_cast<std::uint64_t>(kBytesPerFrame);
    if (used + static_cast<std::uint64_t>(kBytesPerFrame) > kMaxBytes) return WriteResult::Full;

    std::vector<std::uint8_t> fitted;
    int fitW = 0;
    int fitH = 0;
    if (!impl_->opened) {
        if (!FitEven(pixels, width, height, stride, fitted, fitW, fitH, kLongEdge)) return WriteResult::Failed;
        if (!OpenSink(impl_->path, fitW, fitH, impl_->sink, impl_->streamIndex)) return WriteResult::Failed;
        impl_->width = fitW;
        impl_->height = fitH;
        impl_->opened = true;
    } else {
        ScaleBgra(pixels, width, height, stride, fitted, impl_->width, impl_->height);
        fitW = impl_->width;
        fitH = impl_->height;
    }
    if (fitted.size() != static_cast<std::size_t>(fitW) * static_cast<std::size_t>(fitH) * 4) return WriteResult::Failed;

    const std::size_t nv12Bytes = static_cast<std::size_t>(fitW) * static_cast<std::size_t>(fitH) * 3 / 2;
    ComPtr<IMFMediaBuffer> buffer;
    if (FAILED(MFCreateMemoryBuffer(static_cast<DWORD>(nv12Bytes), &buffer))) return WriteResult::Failed;
    BYTE* locked = nullptr;
    if (FAILED(buffer->Lock(&locked, nullptr, nullptr)) || !locked) return WriteResult::Failed;
    BgraToNv12(fitted.data(), fitW, fitH, locked);
    buffer->SetCurrentLength(static_cast<DWORD>(nv12Bytes));
    buffer->Unlock();

    ComPtr<IMFSample> sample;
    if (FAILED(MFCreateSample(&sample))) return WriteResult::Failed;
    if (FAILED(sample->AddBuffer(buffer.Get()))) return WriteResult::Failed;
    long long stamp = static_cast<long long>(elapsedMs < 0 ? 0 : elapsedMs) * 10000LL;
    if (impl_->frames == 0) stamp = 0;
    else if (stamp <= impl_->lastStamp) stamp = impl_->lastStamp + 1000000LL;
    const long long duration = impl_->frames == 0 ? 1000000LL : stamp - impl_->lastStamp;
    if (FAILED(sample->SetSampleTime(stamp)) || FAILED(sample->SetSampleDuration(duration))) return WriteResult::Failed;
    if (FAILED(impl_->sink->WriteSample(impl_->streamIndex, sample.Get()))) return WriteResult::Failed;

    impl_->lastStamp = stamp;
    impl_->last.swap(fitted);
    ++impl_->frames;
    return WriteResult::Ok;
}

bool Writer::Poster(std::vector<std::uint8_t>& jpeg) const {
    if (!impl_ || impl_->last.empty() || impl_->width < 2 || impl_->height < 2) return false;
    return EncodePoster(impl_->last, impl_->width, impl_->height, jpeg);
}

bool Writer::Finalize(std::uint64_t& bytes) {
    bytes = 0;
    if (!impl_ || !impl_->opened || impl_->frames < 1 || !impl_->sink) return false;
    const HRESULT hr = impl_->sink->Finalize();
    impl_->sink = nullptr;
    if (impl_->mf) {
        MFShutdown();
        impl_->mf = false;
    }
    if (FAILED(hr)) return false;
    std::error_code ec;
    const auto size = std::filesystem::file_size(impl_->path, ec);
    if (ec || size == 0) return false;
    bytes = static_cast<std::uint64_t>(size);
    impl_->kept = true;
    return true;
}

void Writer::Abort() {
    if (!impl_) return;
    impl_->sink = nullptr;
    if (impl_->mf) {
        MFShutdown();
        impl_->mf = false;
    }
    if (!impl_->kept && !impl_->path.empty()) {
        std::error_code ec;
        std::filesystem::remove(impl_->path, ec);
    }
    impl_->opened = false;
}

int Writer::frames() const { return impl_ ? impl_->frames : 0; }

std::uint64_t Writer::estimatedBytes() const {
    if (!impl_) return 0;
    return static_cast<std::uint64_t>(impl_->frames) * static_cast<std::uint64_t>(kBytesPerFrame);
}

bool DecodeJpeg(const std::uint8_t* bytes, std::size_t size, std::vector<std::uint8_t>& pixels, int& width, int& height) {
    width = 0;
    height = 0;
    pixels.clear();
    if (!bytes || size < 4 || size > 8 * 1024 * 1024) return false;
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, size);
    if (!memory) return false;
    void* locked = GlobalLock(memory);
    if (!locked) {
        GlobalFree(memory);
        return false;
    }
    std::memcpy(locked, bytes, size);
    GlobalUnlock(memory);
    ComPtr<IStream> stream;
    if (FAILED(CreateStreamOnHGlobal(memory, TRUE, &stream))) {
        GlobalFree(memory);
        return false;
    }
    ComPtr<IWICImagingFactory> factory;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)))) return false;
    ComPtr<IWICBitmapDecoder> decoder;
    if (FAILED(factory->CreateDecoderFromStream(stream.Get(), nullptr, WICDecodeMetadataCacheOnDemand, &decoder))) return false;
    ComPtr<IWICBitmapFrameDecode> frame;
    if (FAILED(decoder->GetFrame(0, &frame))) return false;
    ComPtr<IWICFormatConverter> converter;
    if (FAILED(factory->CreateFormatConverter(&converter))) return false;
    if (FAILED(converter->Initialize(frame.Get(), GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, nullptr, 0.0, WICBitmapPaletteTypeCustom))) return false;
    UINT w = 0;
    UINT h = 0;
    if (FAILED(converter->GetSize(&w, &h)) || w < 2 || h < 2 || w > 8192 || h > 8192) return false;
    const std::size_t bytesOut = static_cast<std::size_t>(w) * static_cast<std::size_t>(h) * 4;
    pixels.resize(bytesOut);
    if (FAILED(converter->CopyPixels(nullptr, w * 4, static_cast<UINT>(bytesOut), pixels.data()))) {
        pixels.clear();
        return false;
    }
    width = static_cast<int>(w);
    height = static_cast<int>(h);
    return true;
}

}  // namespace record

#endif
