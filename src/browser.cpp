// サイドバー（TypeScript の UI）の作成と、UI とのメッセージのやりとり、ウィンドウ内の配置
#include "browser.h"

#include <shellapi.h>
#include <shlobj.h>  // SHOpenFolderAndSelectItems（六角スクショの画像を選んだ状態でフォルダを開く）

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <new>
#include <string>
#include <string_view>
#include <thread>
#include <utility>

#include "ocr.h"

#include "apps.h"
#include "bots.h"
#include "clipboard.h"
#include "hexmemo.h"
#include "hook.h"
#include "livecaptions.h"
#include "media.h"
#include "screengrab.h"
#include "storage.h"
#include "strings.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
using nlohmann::json;

namespace {

// UI の HTML は exe の横の ui フォルダに置き、仮のドメイン名で開く（.example は実在しない予約ドメイン）
constexpr wchar_t kUiHost[] = L"rockscells-ui.example";
constexpr wchar_t kUiOrigin[] = L"https://rockscells-ui.example/";
constexpr wchar_t kUiStartPage[] = L"https://rockscells-ui.example/index.html";
// データ置き場の画像（ui-data\vault\）を、UI の <img> から読めるように見せる仮のドメイン名
constexpr wchar_t kVaultHost[] = L"rockscells-vault.example";

constexpr int kMinSidebarDip = 160;
constexpr int kMaxSidebarDip = 800;
constexpr int kMinContentDip = 200;  // ページ部分は最低これだけ残す
constexpr int kMinMemoDip = 120;     // 下のメモの区画の高さ
constexpr int kMaxMemoDip = 1600;

// 台帳の id。C++ が書く mp4 の名前は、この形だけ（フォルダの外には出さない）
bool CaptureIdOk(const std::string& id) {
    if (id.size() < 7 || id.size() > 33 || id[0] != 'c') return false;
    for (size_t i = 1; i < id.size(); ++i) {
        const unsigned char ch = static_cast<unsigned char>(id[i]);
        const bool digit = ch >= '0' && ch <= '9';
        const bool lower = ch >= 'a' && ch <= 'z';
        if (!digit && !lower) return false;
    }
    return true;
}

// 文字読み取りのワーカーから UI スレッドへ渡す結果。PostMessage の LPARAM。届かなければその場で消す
//   from：頼んだ面（返事を返す面。依頼の小窓 v2・R7c で right のほかに reader・left も）
struct OcrBox {
    int generation = 0;
    json requestId;
    ocr::Outcome outcome;
    std::string from;
};

// webhook の POST（R11）のワーカーから UI スレッドへ渡す結果。PostMessage の LPARAM。届かなければその場で消す
//   botRequestId：どの依頼か（左が受け取り箱の依頼に結果を付ける）。鍵・URL は入れない
struct HookBox {
    json requestId;
    std::string botRequestId;
    hook::Result result;
    std::string from;
};

std::vector<std::uint8_t> JpegPayload(const std::string& image) {
    std::string_view view(image);
    if (view.size() < 16 || view.size() > 2000000) return {};
    if (view.starts_with("data:")) {
        const size_t comma = view.find(',');
        if (comma == std::string_view::npos || view.substr(0, comma).find("base64") == std::string_view::npos) return {};
        view.remove_prefix(comma + 1);
    }
    const auto bytes = FromBase64(std::string(view));
    if (!bytes || bytes->size() < 4 || bytes->size() > 8 * 1024 * 1024) return {};
    return std::vector<std::uint8_t>(bytes->begin(), bytes->end());
}

std::filesystem::path ExeFolder() {
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(nullptr, path, MAX_PATH);
    return std::filesystem::path(path).parent_path();
}

// 仮のドメインのファイルは WebView2 が HTTP キャッシュに残す。build.ps1 で ui を作り直しても、
// 前回の index.html のまま開かれ、足したシートが一覧に出ないことがある。
// スクリプトのファイル名（中身が変わると Vite が変える）と更新時刻を URL に足して取り直す
std::wstring UiBuildToken() {
    const auto index = ExeFolder() / L"ui" / L"index.html";
    std::ifstream in(index, std::ios::binary);
    if (!in) return L"0";
    const std::string html((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    std::string script = "none";
    const auto marker = html.find("assets/index-");
    if (marker != std::string::npos) {
        const auto end = html.find_first_of("\"'", marker);
        if (end != std::string::npos) script = html.substr(marker, end - marker);
        std::replace(script.begin(), script.end(), '/', '-');
    }
    std::error_code timeError;
    const auto when = std::filesystem::last_write_time(index, timeError);
    const auto ticks = timeError ? 0ULL : static_cast<unsigned long long>(when.time_since_epoch().count());
    return ToWide(script) + L"-" + std::to_wstring(ticks);
}

// タブの配置や番号の保存先（中身を決めるのは UI 側。C++ はそのまま書き込むだけ）
std::filesystem::path SessionFile() {
    return AppDataFolder() / L"session.json";
}

// AI（Claude API）のキーの保存先。DPAPI で暗号化して置く
std::filesystem::path ApiKeyFile() {
    return AppDataFolder() / L"ai-key.bin";
}

// webhook「そのまま送る」（依頼の小窓 v2・R11）の宛先と鍵の保存先。DPAPI で暗号化して置く（中身は {"url","key"} の JSON）。
//   UI へは「ある／ない」だけを返し、値は返さない（getApiKey とは違う）
std::filesystem::path BotHookFile() {
    return AppDataFolder() / L"bot-hook.bin";
}

// 保存した宛先と鍵を読む（無い・読めない・形が違えば false）。読んだ値は呼んだ側が使い終わったら消す
bool LoadBotHook(std::string& url, std::string& key) {
    std::string secret = LoadSecret(BotHookFile());
    const json saved = json::parse(secret, nullptr, false);
    SecureZeroMemory(secret.data(), secret.size());
    if (!saved.is_object() || !saved.contains("url") || !saved.contains("key") || !saved["url"].is_string() || !saved["key"].is_string()) return false;
    url = saved["url"].get<std::string>();
    key = saved["key"].get<std::string>();
    return hook::IsHttpsUrl(url) && hook::IsKeyText(key);
}

// 依頼の requestId の形（hb-YYYYMMDD-NNNN-xxxx など。英数字と - の 64 字まで。webhook の結果を左が依頼に結び付ける）
bool IsBotRequestId(const std::string& id) {
    if (id.empty() || id.size() > 64) return false;
    for (const char ch : id) {
        const unsigned char c = static_cast<unsigned char>(ch);
        if (!std::isalnum(c) && c != '-') return false;
    }
    return true;
}

std::string Serialize(const json& msg) {
    return msg.dump(-1, ' ', false, json::error_handler_t::replace);
}

// ---- ボットのセル：Grok Bot アプリを開く ----
// UI からはエージェントの id だけを受け取り、URL はここで組み立てる（形は公開されていないので、変わったらここだけ直す）
constexpr wchar_t kGrokBotAgentUrl[] = L"grokbot://app/v1/agent?id=";

// Grok Bot のエージェントの id の形か（英数字・_・- の 1〜128 字。^[A-Za-z0-9_-]{1,128}$）。
// URL 全体がアプリの起動の引数になるので、"・空白・: などで起動のしかたを変えられないよう、ASCII のこの文字だけを通す
bool IsValidAgentId(const std::string& id) {
    if (id.empty() || id.size() > 128) return false;
    return std::all_of(id.begin(), id.end(), [](char c) {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
    });
}

// grokbot:// がこの PC に登録されているか（HKEY_CLASSES_ROOT\grokbot に "URL Protocol" の値があるか）。
// 無いまま開くと Windows の「アプリを探す」画面が出るので、先にここで確かめる
bool GrokBotRegistered() {
    HKEY key = nullptr;
    if (RegOpenKeyExW(HKEY_CLASSES_ROOT, L"grokbot", 0, KEY_QUERY_VALUE, &key) != ERROR_SUCCESS) return false;
    const bool registered = RegQueryValueExW(key, L"URL Protocol", nullptr, nullptr, nullptr, nullptr) == ERROR_SUCCESS;
    RegCloseKey(key);
    return registered;
}

// ---- 六角スクショを Grok Bot へ（第3段 S3.12）：画像をクリップボードに入れる・ファイルに保存する ----
//   貼れなかったときの逃げ道：%LOCALAPPDATA%\RocksCellsBrowser\bot-shots\<名前>.png に保存して、フォルダを開く（チャットへドラッグで添付）
constexpr size_t kMaxShotBase64 = 24 * 1024 * 1024;  // 受け取る Base64 の長さの上限（六角スクショは 520px 以下なので、ずっと小さい）
constexpr auto kBotShotKeep = std::chrono::hours(24 * 7);  // 保存した画像を残す期間（保存のたびに、これより古いものを消す）

std::filesystem::path BotShotFolder() {
    return AppDataFolder() / L"bot-shots";
}

// 画像の名前（shotId。UI が保存のたびに決める。例 shot-20261009-193859-k3x9）。英数字とハイフンだけの 1〜64 字。
//   \・/・.・: などを通さないので、bot-shots の外のファイルは書けない
bool IsValidShotId(const std::string& id) {
    if (id.empty() || id.size() > 64) return false;
    return std::all_of(id.begin(), id.end(), [](char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-'; });
}

clipboard::ImageFill ShotFill(const std::string& fill) {
    return fill == "dark" ? clipboard::ImageFill::Dark : fill == "none" ? clipboard::ImageFill::None : clipboard::ImageFill::White;
}

// clipboardWrite・clipboardWriteImage の noHistory（依頼の小窓 v2・R2・D6）。true のときだけ印を置く（無い・形が違うときは false）
bool NoHistory(const json& msg) {
    const auto it = msg.find("noHistory");
    return it != msg.end() && it->is_boolean() && it->get<bool>();
}

// 保存した写し（bot-shots\<shotId>.png）を読む（依頼の小窓 v2・R7d：画像入り 1 回貼り。依頼の文を作る左は画像を持たないので、
//   読む画面が先に保存した写しの名前で頼む）。名前の形が違う・無い・読めない・大きすぎるときは nullopt
constexpr std::uintmax_t kMaxShotFileBytes = 16 * 1024 * 1024;  // clipboard.cpp の受け取る画像の上限と同じ
std::optional<std::vector<BYTE>> SavedShotBytes(const json& msg) {
    const auto id = msg.find("shotId");
    const std::string shotId = id != msg.end() && id->is_string() ? id->get<std::string>() : std::string();
    if (!IsValidShotId(shotId) || AppDataFolder().empty()) return std::nullopt;
    const auto data = ReadTextFileCapped(BotShotFolder() / (ToWide(shotId) + L".png"), kMaxShotFileBytes);
    if (!data || data->empty()) return std::nullopt;
    return std::vector<BYTE>(data->begin(), data->end());
}

// UI から受け取った画像（PNG の Base64。data: の頭は付けない）をバイト列に。大きすぎる・戻せないときは nullopt
std::optional<std::vector<BYTE>> ShotBytes(const json& msg) {
    const auto it = msg.find("png");
    if (it == msg.end() || !it->is_string()) return std::nullopt;
    const std::string& data = it->get_ref<const std::string&>();
    if (data.empty() || data.size() > kMaxShotBase64) return std::nullopt;
    return FromBase64(data);
}

// bot-shots の中の、7 日より古い .png を消す
void PruneBotShots(const std::filesystem::path& dir) {
    const auto limit = std::filesystem::file_time_type::clock::now() - kBotShotKeep;
    std::error_code error;
    for (const auto& entry : std::filesystem::directory_iterator(dir, error)) {
        std::error_code entryError;
        if (!entry.is_regular_file(entryError) || entry.path().extension() != L".png") continue;
        const auto modified = entry.last_write_time(entryError);
        if (!entryError && modified < limit) std::filesystem::remove(entry.path(), entryError);
    }
}

// 保存する（PNG だけ。名前が合わない・PNG でないものは書かない）。返事は { ok, path（保存したフルパス）| error }
json SaveBotShot(const json& msg) {
    const auto id = msg.find("shotId");
    const std::string shotId = id != msg.end() && id->is_string() ? id->get<std::string>() : std::string();
    if (!IsValidShotId(shotId)) return {{"ok", false}, {"error", "badId"}};
    static constexpr BYTE kPngSignature[8] = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    const auto bytes = ShotBytes(msg);
    if (!bytes || bytes->size() < sizeof(kPngSignature) || !std::equal(std::begin(kPngSignature), std::end(kPngSignature), bytes->begin())) {
        return {{"ok", false}, {"error", "badImage"}};
    }
    if (AppDataFolder().empty()) return {{"ok", false}, {"error", "write"}};
    const std::filesystem::path dir = BotShotFolder();
    std::error_code error;
    std::filesystem::create_directories(dir, error);
    PruneBotShots(dir);
    const std::filesystem::path file = dir / (ToWide(shotId) + L".png");
    if (!WriteFileAtomically(file, std::string(bytes->begin(), bytes->end()))) return {{"ok", false}, {"error", "write"}};
    return {{"ok", true}, {"path", ToUtf8(file.wstring())}};
}

// bot-shots をエクスプローラーで開く。保存した画像の名前があれば、その画像を選んだ状態で（チャットへドラッグしやすいように）
void OpenBotShotFolder(HWND hwnd, const json& msg) {
    const std::filesystem::path dir = BotShotFolder();
    if (AppDataFolder().empty()) return;
    std::error_code error;
    std::filesystem::create_directories(dir, error);
    const auto id = msg.find("shotId");
    const std::string shotId = id != msg.end() && id->is_string() ? id->get<std::string>() : std::string();
    if (IsValidShotId(shotId)) {
        const std::filesystem::path file = dir / (ToWide(shotId) + L".png");
        if (std::filesystem::is_regular_file(file, error)) {
            if (PIDLIST_ABSOLUTE item = ILCreateFromPathW(file.c_str())) {
                const HRESULT hr = SHOpenFolderAndSelectItems(item, 0, nullptr, 0);
                ILFree(item);
                if (SUCCEEDED(hr)) return;
            }
        }
    }
    ShellExecuteW(hwnd, L"open", dir.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

// ---- ページ全体の画像（M4）：ピクチャ\Rocks-cells Browser\ に書く。古いファイルは消さない ----
constexpr size_t kMaxExportBytes = 24 * 1024 * 1024;
constexpr size_t kMaxExportBase64 = (kMaxExportBytes / 3) * 4 + 4;
constexpr double kPageMaxWidth = 4000;
constexpr double kPageMaxHeight = 16000;
constexpr double kPageScaleWidth = 1600;

// 書き出すファイルの名前。英数字・.・_・- の 1〜80 字に、.jpg か .png。`..` は通さない（フォルダの外を指せないように）
bool IsExportName(const std::string& name) {
    if (name.empty() || name.size() > 84 || name.find("..") != std::string::npos) return false;
    const auto dot = name.rfind('.');
    if (dot == std::string::npos || dot == 0 || dot > 80) return false;
    const std::string ext = name.substr(dot);
    if (ext != ".jpg" && ext != ".png") return false;
    if (name.size() != dot + ext.size()) return false;
    return std::all_of(name.begin(), name.begin() + static_cast<std::ptrdiff_t>(dot), [](unsigned char c) {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-';
    });
}

bool IsJpegBytes(const std::vector<BYTE>& bytes) {
    return bytes.size() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF;
}

bool IsPngBytes(const std::vector<BYTE>& bytes) {
    static constexpr BYTE kPng[8] = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    return bytes.size() >= sizeof(kPng) && std::equal(std::begin(kPng), std::end(kPng), bytes.begin());
}

// ピクチャ\Rocks-cells Browser。ピクチャの場所が取れなければ空
std::filesystem::path ExportFolder() {
    PWSTR known = nullptr;
    std::filesystem::path pictures;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Pictures, 0, nullptr, &known)) && known) pictures = known;
    CoTaskMemFree(known);
    return pictures.empty() ? std::filesystem::path() : pictures / L"Rocks-cells Browser";
}

// 同じ名前があれば -2・-3 を、拡張子の前に付ける。80 字を超えるときは、名前の本体を短くする
std::optional<std::pair<std::filesystem::path, std::string>> UniqueExportFile(const std::filesystem::path& dir, const std::string& name) {
    if (!IsExportName(name)) return std::nullopt;
    const std::string ext = name.substr(name.size() - 4);
    const std::string stem = name.substr(0, name.size() - 4);
    auto freeName = [&](const std::string& candidate) -> std::optional<std::pair<std::filesystem::path, std::string>> {
        if (!IsExportName(candidate)) return std::nullopt;
        const std::filesystem::path file = dir / ToWide(candidate);
        std::error_code error;
        if (std::filesystem::exists(file, error) || error) return std::nullopt;
        return std::make_pair(file, candidate);
    };
    if (auto first = freeName(name)) return first;
    for (int n = 2; n <= 9999; ++n) {
        const std::string suffix = "-" + std::to_string(n);
        std::string base = stem;
        if (base.size() + suffix.size() > 80) {
            if (suffix.size() >= 80) return std::nullopt;
            base.resize(80 - suffix.size());
            while (!base.empty() && (base.back() == '.' || base.back() == '-')) base.pop_back();
        }
        if (base.empty()) return std::nullopt;
        if (auto next = freeName(base + suffix + ext)) return next;
    }
    return std::nullopt;
}

// 名前を確かめてから、フォルダの中のファイルだけを返す。フォルダの外は返さない
std::optional<std::filesystem::path> ExportFileInFolder(const std::string& name) {
    if (!IsExportName(name)) return std::nullopt;
    const std::filesystem::path dir = ExportFolder();
    if (dir.empty()) return std::nullopt;
    const std::filesystem::path file = (dir / ToWide(name)).lexically_normal();
    const std::filesystem::path folder = dir.lexically_normal();
    const std::filesystem::path parent = file.parent_path().lexically_normal();
    if (parent != folder) return std::nullopt;
    return file;
}

}  // namespace

void ShowError(HWND hwnd, const wchar_t* what, HRESULT hr) {
    wchar_t message[256];
    swprintf_s(message, L"%s に失敗しました (HRESULT 0x%08X)", what, static_cast<unsigned>(hr));
    MessageBoxW(hwnd, message, kAppName, MB_ICONERROR);
}

bool IsOpenableUrl(const std::wstring& url) {
    constexpr size_t kMaxUrlLength = 8192;
    if (url.empty() || url.size() > kMaxUrlLength) return false;
    const auto startsWith = [&url](const wchar_t* prefix) { return _wcsnicmp(url.c_str(), prefix, wcslen(prefix)) == 0; };
    if (!startsWith(L"http://") && !startsWith(L"https://")) return false;
    return std::none_of(url.begin(), url.end(), [](wchar_t c) { return c < 0x20 || c == 0x7f; });
}

std::wstring DataFolderKey() {
    std::wstring key = AppDataFolder().lexically_normal().wstring();
    while (key.size() > 1 && (key.back() == L'\\' || key.back() == L'/')) key.pop_back();
    CharLowerBuffW(key.data(), static_cast<DWORD>(key.size()));  // Windows のパスは、大文字と小文字を区別しない
    return key;
}

Browser::Browser(HWND hwnd) : hwnd_(hwnd) {
    surfaces_["left"].widthDip = 280;
    surfaces_["left"].visible = true;
    surfaces_["right"].widthDip = 320;  // 右は UI から開くように言われるまで作らない
    surfaces_["reader"].widthDip = 520;  // 中央：ページを六角セルに組み直して読む画面（ふつうはページに重ねる。幅は動画のときだけ使う）
    surfaces_["memo"].heightDip = 300;   // 下のメモの区画（開くように言われるまで作らない。visible は false）
}

// ---------- 起動 ----------

void Browser::Start() {
    // 見た目のテーマ（前回の色）。面を作るときの地の色と、ページの明暗に使う。自動なら今の Windows の明暗で組を選ぶ
    theme_ = theme::Load();
    if (theme_) themeSlot_ = theme::Pick(*theme_, theme::SystemPrefersDark());
    LoadDownloads();
    // ボットの返事を受け取るのは、データフォルダごとに1つの窓だけ（取れなかった窓は、見回りのたびに取り直してみる）
    botInbox_.TryOwn(DataFolderKey());
    const std::wstring userData = (AppDataFolder() / L"UserData").wstring();
    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, userData.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
                if (FAILED(result)) {
                    ShowError(hwnd_, L"WebView2 環境の作成", result);
                    return result;
                }
                env_ = env;
                CreateSurface("left");
                return S_OK;
            })
            .Get());
    if (FAILED(hr)) ShowError(hwnd_, L"WebView2 の起動", hr);
}

// サイドバーを1つ作る。中身は同じ UI で、URL の ?surface=left / right で役割が変わる
void Browser::CreateSurface(const std::string& name) {
    Surface& surface = surfaces_[name];
    if (surface.controller || surface.creating) return;
    surface.creating = true;

    auto created = Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
        [this, name](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
            Surface& surface = surfaces_[name];
            surface.creating = false;
            if (FAILED(result)) {
                ShowError(hwnd_, L"サイドバーの作成", result);
                return result;
            }
            surface.controller = controller;
            controller->get_CoreWebView2(&surface.webview);
            ICoreWebView2* webview = surface.webview.Get();

            ComPtr<ICoreWebView2Settings> settings;
            webview->get_Settings(&settings);
            settings->put_IsStatusBarEnabled(FALSE);
            settings->put_IsZoomControlEnabled(FALSE);
            // トラックパッドのスワイプで「戻る・進む」が起きないようにする（盤面の移動に使う）。
            // ピンチは無効にするとページに届かなくなるので、有効のまま UI 側で受け止める
            ComPtr<ICoreWebView2Settings6> settings6;
            if (SUCCEEDED(settings.As(&settings6))) settings6->put_IsSwipeNavigationEnabled(FALSE);

            // exe の横の ui フォルダを https://rockscells-ui.example/ として見せる
            ComPtr<ICoreWebView2_3> webview3;
            if (SUCCEEDED(surface.webview.As(&webview3))) {
                webview3->SetVirtualHostNameToFolderMapping(kUiHost, (ExeFolder() / L"ui").c_str(),
                                                            COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY);
                // データ置き場の画像を https://rockscells-vault.example/img/… として見せる（<img> で読むだけ。fetch などは断る）
                std::error_code vaultError;
                std::filesystem::create_directories(VaultFolder() / L"img", vaultError);
                webview3->SetVirtualHostNameToFolderMapping(kVaultHost, VaultFolder().c_str(),
                                                            COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS);
            }

            // サイドバーが UI 以外のページへ移動しないようにする
            webview->add_NavigationStarting(
                Callback<ICoreWebView2NavigationStartingEventHandler>(
                    [](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                        CoString uri;
                        args->get_Uri(uri.put());
                        if (!uri.str().starts_with(kUiOrigin)) args->put_Cancel(TRUE);
                        return S_OK;
                    })
                    .Get(),
                nullptr);

            // UI からのメッセージを受け取る（UI 以外から届いたものは無視する）
            webview->add_WebMessageReceived(
                Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                    [this, name](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                        CoString source;
                        args->get_Source(source.put());
                        if (!source.str().starts_with(kUiOrigin)) return S_OK;
                        CoString text;
                        if (FAILED(args->get_WebMessageAsJson(text.put()))) return S_OK;
                        json msg = json::parse(ToUtf8(text.str()), nullptr, false);
                        if (!msg.is_object()) return S_OK;
                        try {
                            HandleUiMessage(name, msg);
                        } catch (const json::exception&) {
                            // 形のおかしいメッセージは無視する
                        } catch (...) {
                            // メモリ不足やスレッドを作れないときも、WebView2 のコールバックの外へ例外を出さない
                            // （requestId のある頼みは、UI の待ちが時間切れで終わる）
                        }
                        return S_OK;
                    })
                    .Get(),
                nullptr);

            WatchShortcuts(controller);
            Layout();
            // 読む画面と下のメモの区画は、見えたときにキーボードの入力先をそちらへ移す
            if ((name == "reader" || name == "memo") && surface.visible) controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            const std::wstring url = std::wstring(kUiStartPage) + L"?surface=" + ToWide(name) + L"&ui=" + UiBuildToken();
            // この画面ではキャッシュを使わない（命令が遅れても、上の更新時刻つき URL で index.html は取り直す）
            webview->CallDevToolsProtocolMethod(L"Network.setCacheDisabled", L"{\"cacheDisabled\":true}", nullptr);
            if (name == "left") ApplyPageScheme();
            return webview->Navigate(url.c_str());
        });
    // 見た目のテーマがあれば、作るときの選択肢で地の色を渡す（作ったあとに API で付けると、効くまで白いちらつきが残る。SDK の既知の問題）
    ComPtr<ICoreWebView2Environment10> env10;
    ComPtr<ICoreWebView2ControllerOptions> options;
    ComPtr<ICoreWebView2ControllerOptions3> options3;
    if (theme_ && SUCCEEDED(env_.As(&env10)) && SUCCEEDED(env10->CreateCoreWebView2ControllerOptions(&options)) &&
        SUCCEEDED(options.As(&options3)) && SUCCEEDED(options3->put_DefaultBackgroundColor(theme::WebViewColor(themeSlot_.bg)))) {
        env10->CreateCoreWebView2ControllerWithOptions(hwnd_, options.Get(), created.Get());
    } else {
        env_->CreateCoreWebView2Controller(hwnd_, created.Get());
    }
}

// ---------- 見た目のテーマ（窓の枠） ----------

// 左の setTheme。形が合わなければ何もしない（今の色のまま）。前と同じなら何もしない
void Browser::ApplyTheme(const json& msg) {
    const std::optional<theme::Theme> next = theme::Parse(msg);
    if (!next) return;
    const theme::Slot slot = msg.value("current", "") == "dark" ? next->dark : next->light;
    if (theme_ && theme::ToJson(*theme_) == theme::ToJson(*next) && themeSlot_.id == slot.id && themeSlot_.dark == slot.dark) return;
    theme_ = next;
    themeSlot_ = slot;
    theme::Save(*theme_);
    theme::SetBackground(slot.bg);
    theme::ApplyFrame(hwnd_, slot);
    InvalidateRect(hwnd_, nullptr, TRUE);
    for (const auto& entry : popouts_) {  // ライブの小窓（いくつでも）
        if (!entry.second.hwnd || !IsWindow(entry.second.hwnd)) continue;
        theme::ApplyFrame(entry.second.hwnd, slot);
        InvalidateRect(entry.second.hwnd, nullptr, TRUE);
    }
    // 作ってある面の地の色も合わせる（大きさを変えている間などに見える。これから作る面は、作るときの選択肢で渡す）
    for (auto& entry : surfaces_) {
        ComPtr<ICoreWebView2Controller2> controller2;
        if (entry.second.controller && SUCCEEDED(entry.second.controller.As(&controller2))) {
            controller2->put_DefaultBackgroundColor(theme::WebViewColor(slot.bg));
        }
    }
    ApplyPageScheme();
}

void Browser::ApplyPageScheme() {
    if (!theme_) return;
    const auto found = surfaces_.find("left");
    if (found == surfaces_.end() || !found->second.webview) return;
    ComPtr<ICoreWebView2_13> webview13;
    ComPtr<ICoreWebView2Profile> profile;
    if (SUCCEEDED(found->second.webview.As(&webview13)) && SUCCEEDED(webview13->get_Profile(&profile)) && profile) {
        profile->put_PreferredColorScheme(theme::PageScheme(*theme_, themeSlot_));
    }
}

// ---------- UI とのやりとり ----------

void Browser::HandleUiMessage(const std::string& from, const json& msg) {
    const std::string type = msg.value("type", "");
    // タブの id は数。ダウンロードの id は文字列なので、数でないときは 0（ここで例外にすると、その命令ごと消える）
    int id = 0;
    if (const auto found = msg.find("id"); found != msg.end() && found->is_number_integer()) id = found->get<int>();

    if (type == "ready") {
        // UI の準備ができた。今あるタブ・前回保存した内容・サイドバーの状態を伝える
        json tabs = json::array();
        for (const auto& entry : tabs_) tabs.push_back(DescribeTab(entry.second));
        // 盤面を使うのは左だけ。左には「無い」と「読めない」を分け、読めないときは写しと控えを添える（LoadSessionForUi）
        json hello = {{"type", "hello"}, {"tabs", tabs}, {"activeId", activeId_ ? json(activeId_) : json(nullptr)}, {"sidebars", SidebarState()}};
        if (from == "left") hello.update(LoadSessionForUi(SessionFile()));
        else hello["session"] = ReadJsonFile(SessionFile());
        SendToSurface(from, hello);
        if (from == "left") {
            leftReady_ = true;
            // 起動したときに頼まれていたページ（hello の後に届くので、UI は前回のタブを並べ始めた後に受け取る）
            if (!pendingUrl_.empty()) {
                SendToSurface("left", {{"type", "openUrl"}, {"url", ToUtf8(pendingUrl_)}});
                pendingUrl_.clear();
            }
            // ボットの受け取り口：この窓が受け取るかを知らせ、取ったままの返事を渡し直す（ボットへ送り直すのではない）
            ClaimBotInbox();
            BotInboxReady();
            SendDownloads();
        }
    } else if (type == "createTab") {
        std::optional<int> parentId;
        if (msg.contains("parentId") && msg["parentId"].is_number_integer()) parentId = msg["parentId"].get<int>();
        const bool lazy = msg.value("lazy", false);  // true = 眠ったまま作る（前回のタブの復元用）
        const bool background = !lazy && msg.value("background", false);  // true = 裏で読み込む（表示しない。ページはこのまま）
        const int newId = AddTab(ToWide(msg.value("url", "")), parentId, msg.value("requestId", json()), lazy, background);
        if (background) WakeTab(newId);
        else if (!lazy) ActivateTab(newId);
    } else if (type == "setLinkOpen") {
        linkBackground_ = msg.value("background", false);  // ページのリンクから開く新しいタブを、裏で開くか
    } else if (type == "setTheme") {
        if (from == "left") ApplyTheme(msg);  // 見た目のテーマ（窓の地・題名バーと枠・面の地の色・ページの明暗）。左からだけ
    } else if (type == "activateTab") {
        ActivateTab(id);
    } else if (type == "closeTab") {
        CloseTab(id);
    } else if (type == "captureTab") {
        CaptureTab(id);
    } else if (type == "captureFull") {
        // maxEdge：下のメモの区画が「見えている所」を頼むときだけ付く。ページに入力先が無くても撮れて、画像が大きすぎて届かないことを防ぐ
        int maxEdge = 0;
        if (const json edge = msg.value("maxEdge", json()); edge.is_number_integer()) maxEdge = std::clamp(edge.get<int>(), 0, 1600);
        // rect：右の「撮影」が、ページの画像を送るとき（依頼① I1）。見えている所の左上からの CSS ピクセル。
        //   ページが測った数（データ）なので、形・有限・大きさを確かめる。変なら撮らずに 'rect' で断る
        json rect;
        if (msg.contains("rect") && !msg["rect"].is_null()) {
            const json& raw = msg["rect"];
            auto field = [&raw](const char* key) -> double {
                if (!raw.is_object() || !raw.contains(key) || !raw[key].is_number()) return std::nan("");
                return raw[key].get<double>();
            };
            const double rx = field("x");
            const double ry = field("y");
            const double rw = field("width");
            const double rh = field("height");
            constexpr double kRectLimit = 100000;
            const bool good = std::isfinite(rx) && std::isfinite(ry) && std::isfinite(rw) && std::isfinite(rh) && rx > -kRectLimit && rx < kRectLimit &&
                              ry > -kRectLimit && ry < kRectLimit && rw >= 1 && rw < kRectLimit && rh >= 1 && rh < kRectLimit;
            if (!good) {
                SendToSurface(from, {{"type", "capture"}, {"requestId", msg.value("requestId", json())}, {"ok", false}, {"error", "rect"}});
                return;
            }
            rect = {{"x", rx}, {"y", ry}, {"width", rw}, {"height", rh}};
        }
        CaptureFull(id, from, msg.value("requestId", json()), maxEdge, rect);
    } else if (type == "captureScreen") {
        // 右の「撮影」だけ。窓全体か、この窓があるモニタ（C5）。範囲の切り取りは UI が窓の画像から行う
        const json requestId = msg.value("requestId", json());
        if (from != "right") return;
        const std::string scope = msg.value("scope", "");
        const bool desktop = scope == "desktop";
        if (!desktop && scope != "window") {
            SendToSurface(from, {{"type", "capture"}, {"requestId", requestId}, {"ok", false}, {"error", "grab"}});
            return;
        }
        // 録画中は撮らない（窓の撮影は UI スレッドで最長 2.5 秒止まり、録画のコマが途切れる）
        if (recordOn_) {
            SendToSurface(from, {{"type", "capture"}, {"requestId", requestId}, {"ok", false}, {"error", "busy"}});
            return;
        }
        const ScreenGrab grabbed = GrabBrowser(hwnd_, desktop);
        if (grabbed.error || grabbed.jpeg.empty()) {
            SendToSurface(from, {{"type", "capture"}, {"requestId", requestId}, {"ok", false}, {"error", grabbed.error ? grabbed.error : "grab"}});
            return;
        }
        const std::string data = Base64(grabbed.jpeg);
        constexpr size_t kMaxChars = 900000;
        if (data.size() > kMaxChars) {
            SendToSurface(from, {{"type", "capture"}, {"requestId", requestId}, {"ok", false}, {"error", "tooBig"}});
            return;
        }
        SendToSurface(from, {{"type", "capture"},
                              {"requestId", requestId},
                              {"ok", true},
                              {"via", grabbed.graphicsCapture ? "wgc" : "gdi"},
                              {"image", "data:image/jpeg;base64," + data}});
    } else if (type == "recordCenter") {
        HandleRecord(from, msg);
    } else if (type == "readCaptureText") {
        HandleOcr(from, msg);
    } else if (type == "capturePage" || type == "exportImage" || type == "openExported" || type == "revealExported") {
        // ページ全体の画像と書き出しは、左と下のメモの面からだけ（M4）
        if (from != "left" && from != "memo") return;
        if (type == "capturePage") CapturePage(id, from, msg.value("requestId", json()), msg.value("name", ""));
        else if (type == "exportImage") ExportMemoImage(from, msg);
        else if (type == "openExported") OpenExported(msg);
        else RevealExported(msg);
    } else if (type == "suspendTab") {
        SuspendTab(id);
    } else if (type == "discardTab") {
        DiscardTab(id);
    } else if (type == "setMuted") {
        SetMuted(id, msg.value("muted", false));
    } else if (type == "getPageText") {
        SendPageText(from, id, msg.value("requestId", json()));
    } else if (type == "getScroll") {
        SendScroll(from, id, msg.value("requestId", json()));
    } else if (type == "evalInTab") {
        // 下のメモの区画はページの文を出す面なので、タブの中でスクリプトを動かす命令は受けない
        if (from == "memo") {
            SendToSurface(from, {{"type", "evalResult"}, {"requestId", msg.value("requestId", json())}, {"ok", false}, {"error", "noPage"}});
            return;
        }
        // UI が用意した決まったスクリプトだけを流す（AI が書いたスクリプトは流さない。AI は道具を選ぶだけ）
        EvalInTab(from, id, msg.value("script", ""), msg.value("requestId", json()));
    } else if (type == "popout") {
        if (from == "left") ShowPopout(id, msg.value("places", json::array()));
    } else if (type == "dockPopout") {
        // id が無ければ（前の版の UI）、出ている小窓をみな戻す
        if (from == "left") {
            if (id != 0) DockPopout(id);
            else DockAllPopouts();
        }
    } else if (type == "popoutTop") {
        if (from == "left") SetPopoutTop(id, msg.value("top", true));
    } else if (type == "openDownload") {
        if (from == "left") OpenDownload(msg.value("id", ""));
    } else if (type == "revealDownload") {
        if (from == "left") RevealDownload(msg.value("id", ""));
    } else if (type == "forgetDownload") {
        if (from == "left") ForgetDownload(msg.value("id", ""));
    } else if (type == "notify") {
        const bool ok = Notify(ToWide(msg.value("title", "")), ToWide(msg.value("body", "")));  // 長すぎる分は Notify で切る
        if (msg.contains("requestId")) SendToSurface(from, {{"type", "notified"}, {"requestId", msg["requestId"]}, {"ok", ok}});
    } else if (type == "openBotApp") {
        OpenBotApp(from, msg);
    } else if (type == "botReplyTaken" || type == "botCheck" || type == "botInboxWatch") {
        HandleBotMessage(from, type, msg);
    } else if (type == "setApiKey") {
        // キーはファイルに暗号化して置き、使う UI にだけ渡す
        const std::string key = msg.value("key", "");
        if (key.empty() || key.size() > 512 || !SaveSecret(ApiKeyFile(), key)) {
            SendToSurface(from, {{"type", "apiKey"}, {"key", nullptr}, {"error", "save"}});
            return;
        }
        SendToSurface(from, {{"type", "apiKey"}, {"key", key}});
    } else if (type == "getApiKey") {
        const std::string key = LoadSecret(ApiKeyFile());
        SendToSurface(from, {{"type", "apiKey"}, {"key", key.empty() ? json(nullptr) : json(key)}});
    } else if (type == "deleteApiKey") {
        std::error_code error;
        std::filesystem::remove(ApiKeyFile(), error);
        SendToSurface(from, {{"type", "apiKey"}, {"key", nullptr}});
    } else if (type == "setBotHook" || type == "getBotHook" || type == "deleteBotHook" || type == "botHookSend") {
        HandleBotHook(from, type, msg);
    } else if (type == "writeData" || type == "readData" || type == "listData" || type == "deleteData") {
        HandleDataMessage(from, type, msg);
    } else if (type == "captureSurface") {
        CaptureSurface(from, msg);
    } else if (type == "vaultUsage") {
        // データ置き場の大きさ（画像と文字のファイルの合計）
        std::uintmax_t files = 0;
        const std::uintmax_t bytes = FolderSize(VaultFolder(), files);
        SendToSurface(from, {{"type", "vaultUsage"}, {"requestId", msg.value("requestId", json())}, {"bytes", bytes}, {"files", files}});
    } else if (type == "deleteVaultImage") {
        if (const auto file = VaultImageFile(msg.value("name", ""))) {
            std::error_code error;
            std::filesystem::remove(*file, error);
        }
    } else if (type == "openVaultFolder") {
        // データ置き場のフォルダをエクスプローラーで開く（中の画像をほかのアプリで使うとき）
        const std::filesystem::path dir = VaultFolder();
        std::error_code error;
        std::filesystem::create_directories(dir, error);
        ShellExecuteW(hwnd_, L"open", dir.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    } else if (type == "hexMemoCatalog") {
        json reply = hexmemo::Catalog();
        reply["type"] = "hexMemoCatalog";
        reply["requestId"] = msg.value("requestId", json());
        SendToSurface(from, reply);
    } else if (type == "hexMemoSend") {
        json reply = hexmemo::Send(msg.value("appId", json()), msg.value("boardId", ""), msg.value("records", json()),
                                   msg.value("offsets", json()));
        reply["type"] = "hexMemoSent";
        reply["requestId"] = msg.value("requestId", json());
        SendToSurface(from, reply);
    } else if (type == "hexMemoCheck") {
        json reply = hexmemo::Check(msg.value("appId", json()), msg.value("sendId", ""));
        reply["type"] = "hexMemoState";
        reply["requestId"] = msg.value("requestId", json());
        SendToSurface(from, reply);
    } else if (type == "clipboardRead") {
        // クリップボードの文字と HTML（六角メモのマスの写しは HTML に入っている）
        const clipboard::Content content = clipboard::Read(hwnd_);
        SendToSurface(from, {{"type", "clipboard"},
                             {"requestId", msg.value("requestId", json())},
                             {"text", content.text},
                             {"html", content.html}});
    } else if (type == "clipboardHasImage") {
        // 盤面の「画像を貼る」を薄くするとき。中身は読まない（左の盤面からだけ）
        if (from != "left") return;
        SendToSurface(from, {{"type", "clipboardImage"},
                             {"requestId", msg.value("requestId", json())},
                             {"present", clipboard::HasImage()}});
    } else if (type == "clipboardReadImage") {
        // 盤面のセルへ貼る画像。長い辺 1600px の JPEG を data URL で返す（左の盤面からだけ）
        if (from != "left") return;
        const clipboard::ImageRead read = clipboard::ReadImage(hwnd_);
        json reply = {{"type", "clipboardImage"}, {"requestId", msg.value("requestId", json())}, {"ok", false}};
        if (read.error) {
            reply["error"] = read.error;
        } else {
            const std::string image = "data:image/jpeg;base64," + Base64(read.jpeg);
            constexpr size_t kMaxChars = 900000;
            if (image.size() > kMaxChars) reply["error"] = "big";
            else {
                reply["ok"] = true;
                reply["image"] = image;
            }
        }
        SendToSurface(from, reply);
    } else if (type == "liveCaptions") {
        // ライブキャプションの文字（start なら、開いていなければ起動する）
        json reply = livecaptions::Read(msg.value("start", false));
        reply["type"] = "liveCaptions";
        reply["requestId"] = msg.value("requestId", json());
        SendToSurface(from, reply);
    } else if (type == "readSubtitle") {
        json reply = media::ReadSubtitle(ToWide(msg.value("path", "")));
        reply["type"] = "subtitle";
        reply["requestId"] = msg.value("requestId", json());
        SendToSurface(from, reply);
    } else if (type == "openMediaFile") {
        const std::wstring path = media::OpenDialog(hwnd_);
        SendToSurface(from, {{"type", "mediaFile"}, {"requestId", msg.value("requestId", json())}, {"path", path.empty() ? json(nullptr) : json(ToUtf8(path))}});
    } else if (type == "openJsonFile") {
        // 「提案・取り込みファイルを開く…」：選んだ JSON を文字で返す（kMaxImportFileBytes＝1 MB まで。中身を確かめるのは UI）。左と下の区画（型の窓の「読み込む…」）からだけ
        if (from != "left" && from != "memo") return;
        const std::wstring path = media::OpenJsonDialog(hwnd_);
        json reply = {{"type", "jsonFile"}, {"requestId", msg.value("requestId", json())}};
        if (path.empty()) {
            reply["ok"] = false;
            reply["error"] = "cancel";
        } else {
            const json read = media::ReadJsonText(path, kMaxImportFileBytes);
            for (auto it = read.begin(); it != read.end(); ++it) reply[it.key()] = it.value();
        }
        SendToSurface(from, reply);
    } else if (type == "openImageFile") {
        // 盤面の「画像ファイルを開く」。選んだファイルの縮図（長い辺 480px の JPEG）も返す。左からだけ
        if (from != "left") return;
        const std::wstring path = media::OpenImageDialog(hwnd_);
        json reply = {{"type", "imageFile"}, {"requestId", msg.value("requestId", json())}, {"path", path.empty() ? json(nullptr) : json(ToUtf8(path))}};
        if (!path.empty()) {
            const clipboard::ImageRead read = clipboard::ReadImageFile(path, 480);
            if (read.error) {
                reply["ok"] = false;
                reply["error"] = read.error;
            } else {
                const std::string image = "data:image/jpeg;base64," + Base64(read.jpeg);
                constexpr size_t kMaxChars = 900000;
                if (image.size() > kMaxChars) {
                    reply["ok"] = false;
                    reply["error"] = "big";
                } else {
                    reply["ok"] = true;
                    reply["image"] = image;
                }
            }
        }
        SendToSurface(from, reply);
    } else if (type == "saveClipboardImage") {
        // クリップボードの JPEG（data URL か Base64）を、ピクチャ\Rocks-cells Browser\ に書いてパスを返す。左からだけ
        if (from != "left") return;
        json reply = {{"type", "imageSaved"}, {"requestId", msg.value("requestId", json())}, {"ok", false}};
        std::string data = msg.value("data", "");
        const auto comma = data.find(',');
        if (data.rfind("data:", 0) == 0 && comma != std::string::npos) data = data.substr(comma + 1);
        while (!data.empty() && (data.back() == '\0' || data.back() == '\n' || data.back() == '\r' || data.back() == ' ')) data.pop_back();
        const auto bytes = FromBase64(data);
        if (!bytes || !IsJpegBytes(*bytes) || bytes->empty() || bytes->size() > kMaxExportBytes) {
            reply["error"] = "data";
            SendToSurface(from, reply);
            return;
        }
        const std::filesystem::path dir = ExportFolder();
        std::error_code error;
        std::filesystem::create_directories(dir, error);
        SYSTEMTIME now{};
        GetLocalTime(&now);
        char name[64];
        std::snprintf(name, sizeof(name), "clip-%04u%02u%02u-%02u%02u%02u.jpg", static_cast<unsigned>(now.wYear), static_cast<unsigned>(now.wMonth),
                      static_cast<unsigned>(now.wDay), static_cast<unsigned>(now.wHour), static_cast<unsigned>(now.wMinute), static_cast<unsigned>(now.wSecond));
        const auto file = UniqueExportFile(dir, name);
        if (!file || !WriteFileAtomically(file->first, std::string(bytes->begin(), bytes->end()))) {
            reply["error"] = file ? "write" : "folder";
            SendToSurface(from, reply);
            return;
        }
        reply["ok"] = true;
        reply["path"] = ToUtf8(file->first.wstring());
        SendToSurface(from, reply);
    } else if (type == "pickApp") {
        // アプリのセル（A1）：ファイルを選ぶだけ。起動も、窓の移動もしない。左の盤面からだけ
        if (from != "left") return;
        json reply = apps::Pick(hwnd_);
        reply["type"] = "appPicked";
        reply["requestId"] = msg.value("requestId", json());
        SendToSurface(from, reply);
    } else if (type == "summonApp") {
        // アプリのセル：既にある窓を中央に合わせる。無ければ起動して待つ。ストアアプリはアプリ ID で探す。左からだけ
        if (from != "left") return;
        SummonApp(msg);
    } else if (type == "clipboardWrite") {
        // noHistory：クリップボード履歴（Win+V）と同期に入れない印も置く（依頼の小窓 v2・R2・D6。ボットの依頼だけが true で頼む）
        const bool ok = clipboard::Write(hwnd_, msg.value("text", ""), msg.value("html", ""), NoHistory(msg));
        SendToSurface(from, {{"type", "clipboardWritten"}, {"requestId", msg.value("requestId", json())}, {"ok", ok}});
    } else if (type == "clipboardWriteImage") {
        // 六角スクショを Grok Bot へ（S3.12）：画像（PNG の Base64）をクリップボードへ。CF_DIBV5 と PNG の両方。fill：透明な所の色。
        //   noHistory は clipboardWrite と同じ（R2）
        //   画像と文を一つの貼り付けで（依頼の小窓 v2・R7d・D16。試し）：png の代わりに shotId（bot-shots\<shotId>.png。左は画像を持たない）。
        //   text（依頼の文）があれば、同じ Open で CF_UNICODETEXT と HTML Format（html の文の断片の頭に、書く PNG の data: の <img>）も。
        //   アプリが受けたかは分からないので、返すのは書けたかだけ
        const auto bytes = msg.contains("png") ? ShotBytes(msg) : SavedShotBytes(msg);
        const auto text = msg.find("text");
        const auto html = msg.find("html");
        const clipboard::ImageFill fill = ShotFill(msg.value("fill", "white"));
        bool ok = false;
        if (bytes && text != msg.end() && text->is_string()) {
            ok = clipboard::WriteImageWithText(hwnd_, *bytes, fill, text->get<std::string>(), html != msg.end() && html->is_string() ? html->get<std::string>() : std::string(), NoHistory(msg));
        } else if (bytes) {
            ok = clipboard::WriteImage(hwnd_, *bytes, fill, NoHistory(msg));
        }
        SendToSurface(from, {{"type", "clipboardWritten"}, {"requestId", msg.value("requestId", json())}, {"ok", ok}});
    } else if (type == "botShotSave") {
        // 貼れなかったときの逃げ道（S3.12）：bot-shots\<shotId>.png に保存して、フルパスを返す（7 日より古いものは消す）
        json reply = SaveBotShot(msg);
        reply["type"] = "botShotSaved";
        reply["requestId"] = msg.value("requestId", json());
        SendToSurface(from, reply);
    } else if (type == "botShotOpenFolder") {
        OpenBotShotFolder(hwnd_, msg);
    } else if (type == "hexMemoReadBoard") {
        json reply = hexmemo::ReadBoard(msg.value("appId", json()), msg.value("boardId", ""));
        reply["type"] = "hexMemoBoard";
        reply["requestId"] = msg.value("requestId", json());
        SendToSurface(from, reply);
    } else if (type == "setSidebar") {
        auto it = surfaces_.find(msg.value("side", ""));
        if (it == surfaces_.end()) return;
        Surface& surface = it->second;
        const bool wasVisible = surface.visible;
        if (msg.contains("visible")) surface.visible = msg["visible"].get<bool>();
        if (msg.contains("width") && msg["width"].is_number_integer()) {
            surface.widthDip = std::clamp(msg["width"].get<int>(), kMinSidebarDip, kMaxSidebarDip);
        }
        // 下のメモの区画はページの下に置く面。読む画面の split は見ない
        if (it->first != "memo" && msg.contains("split")) {
            const json& split = msg["split"];
            if (split.is_boolean()) surface.split = split.get<bool>() ? "right" : "";
            if (split.is_string()) surface.split = split.get<std::string>() == "bottom" ? "bottom" : split.get<std::string>() == "right" ? "right" : "";
        }
        if (msg.contains("height") && msg["height"].is_number_integer()) {
            const int lo = it->first == "memo" ? kMinMemoDip : kMinSidebarDip;
            const int hi = it->first == "memo" ? kMaxMemoDip : kMaxSidebarDip;
            surface.heightDip = std::clamp(msg["height"].get<int>(), lo, hi);
        }
        // 段 9。下のメモだけ。place が文字列のときだけ見る。"upper" 以外は下の帯へ戻す。欄が無ければ今のまま
        if (it->first == "memo" && msg.contains("place") && msg["place"].is_string()) {
            surface.place = msg["place"].get<std::string>() == "upper" ? "upper" : "";
        }
        if (surface.visible) CreateSurface(it->first);
        Layout();
        if (it->first == "reader") {
            // 読む画面を出したら読む画面へ、閉じたらページへ、キーボードの入力先を移す
            Tab* tab = FindTab(activeId_);
            ICoreWebView2Controller* target = surface.visible ? surface.controller.Get() : (tab ? tab->controller.Get() : nullptr);
            if (target) target->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        } else if (it->first == "memo" && surface.visible != wasVisible) {
            // 高さを変えるたびに移すと、境目をドラッグしているあいだ入力先が飛ぶ。見えた・隠れたときだけ移す
            Tab* tab = FindTab(activeId_);
            ICoreWebView2Controller* target = surface.visible ? surface.controller.Get() : (tab ? tab->controller.Get() : nullptr);
            if (target) target->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        }
        Broadcast({{"type", "sidebars"}, {"state", SidebarState()}});
    } else if (type == "relay") {
        // サイドバー同士の連絡を中継する（C++ は中身を見ない）
        const std::string to = msg.value("to", "all");
        const json relayed = {{"type", "relayed"}, {"from", from}, {"payload", msg.value("payload", json())}};
        for (const auto& entry : surfaces_) {
            if (entry.first != from && (to == "all" || to == entry.first)) SendToSurface(entry.first, relayed);
        }
    } else if (type == "saveSession") {
        if (msg.contains("data") && msg["data"].is_object()) {
            // 書けたかを返す（書けないことを画面に出すため）。控えの回し方は SaveSessionWithBackups
            const bool ok = SaveSessionWithBackups(SessionFile(), msg["data"].dump(2, ' ', false, json::error_handler_t::replace), sessionRotated_);
            SendToSurface(from, {{"type", "sessionSaved"}, {"ok", ok}});
        }
        // 終了前の最後の保存が済んだ → もう一度 WM_CLOSE を送って、今度こそ閉じる
        //   録画を閉じる途中で確定したときは、右がそのカードを保存し終えるまで待つ（recordCenter saved）
        if (msg.value("final", false) && closing_) {
            closeLeftDone_ = true;
            if (closeAwaitId_.empty()) PostMessageW(hwnd_, WM_CLOSE, 0, 0);
        }
    } else if (Tab* tab = FindTab(id)) {
        if (type == "navigate") {
            // すぐに UI へ知らせる（移動の途中でも、眠っていても、この URL を覚えておく）
            tab->url = ToWide(msg.value("url", ""));
            SendTabUpdate(id, {{"url", ToUtf8(tab->url)}});
            if (tab->webview) tab->webview->Navigate(tab->url.c_str());  // 眠っているタブは、起きたときに開く
        } else if (tab->webview) {
            if (type == "goBack") tab->webview->GoBack();
            else if (type == "goForward") tab->webview->GoForward();
            else if (type == "reload") tab->webview->Reload();
        }
    }
}

// ボットのセル：Grok Bot アプリの、そのボットのチャットを開く（第1段）
//   ・UI から受け取るのはエージェントの id だけ。形を確かめてから、URL はここで組み立てて OS に渡す
//   ・grokbot:// が登録されていなければ開かずに noApp を返す（Windows の「アプリを探す」画面を出さない）
//   ・受けるのは左と右のサイドバーだけ（読む画面と下のメモの区画はページの文を出すので受けない）
//   ・返事（botAppOpened）は requestId があるときだけ送る
void Browser::OpenBotApp(const std::string& from, const json& msg) {
    if (from != "left" && from != "right") return;
    const json requestId = msg.value("requestId", json());
    const auto reply = [this, &from, &requestId](bool ok, const char* error) {
        if (requestId.is_null()) return;
        json result = {{"type", "botAppOpened"}, {"requestId", requestId}, {"ok", ok}};
        if (error) result["error"] = error;
        SendToSurface(from, result);
    };
    const auto it = msg.find("agentId");
    const std::string agentId = it != msg.end() && it->is_string() ? it->get<std::string>() : std::string();
    if (!IsValidAgentId(agentId)) {
        reply(false, "badId");
        return;
    }
    if (!GrokBotRegistered()) {
        reply(false, "noApp");
        return;
    }
    const std::wstring url = std::wstring(kGrokBotAgentUrl) + ToWide(agentId);
    // すでに動いている Grok Bot の窓が、自分を前に出せるように（押したのは使う人なので、前に出てよい）
    AllowSetForegroundWindow(ASFW_ANY);
    SHELLEXECUTEINFOW info{};
    info.cbSize = sizeof(info);
    info.fMask = SEE_MASK_FLAG_NO_UI | SEE_MASK_NOASYNC;  // 失敗しても Windows のエラーの窓を出さない
    info.hwnd = hwnd_;
    info.lpVerb = L"open";
    info.lpFile = url.c_str();
    info.nShow = SW_SHOWNORMAL;
    const bool ok = ShellExecuteExW(&info) != FALSE;
    reply(ok, ok ? nullptr : "failed");
}

// アプリのセル（A5。docs/plan-app-cells.md）
//   台帳の target（と、前回掴んだ host）に合う見える窓を、中央の区画へ合わせ、最前面にする。
//   フルパスが違っても、ファイル名（大小無視）が同じなら掴む。Windows 11 のメモ帳はこれ（起動は System32、窓は WindowsApps）。
//   ストアアプリ（target が空、または ApplicationFrameHost.exe）は exe では探さない。アプリ ID、無ければ登録名の題名で探す。
//   無ければ launch を起動し、約8秒、0.2秒おきに待つ。起動直後は、ShellExecuteEx のプロセス番号と、起動前に無かった窓も候補。
//   ストアアプリの待ちでは、新しい窓だけでは掴まない（別のストアアプリを動かさない）。
//   最前面は同時に1つ。合わせたあとは FollowPinned が、ブラウザの移動・大きさ・サイドバー・下のメモに追従する。

namespace {

apps::FoundWindow SeekApp(const std::wstring& target, const std::wstring& host, const std::wstring& appId, const std::wstring& title, DWORD pid,
                          const std::vector<HWND>* earlier, bool* denied, bool allowFresh) {
    apps::WindowLook look;
    look.target = target;
    look.host = host;
    look.appId = appId;
    look.title = title;
    look.pid = pid;
    look.earlier = earlier;
    look.accessDenied = denied;
    look.allowFresh = allowFresh;
    return apps::FindAppWindow(look);
}

// 待ちのあいだの同じアプリか。ストアアプリは ApplicationFrameHost を共有するので、起動パスかアプリ ID で見る
bool SamePending(const std::wstring& waitLaunch, const std::wstring& waitTarget, const std::wstring& waitAppId, const std::wstring& launch,
                 const std::wstring& target, const std::wstring& appId) {
    if (apps::SameAppId(waitAppId, appId)) return true;
    if (apps::IsStoreTarget(target) || apps::IsStoreTarget(waitTarget)) return !launch.empty() && apps::SameExePath(waitLaunch, launch);
    return apps::SameExePath(waitTarget, target);
}

}  // namespace

void Browser::SendAppSummon(const json& requestId, bool ok, const char* action, const char* error, bool overlap, const std::wstring& host,
                            const std::wstring& appId) {
    if (requestId.is_null()) return;
    json reply = {{"type", "appSummoned"}, {"requestId", requestId}, {"ok", ok}};
    if (ok && action) reply["action"] = action;
    if (!ok) reply["error"] = error ? error : "failed";
    if (overlap) reply["overlap"] = true;
    if (ok && !host.empty()) reply["host"] = ToUtf8(host);
    if (ok && !appId.empty()) reply["aumid"] = ToUtf8(appId);
    SendToSurface("left", reply);
}

RECT Browser::PageScreen() {
    // 起動時に PER_MONITOR_AWARE_V2（main.cpp）。ClientToScreen の結果は物理ピクセル。
    // SetWindowPos も物理ピクセルなので、ここで DIP に換算しない（モニタの倍率が違うと大きさがずれる）。
    const RECT page = PageRect();
    POINT origin{page.left, page.top};
    POINT farCorner{page.right, page.bottom};  // far は windows.h の空マクロなので使わない
    ClientToScreen(hwnd_, &origin);
    ClientToScreen(hwnd_, &farCorner);
    return RECT{origin.x, origin.y, farCorner.x, farCorner.y};
}

void Browser::RevealPinned() {
    if (pinnedHidden_ && pinnedHwnd_ && IsWindow(pinnedHwnd_)) ShowWindow(pinnedHwnd_, SW_SHOWNOACTIVATE);
    pinnedHidden_ = false;
}

void Browser::DropFollow(const char* reason) {
    RevealPinned();
    pinnedHwnd_ = nullptr;
    pinnedTarget_.clear();
    haveLastFollow_ = false;
    pinnedOverlap_ = false;
    KillTimer(hwnd_, kAppFollowTimerId);
    // 終了中は UI がもう保存の途中なので、メニューの更新は送らない
    if (!closing_) SendToSurface("left", {{"type", "appFollowEnded"}, {"reason", reason ? reason : "closed"}});
}

void Browser::FollowPinned() {
    if (closing_ || following_ || !pinnedHwnd_) return;
    following_ = true;
    if (!IsWindow(pinnedHwnd_)) {
        DropFollow("closed");
        following_ = false;
        return;
    }
    // ブラウザが最小化のあいだは隠す（タスクバーにアプリのボタンを増やさない）。復元したときに出す
    if (IsIconic(hwnd_)) {
        if (!pinnedHidden_) {
            ShowWindow(pinnedHwnd_, SW_HIDE);
            pinnedHidden_ = true;
        }
        following_ = false;
        return;
    }
    bool shownAgain = false;
    if (pinnedHidden_) {
        ShowWindow(pinnedHwnd_, SW_SHOWNOACTIVATE);
        pinnedHidden_ = false;
        shownAgain = true;
    }
    // 上半分のあいだは、最前面の窓を札の上へ動かさない（前の位置のまま重なることがある）。
    // 下の帯に戻すと Layout からもう一度ここが呼ばれ、ページの矩形へ戻る。PageRect は 0 にしない（裏のタブが大きさ 0 だと組みが崩れる）
    if (MemoCoversPage()) {
        following_ = false;
        return;
    }
    const RECT page = PageScreen();
    if (page.right <= page.left || page.bottom <= page.top) {
        following_ = false;
        return;
    }
    // 区画が同じなら動かさない。使う人が窓をドラッグしても、次にブラウザが動いたときに中央へ戻る
    if (!shownAgain && haveLastFollow_ && page.left == lastFollow_.left && page.top == lastFollow_.top && page.right == lastFollow_.right &&
        page.bottom == lastFollow_.bottom) {
        following_ = false;
        return;
    }
    const apps::PlaceResult placed = apps::PlaceInPage(pinnedHwnd_, page, true);
    if (placed.kind == apps::PlaceKind::Missing) {
        DropFollow("closed");
    } else if (placed.kind == apps::PlaceKind::Denied) {
        if (IsWindow(pinnedHwnd_)) apps::ClearTopmost(pinnedHwnd_);
        DropFollow("denied");
    } else if (placed.kind == apps::PlaceKind::Placed || placed.kind == apps::PlaceKind::Fixed) {
        lastFollow_ = page;
        haveLastFollow_ = true;
        // サイドバーを広げて、固定の窓がはみ出したときだけ一度知らせる（最初のダブルクリックで知らせ済みなら UI が省く）
        if (placed.overlap && !pinnedOverlap_) {
            pinnedOverlap_ = true;
            SendToSurface("left", {{"type", "appFollowOverlap"}});
        }
    }
    following_ = false;
}

void Browser::ReleasePinned(const json& requestId) {
    // 最小化で隠したまま最前面をやめると、窓が画面から消えたままになる。先に戻す
    RevealPinned();
    if (pinnedHwnd_ && IsWindow(pinnedHwnd_)) apps::ClearTopmost(pinnedHwnd_);
    pinnedHwnd_ = nullptr;
    pinnedTarget_.clear();
    haveLastFollow_ = false;
    pinnedOverlap_ = false;
    KillTimer(hwnd_, kAppFollowTimerId);
    SendAppSummon(requestId, true, "released", nullptr);
}

void Browser::PlacePinned(HWND window, const std::wstring& target, const json& requestId, const std::wstring& appId) {
    if (pinnedHwnd_ && pinnedHwnd_ != window && IsWindow(pinnedHwnd_)) {
        RevealPinned();
        apps::ClearTopmost(pinnedHwnd_);
    }
    pinnedHwnd_ = nullptr;
    pinnedTarget_.clear();
    pinnedHidden_ = false;
    haveLastFollow_ = false;
    pinnedOverlap_ = false;
    KillTimer(hwnd_, kAppFollowTimerId);
    if (!window || !IsWindow(window)) {
        SendAppSummon(requestId, false, nullptr, "notFound");
        return;
    }
    const apps::PlaceResult placed = apps::PlaceInPage(window, PageScreen());
    if (placed.kind == apps::PlaceKind::Denied) {
        SendAppSummon(requestId, false, nullptr, "denied");
        return;
    }
    if (placed.kind == apps::PlaceKind::Failed || placed.kind == apps::PlaceKind::Missing) {
        SendAppSummon(requestId, false, nullptr, placed.kind == apps::PlaceKind::Missing ? "notFound" : "failed");
        return;
    }
    pinnedHwnd_ = window;
    pinnedTarget_ = target;
    lastFollow_ = PageScreen();
    haveLastFollow_ = true;
    pinnedOverlap_ = placed.overlap;
    SetTimer(hwnd_, kAppFollowTimerId, kAppFollowIntervalMs, nullptr);
    // 掴んだ窓の実行ファイルを返す。台帳が覚え、次はフルパスでも探す（起動用の exe と違ってもよい）
    // ストアアプリのホスト（ApplicationFrameHost）は HostOf が空にする。アプリ ID は台帳の aumid へ
    std::wstring id = appId;
    if (id.empty() && apps::IsStoreTarget(target)) id = apps::WindowAppId(window);
    SendAppSummon(requestId, true, placed.kind == apps::PlaceKind::Fixed ? "fixed" : "placed", nullptr, placed.overlap, apps::HostOf(window), id);
}

void Browser::SummonApp(const json& msg) {
    const json requestId = msg.value("requestId", json());
    const std::wstring launch = ToWide(msg.value("launch", ""));
    const std::wstring target = ToWide(msg.value("target", ""));
    const std::wstring host = ToWide(msg.value("host", ""));
    const std::wstring args = ToWide(msg.value("args", ""));
    const std::wstring cwd = ToWide(msg.value("cwd", ""));
    if (msg.value("release", false) && pinnedHwnd_ && IsWindow(pinnedHwnd_)) {
        // 最前面をやめる。位置と大きさはそのまま。窓は閉じない
        // 窓がもう無いときは、やめずに下で出し直す（閉じたあとのダブルクリックは、また開く）
        ReleasePinned(requestId);
        return;
    }
    std::wstring appId = ToWide(msg.value("aumid", ""));
    if (!apps::SameAppId(appId, appId)) appId.clear();
    if (appId.empty()) {
        const std::wstring shortcut = ToWide(msg.value("shortcut", ""));
        appId = apps::ShortcutAppId(!shortcut.empty() ? shortcut : launch);
    }
    std::wstring title;
    if (apps::IsStoreTarget(target)) {
        title = ToWide(msg.value("name", ""));
        if (title.size() > 80) title.resize(80);
    }
    if (!apps::IsLaunchable(launch)) {
        SendAppSummon(requestId, false, nullptr, "badPath");
        return;
    }
    // 別のアプリを出す（または出し直す）。今の最前面はやめる。新しい窓が無くても、同時に最前面は1つ
    RevealPinned();
    if (pinnedHwnd_ && IsWindow(pinnedHwnd_)) apps::ClearTopmost(pinnedHwnd_);
    pinnedHwnd_ = nullptr;
    pinnedTarget_.clear();
    haveLastFollow_ = false;
    pinnedOverlap_ = false;
    KillTimer(hwnd_, kAppFollowTimerId);
    const bool store = apps::IsStoreTarget(target);
    // アプリ ID で探すときは、起動前に無かった別の窓を掴かない（別のストアアプリを動かさない）
    const bool allowFresh = !store && appId.empty();
    bool accessDenied = false;
    const apps::FoundWindow already = SeekApp(target, host, appId, title, 0, nullptr, &accessDenied, allowFresh);
    if (already.hwnd && apps::SureMatch(already.via)) {
        const std::wstring id = !already.appId.empty() ? already.appId : appId;
        PlacePinned(already.hwnd, target, requestId, id);
        return;
    }
    // 同じアプリを、いま起動して待っている最中なら、もう一度は起動しない。起動前の控えも、そのときのものを使う
    DWORD pid = 0;
    std::vector<HWND> earlier;
    const auto waiting = std::find_if(appSummons_.begin(), appSummons_.end(), [&](const AppSummonWait& wait) {
        return SamePending(wait.launch, wait.target, wait.appId, launch, target, appId);
    });
    if (waiting != appSummons_.end()) {
        pid = waiting->pid;
        earlier = waiting->earlier;
    } else {
        earlier = apps::ListVisibleWindows();
        if (!apps::Launch(hwnd_, launch, args, cwd, &pid)) {
            SendAppSummon(requestId, false, nullptr, "failed");
            return;
        }
    }
    const apps::FoundWindow opened = SeekApp(target, host, appId, title, pid, &earlier, &accessDenied, allowFresh);
    // フルパス・ファイル名・アプリ ID・プロセス番号・題名はすぐ置く。新しい窓だけは、起動の途中の別の窓を拾わないよう少し待つ
    if (opened.hwnd && apps::SureMatch(opened.via)) {
        const std::wstring id = !opened.appId.empty() ? opened.appId : appId;
        PlacePinned(opened.hwnd, target, requestId, id);
        return;
    }
    if (static_cast<int>(appSummons_.size()) >= 8) {
        // 待ちが溜まりすぎている。起動直後の新しい窓があれば、それを置く（ストアアプリは別の窓を掴まない）。無ければ知らせる
        if (opened.hwnd && allowFresh) PlacePinned(opened.hwnd, target, requestId, appId);
        else SendAppSummon(requestId, true, "waiting", nullptr, false, {}, appId);
        return;
    }
    const bool startTimer = appSummons_.empty();
    AppSummonWait wait;
    wait.requestId = requestId;
    wait.launch = launch;
    wait.target = target;
    wait.host = host;
    wait.appId = appId;
    wait.title = title;
    wait.pid = pid;
    wait.accessDenied = accessDenied;
    wait.ticksLeft = kAppWindowWaitTicks;
    wait.earlier = std::move(earlier);
    if (opened.hwnd && allowFresh) wait.freshHwnd = opened.hwnd;
    appSummons_.push_back(std::move(wait));
    if (startTimer) SetTimer(hwnd_, kAppWindowTimerId, kAppWindowIntervalMs, nullptr);
}

void Browser::PollAppWindows() {
    if (closing_) return;
    std::vector<AppSummonWait> pending;
    pending.reserve(appSummons_.size());
    for (AppSummonWait& wait : appSummons_) {
        const bool store = apps::IsStoreTarget(wait.target);
        const bool allowFresh = !store && wait.appId.empty();
        const apps::FoundWindow found = SeekApp(wait.target, wait.host, wait.appId, wait.title, wait.pid, &wait.earlier, &wait.accessDenied, allowFresh);
        if (found.hwnd && apps::SureMatch(found.via)) {
            const std::wstring id = !found.appId.empty() ? found.appId : wait.appId;
            PlacePinned(found.hwnd, wait.target, wait.requestId, id);
            continue;
        }
        if (allowFresh && found.hwnd && found.via == apps::FoundVia::FreshFront) {
            wait.freshHwnd = found.hwnd;  // 前景に出た新しい窓を優先して覚えておく
        } else if (allowFresh && found.hwnd && found.via == apps::FoundVia::FreshOther && !wait.freshHwnd) {
            wait.freshHwnd = found.hwnd;
        }
        if (wait.freshHwnd && !IsWindow(wait.freshHwnd)) wait.freshHwnd = nullptr;
        wait.ticksLeft -= 1;
        const bool last = wait.ticksLeft <= 0;
        // ファイル名やプロセス番号で特定できるまで待つ。最後の回だけ、残っている新しい窓を掴む。
        // ストアアプリは、ここで別のアプリの窓を掴まない
        if (last && wait.freshHwnd && allowFresh) {
            PlacePinned(wait.freshHwnd, wait.target, wait.requestId, wait.appId);
            continue;
        }
        if (last) {
            // 窓を特定できなかった。中央には合わせていない（UI が理由を出す）
            if (wait.pid == 0 && wait.accessDenied && !store) SendAppSummon(wait.requestId, false, nullptr, "notFound");
            else SendAppSummon(wait.requestId, true, "waiting", nullptr, false, {}, wait.appId);
            continue;
        }
        pending.push_back(std::move(wait));
    }
    appSummons_ = std::move(pending);
    if (appSummons_.empty()) KillTimer(hwnd_, kAppWindowTimerId);
}

// ---------- ボットの返事の受け取り口（第2段 S2.1） ----------
//   ・置き場（RocksCellsRelay\inbox\）から bot-inbox\ へ移し、取ったものを左の UI へ botReply で送る（bots.cpp）
//   ・返事を扱う持ち主は左の UI だけ。ボットの命令は左（from == "left"）からだけ受ける。右と読む画面からは受けない
//   ・C++ は中身を判断しない（形・大きさ・名前だけ）。確かめと二重の見分けは左の UI（bots.ts）

void Browser::HandleBotMessage(const std::string& from, const std::string& type, const json& msg) {
    if (from != "left") return;
    if (type == "botReplyTaken") {
        // 左の UI が「保存した（done）」か「受け取れない（rejected）」と決めた。渡した一覧にある fileId だけを動かす（bots.cpp）
        const auto text = [&msg](const char* key) {
            const auto it = msg.find(key);
            return it != msg.end() && it->is_string() ? it->get<std::string>() : std::string();
        };
        botInbox_.Taken(text("fileId"), text("result"), text("reason"));
    } else if (type == "botInboxWatch") {
        // 台帳にボットがいる（on）／1体もいない。いないときは見回りを止める
        const auto it = msg.find("on");
        botWatch_ = it != msg.end() && it->is_boolean() && it->get<bool>();
        if (botWatch_ && ClaimBotInbox()) BotInboxReady();
        UpdateBotTimer();
        if (botWatch_) ScanBotInbox();
    } else if (type == "botCheck") {
        // 今すぐ見る（台帳にボットがいなくても見る）。peek（R8）：見回らずに様子だけ返す（最後に見回った時刻を聞くため）
        const auto peek = msg.find("peek");
        if (peek == msg.end() || !peek->is_boolean() || !peek->get<bool>()) {
            if (ClaimBotInbox()) BotInboxReady();
            ScanBotInbox();
        }
        if (msg.contains("requestId")) SendBotInboxState(msg["requestId"]);
    }
}

void Browser::OnAppActivate(bool active) {
    if (closing_ || !leftReady_) return;
    SendToSurface("left", {{"type", "appActive"}, {"active", active}});
}

void Browser::OnTimer(UINT_PTR id) {
    if (closing_) return;
    if (id == kAppWindowTimerId) {
        PollAppWindows();
        return;
    }
    if (id == kAppFollowTimerId) {
        FollowPinned();  // ブラウザが動いていなくても、窓が閉じたら追従をやめる
        return;
    }
    if (id == kRecordTimerId) {
        RecordTick();
        return;
    }
    if (id != kBotInboxTimerId) return;
    // 受け取っていない窓：前の持ち主（別の窓）が閉じていれば、ここで受け取りを引き継ぐ
    if (ClaimBotInbox()) BotInboxReady();
    ScanBotInbox();
}

void Browser::ScanBotInbox() {
    if (closing_ || !leftReady_ || !botInbox_.Owner()) return;  // 左の UI の準備ができるまでは取らない（置いたままにする）
    for (json& reply : botInbox_.Scan()) SendToSurface("left", reply);
    botScanAt_ = IsoNow();  // 見回った時刻だけ覚える（知らせない。左が botCheck の peek で聞く。R8）
}

bool Browser::ClaimBotInbox() {
    if (botInbox_.Owner()) return false;
    return botInbox_.TryOwn(DataFolderKey());
}

void Browser::BotInboxReady() {
    if (!leftReady_) return;
    SendBotInboxState(json());
    for (json& reply : botInbox_.Resend()) SendToSurface("left", reply);
}

// 受け取り口の様子：owner＝この窓が受け取る（false なら別の窓が受け取っている）、
// relay＝置き場を見ている（試しのデータフォルダで ROCKSCELLS_RELAY_DIR が無いときは false）、watching＝4秒おきに見回っている、
// lastScanAt＝最後に見回った時刻（R8。まだ見回っていなければ付けない。置き場の場所は渡さない）
void Browser::SendBotInboxState(const json& requestId) {
    json state = {{"type", "botInboxState"},
                  {"owner", botInbox_.Owner()},
                  {"relay", !bots::RelayInboxFolder().empty()},
                  {"watching", botTimerOn_}};
    if (!botScanAt_.empty()) state["lastScanAt"] = botScanAt_;
    if (!requestId.is_null()) state["requestId"] = requestId;
    SendToSurface("left", state);
}

void Browser::UpdateBotTimer() {
    const bool on = botWatch_ && !closing_;
    if (on == botTimerOn_) return;
    botTimerOn_ = on;
    if (on) SetTimer(hwnd_, kBotInboxTimerId, kBotInboxIntervalMs, nullptr);
    else KillTimer(hwnd_, kBotInboxTimerId);
}

// UI の保存場所（ui-data\ の中だけ）の読み書き
void Browser::HandleDataMessage(const std::string& from, const std::string& type, const json& msg) {
    const json requestId = msg.value("requestId", json());
    const std::string name = msg.value("name", "");
    if (type == "writeData") {
        const auto file = UiDataFile(name);
        const bool ok = file && WriteFileAtomically(*file, msg.value("text", ""));
        if (!requestId.is_null()) SendToSurface(from, {{"type", "dataWritten"}, {"requestId", requestId}, {"ok", ok}});
    } else if (type == "readData") {
        const auto file = UiDataFile(name);
        const auto text = file ? ReadTextFile(*file) : std::nullopt;
        json reply = {{"type", "dataRead"}, {"requestId", requestId}, {"text", text ? json(*text) : json(nullptr)}};
        // 読めなかったとき、ファイルが本当に無いのかを添える（撮影の台帳が「無い」と「開けない」を分けるため）
        if (file && !text) {
            std::error_code missingError;
            if (!std::filesystem::exists(*file, missingError) && !missingError) reply["missing"] = true;
        }
        SendToSurface(from, reply);
    } else if (type == "listData") {
        json files = json::array();
        if (const auto dir = UiDataDir(msg.value("dir", ""))) {
            std::error_code error;
            for (const auto& entry : std::filesystem::directory_iterator(*dir, error)) {
                if (!entry.is_regular_file() || entry.path().extension() != L".json") continue;
                const auto modified = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::clock_cast<std::chrono::system_clock>(entry.last_write_time()).time_since_epoch());
                files.push_back({{"name", msg.value("dir", "") + "/" + ToUtf8(entry.path().filename().wstring())},
                                 {"size", entry.file_size()},
                                 {"modified", modified.count()}});
            }
        }
        SendToSurface(from, {{"type", "dataList"}, {"requestId", requestId}, {"files", files}});
    } else if (type == "deleteData") {
        if (const auto file = UiDataFile(name)) {
            std::error_code error;
            std::filesystem::remove(*file, error);
        }
    }
}

// データ置き場：頼んだ面（右サイドバー）の決まった範囲を、DevTools の Page.captureScreenshot で撮って保存する
//   beyond = true：画面の外（下）に描いた会話も撮る（captureBeyondViewport）。false：見えている範囲だけ
//   画像は UI へは返さず、ui-data\vault\img\ に書いて、書けたかと大きさだけを返す（大きな画像を何度も渡さないため）
void Browser::CaptureSurface(const std::string& from, const json& msg) {
    const json requestId = msg.value("requestId", json());
    auto fail = [this, from, requestId](const char* error) {
        SendToSurface(from, {{"type", "surfaceCaptured"}, {"requestId", requestId}, {"ok", false}, {"error", error}});
    };
    const auto it = surfaces_.find(from);
    const std::string name = msg.value("name", "");
    const auto file = VaultImageFile(name);
    const json clip = msg.value("clip", json());
    if (it == surfaces_.end() || !it->second.webview || !file || !clip.is_object()) {
        fail("bad");
        return;
    }
    const auto number = [&clip](const char* key) {
        const json& value = clip.contains(key) ? clip[key] : json();
        return value.is_number() ? value.get<double>() : -1.0;
    };
    const double x = number("x");
    const double y = number("y");
    const double width = number("width");
    const double height = number("height");
    // 1枚の大きさには上限がある（Chromium の画像の大きさの上限より十分小さく。長い会話は UI が何枚かに分ける）
    if (x < 0 || y < 0 || width < 1 || height < 1 || width > 4000 || height > 16000 || x > 100000 || y > 100000) {
        fail("size");
        return;
    }
    const std::string format = name.ends_with(".png") ? "png" : name.ends_with(".webp") ? "webp" : "jpeg";
    json params = {{"format", format},
                   {"clip", {{"x", x}, {"y", y}, {"width", width}, {"height", height}, {"scale", 1}}},
                   {"captureBeyondViewport", msg.value("beyond", false)},
                   {"fromSurface", true}};
    if (format != "png") params["quality"] = 92;
    const std::filesystem::path path = *file;
    const HRESULT hr = it->second.webview->CallDevToolsProtocolMethod(
        L"Page.captureScreenshot", ToWide(params.dump()).c_str(),
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [this, from, requestId, path](HRESULT result, LPCWSTR resultJson) -> HRESULT {
                json reply = {{"type", "surfaceCaptured"}, {"requestId", requestId}, {"ok", false}};
                const json value = SUCCEEDED(result) && resultJson ? json::parse(ToUtf8(resultJson), nullptr, false) : json();
                const std::string data = value.is_object() && value.contains("data") && value["data"].is_string() ? value["data"].get<std::string>() : std::string();
                const auto bytes = data.empty() ? std::optional<std::vector<BYTE>>() : FromBase64(data);
                if (!bytes || bytes->empty()) {
                    reply["error"] = "capture";
                } else if (!WriteFileAtomically(path, std::string(bytes->begin(), bytes->end()))) {
                    reply["error"] = "write";
                } else {
                    reply["ok"] = true;
                    reply["bytes"] = bytes->size();
                }
                SendToSurface(from, reply);
                return S_OK;
            })
            .Get());
    if (FAILED(hr)) fail("capture");
}

void Browser::SendToSurface(const std::string& name, const json& msg) {
    auto it = surfaces_.find(name);
    if (it == surfaces_.end() || !it->second.webview) return;
    it->second.webview->PostWebMessageAsJson(ToWide(Serialize(msg)).c_str());
}

void Browser::Broadcast(const json& msg) {
    const std::wstring text = ToWide(Serialize(msg));
    for (auto& entry : surfaces_) {
        if (entry.second.webview) entry.second.webview->PostWebMessageAsJson(text.c_str());
    }
}

void Browser::SendTabUpdate(int id, json patch) {
    Broadcast({{"type", "tabUpdated"}, {"id", id}, {"patch", std::move(patch)}});
}

// ページ全体を JPEG にして、ピクチャのフォルダへ書く。画像の中身は返さない（大きいので、ファイルの名前だけ）
//   幅 4,000・高さ 16,000 を超えた分は切る（truncated）。幅が 1,600 を超えたら、横が 1,600 になるように縮めて撮る
void Browser::CapturePage(int id, const std::string& surface, const json& requestId, const std::string& name) {
    auto fail = [this, surface, requestId](const char* error) {
        SendToSurface(surface, {{"type", "pageCaptured"}, {"requestId", requestId}, {"ok", false}, {"error", error}});
    };
    if (!IsExportName(name)) {
        fail("name");
        return;
    }
    const std::filesystem::path dir = ExportFolder();
    if (dir.empty()) {
        fail("folder");
        return;
    }
    std::error_code folderError;
    std::filesystem::create_directories(dir, folderError);
    if (folderError) {
        fail("folder");
        return;
    }
    if (IsPopped(id)) {
        fail("popout");
        return;
    }
    Tab* tab = FindTab(id);
    if (!tab || !tab->webview) {
        fail("noPage");
        return;
    }
    if (id != activeId_) {
        fail("notActive");
        return;
    }
    ResumeTab(*tab);
    const HRESULT hr = tab->webview->CallDevToolsProtocolMethod(
        L"Page.getLayoutMetrics", L"{}",
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [this, surface, requestId, id, name, dir](HRESULT result, LPCWSTR resultJson) -> HRESULT {
                auto failInner = [this, surface, requestId](const char* error) {
                    SendToSurface(surface, {{"type", "pageCaptured"}, {"requestId", requestId}, {"ok", false}, {"error", error}});
                };
                Tab* current = FindTab(id);
                if (!current || !current->webview) {
                    failInner("noPage");
                    return S_OK;
                }
                if (id != activeId_) {
                    failInner("notActive");
                    return S_OK;
                }
                const json metrics = SUCCEEDED(result) && resultJson ? json::parse(ToUtf8(resultJson), nullptr, false) : json();
                if (!metrics.is_object()) {
                    failInner("metrics");
                    return S_OK;
                }
                auto num = [](const json& obj, const char* key) -> double {
                    if (!obj.is_object() || !obj.contains(key) || !obj[key].is_number()) return -1;
                    return obj[key].get<double>();
                };
                const json content = metrics.contains("cssContentSize") && metrics["cssContentSize"].is_object() ? metrics["cssContentSize"] : json::object();
                double w = num(content, "width");
                double h = num(content, "height");
                if (!std::isfinite(w) || !std::isfinite(h) || w < 1 || h < 1) {
                    failInner("size");
                    return S_OK;
                }
                const bool truncated = w > kPageMaxWidth || h > kPageMaxHeight;
                if (w > kPageMaxWidth) w = kPageMaxWidth;
                if (h > kPageMaxHeight) h = kPageMaxHeight;
                // clip は DIP（CSS ピクセル × ページの拡大率）で数える（2026-10-14、依頼① I0）。CSS の大きさのままだと、拡大したページで下と右が欠けた。
                //   上限（kPageMaxWidth・kPageMaxHeight）と返す width・height は CSS のまま。縮める倍率は DIP の幅で数える（拡大率 100% なら今までと同じ）
                const json visual = metrics.contains("cssVisualViewport") && metrics["cssVisualViewport"].is_object() ? metrics["cssVisualViewport"] : json::object();
                double zoom = num(visual, "zoom");
                if (!std::isfinite(zoom) || zoom < 0.05 || zoom > 20) zoom = 1.0;
                const double clipW = w * zoom;
                const double clipH = h * zoom;
                const double scale = clipW > kPageScaleWidth ? kPageScaleWidth / clipW : 1.0;
                const int width = static_cast<int>(std::lround(w));
                const int height = static_cast<int>(std::lround(h));
                const json params = {{"format", "jpeg"},
                                     {"quality", 85},
                                     {"fromSurface", true},
                                     {"captureBeyondViewport", true},
                                     {"clip", {{"x", 0}, {"y", 0}, {"width", clipW}, {"height", clipH}, {"scale", scale}}}};
                const HRESULT call = current->webview->CallDevToolsProtocolMethod(
                    L"Page.captureScreenshot", ToWide(params.dump()).c_str(),
                    Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                        [this, surface, requestId, name, dir, width, height, truncated](HRESULT shotResult, LPCWSTR shotJson) -> HRESULT {
                            auto failShot = [this, surface, requestId](const char* error) {
                                SendToSurface(surface, {{"type", "pageCaptured"}, {"requestId", requestId}, {"ok", false}, {"error", error}});
                            };
                            const json shot = SUCCEEDED(shotResult) && shotJson ? json::parse(ToUtf8(shotJson), nullptr, false) : json();
                            const std::string data = shot.is_object() && shot.contains("data") && shot["data"].is_string() ? shot["data"].get<std::string>() : std::string();
                            if (data.empty()) {
                                failShot("shot");
                                return S_OK;
                            }
                            if (data.size() > kMaxExportBase64) {
                                failShot("big");
                                return S_OK;
                            }
                            const auto bytes = FromBase64(data);
                            if (!bytes || !IsJpegBytes(*bytes)) {
                                failShot("shot");
                                return S_OK;
                            }
                            if (bytes->size() > kMaxExportBytes) {
                                failShot("big");
                                return S_OK;
                            }
                            const auto saved = UniqueExportFile(dir, name);
                            if (!saved) {
                                failShot("write");
                                return S_OK;
                            }
                            if (!WriteFileAtomically(saved->first, std::string(bytes->begin(), bytes->end()))) {
                                failShot("write");
                                return S_OK;
                            }
                            SendToSurface(surface, {{"type", "pageCaptured"},
                                                    {"requestId", requestId},
                                                    {"ok", true},
                                                    {"name", saved->second},
                                                    {"width", width},
                                                    {"height", height},
                                                    {"truncated", truncated}});
                            return S_OK;
                        })
                        .Get());
                if (FAILED(call)) failInner("shot");
                return S_OK;
            })
            .Get());
    if (FAILED(hr)) fail("metrics");
}

// カードの画像を、同じピクチャのフォルダへ書く。data は data: の頭を付けない Base64。JPEG か PNG の印を確かめる
void Browser::ExportMemoImage(const std::string& surface, const json& msg) {
    const json requestId = msg.value("requestId", json());
    auto fail = [this, surface, requestId](const char* error) {
        SendToSurface(surface, {{"type", "imageExported"}, {"requestId", requestId}, {"ok", false}, {"error", error}});
    };
    const std::string name = msg.value("name", "");
    if (!IsExportName(name)) {
        fail("name");
        return;
    }
    const auto found = msg.find("data");
    if (found == msg.end() || !found->is_string()) {
        fail("data");
        return;
    }
    const std::string& data = found->get_ref<const std::string&>();
    if (data.empty() || data.find("data:") != std::string::npos) {
        fail("data");
        return;
    }
    if (data.size() > kMaxExportBase64) {
        fail("big");
        return;
    }
    const auto bytes = FromBase64(data);
    if (!bytes) {
        fail("data");
        return;
    }
    if (bytes->size() > kMaxExportBytes) {
        fail("big");
        return;
    }
    const bool jpeg = name.size() >= 4 && name.compare(name.size() - 4, 4, ".jpg") == 0;
    if (jpeg ? !IsJpegBytes(*bytes) : !IsPngBytes(*bytes)) {
        fail("data");
        return;
    }
    const std::filesystem::path dir = ExportFolder();
    if (dir.empty()) {
        fail("folder");
        return;
    }
    std::error_code folderError;
    std::filesystem::create_directories(dir, folderError);
    if (folderError) {
        fail("folder");
        return;
    }
    const auto saved = UniqueExportFile(dir, name);
    if (!saved || !WriteFileAtomically(saved->first, std::string(bytes->begin(), bytes->end()))) {
        fail("write");
        return;
    }
    SendToSurface(surface, {{"type", "imageExported"}, {"requestId", requestId}, {"ok", true}, {"name", saved->second}});
}

// 書き出した画像を Windows で開く。名前が違う・フォルダの外・ファイルが無いときは、何もしない（返事は返さない）
void Browser::OpenExported(const json& msg) {
    const auto file = ExportFileInFolder(msg.value("name", ""));
    if (!file) return;
    std::error_code error;
    if (!std::filesystem::is_regular_file(*file, error) || error) return;
    ShellExecuteW(hwnd_, L"open", file->c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

// ピクチャのフォルダを開いて、その画像を選ぶ。名前が違うときは開かない。ファイルが無ければフォルダだけ開く
void Browser::RevealExported(const json& msg) {
    const auto file = ExportFileInFolder(msg.value("name", ""));
    if (!file) return;
    const std::filesystem::path dir = file->parent_path();
    std::error_code error;
    std::filesystem::create_directories(dir, error);
    if (std::filesystem::is_regular_file(*file, error) && !error) {
        if (PIDLIST_ABSOLUTE item = ILCreateFromPathW(file->c_str())) {
            const HRESULT hr = SHOpenFolderAndSelectItems(item, 0, nullptr, 0);
            ILFree(item);
            if (SUCCEEDED(hr)) return;
        }
    }
    ShellExecuteW(hwnd_, L"open", dir.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

json Browser::SidebarState() const {
    json state = json::object();
    for (const auto& entry : surfaces_) {
        json one = {{"visible", entry.second.visible}, {"width", entry.second.widthDip}, {"height", entry.second.heightDip}};
        // 上半分のときだけ足す。空のときは、今までの JSON と同じ
        if (entry.first == "memo" && entry.second.place == "upper") one["place"] = "upper";
        state[entry.first] = std::move(one);
    }
    return state;
}

// 「🔍 Grok に調べてもらう」のショートカット（S3.11）。PC で確かめて、この定数1つで切り替える
//   false（既定）：Ctrl+Shift+G
//   true         ：Ctrl+G
//   Chromium ではページの検索の「次を検索」（Ctrl+G）・「前を検索」（Ctrl+Shift+G）と同じキー。どちらにしても、ここで先に受け取って
//   Handled にする（ページにもページの検索にも渡さない。検索の次へ・前へは Enter・Shift+Enter・F3 で動く）
//   選んだ文は C++ からは取れないので空で送る（左の UI がページに選んだ文を聞く。無ければ選んだ文なしで小窓を開く）
constexpr bool kAskGrokPlainCtrlG = false;
#ifdef ROCKSCELLS_BOT_FEATURES
constexpr bool kBotFeatures = true;
#else
constexpr bool kBotFeatures = false;
#endif

// Ctrl+T などのショートカットは、どの WebView2 にフォーカスがあっても受け取れるようにする
void Browser::WatchShortcuts(ICoreWebView2Controller* controller) {
    controller->add_AcceleratorKeyPressed(
        Callback<ICoreWebView2AcceleratorKeyPressedEventHandler>(
            [this](ICoreWebView2Controller*, ICoreWebView2AcceleratorKeyPressedEventArgs* args) -> HRESULT {
                COREWEBVIEW2_KEY_EVENT_KIND kind;
                args->get_KeyEventKind(&kind);
                if (kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN || GetKeyState(VK_CONTROL) >= 0) return S_OK;

                UINT key = 0;
                args->get_VirtualKey(&key);
                const bool shift = GetKeyState(VK_SHIFT) < 0;
                const char* action = nullptr;
                switch (key) {
                case 'T': action = "newTab"; break;
                case 'W': action = "closeTab"; break;
                case 'L': action = "focusAddress"; break;
                case VK_TAB: action = shift ? "prevTab" : "nextTab"; break;
                case 'S':
                    if (shift) action = "hexShot";  // 六角形スクショ
                    break;
                case 'M':
                    if (shift) action = "memoPane";  // 下のメモの区画を開く・閉じる（M4）
                    break;
                case 'Q':
                    if (shift) action = "memoQuote";  // 選んだ文を下のメモへ（M4）。文は空。左がページに聞く。ブラウザは終わらせない
                    break;
                case 'Y':
                    if (shift) action = "captureCenter";  // 中央の見えている所（C2）。録画中は右が停止にする（C6）。ブラウザは終わらせない
                    break;
                case 'G':
                    if (kBotFeatures && shift != kAskGrokPlainCtrlG) {
                        // Grok に調べてもらう：表示中のタブの id と URL（http / https のときだけ）を左へ。小窓を開くのは左の UI
                        args->put_Handled(TRUE);
                        const Tab* tab = FindTab(activeId_);
                        const std::wstring url = tab && IsOpenableUrl(tab->url) ? tab->url : std::wstring();
                        SendToSurface("left", {{"type", "linkMenu"}, {"action", "askGrok"}, {"id", activeId_}, {"url", ToUtf8(url)}, {"text", ""}});
                        return S_OK;
                    }
                    break;
                }
                if (!action) return S_OK;

                args->put_Handled(TRUE);
                // アドレスバーに文字を打てるよう、キーボードの入力先を左のサイドバーへ移す
                Surface& left = surfaces_["left"];
                if ((key == 'T' || key == 'L') && left.controller) {
                    left.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
                }
                SendToSurface("left", {{"type", "shortcut"}, {"action", action}});
                return S_OK;
            })
            .Get(),
        nullptr);
}

// ---------- 配置とウィンドウ ----------

// 左サイドバー | ページ | 右サイドバー の順に並べる
RECT Browser::PageRect() {
    RECT client;
    GetClientRect(hwnd_, &client);
    auto widthOf = [this](const char* name) -> LONG {
        const Surface& surface = surfaces_.at(name);
        return surface.visible && surface.controller ? ToPixels(surface.widthDip) : 0;
    };
    const LONG left = std::min<LONG>(widthOf("left"), client.right);
    const LONG right = std::min<LONG>(widthOf("right"), std::max<LONG>(0, client.right - left - ToPixels(kMinContentDip)));
    RECT content{left, 0, client.right - right, client.bottom};
    // 下のメモの区画が見えていれば、表に出たときと同じだけ下を引く（裏のタブの大きさがずれないように）
    // 上半分のあいだは引かない。ページは Layout が隠す。ここを空にすると、裏のタブが大きさ 0 で組まれる
    const Surface& memo = surfaces_.at("memo");
    if (memo.visible && memo.controller && !MemoCoversPage()) {
        const LONG avail = std::max<LONG>(0, content.bottom - content.top - ToPixels(kMinContentDip));
        const LONG height = std::min<LONG>(ToPixels(memo.heightDip), avail);
        content.bottom -= height;
    }
    return content;
}

bool Browser::MemoCoversPage() const {
    const Surface& memo = surfaces_.at("memo");
    if (memo.place != "upper" || !memo.visible || !memo.controller) return false;
    const Surface& reader = surfaces_.at("reader");
    // 読む画面が出ているあいだは、二つの全面を重ねない。メモは下の帯のまま
    return !(reader.visible && reader.controller);
}

void Browser::Layout() {
    RECT client;
    GetClientRect(hwnd_, &client);
    auto widthOf = [this](const char* name) -> LONG {
        const Surface& surface = surfaces_.at(name);
        return surface.visible && surface.controller ? ToPixels(surface.widthDip) : 0;
    };
    LONG left = std::min<LONG>(widthOf("left"), client.right);
    LONG right = std::min<LONG>(widthOf("right"), std::max<LONG>(0, client.right - left - ToPixels(kMinContentDip)));
    RECT content{left, 0, client.right - right, client.bottom};
    RECT memoBounds{};
    const bool memoUpper = MemoCoversPage();
    const Surface& memo = surfaces_.at("memo");
    if (memoUpper) {
        // 段 9。高さの値は残し、ここでは引かない。メモが左右の間を覆う
        memoBounds = content;
    } else if (memo.visible && memo.controller) {
        const LONG avail = std::max<LONG>(0, content.bottom - content.top - ToPixels(kMinContentDip));
        const LONG height = std::min<LONG>(ToPixels(memo.heightDip), avail);
        memoBounds = RECT{content.left, content.bottom - height, content.right, content.bottom};
        content.bottom -= height;
    }
    const Surface& reader = surfaces_.at("reader");
    const bool reading = reader.visible && reader.controller;
    // 読む画面：ふつうはページの場所に重ねる。動画のときは右側か下側だけに出し、残りにページ（動画）を見せる
    const bool split = reading && !reader.split.empty();
    RECT page = content;
    RECT readerBounds = content;
    if (split && reader.split == "bottom") {
        const LONG height = std::min<LONG>(ToPixels(reader.heightDip), std::max<LONG>(0, content.bottom - content.top - ToPixels(kMinContentDip)));
        page.bottom = content.bottom - height;
        readerBounds.top = page.bottom;
    } else if (split) {
        const LONG width = std::min<LONG>(ToPixels(reader.widthDip), std::max<LONG>(0, content.right - content.left - ToPixels(kMinContentDip)));
        page.right = content.right - width;
        readerBounds.left = page.right;
    }

    for (auto& [name, surface] : surfaces_) {
        if (!surface.controller) continue;
        surface.controller->put_IsVisible(surface.visible);
        if (!surface.visible) continue;
        const RECT bounds = name == "left"     ? RECT{0, 0, left, client.bottom}
                            : name == "right" ? RECT{client.right - right, 0, client.right, client.bottom}
                            : name == "memo"  ? memoBounds
                                              : readerBounds;
        surface.controller->put_Bounds(bounds);
    }
    if (Tab* tab = FindTab(activeId_); tab && tab->controller && !IsPopped(tab->id)) {
        tab->controller->put_Bounds(page);
        // 重ねて読んでいる間、またはメモが上半分を覆っている間は、ページを隠す
        tab->controller->put_IsVisible((!reading || split) && !memoUpper);
    }
    LayoutPopouts();
    FollowPinned();  // サイドバーや下のメモで区画が変わったときも、外の窓を追従させる
}

void Browser::OnWindowMoved() {
    for (auto& entry : surfaces_) {
        if (entry.second.controller) entry.second.controller->NotifyParentWindowPositionChanged();
    }
    for (auto& entry : tabs_) {
        // 小窓のタブの親は小さい窓。大きい窓が動いた合図は、そちらには渡さない
        if (entry.second.controller && !IsPopped(entry.first)) entry.second.controller->NotifyParentWindowPositionChanged();
    }
    FollowPinned();  // ブラウザをドラッグしたとき、外の窓も中央の区画に付いてくる
}

void Browser::UpdateWindowTitle() {
    std::wstring caption = kAppName;
    if (Tab* tab = FindTab(activeId_); tab && tab->webview) {
        CoString title;
        tab->webview->get_DocumentTitle(title.put());
        if (!title.str().empty()) caption = title.str() + L" - " + kAppName;
    }
    SetWindowTextW(hwnd_, caption.c_str());
}

LONG Browser::ToPixels(int dip) const {
    return MulDiv(dip, static_cast<int>(GetDpiForWindow(hwnd_)), 96);
}

// ---------- 終了 ----------

namespace {

constexpr int kMaxDownloads = 40;

std::filesystem::path DownloadsFile() {
    return AppDataFolder() / L"downloads.json";
}

bool IsDownloadId(const std::string& id) {
    if (id.empty() || id.size() > 40) return false;
    return std::all_of(id.begin(), id.end(), [](unsigned char c) { return std::isalnum(c) || c == '-'; });
}

// ファイル名を UTF-8 の文字の途中で切らない（切れたまま JSON にすると、表示が崩れる）
void ClipUtf8(std::string& text, std::size_t maxBytes) {
    if (text.size() <= maxBytes) return;
    text.resize(maxBytes);
    while (!text.empty() && (static_cast<unsigned char>(text.back()) & 0xC0) == 0x80) text.pop_back();
    if (!text.empty() && (static_cast<unsigned char>(text.back()) & 0xC0) == 0xC0) text.pop_back();
}

// 人が押しても、実行ファイルやスクリプトは起動しない（フォルダで見せるだけ）
bool IsRiskyDownload(const std::wstring& path) {
    std::wstring ext = std::filesystem::path(path).extension().wstring();
    for (wchar_t& c : ext) c = static_cast<wchar_t>(towlower(static_cast<wint_t>(c)));
    static constexpr const wchar_t* kRisky[] = {
        L".exe", L".bat", L".cmd", L".com", L".scr", L".pif", L".msi", L".msp", L".ps1", L".vbs", L".vbe",
        L".js",  L".jse", L".wsf", L".wsh", L".hta", L".lnk", L".reg", L".msc", L".cpl", L".dll", L".jar",
    };
    for (const wchar_t* item : kRisky) {
        if (ext == item) return true;
    }
    return false;
}

bool SelectInFolder(HWND hwnd, const std::wstring& path) {
    if (PIDLIST_ABSOLUTE item = ILCreateFromPathW(path.c_str())) {
        const HRESULT hr = SHOpenFolderAndSelectItems(item, 0, nullptr, 0);
        ILFree(item);
        if (SUCCEEDED(hr)) return true;
    }
    const std::filesystem::path parent = std::filesystem::path(path).parent_path();
    if (parent.empty()) return false;
    return reinterpret_cast<INT_PTR>(ShellExecuteW(hwnd, L"open", parent.c_str(), nullptr, nullptr, SW_SHOWNORMAL)) > 32;
}

}  // namespace

// ライブの小窓のシステムメニュー（タイトルバーを右クリック・左上のアイコン）に足す項目
constexpr UINT kPopoutMenuTop = 0x1110;   // 最前面に固定（切り替え）
constexpr UINT kPopoutMenuDock = 0x1120;  // サイドバーへ戻す

LRESULT CALLBACK PopoutWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    auto* browser = reinterpret_cast<Browser*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    const int id = browser ? browser->PopoutIdOf(hwnd) : 0;
    switch (msg) {
    case WM_SIZE:
        if (id != 0) browser->LayoutPopout(id);
        return 0;
    case WM_MOVE:
        if (id != 0) {
            if (Browser::Tab* tab = browser->FindTab(id); tab && tab->controller) {
                tab->controller->NotifyParentWindowPositionChanged();
            }
        }
        return 0;
    case WM_EXITSIZEMOVE:  // 動かし終えた・大きさを変え終えた：UI に覚えてもらう
        if (id != 0) browser->SendPopoutPlace(id);
        return 0;
    case WM_DPICHANGED: {
        const RECT* suggested = reinterpret_cast<const RECT*>(lParam);
        SetWindowPos(hwnd, nullptr, suggested->left, suggested->top, suggested->right - suggested->left, suggested->bottom - suggested->top,
                     SWP_NOZORDER | SWP_NOACTIVATE);
        return 0;
    }
    case WM_ERASEBKGND:  // 窓の地（タブを出す前・大きさを変えている間）。見た目のテーマがあればその色
        if (HBRUSH brush = theme::BackgroundBrush()) {
            RECT rect;
            GetClientRect(hwnd, &rect);
            FillRect(reinterpret_cast<HDC>(wParam), &rect, brush);
            return 1;
        }
        break;
    case WM_SYSCOMMAND:
        if (id != 0 && (wParam & 0xFFF0) == kPopoutMenuTop) {
            auto it = browser->popouts_.find(id);
            if (it != browser->popouts_.end()) browser->SetPopoutTop(id, !it->second.top);
            return 0;
        }
        if (id != 0 && (wParam & 0xFFF0) == kPopoutMenuDock) {
            browser->DockPopout(id);
            return 0;
        }
        break;
    case WM_CLOSE:
        if (id != 0) browser->DockPopout(id);
        else DestroyWindow(hwnd);
        return 0;
    default:
        break;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

void Browser::WatchDownloads(int id) {
    Tab* tab = FindTab(id);
    if (!tab || !tab->webview) return;
    ComPtr<ICoreWebView2_4> webview4;
    if (FAILED(tab->webview.As(&webview4))) return;
    // Handled と Cancel は変えない。保存の場所を聞くダイアログは、今までどおり WebView2 が出す
    webview4->add_DownloadStarting(
        Callback<ICoreWebView2DownloadStartingEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* args) -> HRESULT {
                ComPtr<ICoreWebView2DownloadOperation> operation;
                if (!args || FAILED(args->get_DownloadOperation(&operation)) || !operation) return S_OK;
                activeDownloads_.push_back(operation);
                const HRESULT watched = operation->add_StateChanged(
                    Callback<ICoreWebView2StateChangedEventHandler>(
                        [this](ICoreWebView2DownloadOperation* sender, IUnknown*) -> HRESULT {
                            if (!sender) return S_OK;
                            COREWEBVIEW2_DOWNLOAD_STATE state = COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS;
                            if (FAILED(sender->get_State(&state)) || state == COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS) return S_OK;
                            if (state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED) RememberDownload(sender);
                            DropDownload(sender);
                            return S_OK;
                        })
                        .Get(),
                    nullptr);
                if (FAILED(watched)) DropDownload(operation.Get());
                return S_OK;
            })
            .Get(),
        nullptr);
}

void Browser::DropDownload(ICoreWebView2DownloadOperation* operation) {
    for (auto it = activeDownloads_.begin(); it != activeDownloads_.end(); ++it) {
        if (it->Get() == operation) {
            activeDownloads_.erase(it);
            return;
        }
    }
}

void Browser::RememberDownload(ICoreWebView2DownloadOperation* operation) {
    CoString path;
    if (!operation || FAILED(operation->get_ResultFilePath(path.put()))) return;
    const std::wstring file = path.str();
    if (file.empty()) return;
    std::error_code error;
    if (!std::filesystem::is_regular_file(file, error)) return;
    INT64 bytes = 0;
    operation->get_BytesReceived(&bytes);
    const auto at = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
    std::string name = ToUtf8(std::filesystem::path(file).filename().wstring());
    if (name.empty()) name = "ファイル";
    ClipUtf8(name, 180);
    for (auto it = downloads_.begin(); it != downloads_.end(); ++it) {
        if (_wcsicmp(it->path.c_str(), file.c_str()) == 0) {
            DownloadItem kept = std::move(*it);
            downloads_.erase(it);
            kept.name = name;
            kept.bytes = bytes;
            kept.at = at;
            downloads_.insert(downloads_.begin(), std::move(kept));
            SaveDownloads();
            SendDownloads();
            return;
        }
    }
    DownloadItem item;
    item.id = "d" + NewUuid();
    if (item.id.size() > 40) item.id.resize(40);
    item.name = name;
    item.path = file;
    item.bytes = bytes;
    item.at = at;
    downloads_.insert(downloads_.begin(), std::move(item));
    if (static_cast<int>(downloads_.size()) > kMaxDownloads) downloads_.resize(kMaxDownloads);
    SaveDownloads();
    SendDownloads();
}

void Browser::LoadDownloads() {
    downloads_.clear();
    if (AppDataFolder().empty()) return;
    const json data = ReadJsonFile(DownloadsFile());
    if (!data.is_object() || data.value("version", 0) != 1) return;
    const auto items = data.find("items");
    if (items == data.end() || !items->is_array()) return;
    for (const json& row : *items) {
        try {
            if (!row.is_object()) continue;
            DownloadItem item;
            item.id = row.value("id", "");
            item.name = row.value("name", "");
            item.path = ToWide(row.value("path", ""));
            item.bytes = row.value("bytes", static_cast<std::int64_t>(0));
            item.at = row.value("at", static_cast<std::int64_t>(0));
            if (!IsDownloadId(item.id) || item.path.empty()) continue;
            if (item.name.empty()) item.name = ToUtf8(std::filesystem::path(item.path).filename().wstring());
            downloads_.push_back(std::move(item));
            if (static_cast<int>(downloads_.size()) >= kMaxDownloads) break;
        } catch (const json::exception&) {
            continue;
        }
    }
}

void Browser::SaveDownloads() {
    if (AppDataFolder().empty()) return;
    json items = json::array();
    for (const DownloadItem& item : downloads_) {
        items.push_back({{"id", item.id}, {"name", item.name}, {"path", ToUtf8(item.path)}, {"bytes", item.bytes}, {"at", item.at}});
    }
    const json data = {{"version", 1}, {"items", items}};
    WriteFileAtomically(DownloadsFile(), data.dump(2, ' ', false, json::error_handler_t::replace));
}

void Browser::SendDownloads() {
    json items = json::array();
    for (const DownloadItem& item : downloads_) {
        items.push_back({{"id", item.id}, {"name", item.name}, {"bytes", item.bytes}, {"at", item.at}});
    }
    SendToSurface("left", {{"type", "downloads"}, {"items", items}});
}

Browser::DownloadItem* Browser::FindDownload(const std::string& id) {
    if (!IsDownloadId(id)) return nullptr;
    for (DownloadItem& item : downloads_) {
        if (item.id == id) return &item;
    }
    return nullptr;
}

void Browser::OpenDownload(const std::string& id) {
    DownloadItem* item = FindDownload(id);
    if (!item) return;
    std::error_code error;
    if (!std::filesystem::is_regular_file(item->path, error)) {
        SendToSurface("left", {{"type", "downloadResult"}, {"id", id}, {"ok", false}, {"error", "missing"}});
        return;
    }
    if (IsRiskyDownload(item->path)) {
        const bool shown = SelectInFolder(hwnd_, item->path);
        json reply = {{"type", "downloadResult"}, {"id", id}, {"ok", shown}, {"opened", false}};
        if (shown) reply["note"] = "この種類は実行しません。フォルダを開きました";
        else reply["error"] = "failed";
        SendToSurface("left", reply);
        return;
    }
    AllowSetForegroundWindow(ASFW_ANY);
    SHELLEXECUTEINFOW info{};
    info.cbSize = sizeof(info);
    info.fMask = SEE_MASK_FLAG_NO_UI | SEE_MASK_NOASYNC;
    info.hwnd = hwnd_;
    info.lpVerb = L"open";
    info.lpFile = item->path.c_str();
    info.nShow = SW_SHOWNORMAL;
    const bool ok = ShellExecuteExW(&info) != FALSE;
    json reply = {{"type", "downloadResult"}, {"id", id}, {"ok", ok}, {"opened", ok}};
    if (!ok) reply["error"] = "failed";
    SendToSurface("left", reply);
}

void Browser::RevealDownload(const std::string& id) {
    DownloadItem* item = FindDownload(id);
    if (!item) return;
    const bool shown = SelectInFolder(hwnd_, item->path);
    json reply = {{"type", "downloadResult"}, {"id", id}, {"ok", shown}, {"opened", false}};
    if (!shown) reply["error"] = "failed";
    SendToSurface("left", reply);
}

void Browser::ForgetDownload(const std::string& id) {
    if (!IsDownloadId(id)) return;
    const auto it = std::find_if(downloads_.begin(), downloads_.end(), [&](const DownloadItem& item) { return item.id == id; });
    if (it == downloads_.end()) return;
    downloads_.erase(it);
    SaveDownloads();
    SendDownloads();
}

int Browser::PopoutIdOf(HWND hwnd) const {
    for (const auto& entry : popouts_) {
        if (entry.second.hwnd == hwnd) return entry.first;
    }
    return 0;
}

// slot 番の小窓を作る。place（UI が覚えていた {x, y, w, h, top}。物理ピクセル）が画面の中にあれば、その位置・大きさで
//   無ければ右下に 480x270（DIP）。番号ごとに少しずつ上へずらして、重ならないようにする
HWND Browser::CreatePopoutWindow(int slot, const json& place, bool* top) {
    static bool registered = false;
    if (!registered) {
        WNDCLASSEXW wc{sizeof(wc)};
        wc.lpfnWndProc = PopoutWndProc;
        wc.hInstance = GetModuleHandleW(nullptr);
        wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
        wc.lpszClassName = L"RocksCellsBrowserPopout";
        registered = RegisterClassExW(&wc) != 0;
        if (!registered) return nullptr;
    }
    *top = true;
    int x = 0, y = 0, width = 0, height = 0;
    bool placed = false;
    if (place.is_object()) {
        *top = place.value("top", true);
        const auto num = [&place](const char* key) {
            const auto it = place.find(key);
            return it != place.end() && it->is_number() ? it->get<int>() : 0;
        };
        x = num("x");
        y = num("y");
        width = num("w");
        height = num("h");
        const RECT want{x, y, x + width, y + height};
        // 小さすぎる・どの画面にも重ならない（モニターを外した）ときは使わない
        placed = width >= 160 && height >= 100 && width <= 10000 && height <= 10000 && MonitorFromRect(&want, MONITOR_DEFAULTTONULL) != nullptr;
    }
    const DWORD exStyle = *top ? WS_EX_TOPMOST : 0;
    if (!placed) {
        RECT rect{0, 0, ToPixels(480), ToPixels(270)};
        AdjustWindowRectEx(&rect, WS_OVERLAPPEDWINDOW, FALSE, exStyle);
        RECT work{};
        MONITORINFO monitorInfo{sizeof(monitorInfo)};
        if (const HMONITOR monitor = MonitorFromWindow(hwnd_, MONITOR_DEFAULTTONEAREST); monitor && GetMonitorInfoW(monitor, &monitorInfo)) {
            work = monitorInfo.rcWork;
        } else {
            SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
        }
        width = rect.right - rect.left;
        height = rect.bottom - rect.top;
        x = work.right - width - ToPixels(24) - slot * ToPixels(28);
        y = work.bottom - height - ToPixels(24) - slot * ToPixels(36);
    }
    HWND popup = CreateWindowExW(exStyle, L"RocksCellsBrowserPopout", L"小窓", WS_OVERLAPPEDWINDOW, x, y, width, height, hwnd_, nullptr,
                                 GetModuleHandleW(nullptr), nullptr);
    if (!popup) return nullptr;
    SetWindowLongPtrW(popup, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));
    if (theme_) theme::ApplyFrame(popup, themeSlot_);
    if (HMENU menu = GetSystemMenu(popup, FALSE)) {
        AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
        AppendMenuW(menu, MF_STRING | (*top ? MF_CHECKED : MF_UNCHECKED), kPopoutMenuTop, L"最前面に固定");
        AppendMenuW(menu, MF_STRING, kPopoutMenuDock, L"サイドバーへ戻す");
    }
    return popup;
}

// places は UI が覚えている窓の番号ごとの位置（無ければ空）。すでに出ていれば前へ出すだけ
void Browser::ShowPopout(int id, const json& places) {
    if (id == 0) return;
    if (auto it = popouts_.find(id); it != popouts_.end()) {
        SetWindowPos(it->second.hwnd, it->second.top ? HWND_TOPMOST : HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        return;
    }
    Tab* tab = FindTab(id);
    if (!tab) return;
    if (static_cast<int>(popouts_.size()) >= kMaxPopouts) {
        SendPopouts("full");
        return;
    }
    if (!tab->controller) {
        popoutAfterWake_[id] = places;
        if (!tab->waking) WakeTab(id);
        return;
    }
    popoutAfterWake_.erase(id);
    int slot = 0;
    for (; slot < kMaxPopouts; ++slot) {
        bool used = false;
        for (const auto& entry : popouts_) used = used || entry.second.slot == slot;
        if (!used) break;
    }
    const json place = places.is_array() && slot < static_cast<int>(places.size()) ? places[slot] : json();
    bool top = true;
    HWND popup = CreatePopoutWindow(slot, place, &top);
    if (!popup) {
        SendPopouts("failed");
        return;
    }
    ResumeTab(*tab);
    if (FAILED(tab->controller->put_ParentWindow(popup))) {
        DestroyWindow(popup);
        SendPopouts("failed");
        return;
    }
    popouts_[id] = Popout{popup, slot, top};
    tab->controller->put_IsVisible(TRUE);
    LayoutPopout(id);
    tab->controller->NotifyParentWindowPositionChanged();
    UpdatePopoutTitle(id);
    ShowWindow(popup, SW_SHOWNOACTIVATE);
    SetWindowPos(popup, top ? HWND_TOPMOST : HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    SendPopouts();
    Layout();
}

// その小窓を閉じて、ページを大きい窓へ戻す（閉じる前に位置を UI へ返す）
void Browser::DockPopout(int id, bool notify) {
    auto it = popouts_.find(id);
    if (it == popouts_.end()) return;
    SendPopoutPlace(id);
    HWND popup = it->second.hwnd;
    popouts_.erase(it);
    if (Tab* tab = FindTab(id); tab && tab->controller) {
        tab->controller->put_ParentWindow(hwnd_);  // 小さい窓を壊す前に、親を大きい窓へ戻す（戻さないとページごと消える）
        if (id != activeId_) tab->controller->put_IsVisible(FALSE);  // 裏に戻す。表示中なら Layout が大きさも直す
        tab->controller->NotifyParentWindowPositionChanged();
    }
    if (popup) DestroyWindow(popup);
    Layout();
    if (notify) SendPopouts();
}

void Browser::DockAllPopouts() {
    if (popouts_.empty()) return;
    std::vector<int> ids;
    for (const auto& entry : popouts_) ids.push_back(entry.first);
    for (int id : ids) DockPopout(id, false);
    SendPopouts();
}

void Browser::LayoutPopout(int id) {
    auto it = popouts_.find(id);
    if (it == popouts_.end()) return;
    Tab* tab = FindTab(id);
    if (!tab || !tab->controller) return;
    RECT client{};
    GetClientRect(it->second.hwnd, &client);
    tab->controller->put_Bounds(client);
    tab->controller->put_IsVisible(TRUE);
}

void Browser::LayoutPopouts() {
    for (const auto& entry : popouts_) LayoutPopout(entry.first);
}

void Browser::UpdatePopoutTitle(int id) {
    auto it = popouts_.find(id);
    if (it == popouts_.end()) return;
    Tab* tab = FindTab(id);
    std::wstring caption = L"小窓";
    if (tab && tab->webview) {
        CoString title;
        tab->webview->get_DocumentTitle(title.put());
        if (!title.str().empty()) caption = title.str();
    }
    if (!it->second.top) caption += L"（最前面でない）";
    SetWindowTextW(it->second.hwnd, caption.c_str());
}

void Browser::SetPopoutTop(int id, bool top) {
    auto it = popouts_.find(id);
    if (it == popouts_.end()) return;
    it->second.top = top;
    HWND popup = it->second.hwnd;
    SetWindowPos(popup, top ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    if (HMENU menu = GetSystemMenu(popup, FALSE)) CheckMenuItem(menu, kPopoutMenuTop, MF_BYCOMMAND | (top ? MF_CHECKED : MF_UNCHECKED));
    UpdatePopoutTitle(id);
    SendPopoutPlace(id);
    SendPopouts();
}

// 左の UI へ、いま出ている小窓の一覧（id は前の版の UI のため、最初の 1 つ。無ければ null）
void Browser::SendPopouts(const char* error) {
    json list = json::array();
    for (const auto& entry : popouts_) list.push_back({{"id", entry.first}, {"slot", entry.second.slot}, {"top", entry.second.top}});
    json msg = {{"type", "popout"}, {"id", popouts_.empty() ? json() : json(popouts_.begin()->first)}, {"list", list}};
    if (error) msg["error"] = error;
    SendToSurface("left", msg);
}

// その小窓の位置・大きさ（画面の座標。最大化・最小化中は送らない）と最前面を、窓の番号といっしょに UI へ
void Browser::SendPopoutPlace(int id) {
    auto it = popouts_.find(id);
    if (it == popouts_.end() || !it->second.hwnd) return;
    HWND popup = it->second.hwnd;
    if (IsIconic(popup) || IsZoomed(popup)) return;  // 最小化・最大化のあいだは、前に覚えた位置のまま
    RECT r{};
    if (!GetWindowRect(popup, &r)) return;
    SendToSurface("left", {{"type", "popoutPlace"},
                           {"slot", it->second.slot},
                           {"x", r.left},
                           {"y", r.top},
                           {"w", r.right - r.left},
                           {"h", r.bottom - r.top},
                           {"top", it->second.top}});
}

bool Browser::RequestClose() {
    DockAllPopouts();  // 小窓の親を先に戻す（大きい窓を閉じるとき、小窓ごとページが消えないように）
    if (closing_ || !surfaces_["left"].webview) return false;
    // 録画中なら、ここまでの mp4 を確定してから閉じる（Shutdown の RecordAbort は確定前の mp4 を消すため）。
    // 待っているコマの返事は世代が変わるので捨てる。右がカードを保存し終えた知らせ（recordCenter saved）と
    // 左の最後の保存の両方を待って閉じる。どちらかが来なくても、1.5 秒のタイマーで閉じる（mp4 は残る）
    if (recordOn_) {
        const std::string id = recordId_;
        if (RecordFinish(nullptr)) closeAwaitId_ = id;
    }
    closing_ = true;
    SendToSurface("left", {{"type", "flush"}});    // UI に「今すぐ保存して」と頼む
    SetTimer(hwnd_, kCloseTimerId, 1500, nullptr);  // 返事がなくても 1.5 秒後には閉じる
    return true;
}

// Windows の通知。タスクバーの右の通知領域にアイコンを置き、そこから出す（押されたらウィンドウを前に出す）
bool Browser::Notify(const std::wstring& title, const std::wstring& body) {
    NOTIFYICONDATAW data{};
    data.cbSize = sizeof(data);
    data.hWnd = hwnd_;
    data.uID = 1;
    if (!trayAdded_) {
        data.uFlags = NIF_ICON | NIF_TIP | NIF_MESSAGE | NIF_SHOWTIP;
        data.uCallbackMessage = kTrayMessage;
        data.hIcon = reinterpret_cast<HICON>(GetClassLongPtrW(hwnd_, GCLP_HICON));
        if (!data.hIcon) data.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
        wcsncpy_s(data.szTip, kAppName, _TRUNCATE);
        if (!Shell_NotifyIconW(NIM_ADD, &data)) return false;
        data.uVersion = NOTIFYICON_VERSION_4;
        Shell_NotifyIconW(NIM_SETVERSION, &data);
        trayAdded_ = true;
    }
    data.uFlags = NIF_INFO;
    wcsncpy_s(data.szInfoTitle, title.c_str(), _TRUNCATE);
    wcsncpy_s(data.szInfo, body.empty() ? L" " : body.c_str(), _TRUNCATE);
    data.dwInfoFlags = NIIF_INFO | NIIF_RESPECT_QUIET_TIME;  // 集中モードのときは出さない
    const bool shown = Shell_NotifyIconW(NIM_MODIFY, &data) != FALSE;
    if (GetForegroundWindow() != hwnd_) {
        FLASHWINFO flash{sizeof(flash), hwnd_, FLASHW_TRAY | FLASHW_TIMERNOFG, 0, 0};  // タスクバーのボタンも光らせる
        FlashWindowEx(&flash);
    }
    return shown;
}

void Browser::OnTrayMessage(LPARAM lParam) {
    const UINT event = LOWORD(lParam);  // NOTIFYICON_VERSION_4 では、下位16ビットが出来事の種類
    if (event == NIN_BALLOONUSERCLICK || event == NIN_SELECT || event == NIN_KEYSELECT) {
        if (IsIconic(hwnd_)) ShowWindow(hwnd_, SW_RESTORE);
        SetForegroundWindow(hwnd_);
    }
}

void Browser::OpenExternalUrl(const std::wstring& url) {
    if (closing_ || !IsOpenableUrl(url)) return;
    if (IsIconic(hwnd_)) ShowWindow(hwnd_, SW_RESTORE);
    SetForegroundWindow(hwnd_);  // 渡した側が AllowSetForegroundWindow しているので、通ることが多い（通らなければタスクバーが光るだけ）
    if (leftReady_) {
        SendToSurface("left", {{"type", "openUrl"}, {"url", ToUtf8(url)}});
    } else {
        pendingUrl_ = url;  // UI の準備ができたら渡す（その前に次の頼みが来たら、新しい方だけ）
    }
}

// ---------- 文字の読み取り（C7） ----------
//   右の「文字を読む」と、読む画面・左の画像の書き足し（依頼の小窓 v2・R7c：隠す候補を探す）から。返事は頼んだ面へ返す。
//   Windows.Media.Ocr はワーカーで待つ（UI スレッドで .get() しない）。画像は外へ出さない。
//   日本語の認識データが無いときは noJapanese。台帳は UI が消さない。
//   ヘッダが無いビルドは unavailable。ボタンは出さない。

void Browser::SendOcr(const std::string& to, const json& requestId, bool ok, const char* error, const json* lines) {
    json reply = {{"type", "captureText"}, {"requestId", requestId}, {"ok", ok}};
    if (!ok && error) reply["error"] = error;
    if (ok && lines) reply["lines"] = *lines;
    SendToSurface(to, reply);
}

void Browser::DiscardOcrPayload(LPARAM param) {
    delete reinterpret_cast<OcrBox*>(param);
}

void Browser::DeliverOcr(LPARAM param) {
    std::unique_ptr<OcrBox> box(reinterpret_cast<OcrBox*>(param));
    if (!box || box->generation != ocrGen_ || closing_) return;
    ocrBusy_ = false;
    ocrVideoId_.clear();
    if (box->outcome.failure != ocr::Failure::None) {
        SendOcr(box->from, box->requestId, false, ocr::FailureName(box->outcome.failure), nullptr);
        return;
    }
    json lines = json::array();
    for (const ocr::Line& line : box->outcome.lines) {
        json row = {{"text", line.text}, {"x", line.x}, {"y", line.y}, {"w", line.w}, {"h", line.h}};
        if (line.table) row["table"] = true;
        if (line.at >= 0) row["at"] = line.at;
        lines.push_back(std::move(row));
    }
    SendOcr(box->from, box->requestId, true, nullptr, &lines);
}

void Browser::HandleOcr(const std::string& from, const json& msg) {
    if (from != "right" && from != "reader" && from != "left") return;
    const json requestId = msg.value("requestId", json());
    const std::string command = msg.value("command", "");
    if (command == "query") {
        SendOcr(from, requestId, ocr::Available(), ocr::Available() ? nullptr : "unavailable", nullptr);
        return;
    }
    if (command != "read") {
        SendOcr(from, requestId, false, "unavailable", nullptr);
        return;
    }
    if (!ocr::Available()) {
        SendOcr(from, requestId, false, "unavailable", nullptr);
        return;
    }
    // ワーカーが返事を届けられなかったとき（PostMessageW の失敗など）は、目安の時間で「使用中」を解く。
    // 遅れて届いた古い返事は世代が違うので捨てる
    if (ocrBusy_ && GetTickCount() - ocrSince_ >= kOcrStaleMs) {
        ++ocrGen_;
        ocrBusy_ = false;
        ocrVideoId_.clear();
    }
    if (ocrBusy_ || recordOn_) {
        SendOcr(from, requestId, false, "busy", nullptr);
        return;
    }
    const std::string image = msg.value("image", "");
    std::vector<std::uint8_t> jpeg = JpegPayload(image);
    if (jpeg.empty()) {
        SendOcr(from, requestId, false, "decode", nullptr);
        return;
    }
    std::vector<int> times;
    if (const json raw = msg.value("times", json()); raw.is_array()) {
        for (const json& item : raw) {
            if (times.size() >= 20) break;
            if (!item.is_number_integer()) continue;
            const int ms = item.get<int>();
            if (ms < 0 || ms > 120000) continue;
            times.push_back(ms);
        }
    }
    std::wstring video;
    std::string videoId;
    if (!times.empty()) {
        std::filesystem::path file;
        const std::string id = msg.value("id", "");
        std::error_code error;
        if (RecordFile(id, file) && std::filesystem::is_regular_file(file, error) && !error) {
            video = file.wstring();
            videoId = id;
        }
    }
    const int generation = ++ocrGen_;
    ocrBusy_ = true;
    ocrSince_ = GetTickCount();
    ocrVideoId_ = videoId;
    const HWND hwnd = hwnd_;
    try {
        std::thread([hwnd, generation, requestId, from, jpeg = std::move(jpeg), video = std::move(video), times = std::move(times)]() mutable {
            ocr::Outcome outcome;
            try {
                outcome = ocr::Read(jpeg, video, times);
            } catch (...) {
                outcome = {ocr::Failure::Engine, {}};
            }
            auto* box = new (std::nothrow) OcrBox{generation, requestId, std::move(outcome), from};
            if (!box) return;
            if (!PostMessageW(hwnd, kOcrMessage, 0, reinterpret_cast<LPARAM>(box))) delete box;
        }).detach();
    } catch (...) {
        // スレッドを作れなかった。「使用中」のまま残さない
        ocrBusy_ = false;
        ocrVideoId_.clear();
        SendOcr(from, requestId, false, "engine", nullptr);
    }
}

// ---------- webhook「そのまま送る」（依頼の小窓 v2・R11・D20） ----------
//   宛先（https の URL）と鍵は DPAPI の bot-hook.bin だけに置く。UI へは「ある／ない」だけを返す（値・ホスト名は返さない）。
//   設定は左と右（巣の ⚙「送り方」）から。送るのは左からだけ：依頼の JSON を、別スレッドの WinHTTP で POST（hook.cpp）し、
//   kHookMessage で UI スレッドへ戻して botHookSent { botRequestId, ok, status, error } を返す。鍵・URL は返事にもログにも入れない

void Browser::HandleBotHook(const std::string& from, const std::string& type, const json& msg) {
    if (type == "botHookSend") {
        if (from == "left") SendBotHook(from, msg);
        return;
    }
    if (from != "left" && from != "right") return;
    const json requestId = msg.value("requestId", json());
    auto state = [&](bool has, const char* error) {
        json reply = {{"type", "botHook"}, {"requestId", requestId}, {"has", has}};
        if (error) reply["error"] = error;
        SendToSurface(from, reply);
    };
    auto saved = []() {
        std::string url;
        std::string key;
        const bool has = LoadBotHook(url, key);
        SecureZeroMemory(key.data(), key.size());
        return has;
    };
    if (type == "getBotHook") {
        state(saved(), nullptr);
        return;
    }
    if (type == "deleteBotHook") {
        std::error_code error;
        std::filesystem::remove(BotHookFile(), error);
        state(saved(), error ? "delete" : nullptr);
        return;
    }
    // setBotHook：URL は https だけ、鍵は空白の無い見える ASCII だけ。直せないものは保存しない（前の設定はそのまま）
    const std::string url = msg.contains("url") && msg["url"].is_string() ? msg["url"].get<std::string>() : std::string();
    std::string key = msg.contains("key") && msg["key"].is_string() ? msg["key"].get<std::string>() : std::string();
    const char* error = !hook::IsHttpsUrl(url) ? "badUrl" : !hook::IsKeyText(key) ? "badKey" : nullptr;
    if (!error) {
        std::string secret = json{{"url", url}, {"key", key}}.dump();
        if (!SaveSecret(BotHookFile(), secret)) error = "save";
        SecureZeroMemory(secret.data(), secret.size());
    }
    SecureZeroMemory(key.data(), key.size());
    state(saved(), error);
}

void Browser::SendBotHook(const std::string& from, const json& msg) {
    const json requestId = msg.value("requestId", json());
    const std::string botRequestId = msg.contains("botRequestId") && msg["botRequestId"].is_string() ? msg["botRequestId"].get<std::string>() : std::string();
    auto fail = [&](const char* error) {
        SendToSurface(from, {{"type", "botHookSent"}, {"requestId", requestId}, {"botRequestId", botRequestId}, {"ok", false}, {"status", 0}, {"error", error}});
    };
    if (!IsBotRequestId(botRequestId)) {
        fail("badRequest");
        return;
    }
    // 依頼の JSON（request.v1。UI が作ったもの）。形が JSON のものだけ、300 KB まで
    const std::string body = msg.contains("body") && msg["body"].is_string() ? msg["body"].get<std::string>() : std::string();
    if (body.empty() || body.size() > 300 * 1024 || !json::parse(body, nullptr, false).is_object()) {
        fail("badRequest");
        return;
    }
    const std::string agentId = msg.contains("agentId") && msg["agentId"].is_string() ? msg["agentId"].get<std::string>() : std::string();
    if (!agentId.empty() && !IsValidAgentId(agentId)) {
        fail("badRequest");
        return;
    }
    std::string url;
    std::string key;
    if (!LoadBotHook(url, key)) {
        SecureZeroMemory(key.data(), key.size());
        fail("noHook");
        return;
    }
    const HWND hwnd = hwnd_;
    std::thread([hwnd, requestId, botRequestId, from, url = std::move(url), key = std::move(key), body, agentId]() mutable {
        hook::Result result;
        try {
            result = hook::Post(url, key, body, agentId);
        } catch (...) {
            result = {false, 0, "connect"};
        }
        SecureZeroMemory(key.data(), key.size());
        auto* box = new (std::nothrow) HookBox{requestId, botRequestId, std::move(result), from};
        if (!box) return;
        if (!PostMessageW(hwnd, kHookMessage, 0, reinterpret_cast<LPARAM>(box))) delete box;
    }).detach();
}

void Browser::DiscardHookPayload(LPARAM param) {
    delete reinterpret_cast<HookBox*>(param);
}

void Browser::DeliverHook(LPARAM param) {
    std::unique_ptr<HookBox> box(reinterpret_cast<HookBox*>(param));
    if (!box || closing_) return;
    json reply = {{"type", "botHookSent"}, {"requestId", box->requestId}, {"botRequestId", box->botRequestId}, {"ok", box->result.ok}, {"status", box->result.status}};
    if (!box->result.ok) reply["error"] = box->result.error.empty() ? "connect" : box->result.error;
    SendToSurface(box->from, reply);
}

// ---------- 中央のページの録画（C6） ----------
//   画素は DevTools の Page.captureScreenshot（中央の見えている所。窓全体のキャプチャはサイドバーも写すので使わない）。
//   captureBeyondViewport は false。true だと Chromium がフレームごとにスクロールバーを出し入れし、
//   中央寄せのページが左右に約 8px ずれる。画面のコピー（fromSurface）だけを使い、上書きの設定はしない。
//   縮小は録画側で行う（クリップの scale で画面の大きさを変えない）。
//   mp4 は Media Foundation。ヘッダが無いビルドでは record::Available() が false で、メニューにも出さない。
//   右の面からだけ受ける。120秒、見積もり 80MB、長い辺 1,280、毎秒 10 枚、音声なし。

void Browser::SendRecord(const json& requestId, bool ok, const char* error) {
    json reply = {{"type", "record"}, {"requestId", requestId}, {"ok", ok}};
    if (!ok && error) reply["error"] = error;
    SendToSurface("right", reply);
}

bool Browser::RecordFile(const std::string& id, std::filesystem::path& out) const {
    if (!CaptureIdOk(id)) return false;
    const auto dir = UiDataDir("captures");
    if (!dir) return false;
    std::error_code error;
    std::filesystem::create_directories(*dir, error);
    if (error) return false;
    // id は英数字だけなので、フォルダの外には出ない。字句の相対パスで確かめる（実在しなくても比較できる）
    const std::filesystem::path name = ToWide(id) + L".mp4";
    const std::filesystem::path file = *dir / name;
    const std::filesystem::path rel = file.lexically_relative(*dir);
    if (rel.empty() || rel.has_parent_path() || rel.wstring() != name.wstring()) return false;
    out = file;
    return true;
}

void Browser::HandleRecord(const std::string& from, const json& msg) {
    if (from != "right") return;
    const json requestId = msg.value("requestId", json());
    const std::string command = msg.value("command", "");
    if (command == "saved") {
        // 右が録画のカードを保存し終えた（失敗でも）。閉じる途中で、左の保存も済んでいれば閉じる。返事は無い
        if (!closeAwaitId_.empty() && msg.value("id", "") == closeAwaitId_) {
            closeAwaitId_.clear();
            if (closing_ && closeLeftDone_) PostMessageW(hwnd_, WM_CLOSE, 0, 0);
        }
        return;
    }
    if (command == "query") {
        SendRecord(requestId, record::Available(), record::Available() ? nullptr : "unavailable");
        return;
    }
    if (command == "start") {
        const std::string id = msg.value("id", "");
        if (!record::Available()) {
            SendRecord(requestId, false, "unavailable");
            return;
        }
        if (recordOn_) {
            SendRecord(requestId, false, "busy");
            return;
        }
        if (activeId_ != 0 && IsPopped(activeId_)) {
            SendRecord(requestId, false, "popout");
            return;
        }
        const Tab* tab = FindTab(activeId_);
        if (activeId_ == 0 || !tab || !tab->webview) {
            SendRecord(requestId, false, "noPage");
            return;
        }
        std::filesystem::path path;
        if (!CaptureIdOk(id) || !RecordFile(id, path)) {
            SendRecord(requestId, false, CaptureIdOk(id) ? "write" : "badId");
            return;
        }
        recordWriter_ = std::make_unique<record::Writer>();
        if (!recordWriter_->Begin(path)) {
            recordWriter_->Abort();
            recordWriter_.reset();
            SendRecord(requestId, false, "write");
            return;
        }
        recordOn_ = true;
        recordAwait_ = false;
        recordMisses_ = 0;
        recordIdleSince_ = 0;
        recordStop_ = false;
        recordId_ = id;
        recordPath_ = path;
        recordTick_ = GetTickCount();
        recordSentSecond_ = 0;
        recordTimes_.clear();
        SetTimer(hwnd_, kRecordTimerId, kRecordIntervalMs, nullptr);
        SendToSurface("right", {{"type", "recordProgress"}, {"seconds", 0}, {"limit", record::kLimitSeconds}});
        SendRecord(requestId, true, nullptr);
        return;
    }
    if (command == "stop") {
        if (!recordOn_) {
            SendRecord(requestId, false, "empty");
            return;
        }
        SendRecord(requestId, true, nullptr);
        RecordStop();
        return;
    }
    if (command == "open" || command == "delete") {
        const std::string id = msg.value("id", "");
        std::filesystem::path file;
        if (!RecordFile(id, file)) {
            SendRecord(requestId, false, "badId");
            return;
        }
        // 録画中の mp4 と、文字の読み取りのワーカーが開いている mp4 は、消さない・開かない
        if ((recordOn_ && id == recordId_) || (ocrBusy_ && !ocrVideoId_.empty() && id == ocrVideoId_)) {
            SendRecord(requestId, false, "busy");
            return;
        }
        if (command == "delete") {
            std::error_code error;
            const bool removed = std::filesystem::remove(file, error);
            // 消せなかった（再生アプリや読み取りが開いている）。元から無いときは error が立たないので ok
            if (!removed && error) {
                SendRecord(requestId, false, "busy");
                return;
            }
            SendRecord(requestId, true, nullptr);
            return;
        }
        std::error_code error;
        if (!std::filesystem::is_regular_file(file, error) || error) {
            SendRecord(requestId, false, "empty");
            return;
        }
        const INT_PTR launched = reinterpret_cast<INT_PTR>(ShellExecuteW(hwnd_, L"open", file.c_str(), nullptr, nullptr, SW_SHOWNORMAL));
        SendRecord(requestId, launched > 32, launched > 32 ? nullptr : "write");
        return;
    }
    SendRecord(requestId, false, "badId");
}

void Browser::RecordTick() {
    if (closing_ || !recordOn_ || !recordWriter_) return;
    // コマの返事が上限までに来ない（タブを閉じた・ページが固まった）。世代を進めて遅れた返事を捨て、次を撮る。
    // 続けて来ないとき・止めると決まっているときは、ここまでで確定する（1 コマも無ければ残さない）
    if (recordAwait_ && GetTickCount() - recordAwaitSince_ >= kRecordShotWaitMs) {
        ++recordGen_;
        recordAwait_ = false;
        ++recordMisses_;
        if (recordStop_ || recordMisses_ >= kRecordShotMisses) {
            // 止めると決まっていたなら、途中で止まったことにはしない（そこまでのコマで確定）
            RecordFinish(recordStop_ && recordWriter_->frames() > 0 ? nullptr : "shot");
            return;
        }
    }
    const DWORD elapsed = GetTickCount() - recordTick_;
    int seconds = static_cast<int>(elapsed / 1000);
    if (seconds < 0) seconds = 0;
    if (seconds > record::kLimitSeconds) seconds = record::kLimitSeconds;
    if (seconds != recordSentSecond_) {
        recordSentSecond_ = seconds;
        SendToSurface("right", {{"type", "recordProgress"}, {"seconds", seconds}, {"limit", record::kLimitSeconds}});
    }
    const bool timedOut = elapsed >= static_cast<DWORD>(record::kLimitSeconds) * 1000;
    const bool full = recordWriter_->estimatedBytes() >= record::kMaxBytes;
    if (timedOut || full) {
        recordStop_ = true;
        if (!recordAwait_) RecordFinish(nullptr);
        return;
    }
    if (!recordAwait_ && !recordStop_) RecordGrab();
}

void Browser::RecordGrab() {
    if (!recordOn_ || recordAwait_ || recordStop_ || !recordWriter_) return;
    // 撮る相手が無い（タブを閉じた・小窓に出した）。しばらく戻らなければ、そこまでで止める
    Tab* tab = activeId_ == 0 || IsPopped(activeId_) ? nullptr : FindTab(activeId_);
    if (!tab || !tab->webview) {
        const DWORD now = GetTickCount();
        if (recordIdleSince_ == 0) recordIdleSince_ = now;
        else if (now - recordIdleSince_ >= kRecordShotWaitMs * kRecordShotMisses) RecordFinish("shot");
        return;
    }
    recordIdleSince_ = 0;
    ResumeTab(*tab);
    const int generation = recordGen_;
    recordAwait_ = true;
    recordAwaitSince_ = GetTickCount();
    // 見えている面だけを、今の大きさのまま撮る。クリップも scale も付けない。
    // captureBeyondViewport を true にすると、フレームごとにスクロールバーが揺れ、中央のページが左右にずれる。
    // 長い辺 1,280 への縮小は、受け取った JPEG を録画側で行う。
    const json params = {{"format", "jpeg"}, {"quality", 70}, {"fromSurface", true}, {"captureBeyondViewport", false}};
    const HRESULT hr = tab->webview->CallDevToolsProtocolMethod(
        L"Page.captureScreenshot", ToWide(params.dump()).c_str(),
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [this, generation](HRESULT shotResult, LPCWSTR shotJson) -> HRESULT {
                if (generation != recordGen_ || !recordOn_) return S_OK;
                try {
                    const json shot = SUCCEEDED(shotResult) && shotJson ? json::parse(ToUtf8(shotJson), nullptr, false) : json();
                    const std::string data = shot.is_object() && shot.contains("data") && shot["data"].is_string() ? shot["data"].get<std::string>() : std::string();
                    RecordOnShot(generation, data);
                } catch (...) {
                    // 大きなコマでメモリが足りないなど。このコマは捨て、次の刻みでまた撮る
                    if (recordOn_ && generation == recordGen_) {
                        recordAwait_ = false;
                    } else if (!recordOn_ && recordWriter_) {
                        // 確定の途中で落ちた。書きかけは片づけ（確定済みなら mp4 は残る）、右の「録画中」を戻す
                        recordWriter_.reset();
                        recordPath_.clear();
                        SendToSurface("right", {{"type", "recordDone"}, {"ok", false}, {"error", "write"}});
                    }
                }
                return S_OK;
            })
            .Get());
    if (FAILED(hr)) recordAwait_ = false;
}

void Browser::RecordOnShot(int generation, const std::string& jpegBase64) {
    if (generation != recordGen_ || !recordOn_ || !recordWriter_) return;
    recordAwait_ = false;
    // 1枚失敗しても録画は続ける。止めると決まっているときだけ、ここまでを残す（1枚も無ければ残さない）
    auto skip = [this]() {
        if (!recordStop_) return;
        RecordFinish(recordWriter_ && recordWriter_->frames() > 0 ? nullptr : "shot");
    };
    if (jpegBase64.empty() || jpegBase64.size() > 8 * 1024 * 1024) {
        skip();
        return;
    }
    const auto encoded = FromBase64(jpegBase64);
    std::vector<std::uint8_t> pixels;
    int width = 0;
    int height = 0;
    if (!encoded || encoded->empty() || !record::DecodeJpeg(encoded->data(), encoded->size(), pixels, width, height)) {
        skip();
        return;
    }
    DWORD elapsed = GetTickCount() - recordTick_;
    if (elapsed > static_cast<DWORD>(record::kLimitSeconds) * 1000) elapsed = static_cast<DWORD>(record::kLimitSeconds) * 1000;
    const int mark = static_cast<int>(elapsed);
    const record::WriteResult wrote = recordWriter_->WriteBgra(pixels.data(), width, height, width * 4, mark);
    if (wrote == record::WriteResult::Full) {
        RecordFinish(nullptr);
        return;
    }
    if (wrote != record::WriteResult::Ok) {
        RecordFinish("write");
        return;
    }
    recordMisses_ = 0;
    if (recordTimes_.empty()) recordTimes_.push_back(0);
    else if (recordTimes_.size() < 40 && mark - recordTimes_.back() >= 4000) recordTimes_.push_back(mark);
    if (recordStop_ || mark >= record::kLimitSeconds * 1000 || recordWriter_->estimatedBytes() >= record::kMaxBytes) RecordFinish(nullptr);
}

void Browser::RecordStop() {
    if (!recordOn_) return;
    recordStop_ = true;
    if (!recordAwait_) RecordFinish(nullptr);
}

bool Browser::RecordFinish(const char* error) {
    if (!recordOn_) return false;
    ++recordGen_;
    recordOn_ = false;
    recordAwait_ = false;
    recordStop_ = false;
    KillTimer(hwnd_, kRecordTimerId);
    const std::string id = recordId_;
    recordId_.clear();
    recordSentSecond_ = -1;
    DWORD elapsed = GetTickCount() - recordTick_;
    if (elapsed > static_cast<DWORD>(record::kLimitSeconds) * 1000) elapsed = static_cast<DWORD>(record::kLimitSeconds) * 1000;
    const int mark = static_cast<int>(elapsed);
    const int seconds = mark / 1000;
    std::vector<int> times = std::move(recordTimes_);
    recordTimes_.clear();
    if (times.empty()) times.push_back(0);
    else if (times.size() < 40 && times.back() != mark) times.push_back(mark);

    // 残すかどうかはコマの有無で決める（途中の書き込み失敗・コマの返事切れでも、そこまでは残す）
    const char* fail = nullptr;
    std::uint64_t bytes = 0;
    std::string image;
    const bool hadFrames = recordWriter_ && recordWriter_->frames() > 0;
    if (!hadFrames) fail = error ? error : "empty";
    // mp4 を先に確定する。代表画像（最後のコマ）は確定のあとでも作れる。
    // 代表画像を作れない・大きすぎるときも mp4 は残し、画像なしで知らせる（UI が仮の代表画像でカードを作る）
    if (!fail && recordWriter_) {
        if (!recordWriter_->Finalize(bytes)) fail = "write";
        else {
            std::vector<std::uint8_t> jpeg;
            if (recordWriter_->Poster(jpeg) && !jpeg.empty()) {
                const std::vector<BYTE> encoded(jpeg.begin(), jpeg.end());
                const std::string data = Base64(encoded);
                if (!data.empty() && data.size() <= 900000) image = "data:image/jpeg;base64," + data;
            }
        }
    }
    if (fail && recordWriter_) recordWriter_->Abort();
    recordWriter_.reset();
    recordPath_.clear();

    json done = {{"type", "recordDone"}, {"ok", fail == nullptr}, {"id", id}, {"seconds", seconds}};
    if (fail) done["error"] = fail;
    else {
        if (!image.empty()) done["image"] = image;
        if (error) done["note"] = error;  // 途中で止まった理由（そこまでは残した）
        done["bytes"] = bytes;
        done["times"] = times;
    }
    SendToSurface("right", done);
    return fail == nullptr;
}

void Browser::RecordAbort() {
    ++recordGen_;
    recordOn_ = false;
    recordAwait_ = false;
    recordMisses_ = 0;
    recordIdleSince_ = 0;
    recordStop_ = false;
    recordSentSecond_ = -1;
    recordId_.clear();
    recordTimes_.clear();
    recordPath_.clear();
    if (hwnd_) KillTimer(hwnd_, kRecordTimerId);
    if (recordWriter_) recordWriter_->Abort();
    recordWriter_.reset();
}

void Browser::Shutdown() {
    ++ocrGen_;  // 読み取りのワーカーが戻っても、閉じたあとは頼んだ面へ送らない
    ocrBusy_ = false;
    ocrVideoId_.clear();
    RecordAbort();  // 書きかけの mp4 は残さない。枠を閉じたあとのコールバックは世代が違うので何もしない
    DockAllPopouts();
    activeDownloads_.clear();
    if (botTimerOn_) KillTimer(hwnd_, kBotInboxTimerId);
    botTimerOn_ = false;
    if (!appSummons_.empty()) KillTimer(hwnd_, kAppWindowTimerId);
    appSummons_.clear();
    // 終了しても、開いているアプリの窓は残す。最前面だけやめる（位置と大きさはそのまま）
    // 最小化で隠していた窓は、戻してから最前面をやめる（隠したままにしない）
    RevealPinned();
    if (pinnedHwnd_ && IsWindow(pinnedHwnd_)) apps::ClearTopmost(pinnedHwnd_);
    pinnedHwnd_ = nullptr;
    pinnedTarget_.clear();
    haveLastFollow_ = false;
    pinnedOverlap_ = false;
    KillTimer(hwnd_, kAppFollowTimerId);
    botWatch_ = false;
    botInbox_.Release();
    if (trayAdded_) {
        NOTIFYICONDATAW data{};
        data.cbSize = sizeof(data);
        data.hWnd = hwnd_;
        data.uID = 1;
        Shell_NotifyIconW(NIM_DELETE, &data);
        trayAdded_ = false;
    }
    for (auto& entry : tabs_) {
        if (entry.second.controller) entry.second.controller->Close();
    }
    tabs_.clear();
    for (auto& entry : surfaces_) {
        if (entry.second.controller) entry.second.controller->Close();
        entry.second.webview = nullptr;
        entry.second.controller = nullptr;
    }
    env_ = nullptr;
}
