// アプリのセル
//   A1：登録するファイルを選んでもらい、ショートカットなら実行ファイルの場所を読み、アイコンを PNG にする
//   A2：既にある窓を前に出す。無ければ ShellExecuteExW で起動する
//   A3：中央の区画に合わせ、最前面にする。起動用と窓の exe が違うときはファイル名と新しい窓でも探す
//   A5：ストアアプリは、ショートカットと窓のアプリ ID（System.AppUserModel.ID）で探す
#include "apps.h"

#include <processthreadsapi.h>  // OpenProcess、QueryFullProcessImageNameW（A2 で窓の実行ファイルを聞く）
#include <shellapi.h>           // SHGetFileInfoW（アイコンと表示名）、ShellExecuteExW（A2 の起動）
#include <shlobj.h>    // SHGetKnownFolderPath（スタートメニュー）、IShellLink
#include <shobjidl.h>  // IFileOpenDialog
#include <wincodec.h>  // アイコンを PNG にする（リンクは windowscodecs。clipboard.cpp と同じ）
#include <wrl/client.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <cwctype>
#include <filesystem>
#include <string>
#include <vector>

#include "storage.h"
#include "strings.h"

using Microsoft::WRL::ComPtr;
using nlohmann::json;
namespace fs = std::filesystem;

namespace apps {
namespace {

constexpr int kMaxNameUnits = 80;             // C++ が返す名前の上限（UTF-16 の個数）。UI がさらに 40 文字に切る
constexpr size_t kMaxPngBytes = 64 * 1024;    // アイコンの PNG。これを超えたらアイコン無しで登録する
constexpr int kMaxIconEdge = 256;             // これより大きいアイコンは使わない（セルには大きすぎる）

json Fail(const char* error) {
    return {{"ok", false}, {"error", error}};
}

// 拡張子を小文字に（.EXE → .exe）。ドット付き
std::wstring ExtensionOf(const std::wstring& path) {
    std::wstring ext = fs::path(path).extension().wstring();
    for (wchar_t& c : ext) c = static_cast<wchar_t>(towlower(static_cast<wint_t>(c)));
    return ext;
}

// ドライブ文字か、\\ で始まる UNC。制御文字は含めない
bool IsAbsolutePath(const std::wstring& path) {
    if (path.size() < 3 || path.size() > 32767) return false;
    for (const wchar_t c : path) {
        if (c < 32) return false;
    }
    const bool drive = ((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z')) && path[1] == L':' &&
                        (path[2] == L'\\' || path[2] == L'/');
    return drive || (path[0] == L'\\' && path[1] == L'\\');
}

bool IsFile(const std::wstring& path) {
    if (!IsAbsolutePath(path)) return false;
    std::error_code error;
    return fs::is_regular_file(fs::path(path), error) && !error;
}

bool IsDirectory(const std::wstring& path) {
    if (!IsAbsolutePath(path)) return false;
    std::error_code error;
    return fs::is_directory(fs::path(path), error) && !error;
}

// 改行をスペースにし、前後の空白を取り、長すぎる分を切る
std::wstring CleanName(std::wstring name) {
    std::wstring out;
    bool gap = false;
    for (wchar_t c : name) {
        if (c < 32 || c == L'\u007f') c = L' ';
        if (c == L' ') {
            gap = !out.empty();
            continue;
        }
        if (gap) out.push_back(L' ');
        gap = false;
        out.push_back(c);
        if (static_cast<int>(out.size()) >= kMaxNameUnits) break;
    }
    return out;
}

// IShellLink::GetPath などに渡す、書き込みできるバッファ
std::wstring WideBuffer(int chars) {
    return std::wstring(static_cast<size_t>(chars), L'\0');
}

std::wstring TakeWritten(std::wstring buffer) {
    buffer.resize(wcslen(buffer.c_str()));
    return buffer;
}

// ショートカット（.lnk）の中身。target は解決できた .exe（無ければ空）。起動はしない
struct LinkInfo {
    std::wstring target;
    std::wstring args;
    std::wstring cwd;
    std::wstring appId;  // System.AppUserModel.ID。ストアアプリを窓と突き合わせる
};

// PKEY_AppUserModel_ID。fmtid は {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}、pid は 5（propkey.h）
const PROPERTYKEY kAppUserModelId{
    {0x9F4C2855, 0x9F79, 0x4B39, {0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3}},
    5,
};

// アプリ ID として渡してよい文字列か。制御文字やパスの区切りは不可。長さは 128 まで
bool AcceptableAppId(const std::wstring& id) {
    if (id.empty() || id.size() > 128) return false;
    for (const wchar_t c : id) {
        if (c < 33 || c == 127 || c == L'\\' || c == L'/' || c == L'"' || c == L'<' || c == L'>' || c == L'|' || c == L'*' || c == L'?') return false;
    }
    return true;
}

std::wstring AppIdFromVariant(const PROPVARIANT& value) {
    const wchar_t* text = nullptr;
    if (value.vt == VT_LPWSTR) text = value.pwszVal;
    else if (value.vt == VT_BSTR) text = value.bstrVal;
    if (!text || !text[0]) return {};
    std::wstring id(text);
    if (!AcceptableAppId(id)) return {};
    return id;
}

std::wstring AppIdFromStore(IPropertyStore* store) {
    if (!store) return {};
    PROPVARIANT value{};
    const HRESULT read = store->GetValue(kAppUserModelId, &value);
    const std::wstring id = SUCCEEDED(read) ? AppIdFromVariant(value) : std::wstring{};
    PropVariantClear(&value);
    return id;
}

LinkInfo ReadLink(const std::wstring& path) {
    LinkInfo info;
    ComPtr<IShellLinkW> link;
    if (FAILED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&link)))) return info;
    ComPtr<IPersistFile> file;
    if (FAILED(link.As(&file)) || FAILED(file->Load(path.c_str(), STGM_READ))) return info;
    // ファイルが無くても UI は出さない（SLR_NO_UI）。見つからなくても、下の GetPath が記録されているパスを返すことがある
    link->Resolve(nullptr, SLR_NO_UI | SLR_NOUPDATE | SLR_NOSEARCH | SLR_NOTRACK);

    std::wstring target = WideBuffer(32767);
    if (SUCCEEDED(link->GetPath(target.data(), static_cast<int>(target.size()), nullptr, 0))) {
        target = TakeWritten(std::move(target));
        if (IsFile(target) && ExtensionOf(target) == L".exe") info.target = std::move(target);
    }
    std::wstring args = WideBuffer(2048);
    if (SUCCEEDED(link->GetArguments(args.data(), static_cast<int>(args.size())))) info.args = TakeWritten(std::move(args));
    std::wstring cwd = WideBuffer(2048);
    if (SUCCEEDED(link->GetWorkingDirectory(cwd.data(), static_cast<int>(cwd.size())))) {
        cwd = TakeWritten(std::move(cwd));
        if (IsDirectory(cwd)) info.cwd = std::move(cwd);
    }
    ComPtr<IPropertyStore> store;
    if (SUCCEEDED(link.As(&store))) info.appId = AppIdFromStore(store.Get());
    return info;
}

// アイコンを、黒地と白地に描いて、透明を戻す（DrawIconEx は 32bit のアルファを捨てることがある）
bool DrawIcon(HICON icon, int width, int height, COLORREF background, std::vector<uint8_t>& pixels) {
    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = width;
    info.bmiHeader.biHeight = -height;  // 上の行から
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    void* bits = nullptr;
    HDC screen = GetDC(nullptr);
    HBITMAP dib = screen ? CreateDIBSection(screen, &info, DIB_RGB_COLORS, &bits, nullptr, 0) : nullptr;
    HDC mem = dib ? CreateCompatibleDC(screen) : nullptr;
    HGDIOBJ old = mem ? SelectObject(mem, dib) : nullptr;
    HBRUSH brush = CreateSolidBrush(background);
    bool ok = bits && mem && old && brush;
    if (ok) {
        const RECT rc{0, 0, width, height};
        FillRect(mem, &rc, brush);
        ok = DrawIconEx(mem, 0, 0, icon, width, height, 0, nullptr, DI_NORMAL) != FALSE;
    }
    if (ok) {
        pixels.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * 4);
        memcpy(pixels.data(), bits, pixels.size());
    }
    if (old && mem) SelectObject(mem, old);
    if (brush) DeleteObject(brush);
    if (mem) DeleteDC(mem);
    if (dib) DeleteObject(dib);
    if (screen) ReleaseDC(nullptr, screen);
    return ok;
}

void RestoreAlpha(const std::vector<uint8_t>& onBlack, const std::vector<uint8_t>& onWhite, std::vector<uint8_t>& out) {
    out.assign(onBlack.size(), 0);
    for (size_t i = 0; i + 3 < onBlack.size() && i + 3 < onWhite.size(); i += 4) {
        auto alphaOf = [](int white, int black) {
            const int diff = white - black;
            const int clamped = diff < 0 ? 0 : (diff > 255 ? 255 : diff);
            return 255 - clamped;
        };
        int alpha = alphaOf(onWhite[i], onBlack[i]);
        const int green = alphaOf(onWhite[i + 1], onBlack[i + 1]);
        const int red = alphaOf(onWhite[i + 2], onBlack[i + 2]);
        if (green > alpha) alpha = green;
        if (red > alpha) alpha = red;
        if (alpha < 8) continue;
        auto color = [alpha](int onBlackChannel) {
            const int value = onBlackChannel * 255 / alpha;
            return static_cast<uint8_t>(value > 255 ? 255 : value);
        };
        out[i] = color(onBlack[i]);
        out[i + 1] = color(onBlack[i + 1]);
        out[i + 2] = color(onBlack[i + 2]);
        out[i + 3] = static_cast<uint8_t>(alpha);
    }
}

bool EncodePng(const std::vector<uint8_t>& pixels, int width, int height, std::vector<BYTE>& png) {
    ComPtr<IWICImagingFactory> factory;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)))) return false;
    ComPtr<IStream> stream;
    if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream))) return false;
    ComPtr<IWICBitmapEncoder> encoder;
    if (FAILED(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder))) return false;
    if (FAILED(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache))) return false;
    ComPtr<IWICBitmapFrameEncode> frame;
    if (FAILED(encoder->CreateNewFrame(&frame, nullptr))) return false;
    if (FAILED(frame->Initialize(nullptr)) || FAILED(frame->SetSize(static_cast<UINT>(width), static_cast<UINT>(height)))) return false;
    WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
    if (FAILED(frame->SetPixelFormat(&format)) || format != GUID_WICPixelFormat32bppBGRA) return false;
    const UINT stride = static_cast<UINT>(width) * 4;
    if (FAILED(frame->WritePixels(static_cast<UINT>(height), stride, static_cast<UINT>(pixels.size()),
                                  reinterpret_cast<BYTE*>(const_cast<uint8_t*>(pixels.data()))))) {
        return false;
    }
    if (FAILED(frame->Commit()) || FAILED(encoder->Commit())) return false;
    STATSTG stat{};
    if (FAILED(stream->Stat(&stat, STATFLAG_NONAME)) || stat.cbSize.QuadPart == 0 || stat.cbSize.QuadPart > kMaxPngBytes) return false;
    HGLOBAL memory = nullptr;
    if (FAILED(GetHGlobalFromStream(stream.Get(), &memory))) return false;
    const auto* bytes = static_cast<const uint8_t*>(GlobalLock(memory));
    if (!bytes) return false;
    png.assign(bytes, bytes + static_cast<size_t>(stat.cbSize.QuadPart));
    GlobalUnlock(memory);
    return true;
}

// ファイルのアイコンを PNG の Base64 にする（data: の頭は付けない）。取れなければ空
std::string IconBase64(const std::wstring& path) {
    SHFILEINFOW info{};
    if (SHGetFileInfoW(path.c_str(), 0, &info, sizeof(info), SHGFI_ICON | SHGFI_LARGEICON) == 0 || !info.hIcon) return {};
    ICONINFO iconInfo{};
    int width = 0;
    int height = 0;
    const bool sized = GetIconInfo(info.hIcon, &iconInfo) != FALSE;
    if (sized) {
        BITMAP bm{};
        const HBITMAP sample = iconInfo.hbmColor ? iconInfo.hbmColor : iconInfo.hbmMask;
        if (sample && GetObject(sample, static_cast<int>(sizeof(bm)), &bm) == static_cast<int>(sizeof(bm))) {
            width = bm.bmWidth;
            height = iconInfo.hbmColor ? bm.bmHeight : bm.bmHeight / 2;
        }
    }
    if (iconInfo.hbmColor) DeleteObject(iconInfo.hbmColor);
    if (iconInfo.hbmMask) DeleteObject(iconInfo.hbmMask);
    std::string encoded;
    if (width > 0 && height > 0 && width <= kMaxIconEdge && height <= kMaxIconEdge) {
        std::vector<uint8_t> onBlack;
        std::vector<uint8_t> onWhite;
        std::vector<uint8_t> bgra;
        std::vector<BYTE> png;
        if (DrawIcon(info.hIcon, width, height, RGB(0, 0, 0), onBlack) && DrawIcon(info.hIcon, width, height, RGB(255, 255, 255), onWhite) &&
            onBlack.size() == onWhite.size()) {
            RestoreAlpha(onBlack, onWhite, bgra);
            if (EncodePng(bgra, width, height, png)) encoded = Base64(png);
        }
    }
    DestroyIcon(info.hIcon);
    return encoded;
}

std::wstring DisplayName(const std::wstring& path) {
    SHFILEINFOW info{};
    if (SHGetFileInfoW(path.c_str(), 0, &info, sizeof(info), SHGFI_DISPLAYNAME) == 0) return {};
    return CleanName(info.szDisplayName);
}

// スタートメニューの「プログラム」から始める。取れなければ、ダイアログの既定の場所のまま
void StartInPrograms(IFileOpenDialog* dialog) {
    PWSTR programs = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_Programs, 0, nullptr, &programs)) || !programs) return;
    ComPtr<IShellItem> folder;
    if (SUCCEEDED(SHCreateItemFromParsingName(programs, nullptr, IID_PPV_ARGS(&folder)))) dialog->SetFolder(folder.Get());
    CoTaskMemFree(programs);
}

constexpr DWORD kPathChars = 32768;  // パスの上限（ヌル文字の分を含む）

// 大文字小文字を無視して、文字列全体が同じか（パス用。ロケールには依存しない）
bool EqualsIgnoreCase(const std::wstring& a, const std::wstring& b) {
    return CompareStringOrdinal(a.c_str(), static_cast<int>(a.size()), b.c_str(), static_cast<int>(b.size()), TRUE) == CSTR_EQUAL;
}

// 比べる前に揃える。スラッシュ、\\?\ の頭、8.3 の短い名前
std::wstring NormalizeExe(std::wstring path) {
    for (wchar_t& c : path) {
        if (c == L'/') c = L'\\';
    }
    const std::wstring prefix = L"\\\\?\\";
    if (path.size() >= prefix.size() && EqualsIgnoreCase(path.substr(0, prefix.size()), prefix)) path.erase(0, prefix.size());
    while (path.size() > 3 && path.back() == L'\\') path.pop_back();
    wchar_t buffer[kPathChars];
    const DWORD length = GetLongPathNameW(path.c_str(), buffer, kPathChars);
    if (length > 0 && length < kPathChars) return std::wstring(buffer, length);
    return path;
}

std::wstring FileNameOf(const std::wstring& path) {
    return fs::path(path).filename().wstring();
}

// そのプロセスの実行ファイルのフルパス。聞けなければ空。
// denied には、管理者などで聞けなかったとき true を入れる（他の失敗では変えない）。
std::wstring ProcessImage(DWORD pid, bool* denied) {
    if (pid == 0) return {};
    const HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!process) {
        if (denied && GetLastError() == ERROR_ACCESS_DENIED) *denied = true;
        return {};
    }
    wchar_t buffer[kPathChars];
    DWORD length = kPathChars;
    const BOOL ok = QueryFullProcessImageNameW(process, 0, buffer, &length);
    CloseHandle(process);
    if (!ok || length == 0 || length >= kPathChars) return {};
    return std::wstring(buffer, length);
}

// 実行ファイルに渡してよい引数か。制御文字は不可（タブだけは残す）。長すぎるものも渡さない
bool SafeArgs(const std::wstring& args) {
    if (args.empty() || args.size() > 2048) return false;
    for (const wchar_t c : args) {
        if (c < 32 && c != L'\t') return false;
    }
    return true;
}

bool IsFrameHostImage(const std::wstring& path) {
    return EqualsIgnoreCase(FileNameOf(path), L"ApplicationFrameHost.exe");
}

// kernel32 の GetApplicationUserModelId。宣言の有無に依存しない（Windows 8 以降）
using AppModelIdFn = LONG(WINAPI*)(HANDLE, UINT32*, PWSTR);

AppModelIdFn ProcessAppIdFn() {
    static const AppModelIdFn fn = reinterpret_cast<AppModelIdFn>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "GetApplicationUserModelId"));
    return fn;
}

std::wstring AppIdOfProcess(DWORD pid) {
    const AppModelIdFn fn = ProcessAppIdFn();
    if (!fn || pid == 0) return {};
    const HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!process) return {};
    UINT32 length = 0;
    const LONG asked = fn(process, &length, nullptr);
    // 長さは終端のヌルを含む。130 を超えるものはアプリ ID ではない
    if (asked != ERROR_INSUFFICIENT_BUFFER || length < 2 || length > 130) {
        CloseHandle(process);
        return {};
    }
    std::wstring id(length, L'\0');
    const LONG read = fn(process, &length, id.data());
    CloseHandle(process);
    if (read != ERROR_SUCCESS) return {};
    id.resize(wcslen(id.c_str()));
    if (!AcceptableAppId(id)) return {};
    return id;
}

// DWMWA_CLOAKED（14）。見えていない UWP の窓を、別のアプリとして掴まない。dwmapi は LoadLibrary（リンクしない）
bool WindowCloaked(HWND hwnd) {
    using AttrFn = HRESULT(WINAPI*)(HWND, DWORD, void*, DWORD);
    static const AttrFn fn = []() -> AttrFn {
        HMODULE library = GetModuleHandleW(L"dwmapi.dll");
        if (!library) library = LoadLibraryW(L"dwmapi.dll");
        if (!library) return nullptr;
        return reinterpret_cast<AttrFn>(GetProcAddress(library, "DwmGetWindowAttribute"));
    }();
    if (!fn || !hwnd) return false;
    DWORD cloaked = 0;
    if (FAILED(fn(hwnd, 14, &cloaked, sizeof(cloaked)))) return false;
    return cloaked != 0;
}

// ApplicationFrameHost の中の、本物のアプリのプロセス
std::wstring AppIdOfCoreChild(HWND hwnd) {
    struct Bag {
        DWORD framePid = 0;
        std::wstring appId;
        bool coreOnly = true;
    } bag;
    GetWindowThreadProcessId(hwnd, &bag.framePid);
    auto visit = [](HWND child, LPARAM param) -> BOOL {
        auto* bag = reinterpret_cast<Bag*>(param);
        DWORD pid = 0;
        GetWindowThreadProcessId(child, &pid);
        if (pid == 0 || pid == bag->framePid) return TRUE;
        if (bag->coreOnly) {
            wchar_t className[64];
            if (GetClassNameW(child, className, 64) <= 0 || wcscmp(className, L"Windows.UI.Core.CoreWindow") != 0) return TRUE;
        }
        const std::wstring id = AppIdOfProcess(pid);
        if (id.empty()) return TRUE;
        bag->appId = id;
        return FALSE;
    };
    EnumChildWindows(hwnd, visit, reinterpret_cast<LPARAM>(&bag));
    if (!bag.appId.empty()) return bag.appId;
    bag.coreOnly = false;
    EnumChildWindows(hwnd, visit, reinterpret_cast<LPARAM>(&bag));
    return bag.appId;
}

bool FrameWindowClass(HWND hwnd) {
    wchar_t className[64];
    return GetClassNameW(hwnd, className, 64) > 0 && wcscmp(className, L"ApplicationFrameWindow") == 0;
}

std::wstring WindowTitle(HWND hwnd) {
    const int length = GetWindowTextLengthW(hwnd);
    if (length <= 0 || length > 512) return {};
    std::wstring text(static_cast<size_t>(length) + 1, L'\0');
    const int written = GetWindowTextW(hwnd, text.data(), length + 1);
    if (written <= 0) return {};
    text.resize(static_cast<size_t>(written));
    return text;
}

bool ContainsText(const std::wstring& hay, const std::wstring& needle) {
    if (needle.size() < 2 || hay.size() < needle.size()) return false;
    const int span = static_cast<int>(needle.size());
    const int last = static_cast<int>(hay.size()) - span;
    for (int i = 0; i <= last; ++i) {
        if (CompareStringOrdinal(hay.c_str() + i, span, needle.c_str(), span, TRUE) == CSTR_EQUAL) return true;
    }
    return false;
}

}  // namespace

json Pick(HWND owner) {
    ComPtr<IFileOpenDialog> dialog;
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)))) return Fail("dialog");
    DWORD options = 0;
    if (FAILED(dialog->GetOptions(&options))) return Fail("dialog");
    // 実在するファイルだけ。スタートメニューのショートカットも、ディスク上の .lnk なのでここで選べる
    if (FAILED(dialog->SetOptions(options | FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST | FOS_FORCEFILESYSTEM))) return Fail("dialog");
    const COMDLG_FILTERSPEC filters[] = {
        {L"アプリ（実行ファイルとショートカット）", L"*.exe;*.lnk"},
        {L"実行ファイル", L"*.exe"},
        {L"ショートカット", L"*.lnk"},
    };
    dialog->SetFileTypes(3, filters);
    dialog->SetTitle(L"盤面に登録するアプリを選ぶ");
    StartInPrograms(dialog.Get());
    const HRESULT shown = dialog->Show(owner);
    if (shown == HRESULT_FROM_WIN32(ERROR_CANCELLED)) return Fail("cancel");
    if (FAILED(shown)) return Fail("dialog");

    ComPtr<IShellItem> item;
    if (FAILED(dialog->GetResult(&item))) return Fail("dialog");
    PWSTR pickedPath = nullptr;
    if (FAILED(item->GetDisplayName(SIGDN_FILESYSPATH, &pickedPath)) || !pickedPath) return Fail("dialog");
    const std::wstring picked(pickedPath);
    CoTaskMemFree(pickedPath);

    if (!IsFile(picked)) return Fail("missing");
    const std::wstring ext = ExtensionOf(picked);
    if (ext != L".exe" && ext != L".lnk") return Fail("type");

    std::wstring target;
    std::wstring args;
    std::wstring cwd;
    std::wstring shortcut;
    std::wstring appId;
    std::wstring launch = picked;
    if (ext == L".lnk") {
        shortcut = picked;
        const LinkInfo link = ReadLink(picked);
        target = link.target;
        args = link.args;
        cwd = link.cwd;
        appId = link.appId;
        // ショートカット自身を起動パスにする（A2 が引数・作業フォルダ・ストアアプリを残せるように）
        launch = picked;
    } else {
        target = picked;
        launch = picked;
    }

    const std::wstring iconPath = !target.empty() && IsFile(target) ? target : picked;
    const std::string icon = IconBase64(iconPath);
    std::wstring name = DisplayName(picked);
    if (name.empty()) name = CleanName(fs::path(picked).stem().wstring());
    if (name.empty()) name = L"アプリ";

    return {{"ok", true},
            {"name", ToUtf8(name)},
            {"launch", ToUtf8(launch)},
            {"target", ToUtf8(target)},
            {"args", ToUtf8(args)},
            {"cwd", ToUtf8(cwd)},
            {"shortcut", ToUtf8(shortcut)},
            {"aumid", ToUtf8(appId)},
            {"icon", icon.empty() ? std::string() : "data:image/png;base64," + icon}};
}

bool IsStoreTarget(const std::wstring& target) {
    if (target.empty()) return true;
    return EqualsIgnoreCase(FileNameOf(target), L"ApplicationFrameHost.exe");
}

std::wstring ShortcutAppId(const std::wstring& shortcut) {
    if (!IsFile(shortcut) || ExtensionOf(shortcut) != L".lnk") return {};
    return ReadLink(shortcut).appId;
}

std::wstring WindowAppId(HWND window) {
    if (!window || !IsWindow(window) || WindowCloaked(window)) return {};
    DWORD pid = 0;
    GetWindowThreadProcessId(window, &pid);
    const std::wstring image = ProcessImage(pid, nullptr);
    const bool frame = IsFrameHostImage(image) || FrameWindowClass(window);
    // ホストの窓は使い回されることがある。中のプロセスの ID を、窓に残ったプロパティより先に使う
    if (frame) {
        const std::wstring child = AppIdOfCoreChild(window);
        if (!child.empty()) return child;
    }
    ComPtr<IPropertyStore> store;
    if (SUCCEEDED(SHGetPropertyStoreForWindow(window, IID_PPV_ARGS(&store)))) {
        const std::wstring id = AppIdFromStore(store.Get());
        if (!id.empty()) return id;
    }
    if (frame) return {};
    return AppIdOfProcess(pid);
}

bool SameAppId(const std::wstring& a, const std::wstring& b) {
    if (!AcceptableAppId(a) || !AcceptableAppId(b)) return false;
    return EqualsIgnoreCase(a, b);
}

bool SameExePath(const std::wstring& a, const std::wstring& b) {
    if (a.empty() || b.empty()) return false;
    return EqualsIgnoreCase(NormalizeExe(a), NormalizeExe(b));
}

namespace {

bool FrameHostFile(const std::wstring& path) {
    return EqualsIgnoreCase(FileNameOf(path), L"ApplicationFrameHost.exe");
}

// ファイル名で探してよいパスなら、そのファイル名。ストアのホストや空は空
std::wstring MatchableFileName(const std::wstring& path) {
    if (path.empty() || IsStoreTarget(path) || FrameHostFile(path)) return {};
    return FileNameOf(path);
}

bool TopLevelCandidate(HWND hwnd, DWORD self) {
    if (!hwnd || !IsWindowVisible(hwnd)) return false;
    DWORD windowPid = 0;
    GetWindowThreadProcessId(hwnd, &windowPid);
    if (windowPid == 0 || windowPid == self) return false;
    const LONG_PTR style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    if ((style & WS_EX_TOOLWINDOW) != 0 && (style & WS_EX_APPWINDOW) == 0) return false;
    RECT rect{};
    return GetWindowRect(hwnd, &rect) && rect.right > rect.left && rect.bottom > rect.top;
}

bool ListedEarlier(const std::vector<HWND>* earlier, HWND hwnd) {
    if (!earlier) return false;
    return std::find(earlier->begin(), earlier->end(), hwnd) != earlier->end();
}

struct Slot {
    HWND hwnd = nullptr;
    FoundVia via = FoundVia::None;
    std::wstring host;
    std::wstring appId;
};

// 同じ強さなら、先に見たもの（手前）を残す
void KeepBetter(Slot* slot, HWND hwnd, FoundVia via, const std::wstring& host, const std::wstring& appId) {
    if (!slot->hwnd || static_cast<int>(via) < static_cast<int>(slot->via)) {
        slot->hwnd = hwnd;
        slot->via = via;
        slot->host = host;
        slot->appId = appId;
    }
}

}  // namespace

std::vector<HWND> ListVisibleWindows() {
    struct Bag {
        DWORD self = 0;
        std::vector<HWND> windows;
    } bag;
    bag.self = GetCurrentProcessId();
    EnumWindows(
        [](HWND hwnd, LPARAM param) -> BOOL {
            auto* bag = reinterpret_cast<Bag*>(param);
            if (TopLevelCandidate(hwnd, bag->self)) bag->windows.push_back(hwnd);
            return TRUE;
        },
        reinterpret_cast<LPARAM>(&bag));
    return bag.windows;
}

std::wstring HostOf(HWND window) {
    if (!window || !IsWindow(window)) return {};
    DWORD pid = 0;
    GetWindowThreadProcessId(window, &pid);
    const std::wstring image = ProcessImage(pid, nullptr);
    if (image.empty() || IsStoreTarget(image) || FrameHostFile(image)) return {};
    return image;
}

FoundWindow FindAppWindow(const WindowLook& look) {
    FoundWindow found;
    const bool havePath = (!look.target.empty() && !IsStoreTarget(look.target)) || (!look.host.empty() && !IsStoreTarget(look.host));
    const bool haveAppId = SameAppId(look.appId, look.appId);
    const bool haveTitle = look.title.size() >= 2;
    if (!havePath && !haveAppId && !haveTitle && look.pid == 0 && !(look.allowFresh && look.earlier)) return found;

    struct Search {
        std::wstring target;
        std::wstring host;
        std::wstring targetName;
        std::wstring hostName;
        std::wstring appId;
        std::wstring title;
        bool allowFresh = true;
        DWORD self = 0;
        DWORD pid = 0;
        const std::vector<HWND>* earlier = nullptr;
        HWND foreground = nullptr;
        bool* accessDenied = nullptr;
        int looseTitle = 0;  // 題名への部分一致。2つ以上なら、どれも掴まない
        Slot loose;
        Slot unowned;
        Slot owned;
    } search;
    search.target = look.target;
    search.host = look.host;
    search.targetName = MatchableFileName(look.target);
    search.hostName = MatchableFileName(look.host);
    search.appId = haveAppId ? look.appId : std::wstring{};
    search.title = haveTitle ? look.title : std::wstring{};
    search.allowFresh = look.allowFresh;
    search.self = GetCurrentProcessId();
    search.pid = look.pid;
    search.earlier = look.earlier;
    search.foreground = GetForegroundWindow();
    search.accessDenied = look.accessDenied;

    EnumWindows(
        [](HWND hwnd, LPARAM param) -> BOOL {
            auto* search = reinterpret_cast<Search*>(param);
            if (!TopLevelCandidate(hwnd, search->self) || WindowCloaked(hwnd)) return TRUE;
            DWORD windowPid = 0;
            GetWindowThreadProcessId(hwnd, &windowPid);
            bool denied = false;
            const std::wstring image = ProcessImage(windowPid, &denied);
            if (denied && search->accessDenied) *search->accessDenied = true;
            const bool frameHost = !image.empty() && (IsStoreTarget(image) || FrameHostFile(image));
            const std::wstring imageName = FileNameOf(image);
            const bool needAppId = !search->appId.empty() || !search->title.empty();
            const std::wstring windowAppId = needAppId ? WindowAppId(hwnd) : std::wstring{};

            FoundVia via = FoundVia::None;
            if (!image.empty() && !frameHost) {
                const bool pathTarget = !search->target.empty() && !IsStoreTarget(search->target) && SameExePath(image, search->target);
                const bool pathHost = !search->host.empty() && !IsStoreTarget(search->host) && SameExePath(image, search->host);
                if (pathTarget || pathHost) {
                    via = FoundVia::Path;
                } else if ((!search->targetName.empty() && EqualsIgnoreCase(imageName, search->targetName)) ||
                           (!search->hostName.empty() && EqualsIgnoreCase(imageName, search->hostName))) {
                    via = FoundVia::Name;
                }
            }
            if (via == FoundVia::None && !search->appId.empty() && SameAppId(windowAppId, search->appId)) via = FoundVia::AppId;
            // フルパスでもファイル名でも無いとき、今起動したプロセスの窓（パスを聞けなくても候補）。
            // ApplicationFrameHost は複数のストアアプリで共有するので、番号だけでは掴まない
            if (via == FoundVia::None && search->pid != 0 && windowPid == search->pid && !frameHost) via = FoundVia::Pid;
            // ID が一致しないストアの窓は、登録名が題名そのものなら掴む。部分一致は数えて、1つだけのときだけ使う
            if (via == FoundVia::None && !search->title.empty() && (frameHost || FrameWindowClass(hwnd) || !windowAppId.empty())) {
                const std::wstring title = WindowTitle(hwnd);
                if (EqualsIgnoreCase(title, search->title)) {
                    via = FoundVia::Title;
                } else if (ContainsText(title, search->title)) {
                    search->looseTitle += 1;
                    if (search->looseTitle == 1) {
                        search->loose.hwnd = hwnd;
                        search->loose.via = FoundVia::Title;
                        search->loose.host = image;
                        search->loose.appId = windowAppId;
                    }
                }
            }
            // 起動前の控えが無いときは、新しい窓を候補にしない。ApplicationFrameHost は別のストアアプリなので除く
            if (via == FoundVia::None && search->allowFresh && search->earlier && !frameHost && !ListedEarlier(search->earlier, hwnd) &&
                GetWindowTextLengthW(hwnd) > 0) {
                via = hwnd == search->foreground ? FoundVia::FreshFront : FoundVia::FreshOther;
            }
            if (via == FoundVia::None) return TRUE;
            Slot* slot = GetWindow(hwnd, GW_OWNER) ? &search->owned : &search->unowned;
            KeepBetter(slot, hwnd, via, image, via == FoundVia::AppId || via == FoundVia::Title ? windowAppId : std::wstring{});
            return TRUE;
        },
        reinterpret_cast<LPARAM>(&search));

    // 題名の部分一致は、1つだけのとき、かつ題名そのものの一致が無いときだけ
    const bool exactTitle = search.unowned.via == FoundVia::Title || search.owned.via == FoundVia::Title;
    if (!exactTitle && search.looseTitle == 1 && search.loose.hwnd) {
        Slot* slot = GetWindow(search.loose.hwnd, GW_OWNER) ? &search.owned : &search.unowned;
        if (!slot->hwnd || static_cast<int>(slot->via) > static_cast<int>(FoundVia::Title)) {
            KeepBetter(slot, search.loose.hwnd, FoundVia::Title, search.loose.host, search.loose.appId);
        }
    }

    // 同じ強さならオーナーの無い窓。弱い新しい窓より、オーナー付きでもフルパスの方が優先
    const bool unownedBetter = search.unowned.hwnd &&
                               (!search.owned.hwnd || static_cast<int>(search.unowned.via) <= static_cast<int>(search.owned.via));
    const Slot& picked = unownedBetter ? search.unowned : search.owned;
    found.hwnd = picked.hwnd;
    found.host = picked.host;
    if (IsStoreTarget(found.host) || FrameHostFile(found.host)) found.host.clear();
    found.appId = picked.appId;
    found.via = picked.via;
    return found;
}

void BringToFront(HWND window) {
    if (!window || !IsWindow(window)) return;
    AllowSetForegroundWindow(ASFW_ANY);
    if (IsIconic(window)) ShowWindow(window, SW_RESTORE);  // 最小化のままでは前に出ても見えない
    // 押した直後は、このブラウザが手前なので SetForegroundWindow が通る。
    // 通らないとき（別の操作が割り込んだとき）は、入力の列を一時的につないでからもう一度出す。
    const HWND foreground = GetForegroundWindow();
    const DWORD foregroundThread = foreground ? GetWindowThreadProcessId(foreground, nullptr) : 0;
    const DWORD current = GetCurrentThreadId();
    const bool attached = foregroundThread != 0 && foregroundThread != current && AttachThreadInput(current, foregroundThread, TRUE) != FALSE;
    SetForegroundWindow(window);
    if (attached) AttachThreadInput(current, foregroundThread, FALSE);
}

bool IsLaunchable(const std::wstring& launch) {
    if (!IsFile(launch)) return false;
    const std::wstring ext = ExtensionOf(launch);
    return ext == L".exe" || ext == L".lnk";
}

bool Launch(HWND owner, const std::wstring& launch, const std::wstring& args, const std::wstring& cwd, DWORD* pid) {
    if (pid) *pid = 0;
    if (!IsLaunchable(launch)) return false;
    const bool shortcut = ExtensionOf(launch) == L".lnk";
    // 実行ファイルを直接選んだときだけ、覚えてある引数と作業フォルダを渡す
    const wchar_t* parameters = !shortcut && SafeArgs(args) ? args.c_str() : nullptr;
    const wchar_t* directory = !shortcut && IsDirectory(cwd) ? cwd.c_str() : nullptr;
    AllowSetForegroundWindow(ASFW_ANY);
    SHELLEXECUTEINFOW info{};
    info.cbSize = sizeof(info);
    info.fMask = SEE_MASK_FLAG_NO_UI | SEE_MASK_NOASYNC;  // 失敗しても Windows のエラーの窓を出さない（OpenBotApp と同じ）
    if (pid) info.fMask |= SEE_MASK_NOCLOSEPROCESS;       // 番号が要るときだけ。ハンドルはすぐ閉じる
    info.hwnd = owner;
    info.lpVerb = L"open";
    info.lpFile = launch.c_str();
    info.lpParameters = parameters;
    info.lpDirectory = directory;
    info.nShow = SW_SHOWNORMAL;
    const BOOL ok = ShellExecuteExW(&info);
    if (info.hProcess) {
        if (pid) *pid = GetProcessId(info.hProcess);
        CloseHandle(info.hProcess);
    }
    return ok != FALSE;
}

namespace {

constexpr int kFixedSlackPx = 12;  // これ以上大きさが足りなければ、固定とみなす

enum class Move { Ok, Denied, Failed };

// 宣言が古い SDK に無くても、Windows 10 以降なら実行時に取れる。無ければ偽（最大化と最小化だけ戻す）
bool WindowArranged(HWND window) {
    using ArrangedFn = BOOL(WINAPI*)(HWND);
    static const ArrangedFn arranged = reinterpret_cast<ArrangedFn>(GetProcAddress(GetModuleHandleW(L"user32.dll"), "IsWindowArranged"));
    return arranged && window && arranged(window) != FALSE;
}

// 最大化・最小化・スナップのままでは、SetWindowPos に渡した大きさが無視される
void RestoreBeforeMove(HWND window) {
    if (!window || !IsWindow(window)) return;
    if (IsIconic(window) || IsZoomed(window) || WindowArranged(window)) ShowWindow(window, SW_RESTORE);
}

UINT DpiOfWindow(HWND window) {
    if (!window) return 0;
    const UINT dpi = GetDpiForWindow(window);
    return dpi;
}

// page の中央があるモニタの実効 DPI。聞けなければ 0（比べない）
UINT DpiOfPage(const RECT& page) {
    const LONG width = page.right - page.left;
    const LONG height = page.bottom - page.top;
    if (width <= 0 || height <= 0) return 0;
    const POINT center{page.left + width / 2, page.top + height / 2};
    const HMONITOR monitor = MonitorFromPoint(center, MONITOR_DEFAULTTONEAREST);
    if (!monitor) return 0;
    using MonitorDpiFn = HRESULT(WINAPI*)(HMONITOR, int, UINT*, UINT*);
    static const MonitorDpiFn monitorDpi = []() -> MonitorDpiFn {
        HMODULE library = GetModuleHandleW(L"shcore.dll");
        if (!library) library = LoadLibraryW(L"shcore.dll");
        if (!library) return nullptr;
        return reinterpret_cast<MonitorDpiFn>(GetProcAddress(library, "GetDpiForMonitor"));
    }();
    UINT dpiX = 0;
    UINT dpiY = 0;
    // MDT_EFFECTIVE_DPI は 0
    if (!monitorDpi || FAILED(monitorDpi(monitor, 0, &dpiX, &dpiY)) || dpiX == 0) return 0;
    return dpiX;
}

Move MoveTopmost(HWND window, LONG x, LONG y, LONG w, LONG h, bool quiet) {
    if (w <= 0 || h <= 0) return Move::Failed;
    RestoreBeforeMove(window);
    if (!IsWindow(window)) return Move::Failed;
    // 追従のときは、ドラッグの途中でフォーカスを奪わない。出す瞬間だけ、これまでどおり前に出す
    const UINT flags = quiet ? (SWP_NOACTIVATE | SWP_SHOWWINDOW) : SWP_SHOWWINDOW;
    SetLastError(0);
    if (SetWindowPos(window, HWND_TOPMOST, static_cast<int>(x), static_cast<int>(y), static_cast<int>(w), static_cast<int>(h), flags) != FALSE) {
        return Move::Ok;
    }
    return GetLastError() == ERROR_ACCESS_DENIED ? Move::Denied : Move::Failed;
}

// 区画より大きいときは左上を合わせる。収まるときは中央。
void PlaceFixed(const RECT& page, LONG ww, LONG hh, LONG* x, LONG* y) {
    const LONG pw = page.right - page.left;
    const LONG ph = page.bottom - page.top;
    *x = ww >= pw ? page.left : page.left + (pw - ww) / 2;
    *y = hh >= ph ? page.top : page.top + (ph - hh) / 2;
}

bool ExtendsOutside(const RECT& window, const RECT& page) {
    return window.left < page.left || window.top < page.top || window.right > page.right || window.bottom > page.bottom;
}

long Gap(LONG a, LONG b) {
    return a > b ? a - b : b - a;
}

}  // namespace

PlaceResult PlaceInPage(HWND window, const RECT& page, bool quiet) {
    PlaceResult result;
    if (!window || !IsWindow(window)) return result;
    const LONG pw = page.right - page.left;
    const LONG ph = page.bottom - page.top;
    if (pw <= 0 || ph <= 0) {
        result.kind = PlaceKind::Failed;
        return result;
    }
    // このプロセスは PER_MONITOR_AWARE_V2。page も SetWindowPos も物理ピクセルなので、96dpi へ換算し直さない。
    // 別の DPI のモニタから来た窓は、1回目の大きさが移動先の DPI に揃う前に確定することがある。同じ座標でもう一度置く。
    const UINT fromDpi = DpiOfWindow(window);
    const UINT pageDpi = DpiOfPage(page);
    const bool dpiDiffers = fromDpi != 0 && pageDpi != 0 && fromDpi != pageDpi;
    RestoreBeforeMove(window);
    if (!IsWindow(window)) return result;
    auto placeAt = [&](LONG x, LONG y, LONG w, LONG h) -> Move {
        const Move first = MoveTopmost(window, x, y, w, h, quiet);
        if (first != Move::Ok || !dpiDiffers) return first;
        const Move second = MoveTopmost(window, x, y, w, h, quiet);
        return second == Move::Ok ? second : first;
    };
    RECT current{};
    if (!GetWindowRect(window, &current)) {
        result.kind = PlaceKind::Failed;
        return result;
    }
    const LONG ww = current.right - current.left;
    const LONG hh = current.bottom - current.top;
    const LONG_PTR style = GetWindowLongPtrW(window, GWL_STYLE);
    const bool thick = (style & WS_THICKFRAME) != 0;
    if (!quiet) AllowSetForegroundWindow(ASFW_ANY);

    auto finish = [&](PlaceKind kind, bool overlap) {
        if (!quiet && (kind == PlaceKind::Placed || kind == PlaceKind::Fixed)) BringToFront(window);
        result.kind = kind;
        result.overlap = overlap;
        return result;
    };

    if (!thick) {
        LONG x = 0;
        LONG y = 0;
        PlaceFixed(page, ww, hh, &x, &y);
        const Move moved = placeAt(x, y, ww, hh);
        if (moved == Move::Denied) return finish(PlaceKind::Denied, false);
        if (moved != Move::Ok) return finish(PlaceKind::Failed, false);
        RECT after{};
        const bool overlap = GetWindowRect(window, &after) && ExtendsOutside(after, page);
        return finish(PlaceKind::Fixed, overlap);
    }

    const Move sized = placeAt(page.left, page.top, pw, ph);
    if (sized == Move::Denied) return finish(PlaceKind::Denied, false);
    if (sized != Move::Ok) return finish(PlaceKind::Failed, false);
    RECT after{};
    if (!GetWindowRect(window, &after)) return finish(PlaceKind::Placed, false);
    const LONG aw = after.right - after.left;
    const LONG ah = after.bottom - after.top;
    if (Gap(aw, pw) >= kFixedSlackPx || Gap(ah, ph) >= kFixedSlackPx) {
        // 枠はあっても大きさが変わらなかった。中央寄せだけ、もう一度
        LONG x = 0;
        LONG y = 0;
        PlaceFixed(page, aw, ah, &x, &y);
        const Move centered = placeAt(x, y, aw, ah);
        if (centered == Move::Denied) {
            ClearTopmost(window);
            return finish(PlaceKind::Denied, false);
        }
        if (centered != Move::Ok) return finish(PlaceKind::Fixed, ExtendsOutside(after, page));
        RECT settled{};
        const bool overlap = GetWindowRect(window, &settled) && ExtendsOutside(settled, page);
        return finish(PlaceKind::Fixed, overlap);
    }
    return finish(PlaceKind::Placed, false);
}

void ClearTopmost(HWND window) {
    if (!window || !IsWindow(window)) return;
    // 位置と大きさはそのまま。操作の途中でフォーカスも奪わない。窓は閉じない
    SetWindowPos(window, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

}  // namespace apps
