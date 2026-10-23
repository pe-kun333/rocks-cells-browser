// 文字の読み取り（C7）。
//   Windows.Media.Ocr は C++/WinRT の winrt::Windows::Media::Ocr。
//   ABI の ::Windows::Media::Ocr は使わない（C5 の IDirect3DDxgiInterfaceAccess は逆で、
//   あちらは ::Windows::Graphics::DirectX::Direct3D11 であり winrt:: ではない）。
//   RecognizeAsync().get() は、このファイルの中で、マルチスレッドのアパートメントを
//   初期化したスレッドだけで呼ぶ。UI スレッド（STA）では init_apartment も .get() もしない。
//   ヘッダが無いときは ROCKSCELLS_HAS_OCR を定義せず、下の空実装だけをコンパイルする。
#include "ocr.h"

#include "ocrjoin.h"

#include <cstddef>

namespace ocr {

const char* FailureName(Failure failure) {
    switch (failure) {
    case Failure::Unavailable: return "unavailable";
    case Failure::NoJapanese: return "noJapanese";
    case Failure::Decode: return "decode";
    case Failure::Engine: return "engine";
    case Failure::None: return nullptr;
    }
    return "engine";
}

}  // namespace ocr

#ifndef ROCKSCELLS_HAS_OCR

namespace ocr {

bool Available() { return false; }

Outcome Read(const std::vector<std::uint8_t>&, const std::wstring&, const std::vector<int>&) {
    return {Failure::Unavailable, {}};
}

}  // namespace ocr

#else

#include <objbase.h>
#include <wincodec.h>
#include <wrl/client.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Globalization.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Media.Ocr.h>
#include <winrt/Windows.Storage.Streams.h>

#include <cmath>
#include <cstring>
#include <utility>

#include "strings.h"

#ifdef ROCKSCELLS_HAS_RECORD
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#endif

using Microsoft::WRL::ComPtr;
namespace wocr = winrt::Windows::Media::Ocr;
namespace wimg = winrt::Windows::Graphics::Imaging;
namespace wglob = winrt::Windows::Globalization;
namespace wstream = winrt::Windows::Storage::Streams;

namespace ocr {
namespace {

constexpr int kLongEdge = 2000;  // 1辺がおよそ 1万を超える画像はエンジンが受け取れない
constexpr int kLineCap = 80;     // 1枚あたり。表の追加行を含めて、呼び出し側が全体も切る
constexpr int kTotalCap = 240;
constexpr int kTextCap = 500;
constexpr int kWordCap = 400;
constexpr int kSampleCap = 20;

int Longer(int a, int b) { return a > b ? a : b; }

struct WordBox {
    std::wstring text;
    double left = 0;
    double top = 0;
    double width = 0;
    double height = 0;
    int row = 0;
};

struct Row {
    double left = 0;
    double top = 0;
    double width = 0;
    double height = 0;
};

bool StartsWithJa(winrt::hstring const& tag) {
    if (tag.size() < 2) return false;
    auto lower = [](wchar_t ch) {
        if (ch >= L'A' && ch <= L'Z') return static_cast<wchar_t>(ch - L'A' + L'a');
        return ch;
    };
    if (lower(tag[0]) != L'j' || lower(tag[1]) != L'a') return false;
    return tag.size() == 2 || tag[2] == L'-';
}

// 日本語パックがあればそれを使う。プロフィールが英語でも英語には落とさない。
// パックが無いときは nullptr（呼び出し側が NoJapanese）。
wocr::OcrEngine MakeJapaneseEngine() {
    wglob::Language preferred{nullptr};
    for (auto const& language : wocr::OcrEngine::AvailableRecognizerLanguages()) {
        if (!StartsWithJa(language.LanguageTag())) continue;
        preferred = language;
        if (language.LanguageTag() == L"ja-JP") break;
    }
    if (preferred) {
        auto engine = wocr::OcrEngine::TryCreateFromLanguage(preferred);
        if (engine) return engine;
    }
    auto profile = wocr::OcrEngine::TryCreateFromUserProfileLanguages();
    if (profile && StartsWithJa(profile.RecognizerLanguage().LanguageTag())) return profile;
    return nullptr;
}

std::wstring ClipWide(std::wstring text) {
    for (wchar_t& ch : text) {
        if (ch == L'\r' || ch == L'\n' || ch == L'\t') ch = L' ';
    }
    if (text.size() > static_cast<size_t>(kTextCap)) {
        text.resize(static_cast<size_t>(kTextCap));
        if (!text.empty()) {
            const wchar_t last = text.back();
            if (last >= 0xD800 && last <= 0xDBFF) text.pop_back();
        }
    }
    return text;
}

double Fraction(double value, double span) {
    if (!(span > 0) || !std::isfinite(value)) return 0;
    double unit = value / span;
    if (unit < 0) unit = 0;
    if (unit > 1) unit = 1;
    return std::round(unit * 10000.0) / 10000.0;
}

// OcrWord::BoundingRect を合併した行の矩形。OcrLine 自体には矩形が無い（SDK 10.0.22621）
struct PixelSpan {
    double left = 0;
    double top = 0;
    double right = 0;
    double bottom = 0;
    bool any = false;
};

void IncludeSpan(PixelSpan& span, double left, double top, double right, double bottom) {
    if (!span.any) {
        span.left = left;
        span.top = top;
        span.right = right;
        span.bottom = bottom;
        span.any = true;
        return;
    }
    if (left < span.left) span.left = left;
    if (top < span.top) span.top = top;
    if (right > span.right) span.right = right;
    if (bottom > span.bottom) span.bottom = bottom;
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
    UINT wide = 0;
    UINT high = 0;
    if (FAILED(converter->GetSize(&wide, &high)) || wide < 2 || high < 2 || wide > 8192 || high > 8192) return false;
    const std::size_t bytesOut = static_cast<std::size_t>(wide) * static_cast<std::size_t>(high) * 4;
    pixels.resize(bytesOut);
    if (FAILED(converter->CopyPixels(nullptr, wide * 4, static_cast<UINT>(bytesOut), pixels.data()))) {
        pixels.clear();
        return false;
    }
    width = static_cast<int>(wide);
    height = static_cast<int>(high);
    return true;
}

void ScaleBgra(const std::uint8_t* src, int srcW, int srcH, std::vector<std::uint8_t>& dest, int destW, int destH) {
    dest.assign(static_cast<std::size_t>(destW) * static_cast<std::size_t>(destH) * 4, 0);
    if (srcW < 1 || srcH < 1 || destW < 1 || destH < 1) return;
    const int stride = srcW * 4;
    for (int y = 0; y < destH; ++y) {
        int srcY = (y * srcH) / destH;
        if (srcY >= srcH) srcY = srcH - 1;
        const std::uint8_t* row = src + static_cast<std::size_t>(srcY) * static_cast<std::size_t>(stride);
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

bool FitLongEdge(const std::uint8_t* bytes, std::size_t size, std::vector<std::uint8_t>& dest, int& destW, int& destH) {
    std::vector<std::uint8_t> raw;
    int srcW = 0;
    int srcH = 0;
    if (!DecodeJpeg(bytes, size, raw, srcW, srcH)) return false;
    int fitW = srcW;
    int fitH = srcH;
    const int span = Longer(srcW, srcH);
    if (span > kLongEdge) {
        if (srcW >= srcH) {
            fitW = kLongEdge;
            fitH = (srcH * kLongEdge) / srcW;
        } else {
            fitH = kLongEdge;
            fitW = (srcW * kLongEdge) / srcH;
        }
    }
    if (fitW < 1) fitW = 1;
    if (fitH < 1) fitH = 1;
    if (fitW == srcW && fitH == srcH) dest = std::move(raw);
    else ScaleBgra(raw.data(), srcW, srcH, dest, fitW, fitH);
    destW = fitW;
    destH = fitH;
    return dest.size() == static_cast<std::size_t>(fitW) * static_cast<std::size_t>(fitH) * 4;
}

bool FitPixels(const std::uint8_t* pixels, int srcW, int srcH, std::vector<std::uint8_t>& dest, int& destW, int& destH) {
    if (!pixels || srcW < 2 || srcH < 2) return false;
    int fitW = srcW;
    int fitH = srcH;
    const int span = Longer(srcW, srcH);
    if (span > kLongEdge) {
        if (srcW >= srcH) {
            fitW = kLongEdge;
            fitH = (srcH * kLongEdge) / srcW;
        } else {
            fitH = kLongEdge;
            fitW = (srcW * kLongEdge) / srcH;
        }
    }
    if (fitW < 1) fitW = 1;
    if (fitH < 1) fitH = 1;
    if (fitW == srcW && fitH == srcH) {
        dest.assign(pixels, pixels + static_cast<std::size_t>(srcW) * static_cast<std::size_t>(srcH) * 4);
    } else {
        ScaleBgra(pixels, srcW, srcH, dest, fitW, fitH);
    }
    destW = fitW;
    destH = fitH;
    return dest.size() == static_cast<std::size_t>(fitW) * static_cast<std::size_t>(fitH) * 4;
}

// 大きな隙間で区切ったかたまりの左端が、複数の行で揃っているときだけ表の行を足す。元の行は残す。空のセルは書かない。
void AppendTable(const std::vector<Row>& rows, const std::vector<WordBox>& words, int width, int height, int at, std::vector<Line>& out) {
    if (rows.size() < 2 || words.size() < 2) return;
    if (static_cast<int>(out.size()) >= kTotalCap) return;
    std::vector<ocrjoin::Glyph> glyphs;
    glyphs.reserve(words.size());
    for (const WordBox& word : words) {
        glyphs.push_back(ocrjoin::Glyph{word.text, word.left, word.top, word.width, word.height, word.row});
    }
    const std::vector<ocrjoin::TableHit> hits = ocrjoin::TableHits(static_cast<int>(rows.size()), glyphs);
    for (const ocrjoin::TableHit& hit : hits) {
        if (static_cast<int>(out.size()) >= kTotalCap) return;
        if (hit.row < 0 || hit.row >= static_cast<int>(rows.size())) continue;
        std::wstring joined = ClipWide(hit.text);
        if (joined.empty()) continue;
        const Row& row = rows[static_cast<size_t>(hit.row)];
        Line line;
        line.text = ToUtf8(joined);
        line.x = Fraction(row.left, width);
        line.y = Fraction(row.top, height);
        line.w = Fraction(row.width, width);
        line.h = Fraction(row.height, height);
        if (line.x + line.w > 1) line.w = Fraction(1.0 - line.x, 1.0);
        if (line.y + line.h > 1) line.h = Fraction(1.0 - line.y, 1.0);
        line.table = true;
        line.at = at;
        out.push_back(std::move(line));
    }
}

// 1枚を読む。失敗は false（エンジン側）。文字が無いだけなら true。
bool AppendFrame(const wocr::OcrEngine& engine, const std::vector<std::uint8_t>& pixels, int width, int height, int at, std::vector<Line>& out) {
    if (static_cast<int>(out.size()) >= kTotalCap) return true;
    if (width < 1 || height < 1 || pixels.size() != static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4) return false;
    wstream::DataWriter writer;
    const winrt::array_view<std::uint8_t const> view(pixels.data(), pixels.data() + pixels.size());
    writer.WriteBytes(view);
    auto buffer = writer.DetachBuffer();
    wimg::SoftwareBitmap bitmap = wimg::SoftwareBitmap::CreateCopyFromBuffer(buffer, wimg::BitmapPixelFormat::Bgra8, width, height, wimg::BitmapAlphaMode::Ignore);
    // .get() はワーカーの MTA だけで呼ぶ。UI スレッドには来ない（Read の入口で STA なら初期化に失敗して戻る）
    wocr::OcrResult result = engine.RecognizeAsync(bitmap).get();

    std::vector<Row> rows;
    std::vector<WordBox> words;
    int added = 0;
    for (auto const& ocrLine : result.Lines()) {
        if (added >= kLineCap || static_cast<int>(out.size()) >= kTotalCap) break;
        // OcrLine::Text() は日本語の語のあいだに空白を入れる。表示は語から組み立てる。
        // OcrLine に BoundingRect は無い。各 OcrWord::BoundingRect を合併して行の矩形にする
        const int rowIndex = static_cast<int>(rows.size());
        PixelSpan span;
        std::vector<WordBox> lineWords;
        std::wstring text;
        for (auto const& word : ocrLine.Words()) {
            const auto wordBounds = word.BoundingRect();
            if (!(wordBounds.Width > 0) || !(wordBounds.Height > 0)) continue;
            const double left = wordBounds.X;
            const double top = wordBounds.Y;
            const double right = static_cast<double>(wordBounds.X) + static_cast<double>(wordBounds.Width);
            const double bottom = static_cast<double>(wordBounds.Y) + static_cast<double>(wordBounds.Height);
            IncludeSpan(span, left, top, right, bottom);
            std::wstring wordText(word.Text().c_str(), word.Text().size());
            ocrjoin::AppendToken(text, wordText);
            wordText = ocrjoin::TightenSpaces(std::move(wordText));
            if (wordText.empty()) continue;
            if (static_cast<int>(words.size()) + static_cast<int>(lineWords.size()) >= kWordCap) continue;
            lineWords.push_back(WordBox{std::move(wordText), left, top, wordBounds.Width, wordBounds.Height, rowIndex});
        }
        if (text.empty()) text = ocrjoin::TightenSpaces(std::wstring(ocrLine.Text().c_str(), ocrLine.Text().size()));
        text = ClipWide(std::move(text));
        if (text.empty()) continue;
        const double boxLeft = span.any ? span.left : 0;
        const double boxTop = span.any ? span.top : 0;
        const double boxWidth = span.any ? span.right - span.left : 0;
        const double boxHeight = span.any ? span.bottom - span.top : 0;
        Line line;
        line.text = ToUtf8(text);
        line.x = Fraction(boxLeft, width);
        line.y = Fraction(boxTop, height);
        line.w = Fraction(boxWidth, width);
        line.h = Fraction(boxHeight, height);
        if (line.x + line.w > 1) line.w = Fraction(1.0 - line.x, 1.0);
        if (line.y + line.h > 1) line.h = Fraction(1.0 - line.y, 1.0);
        line.at = at;
        rows.push_back(Row{boxLeft, boxTop, boxWidth, boxHeight});
        for (WordBox& boxed : lineWords) words.push_back(std::move(boxed));
        out.push_back(std::move(line));
        ++added;
    }
    AppendTable(rows, words, width, height, at, out);
    return true;
}

#ifdef ROCKSCELLS_HAS_RECORD

// MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS。record.cpp と同じく、定数の名前には依存しない
constexpr GUID kEnableHardware = {0xa634a91c, 0x822b, 0x41b9, {0xa4, 0x94, 0x4d, 0xe4, 0x64, 0x36, 0x12, 0xb0}};

struct MfSession {
    bool on = false;
    MfSession() { on = SUCCEEDED(MFStartup(MF_VERSION, MFSTARTUP_FULL)); }
    ~MfSession() {
        if (on) MFShutdown();
    }
    MfSession(const MfSession&) = delete;
    MfSession& operator=(const MfSession&) = delete;
};

bool CopyRgb32(const BYTE* data, DWORD length, int width, int height, INT32 stride, std::vector<std::uint8_t>& bgra) {
    if (!data || width < 2 || height < 2) return false;
    const int rowBytes = width * 4;
    int step = stride == 0 ? rowBytes : stride;
    const int absStep = step < 0 ? -step : step;
    if (absStep < rowBytes) return false;
    const std::size_t need = static_cast<std::size_t>(absStep) * static_cast<std::size_t>(height);
    if (static_cast<std::size_t>(length) < need) return false;
    bgra.resize(static_cast<std::size_t>(rowBytes) * static_cast<std::size_t>(height));
    const bool bottomUp = step < 0;
    const BYTE* first = bottomUp ? data + static_cast<std::size_t>(absStep) * static_cast<std::size_t>(height - 1) : data;
    const int walk = bottomUp ? -absStep : absStep;
    for (int y = 0; y < height; ++y) {
        const BYTE* row = first + static_cast<std::ptrdiff_t>(walk) * y;
        std::memcpy(bgra.data() + static_cast<std::size_t>(y) * static_cast<std::size_t>(rowBytes), row, static_cast<std::size_t>(rowBytes));
    }
    return true;
}

bool GrabSample(IMFSourceReader* reader, std::vector<std::uint8_t>& pixels, int& width, int& height) {
    width = 0;
    height = 0;
    pixels.clear();
    for (int attempt = 0; attempt < 8; ++attempt) {
        DWORD flags = 0;
        LONGLONG stamp = 0;
        ComPtr<IMFSample> sample;
        // mfreadwrite.h の制御フラグは MF_SOURCE_READER_CONTROLF_DRAIN だけ（FLUSH は無い）。
        // SetCurrentPosition が待ちサンプルを捨てるので、ここは 0 のまま読む。
        const HRESULT hr = reader->ReadSample(static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM), 0, nullptr, &flags, &stamp, &sample);
        (void)stamp;
        if (FAILED(hr)) return false;
        if (flags & MF_SOURCE_READERF_ERROR) return false;
        if (flags & MF_SOURCE_READERF_ENDOFSTREAM) return false;
        if (flags & MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED) continue;
        if (!sample) continue;
        ComPtr<IMFMediaType> kind;
        if (FAILED(reader->GetCurrentMediaType(static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM), &kind))) return false;
        UINT32 wide = 0;
        UINT32 high = 0;
        if (FAILED(MFGetAttributeSize(kind.Get(), MF_MT_FRAME_SIZE, &wide, &high))) return false;
        UINT32 rawStride = 0;
        INT32 stride = static_cast<INT32>(wide) * 4;
        if (SUCCEEDED(kind->GetUINT32(MF_MT_DEFAULT_STRIDE, &rawStride))) stride = static_cast<INT32>(rawStride);
        ComPtr<IMFMediaBuffer> buffer;
        if (FAILED(sample->ConvertToContiguousBuffer(&buffer))) return false;
        BYTE* data = nullptr;
        DWORD length = 0;
        if (FAILED(buffer->Lock(&data, nullptr, &length))) return false;
        const bool copied = CopyRgb32(data, length, static_cast<int>(wide), static_cast<int>(high), stride, pixels);
        buffer->Unlock();
        if (!copied) return false;
        width = static_cast<int>(wide);
        height = static_cast<int>(high);
        return true;
    }
    return false;
}

// 1枚でも読めれば true（文字が無くても）。開けなければ false（呼び出し側が JPEG に戻る）
bool ReadVideo(const wocr::OcrEngine& engine, const std::wstring& path, const std::vector<int>& times, std::vector<Line>& out) {
    MfSession session;
    if (!session.on) return false;
    ComPtr<IMFAttributes> attrs;
    if (FAILED(MFCreateAttributes(&attrs, 1))) return false;
    attrs->SetUINT32(kEnableHardware, FALSE);
    ComPtr<IMFSourceReader> reader;
    if (FAILED(MFCreateSourceReaderFromURL(path.c_str(), attrs.Get(), &reader))) return false;
    reader->SetStreamSelection(static_cast<DWORD>(MF_SOURCE_READER_ALL_STREAMS), FALSE);
    reader->SetStreamSelection(static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM), TRUE);
    ComPtr<IMFMediaType> kind;
    if (FAILED(MFCreateMediaType(&kind))) return false;
    kind->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    kind->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
    if (FAILED(reader->SetCurrentMediaType(static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM), nullptr, kind.Get()))) return false;

    bool any = false;
    int previous = -1;
    int samples = 0;
    for (int ms : times) {
        if (samples >= kSampleCap || static_cast<int>(out.size()) >= kTotalCap) break;
        if (ms == previous) continue;
        previous = ms;
        ++samples;
        PROPVARIANT position{};
        position.vt = VT_I8;
        position.hVal.QuadPart = static_cast<LONGLONG>(ms) * 10000;
        const HRESULT seek = reader->SetCurrentPosition(GUID_NULL, position);
        PropVariantClear(&position);
        if (FAILED(seek)) continue;
        std::vector<std::uint8_t> frame;
        int width = 0;
        int height = 0;
        if (!GrabSample(reader.Get(), frame, width, height)) continue;
        std::vector<std::uint8_t> fitted;
        int fitW = 0;
        int fitH = 0;
        if (!FitPixels(frame.data(), width, height, fitted, fitW, fitH)) continue;
        if (!AppendFrame(engine, fitted, fitW, fitH, ms, out)) return any;
        any = true;
    }
    return any;
}

#endif  // ROCKSCELLS_HAS_RECORD

Outcome ReadOnWorker(const std::vector<std::uint8_t>& jpeg, const std::wstring& videoPath, const std::vector<int>& times) {
    wocr::OcrEngine engine{nullptr};
    try {
        engine = MakeJapaneseEngine();
    } catch (...) {
        return {Failure::Engine, {}};
    }
    if (!engine) return {Failure::NoJapanese, {}};

    std::vector<Line> lines;
    bool fromVideo = false;
#ifdef ROCKSCELLS_HAS_RECORD
    if (!videoPath.empty() && !times.empty()) {
        try {
            fromVideo = ReadVideo(engine, videoPath, times, lines);
        } catch (...) {
            fromVideo = false;
            lines.clear();
        }
    }
#else
    (void)videoPath;
#endif
    if (!fromVideo) {
        std::vector<std::uint8_t> poster;
        int width = 0;
        int height = 0;
        if (!FitLongEdge(jpeg.data(), jpeg.size(), poster, width, height)) return {Failure::Decode, {}};
        const int at = times.empty() ? -1 : times.front();
        try {
            if (!AppendFrame(engine, poster, width, height, at, lines)) return {Failure::Engine, {}};
        } catch (...) {
            return {Failure::Engine, {}};
        }
    }
    if (static_cast<int>(lines.size()) > kTotalCap) lines.resize(static_cast<size_t>(kTotalCap));
    return {Failure::None, std::move(lines)};
}

}  // namespace

bool Available() { return true; }

Outcome Read(const std::vector<std::uint8_t>& jpeg, const std::wstring& videoPath, const std::vector<int>& times) {
    // UI スレッドは STA。ここで MTA の初期化は失敗し、.get() には進まない。成功したスレッドだけ後で戻す
    struct Apartment {
        bool ok = false;
        Apartment() {
            try {
                winrt::init_apartment(winrt::apartment_type::multi_threaded);
                ok = true;
            } catch (...) {
                ok = false;
            }
        }
        ~Apartment() {
            if (ok) winrt::uninit_apartment();
        }
    } apartment;
    if (!apartment.ok) return {Failure::Engine, {}};
    try {
        return ReadOnWorker(jpeg, videoPath, times);
    } catch (...) {
        return {Failure::Engine, {}};
    }
}

}  // namespace ocr

#endif  // ROCKSCELLS_HAS_OCR
