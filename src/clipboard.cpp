// Windows のクリップボード（文字と HTML・画像）の読み書き
#include "clipboard.h"

#include <wincodec.h>  // WIC：画像を読む・PNG にし直す（Windows に入っている。リンクは windowscodecs）
#include <wrl/client.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>

#include "storage.h"  // Base64（画像入り 1 回貼りの CF_HTML。R7d）
#include "strings.h"

// 一部の Windows SDK の wingdi.h / winuser.h に無い定数。値は公式ヘッダと同じ。
//   BI_ALPHABITFIELDS は後から足された圧縮種別（6）。CF_DIBV5 は 17。
//   LCS_sRGB は文字 'sRGB'（0x73524742）。LCS_GM_IMAGES は 4。
//   BITMAPV5HEADER と bV5* は wingdi.h の構造体（このファイルの画像の書き出しが以前から使っている）。マクロではないので、ここには置かない。
#ifndef BI_ALPHABITFIELDS
#define BI_ALPHABITFIELDS 6L
#endif
#ifndef CF_DIBV5
#define CF_DIBV5 17
#endif
#ifndef LCS_sRGB
#define LCS_sRGB 0x73524742L
#endif
#ifndef LCS_GM_IMAGES
#define LCS_GM_IMAGES 0x00000004L
#endif

using Microsoft::WRL::ComPtr;

namespace clipboard {
namespace {

UINT HtmlFormat() {
    static const UINT format = RegisterClipboardFormatW(L"HTML Format");
    return format;
}

// 画像の形式「PNG」（Chromium・Office などがこの名前で読み書きする。透明もそのまま渡る）
UINT PngFormat() {
    static const UINT format = RegisterClipboardFormatW(L"PNG");
    return format;
}

constexpr size_t kMaxImageBytes = 16 * 1024 * 1024;  // 受け取る画像のファイルの大きさの上限
constexpr UINT kMaxImageSide = 4096;                 // 縦・横の上限（六角スクショは 520px 以下）

// ほかのアプリが使っている途中のことがあるので、少し待ってやり直す
bool OpenWithRetry(HWND owner) {
    for (int attempt = 0; attempt < 10; ++attempt) {
        if (OpenClipboard(owner)) return true;
        Sleep(20);
    }
    return false;
}

HGLOBAL CopyToGlobal(const void* data, size_t size) {
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, size);
    if (!memory) return nullptr;
    if (void* target = GlobalLock(memory)) {
        std::memcpy(target, data, size);
        GlobalUnlock(memory);
        return memory;
    }
    GlobalFree(memory);
    return nullptr;
}

// 履歴（Win+V）とほかの端末への同期に入れない印（依頼の小窓 v2・R2・D6）。Microsoft の「Clipboard Formats」の
//   Cloud Clipboard and Clipboard History Formats：ExcludeClipboardContentFromMonitorProcessing は中身を問わない（ここでは DWORD 0）、
//   CanIncludeInClipboardHistory・CanUploadToCloudClipboard は DWORD 0 で「入れない」。
//   OpenClipboard と EmptyClipboard のあと、同じ Open の中で呼ぶ。1 つでも置けなければ false
bool MarkNoHistory() {
    static const UINT formats[] = {
        RegisterClipboardFormatW(L"ExcludeClipboardContentFromMonitorProcessing"),
        RegisterClipboardFormatW(L"CanIncludeInClipboardHistory"),
        RegisterClipboardFormatW(L"CanUploadToCloudClipboard"),
    };
    const DWORD zero = 0;
    for (const UINT format : formats) {
        if (!format) return false;
        HGLOBAL memory = CopyToGlobal(&zero, sizeof(zero));
        if (!memory) return false;
        if (!SetClipboardData(format, memory)) {
            GlobalFree(memory);
            return false;
        }
    }
    return true;
}

// CF_HTML：先頭に「どこからどこまでが HTML か」をバイト数で書いた見出しを付ける
std::string MakeCfHtml(const std::string& fragment) {
    const std::string start = "<html><body>\r\n<!--StartFragment-->";
    const std::string end = "<!--EndFragment-->\r\n</body></html>";
    const char* headerFormat = "Version:0.9\r\nStartHTML:%010zu\r\nEndHTML:%010zu\r\nStartFragment:%010zu\r\nEndFragment:%010zu\r\n";
    char header[160];
    const size_t headerLength = static_cast<size_t>(std::snprintf(header, sizeof(header), headerFormat, size_t{0}, size_t{0}, size_t{0}, size_t{0}));
    const size_t startHtml = headerLength;
    const size_t startFragment = startHtml + start.size();
    const size_t endFragment = startFragment + fragment.size();
    const size_t endHtml = endFragment + end.size();
    std::snprintf(header, sizeof(header), headerFormat, startHtml, endHtml, startFragment, endFragment);
    return std::string(header) + start + fragment + end;
}

// ---- 画像（S3.12） ----

// 画像を、32 ビット BGRA（アルファは掛けていないまま・上の行から順）の画素にする
bool DecodeBgra(IWICImagingFactory* factory, const std::vector<uint8_t>& image, UINT& width, UINT& height, std::vector<uint8_t>& pixels) {
    ComPtr<IWICStream> stream;
    if (FAILED(factory->CreateStream(&stream))) return false;
    if (FAILED(stream->InitializeFromMemory(const_cast<BYTE*>(image.data()), static_cast<DWORD>(image.size())))) return false;
    ComPtr<IWICBitmapDecoder> decoder;
    if (FAILED(factory->CreateDecoderFromStream(stream.Get(), nullptr, WICDecodeMetadataCacheOnDemand, &decoder))) return false;
    ComPtr<IWICBitmapFrameDecode> frame;
    if (FAILED(decoder->GetFrame(0, &frame))) return false;
    ComPtr<IWICFormatConverter> converter;
    if (FAILED(factory->CreateFormatConverter(&converter))) return false;
    if (FAILED(converter->Initialize(frame.Get(), GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, nullptr, 0.0, WICBitmapPaletteTypeCustom))) return false;
    if (FAILED(converter->GetSize(&width, &height))) return false;
    if (width == 0 || height == 0 || width > kMaxImageSide || height > kMaxImageSide) return false;
    pixels.resize(size_t{width} * height * 4);
    return SUCCEEDED(converter->CopyPixels(nullptr, width * 4, static_cast<UINT>(pixels.size()), pixels.data()));
}

// 透明な所を塗る（アルファで下の色と混ぜて、不透明にする）。None なら何もしない
void FillTransparent(std::vector<uint8_t>& pixels, ImageFill fill) {
    if (fill == ImageFill::None) return;
    // 暗い色は、読む画面の暗い地に近い色（B・G・R の順）
    const uint8_t back[3] = {fill == ImageFill::White ? uint8_t{255} : uint8_t{0x26}, fill == ImageFill::White ? uint8_t{255} : uint8_t{0x22},
                             fill == ImageFill::White ? uint8_t{255} : uint8_t{0x20}};
    for (size_t i = 0; i + 3 < pixels.size(); i += 4) {
        const unsigned alpha = pixels[i + 3];
        for (size_t c = 0; c < 3; ++c) {
            pixels[i + c] = static_cast<uint8_t>((pixels[i + c] * alpha + back[c] * (255u - alpha) + 127u) / 255u);
        }
        pixels[i + 3] = 255;
    }
}

// 画素を PNG のファイルの中身にする（塗ったあとの画像を「PNG」の形式でも入れるため）
bool EncodePng(IWICImagingFactory* factory, UINT width, UINT height, std::vector<uint8_t>& pixels, std::vector<uint8_t>& png) {
    ComPtr<IStream> stream;
    if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream))) return false;
    ComPtr<IWICBitmapEncoder> encoder;
    if (FAILED(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder))) return false;
    if (FAILED(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache))) return false;
    ComPtr<IWICBitmapFrameEncode> frame;
    if (FAILED(encoder->CreateNewFrame(&frame, nullptr))) return false;
    if (FAILED(frame->Initialize(nullptr)) || FAILED(frame->SetSize(width, height))) return false;
    WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
    if (FAILED(frame->SetPixelFormat(&format)) || format != GUID_WICPixelFormat32bppBGRA) return false;
    if (FAILED(frame->WritePixels(height, width * 4, static_cast<UINT>(pixels.size()), pixels.data()))) return false;
    if (FAILED(frame->Commit()) || FAILED(encoder->Commit())) return false;
    STATSTG stat{};
    if (FAILED(stream->Stat(&stat, STATFLAG_NONAME)) || stat.cbSize.QuadPart == 0 || stat.cbSize.QuadPart > kMaxImageBytes * 4) return false;
    HGLOBAL memory = nullptr;
    if (FAILED(GetHGlobalFromStream(stream.Get(), &memory))) return false;
    const auto* bytes = static_cast<const uint8_t*>(GlobalLock(memory));
    if (!bytes) return false;
    png.assign(bytes, bytes + static_cast<size_t>(stat.cbSize.QuadPart));
    GlobalUnlock(memory);
    return true;
}

// CF_DIBV5：BITMAPV5HEADER のすぐ後ろに画素（下の行から順・BGRA。マスクは見出しの中）
HGLOBAL MakeDibV5(UINT width, UINT height, const std::vector<uint8_t>& pixels) {
    const size_t stride = size_t{width} * 4;
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, sizeof(BITMAPV5HEADER) + stride * height);
    if (!memory) return nullptr;
    auto* bytes = static_cast<uint8_t*>(GlobalLock(memory));
    if (!bytes) {
        GlobalFree(memory);
        return nullptr;
    }
    BITMAPV5HEADER header{};
    header.bV5Size = sizeof(BITMAPV5HEADER);
    header.bV5Width = static_cast<LONG>(width);
    header.bV5Height = static_cast<LONG>(height);  // 正の数＝下の行から（いちばん多くのアプリが読める向き）
    header.bV5Planes = 1;
    header.bV5BitCount = 32;
    header.bV5Compression = BI_BITFIELDS;
    header.bV5SizeImage = static_cast<DWORD>(stride * height);
    header.bV5RedMask = 0x00FF0000;
    header.bV5GreenMask = 0x0000FF00;
    header.bV5BlueMask = 0x000000FF;
    header.bV5AlphaMask = 0xFF000000;
    header.bV5CSType = LCS_sRGB;
    header.bV5Intent = LCS_GM_IMAGES;
    std::memcpy(bytes, &header, sizeof(header));
    uint8_t* rows = bytes + sizeof(header);
    for (UINT y = 0; y < height; ++y) {
        std::memcpy(rows + stride * (height - 1 - y), pixels.data() + stride * y, stride);
    }
    GlobalUnlock(memory);
    return memory;
}

constexpr size_t kMaxClipboardBytes = 64 * 1024 * 1024;  // クリップボードから受け取る一塊の上限
constexpr unsigned long long kMaxClipboardPixels = 20000000ull;  // 画素に展開するときの上限（約 4K の数倍）
constexpr UINT kPasteLongEdge = 1600;  // セルに保存する JPEG の長い辺
constexpr size_t kMaxJpegBytes = 670000;  // Base64 にすると約 90 万字（面へ渡せる上限の内側）
constexpr UINT kMaxSourceSide = 16384;  // これより大きい画像は、縮める前に断る

std::vector<uint8_t> CopyClipboardBytes(HANDLE data, bool& tooBig) {
    std::vector<uint8_t> out;
    if (!data) return out;
    const auto* bytes = static_cast<const uint8_t*>(GlobalLock(data));
    if (!bytes) return out;
    const size_t size = GlobalSize(data);
    if (size == 0 || size > kMaxClipboardBytes) {
        if (size > kMaxClipboardBytes) tooBig = true;
    } else {
        out.assign(bytes, bytes + size);
    }
    GlobalUnlock(data);
    return out;
}

// CF_DIB / CF_DIBV5 を、WIC が読める BMP ファイルにする（画素の位置は見出しから計算する）
bool DibToBmpFile(const std::vector<uint8_t>& dib, std::vector<uint8_t>& bmp, bool& tooBig) {
    if (dib.size() < sizeof(BITMAPINFOHEADER)) return false;
    const auto* info = reinterpret_cast<const BITMAPINFOHEADER*>(dib.data());
    if (info->biSize < sizeof(BITMAPINFOHEADER) || static_cast<size_t>(info->biSize) > dib.size()) return false;
    const int bitCount = info->biBitCount;
    if (bitCount <= 0 || bitCount > 32) return false;
    size_t pixelOffset = info->biSize;
    if (info->biCompression == BI_BITFIELDS && info->biSize == sizeof(BITMAPINFOHEADER)) pixelOffset += 12;
    else if (info->biCompression == BI_ALPHABITFIELDS && info->biSize == sizeof(BITMAPINFOHEADER)) pixelOffset += 16;
    if (bitCount <= 8) {
        DWORD colors = info->biClrUsed;
        if (colors == 0) colors = 1u << static_cast<unsigned>(bitCount);
        if (colors > 256) return false;
        pixelOffset += static_cast<size_t>(colors) * 4u;
    }
    if (pixelOffset >= dib.size()) return false;
    const int width = info->biWidth >= 0 ? info->biWidth : -info->biWidth;
    const int height = info->biHeight >= 0 ? info->biHeight : -info->biHeight;
    if (width < 1 || height < 1) return false;
    if (width > 8192 || height > 8192 || static_cast<unsigned long long>(width) * static_cast<unsigned long long>(height) > kMaxClipboardPixels) {
        tooBig = true;
        return false;
    }
    const size_t total = sizeof(BITMAPFILEHEADER) + dib.size();
    if (total > kMaxClipboardBytes) {
        tooBig = true;
        return false;
    }
    BITMAPFILEHEADER file{};
    file.bfType = 0x4D42;  // 'BM'
    file.bfOffBits = static_cast<DWORD>(sizeof(BITMAPFILEHEADER) + pixelOffset);
    file.bfSize = static_cast<DWORD>(total);
    bmp.resize(total);
    std::memcpy(bmp.data(), &file, sizeof(file));
    std::memcpy(bmp.data() + sizeof(file), dib.data(), dib.size());
    return true;
}

// CF_BITMAP（HBITMAP）を 32 ビットの BMP にする。クリップボードを開いているあいだに呼ぶ
bool BitmapToBmp(HBITMAP bitmap, std::vector<uint8_t>& bmp, bool& tooBig) {
    BITMAP info{};
    if (GetObjectW(bitmap, sizeof(info), &info) == 0) return false;
    const int width = info.bmWidth >= 0 ? info.bmWidth : -info.bmWidth;
    const int height = info.bmHeight >= 0 ? info.bmHeight : -info.bmHeight;
    if (width < 1 || height < 1) return false;
    if (width > 8192 || height > 8192 || static_cast<unsigned long long>(width) * static_cast<unsigned long long>(height) > kMaxClipboardPixels) {
        tooBig = true;
        return false;
    }
    BITMAPINFO bmi{};
    bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bmi.bmiHeader.biWidth = width;
    bmi.bmiHeader.biHeight = height;  // 正の数＝下の行から
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;
    const size_t pixelBytes = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
    std::vector<uint8_t> pixels(pixelBytes);
    HDC screen = GetDC(nullptr);
    if (!screen) return false;
    const int rows = GetDIBits(screen, bitmap, 0, static_cast<UINT>(height), pixels.data(), &bmi, DIB_RGB_COLORS);
    ReleaseDC(nullptr, screen);
    if (rows == 0) return false;
    std::vector<uint8_t> dib(sizeof(BITMAPINFOHEADER) + pixelBytes);
    std::memcpy(dib.data(), &bmi.bmiHeader, sizeof(BITMAPINFOHEADER));
    std::memcpy(dib.data() + sizeof(BITMAPINFOHEADER), pixels.data(), pixelBytes);
    return DibToBmpFile(dib, bmp, tooBig);
}

enum class ScaledDecode { Ok, Fail, Big };

// 長い辺が edge 以下の 32 ビット BGRA にする。大きい画像は WIC の縮小で、全画素を一度に持たない
ScaledDecode DecodeScaledBgra(IWICImagingFactory* factory, const std::vector<uint8_t>& image, UINT edge, UINT& width, UINT& height, std::vector<uint8_t>& pixels) {
    if (image.empty()) return ScaledDecode::Fail;
    ComPtr<IWICStream> stream;
    if (FAILED(factory->CreateStream(&stream))) return ScaledDecode::Fail;
    if (FAILED(stream->InitializeFromMemory(const_cast<BYTE*>(image.data()), static_cast<DWORD>(image.size())))) return ScaledDecode::Fail;
    ComPtr<IWICBitmapDecoder> decoder;
    if (FAILED(factory->CreateDecoderFromStream(stream.Get(), nullptr, WICDecodeMetadataCacheOnDemand, &decoder))) return ScaledDecode::Fail;
    ComPtr<IWICBitmapFrameDecode> frame;
    if (FAILED(decoder->GetFrame(0, &frame))) return ScaledDecode::Fail;
    UINT srcW = 0;
    UINT srcH = 0;
    if (FAILED(frame->GetSize(&srcW, &srcH)) || srcW == 0 || srcH == 0) return ScaledDecode::Fail;
    if (srcW > kMaxSourceSide || srcH > kMaxSourceSide) return ScaledDecode::Big;
    ComPtr<IWICBitmapSource> source;
    if (FAILED(frame.As(&source))) return ScaledDecode::Fail;
    width = srcW;
    height = srcH;
    const UINT span = srcW > srcH ? srcW : srcH;
    if (span > edge) {
        UINT destW = srcW >= srcH ? edge : (srcW * edge) / srcH;
        UINT destH = srcH > srcW ? edge : (srcH * edge) / srcW;
        if (destW < 1) destW = 1;
        if (destH < 1) destH = 1;
        ComPtr<IWICBitmapScaler> scaler;
        if (FAILED(factory->CreateBitmapScaler(&scaler))) return ScaledDecode::Fail;
        if (FAILED(scaler->Initialize(source.Get(), destW, destH, WICBitmapInterpolationModeFant))) return ScaledDecode::Fail;
        if (FAILED(scaler.As(&source))) return ScaledDecode::Fail;
        width = destW;
        height = destH;
    }
    ComPtr<IWICFormatConverter> converter;
    if (FAILED(factory->CreateFormatConverter(&converter))) return ScaledDecode::Fail;
    if (FAILED(converter->Initialize(source.Get(), GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, nullptr, 0.0, WICBitmapPaletteTypeCustom))) return ScaledDecode::Fail;
    pixels.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * 4u);
    if (FAILED(converter->CopyPixels(nullptr, width * 4, static_cast<UINT>(pixels.size()), pixels.data()))) return ScaledDecode::Fail;
    return ScaledDecode::Ok;
}

void DownscaleEdge(std::vector<uint8_t>& pixels, UINT& width, UINT& height, UINT edge) {
    const UINT span = width > height ? width : height;
    if (span <= edge || width == 0 || height == 0) return;
    UINT destW = width >= height ? edge : (width * edge) / height;
    UINT destH = height > width ? edge : (height * edge) / width;
    if (destW < 1) destW = 1;
    if (destH < 1) destH = 1;
    std::vector<uint8_t> next(static_cast<size_t>(destW) * static_cast<size_t>(destH) * 4u);
    for (UINT y = 0; y < destH; ++y) {
        UINT srcY = (y * height) / destH;
        if (srcY >= height) srcY = height - 1;
        for (UINT x = 0; x < destW; ++x) {
            UINT srcX = (x * width) / destW;
            if (srcX >= width) srcX = width - 1;
            const size_t from = (static_cast<size_t>(srcY) * static_cast<size_t>(width) + static_cast<size_t>(srcX)) * 4u;
            const size_t to = (static_cast<size_t>(y) * static_cast<size_t>(destW) + static_cast<size_t>(x)) * 4u;
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

bool EncodeJpegBgr(IWICImagingFactory* factory, const std::vector<uint8_t>& pixels, UINT width, UINT height, std::vector<BYTE>& jpeg) {
    if (width == 0 || height == 0) return false;
    if (pixels.size() != static_cast<size_t>(width) * static_cast<size_t>(height) * 4u) return false;
    std::vector<uint8_t> bgr(static_cast<size_t>(width) * static_cast<size_t>(height) * 3u);
    for (UINT y = 0; y < height; ++y) {
        const uint8_t* src = pixels.data() + static_cast<size_t>(y) * static_cast<size_t>(width) * 4u;
        uint8_t* dst = bgr.data() + static_cast<size_t>(y) * static_cast<size_t>(width) * 3u;
        for (UINT x = 0; x < width; ++x) {
            dst[x * 3] = src[x * 4];
            dst[x * 3 + 1] = src[x * 4 + 1];
            dst[x * 3 + 2] = src[x * 4 + 2];
        }
    }
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
    if (FAILED(frame->SetSize(width, height))) return false;
    WICPixelFormatGUID format = GUID_WICPixelFormat24bppBGR;
    if (FAILED(frame->SetPixelFormat(&format)) || format != GUID_WICPixelFormat24bppBGR) return false;
    const UINT stride = width * 3;
    const UINT bytes = stride * height;
    if (FAILED(frame->WritePixels(height, stride, bytes, bgr.data()))) return false;
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

// まだ大きければ長い辺を半分にして、面へ渡せる大きさまで縮める
//   1＝jpeg に入れた　0＝まだ大きい　-1＝JPEG にできなかった
int FitJpeg(IWICImagingFactory* factory, std::vector<uint8_t> pixels, UINT width, UINT height, std::vector<BYTE>& jpeg) {
    for (int attempt = 0; attempt < 5; ++attempt) {
        std::vector<BYTE> encoded;
        if (!EncodeJpegBgr(factory, pixels, width, height, encoded)) return -1;
        if (encoded.size() <= kMaxJpegBytes) {
            jpeg.swap(encoded);
            return 1;
        }
        const UINT span = width > height ? width : height;
        const UINT next = span / 2;
        if (next < 64) return 0;
        DownscaleEdge(pixels, width, height, next);
    }
    return 0;
}

}  // namespace

Content Read(HWND owner) {
    Content content;
    if (!OpenWithRetry(owner)) return content;
    if (HANDLE data = GetClipboardData(CF_UNICODETEXT)) {
        if (const auto* text = static_cast<const wchar_t*>(GlobalLock(data))) {
            const size_t limit = GlobalSize(data) / sizeof(wchar_t);
            content.text = ToUtf8(std::wstring_view(text, wcsnlen(text, limit)));
            GlobalUnlock(data);
        }
    }
    if (HANDLE data = GetClipboardData(HtmlFormat())) {
        if (const auto* bytes = static_cast<const char*>(GlobalLock(data))) {
            content.html.assign(bytes, strnlen(bytes, GlobalSize(data)));
            GlobalUnlock(data);
        }
    }
    CloseClipboard();
    return content;
}

bool Write(HWND owner, const std::string& text, const std::string& html, bool noHistory) {
    if (!OpenWithRetry(owner)) return false;
    EmptyClipboard();
    if (noHistory && !MarkNoHistory()) {  // 印を置けなければ、中身も置かない（履歴に入るかもしれない形では渡さない）
        EmptyClipboard();
        CloseClipboard();
        return false;
    }
    bool ok = true;
    const std::wstring wide = ToWide(text);
    if (HGLOBAL memory = CopyToGlobal(wide.c_str(), (wide.size() + 1) * sizeof(wchar_t))) {
        if (!SetClipboardData(CF_UNICODETEXT, memory)) {
            GlobalFree(memory);
            ok = false;
        }
    }
    if (!html.empty()) {
        const std::string cfHtml = MakeCfHtml(html);
        if (HGLOBAL memory = CopyToGlobal(cfHtml.c_str(), cfHtml.size() + 1)) {
            if (!SetClipboardData(HtmlFormat(), memory)) {
                GlobalFree(memory);
                ok = false;
            }
        }
    }
    CloseClipboard();
    return ok;
}

namespace {

// 画像を書く（WriteImage・WriteImageWithText の中身）：読む → （塗る）→ CF_DIBV5 と PNG を作る → クリップボードを空にして入れる。
//   text があれば（R7d）、同じ Open で HTML Format（html の断片の頭に、いま作った PNG の data: の <img>）と CF_UNICODETEXT も入れる。
//   置く順は、中身の多い形式から（HTML・CF_DIBV5・PNG・文）。noHistory なら履歴・同期に入れない印も。
//   置く物は先に全部作ってから開く（クリップボードを掴む時間を短く）。COM は main.cpp で初期化してある（UI のスレッドから呼ぶ）
bool PutImage(HWND owner, const std::vector<uint8_t>& image, ImageFill fill, const std::string* text, const std::string& html, bool noHistory) {
    if (image.empty() || image.size() > kMaxImageBytes) return false;
    ComPtr<IWICImagingFactory> factory;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)))) return false;
    UINT width = 0;
    UINT height = 0;
    std::vector<uint8_t> pixels;
    if (!DecodeBgra(factory.Get(), image, width, height, pixels)) return false;
    FillTransparent(pixels, fill);
    std::vector<uint8_t> png;
    if (!EncodePng(factory.Get(), width, height, pixels, png)) return false;
    struct Part {
        UINT format;
        HGLOBAL memory;
    };
    std::vector<Part> parts;
    if (text) {
        // CF_HTML の画像は、いまクリップボードに置く PNG そのもの（塗ったあと）。元の画像や隠す前の画像は入れない（絶対の制約 1）
        const std::string cfHtml = MakeCfHtml("<img src=\"data:image/png;base64," + Base64(png) + "\" alt=\"\"><br>" + html);
        parts.push_back({HtmlFormat(), CopyToGlobal(cfHtml.c_str(), cfHtml.size() + 1)});
    }
    parts.push_back({CF_DIBV5, MakeDibV5(width, height, pixels)});  // CF_DIB・CF_BITMAP は Windows が CF_DIBV5 から作る
    parts.push_back({PngFormat(), CopyToGlobal(png.data(), png.size())});
    if (text) {
        const std::wstring wide = ToWide(*text);
        parts.push_back({CF_UNICODETEXT, CopyToGlobal(wide.c_str(), (wide.size() + 1) * sizeof(wchar_t))});
    }
    const auto freeAll = [&parts] {
        for (const Part& part : parts) {
            if (part.memory) GlobalFree(part.memory);
        }
    };
    if (std::any_of(parts.begin(), parts.end(), [](const Part& part) { return !part.memory; }) || !OpenWithRetry(owner)) {
        freeAll();
        return false;
    }
    EmptyClipboard();
    if (noHistory && !MarkNoHistory()) {  // 印を置けなければ、画像も文も置かない
        EmptyClipboard();
        CloseClipboard();
        freeAll();
        return false;
    }
    bool ok = true;
    for (const Part& part : parts) {
        if (!SetClipboardData(part.format, part.memory)) {
            GlobalFree(part.memory);
            ok = false;
        }
    }
    CloseClipboard();
    return ok;
}

}  // namespace

// 画像を書く：CF_DIBV5 と PNG（noHistory なら履歴・同期に入れない印も）
bool WriteImage(HWND owner, const std::vector<uint8_t>& image, ImageFill fill, bool noHistory) {
    return PutImage(owner, image, fill, nullptr, std::string(), noHistory);
}

// 画像と文を一つの貼り付けで（依頼の小窓 v2・R7d・D16。試し）：CF_DIBV5・PNG に、文と CF_HTML（画像の data: と文の断片）も
bool WriteImageWithText(HWND owner, const std::vector<uint8_t>& image, ImageFill fill, const std::string& text, const std::string& html, bool noHistory) {
    return PutImage(owner, image, fill, &text, html, noHistory);
}

bool HasImage() {
    return IsClipboardFormatAvailable(PngFormat()) || IsClipboardFormatAvailable(CF_DIBV5) || IsClipboardFormatAvailable(CF_DIB) || IsClipboardFormatAvailable(CF_BITMAP);
}

// PNG を先に試し、無ければ DIB、最後に HBITMAP。透明な所は白で塗ってから JPEG にする
ImageRead ReadImage(HWND owner) {
    ImageRead result;
    if (!HasImage()) {
        result.error = "empty";
        return result;
    }
    if (!OpenWithRetry(owner)) {
        result.error = "decode";
        return result;
    }
    bool tooBig = false;
    std::vector<uint8_t> pngBytes;
    std::vector<uint8_t> bmpBytes;
    if (IsClipboardFormatAvailable(PngFormat())) pngBytes = CopyClipboardBytes(GetClipboardData(PngFormat()), tooBig);
    if (IsClipboardFormatAvailable(CF_DIBV5)) {
        const std::vector<uint8_t> dib = CopyClipboardBytes(GetClipboardData(CF_DIBV5), tooBig);
        if (!dib.empty()) DibToBmpFile(dib, bmpBytes, tooBig);
    }
    if (bmpBytes.empty() && IsClipboardFormatAvailable(CF_DIB)) {
        const std::vector<uint8_t> dib = CopyClipboardBytes(GetClipboardData(CF_DIB), tooBig);
        if (!dib.empty()) DibToBmpFile(dib, bmpBytes, tooBig);
    }
    if (bmpBytes.empty() && IsClipboardFormatAvailable(CF_BITMAP)) {
        const auto bitmap = static_cast<HBITMAP>(GetClipboardData(CF_BITMAP));
        if (bitmap) BitmapToBmp(bitmap, bmpBytes, tooBig);
    }
    CloseClipboard();

    ComPtr<IWICImagingFactory> factory;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)))) {
        result.error = "decode";
        return result;
    }
    UINT width = 0;
    UINT height = 0;
    std::vector<uint8_t> pixels;
    ScaledDecode decoded = ScaledDecode::Fail;
    if (!pngBytes.empty()) decoded = DecodeScaledBgra(factory.Get(), pngBytes, kPasteLongEdge, width, height, pixels);
    if (decoded != ScaledDecode::Ok && !bmpBytes.empty()) decoded = DecodeScaledBgra(factory.Get(), bmpBytes, kPasteLongEdge, width, height, pixels);
    if (decoded == ScaledDecode::Big || (decoded != ScaledDecode::Ok && tooBig)) {
        result.error = "big";
        return result;
    }
    if (decoded != ScaledDecode::Ok) {
        result.error = "decode";
        return result;
    }
    FillTransparent(pixels, ImageFill::White);
    const int fit = FitJpeg(factory.Get(), std::move(pixels), width, height, result.jpeg);
    if (fit != 1) {
        result.jpeg.clear();
        result.error = fit < 0 ? "decode" : "big";
        return result;
    }
    return result;
}

namespace {

bool IsImageExtension(const std::wstring& path) {
    const std::wstring ext = std::filesystem::path(path).extension().wstring();
    std::wstring lower;
    lower.reserve(ext.size());
    for (wchar_t ch : ext) {
        if (ch >= L'A' && ch <= L'Z') ch = static_cast<wchar_t>(ch - L'A' + L'a');
        lower.push_back(ch);
    }
    return lower == L".png" || lower == L".jpg" || lower == L".jpeg" || lower == L".gif" || lower == L".webp" || lower == L".bmp" || lower == L".tif" ||
           lower == L".tiff";
}

}  // namespace

ImageRead ReadImageFile(const std::wstring& path, UINT edge) {
    ImageRead result;
    if (!IsImageExtension(path)) {
        result.error = "type";
        return result;
    }
    std::error_code error;
    const std::filesystem::path file(path);
    if (!std::filesystem::is_regular_file(file, error)) {
        result.error = "missing";
        return result;
    }
    const std::uintmax_t bytes = std::filesystem::file_size(file, error);
    if (error || bytes == 0 || bytes > kMaxClipboardBytes) {
        result.error = !error && bytes > kMaxClipboardBytes ? "big" : "decode";
        return result;
    }
    std::ifstream in(file, std::ios::binary);
    std::vector<uint8_t> image(static_cast<size_t>(bytes));
    in.read(reinterpret_cast<char*>(image.data()), static_cast<std::streamsize>(image.size()));
    if (!in || in.gcount() != static_cast<std::streamsize>(image.size())) {
        result.error = "decode";
        return result;
    }
    ComPtr<IWICImagingFactory> factory;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)))) {
        result.error = "decode";
        return result;
    }
    const UINT longEdge = edge == 0 ? kPasteLongEdge : edge;
    UINT width = 0;
    UINT height = 0;
    std::vector<uint8_t> pixels;
    const ScaledDecode decoded = DecodeScaledBgra(factory.Get(), image, longEdge, width, height, pixels);
    if (decoded == ScaledDecode::Big) {
        result.error = "big";
        return result;
    }
    if (decoded != ScaledDecode::Ok) {
        result.error = "decode";
        return result;
    }
    FillTransparent(pixels, ImageFill::White);
    const int fit = FitJpeg(factory.Get(), std::move(pixels), width, height, result.jpeg);
    if (fit != 1) {
        result.jpeg.clear();
        result.error = fit < 0 ? "decode" : "big";
        return result;
    }
    return result;
}

}  // namespace clipboard
