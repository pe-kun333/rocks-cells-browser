// 自分の音声・動画のファイル：開くダイアログと、横に置いた字幕のファイルを読む
#include "media.h"

#include <shobjidl.h>
#include <wrl/client.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <vector>

#include "strings.h"
#include "l10n.h"

using Microsoft::WRL::ComPtr;
using nlohmann::json;
namespace fs = std::filesystem;

namespace media {
namespace {

const wchar_t* const kMediaExtensions[] = {L".mp3", L".m4a", L".aac", L".wav", L".ogg", L".oga", L".opus", L".flac",
                                           L".mp4", L".m4v", L".webm", L".mkv", L".mov"};
const wchar_t* const kSubtitleSuffixes[] = {L".ja.srt", L".ja.vtt", L".srt", L".vtt", L".en.srt", L".en.vtt", L".txt"};
constexpr std::uintmax_t kMaxSubtitleBytes = 3 * 1024 * 1024;

bool IsMedia(const fs::path& path) {
    std::wstring ext = path.extension().wstring();
    std::transform(ext.begin(), ext.end(), ext.begin(), ::towlower);
    return std::any_of(std::begin(kMediaExtensions), std::end(kMediaExtensions), [&](const wchar_t* e) { return ext == e; });
}

bool IsUtf8(const std::string& bytes) {
    return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes.data(), static_cast<int>(bytes.size()), nullptr, 0) > 0 || bytes.empty();
}

// UTF-8（BOM あり・なし）か Shift_JIS の文字を UTF-8 に
std::string ToUtf8Text(std::string bytes) {
    if (bytes.size() >= 3 && static_cast<unsigned char>(bytes[0]) == 0xEF && static_cast<unsigned char>(bytes[1]) == 0xBB &&
        static_cast<unsigned char>(bytes[2]) == 0xBF) {
        bytes.erase(0, 3);
    }
    if (IsUtf8(bytes)) return bytes;
    const int length = MultiByteToWideChar(932, 0, bytes.data(), static_cast<int>(bytes.size()), nullptr, 0);
    std::wstring wide(static_cast<size_t>(length), L'\0');
    MultiByteToWideChar(932, 0, bytes.data(), static_cast<int>(bytes.size()), wide.data(), length);
    return ToUtf8(wide);
}

}  // namespace

std::wstring OpenDialog(HWND owner) {
    ComPtr<IFileOpenDialog> dialog;
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)))) return {};
    const COMDLG_FILTERSPEC filters[] = {
        {l10n::Tr(L"音声・動画"), L"*.mp3;*.m4a;*.aac;*.wav;*.ogg;*.oga;*.opus;*.flac;*.mp4;*.m4v;*.webm;*.mkv;*.mov"},
        {l10n::Tr(L"すべてのファイル"), L"*.*"},
    };
    dialog->SetFileTypes(2, filters);
    dialog->SetTitle(l10n::Tr(L"音声・動画のファイルを開く（同じ名前の .srt / .vtt があれば字幕も読みます）"));
    if (FAILED(dialog->Show(owner))) return {};  // やめた
    ComPtr<IShellItem> item;
    if (FAILED(dialog->GetResult(&item))) return {};
    PWSTR path = nullptr;
    if (FAILED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) || !path) return {};
    std::wstring result(path);
    CoTaskMemFree(path);
    return result;
}

std::wstring OpenImageDialog(HWND owner) {
    ComPtr<IFileOpenDialog> dialog;
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)))) return {};
    const COMDLG_FILTERSPEC filters[] = {
        {l10n::Tr(L"画像"), L"*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.tif;*.tiff"},
        {l10n::Tr(L"すべてのファイル"), L"*.*"},
    };
    dialog->SetFileTypes(2, filters);
    dialog->SetTitle(l10n::Tr(L"画像ファイルを開く"));
    if (FAILED(dialog->Show(owner))) return {};
    ComPtr<IShellItem> item;
    if (FAILED(dialog->GetResult(&item))) return {};
    PWSTR path = nullptr;
    if (FAILED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) || !path) return {};
    std::wstring result(path);
    CoTaskMemFree(path);
    return result;
}

std::wstring OpenJsonDialog(HWND owner) {
    ComPtr<IFileOpenDialog> dialog;
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)))) return {};
    const COMDLG_FILTERSPEC filters[] = {
        {l10n::Tr(L"提案のファイル（JSON）"), L"*.json"},
        {l10n::Tr(L"すべてのファイル"), L"*.*"},
    };
    dialog->SetFileTypes(2, filters);
    dialog->SetTitle(l10n::Tr(L"Grok の提案ファイルを開く（patch.v1 の JSON）"));
    if (FAILED(dialog->Show(owner))) return {};
    ComPtr<IShellItem> item;
    if (FAILED(dialog->GetResult(&item))) return {};
    PWSTR path = nullptr;
    if (FAILED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) || !path) return {};
    std::wstring result(path);
    CoTaskMemFree(path);
    return result;
}

json ReadJsonText(const std::wstring& path, std::uintmax_t maxBytes) {
    const fs::path file(path);
    std::error_code error;
    if (!fs::is_regular_file(file, error)) return {{"ok", false}, {"error", "notFound"}};
    const std::uintmax_t size = fs::file_size(file, error);
    if (error) return {{"ok", false}, {"error", "read"}};
    if (size > maxBytes) return {{"ok", false}, {"error", "big"}};
    std::ifstream in(file, std::ios::binary);
    if (!in) return {{"ok", false}, {"error", "read"}};
    std::string bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    return {{"ok", true}, {"name", ToUtf8(file.filename().wstring())}, {"text", ToUtf8Text(std::move(bytes))}};
}

json ReadSubtitle(const std::wstring& mediaPath) {
    const fs::path media(mediaPath);
    std::error_code error;
    if (!IsMedia(media) || !fs::exists(media, error)) return {{"ok", false}, {"error", "notMedia"}};
    const fs::path stem = media.parent_path() / media.stem();
    for (const wchar_t* suffix : kSubtitleSuffixes) {
        const fs::path candidate = stem.wstring() + suffix;
        if (!fs::exists(candidate, error) || fs::file_size(candidate, error) > kMaxSubtitleBytes) continue;
        std::ifstream file(candidate, std::ios::binary);
        std::string bytes((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
        return {{"ok", true}, {"name", ToUtf8(candidate.filename().wstring())}, {"text", ToUtf8Text(std::move(bytes))}};
    }
    return {{"ok", false}, {"error", "notFound"}};
}

}  // namespace media
