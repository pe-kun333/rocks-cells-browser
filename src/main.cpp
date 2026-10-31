// Rocks-cells Browser — 入口とウィンドウ
//
// 全体の流れ
//   1. Windows のウィンドウを1つ作る
//   2. Browser（browser.cpp / tabs.cpp）が、その中に WebView2 を並べる
//        左サイドバー（TypeScript の UI） | 表示中のタブのページ | 右サイドバー（開いたときだけ）
//   3. ウィンドウが閉じられるまで「メッセージループ」で待ち続ける
//   4. 閉じるときは、UI にタブの配置を保存してもらってから閉じる

#include <windows.h>
#include <shellapi.h>  // CommandLineToArgvW

#include <memory>
#include <string>

#include "browser.h"
#include "l10n.h"
#include "theme.h"

namespace {

// 窓の種類の名前。URL の受け渡しでは、この名前の窓だけを探す
constexpr wchar_t kWindowClass[] = L"RocksCellsBrowserWindow";

std::unique_ptr<Browser> g_browser;
std::wstring g_earlyUrl;  // ウィンドウはできたが Browser がまだ無いうちに届いた「このページを開いて」

// 起動したときの引数から、開いてほしいページ（http / https の URL）を取り出す。例：RocksCellsBrowser.exe http://localhost:8787/
std::wstring UrlFromCommandLine() {
    int count = 0;
    LPWSTR* args = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!args) return {};
    std::wstring url;
    for (int i = 1; i < count; ++i) {
        if (IsOpenableUrl(args[i])) {
            url = args[i];
            break;
        }
    }
    LocalFree(args);
    return url;
}

// すでに同じデータフォルダで動いている Rocks-cells Browser があれば、そちらへ URL を渡して true を返す
// （渡せたら、このプロセスは何も開かずに終わる。ウィンドウが2つにならない）
bool ForwardToRunningInstance(const std::wstring& url) {
    struct Delivery {
        std::wstring payload;
        bool delivered = false;
    } delivery{DataFolderKey() + L"\n" + url};

    EnumWindows(
        [](HWND hwnd, LPARAM param) -> BOOL {
            auto* delivery = reinterpret_cast<Delivery*>(param);
            wchar_t name[64];
            if (GetClassNameW(hwnd, name, 64) == 0 || wcscmp(name, kWindowClass) != 0) return TRUE;
            DWORD pid = 0;
            GetWindowThreadProcessId(hwnd, &pid);
            AllowSetForegroundWindow(pid);  // 渡された側が、自分のウィンドウを前に出せるように
            COPYDATASTRUCT data{kOpenUrlCopyData, static_cast<DWORD>((delivery->payload.size() + 1) * sizeof(wchar_t)),
                                const_cast<wchar_t*>(delivery->payload.c_str())};
            DWORD_PTR accepted = 0;
            // 動いていない（固まっている）窓や、データフォルダの違う窓は受け取らない → 次の窓へ
            if (SendMessageTimeoutW(hwnd, WM_COPYDATA, 0, reinterpret_cast<LPARAM>(&data), SMTO_ABORTIFHUNG, 3000, &accepted) && accepted) {
                delivery->delivered = true;
                return FALSE;
            }
            return TRUE;
        },
        reinterpret_cast<LPARAM>(&delivery));
    return delivery.delivered;
}

// WM_COPYDATA の中身（「データフォルダ\nURL」）から、自分宛ての URL だけを取り出す。違えば空
std::wstring UrlFromCopyData(const COPYDATASTRUCT* data) {
    constexpr DWORD kMaxBytes = 20000;
    if (!data || data->dwData != kOpenUrlCopyData || !data->lpData) return {};
    if (data->cbData < sizeof(wchar_t) || data->cbData > kMaxBytes || data->cbData % sizeof(wchar_t) != 0) return {};
    std::wstring text(static_cast<const wchar_t*>(data->lpData), data->cbData / sizeof(wchar_t));
    while (!text.empty() && text.back() == L'\0') text.pop_back();
    const size_t split = text.find(L'\n');
    if (split == std::wstring::npos || text.substr(0, split) != DataFolderKey()) return {};
    std::wstring url = text.substr(split + 1);
    return IsOpenableUrl(url) ? url : std::wstring{};
}

// ウィンドウに届く「出来事（メッセージ）」を処理する関数
LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_SIZE:  // 大きさが変わった
        if (g_browser) g_browser->Layout();
        return 0;
    case WM_MOVE:  // 位置が変わった
        if (g_browser) g_browser->OnWindowMoved();
        return 0;
    case WM_ERASEBKGND:  // 窓の地（面が描く前・タブを小窓に出したあと・大きさを変えている間）。見た目のテーマがあればその色で塗る
        if (HBRUSH brush = theme::BackgroundBrush()) {
            RECT rect;
            GetClientRect(hwnd, &rect);
            FillRect(reinterpret_cast<HDC>(wParam), &rect, brush);
            return 1;
        }
        break;
    case WM_DPICHANGED: {
        // 解像度の違うモニターへ移った → Windows が勧める大きさにする（並べ直しは WM_SIZE で行われる）
        const RECT* suggested = reinterpret_cast<const RECT*>(lParam);
        SetWindowPos(hwnd, nullptr, suggested->left, suggested->top, suggested->right - suggested->left,
                     suggested->bottom - suggested->top, SWP_NOZORDER | SWP_NOACTIVATE);
        return 0;
    }
    case kCloseTabMessage:  // ページが「閉じて」と頼んできたタブを閉じる
        if (g_browser) g_browser->CloseTab(static_cast<int>(wParam));
        return 0;
    case kTrayMessage:  // 通知が押された
        if (g_browser) g_browser->OnTrayMessage(lParam);
        return 0;
    case kOcrMessage:  // 文字の読み取りが別スレッドで終わった（中身は結果のポインタ。UI スレッドで頼んだ面へ渡す）
        try {
            if (g_browser) g_browser->DeliverOcr(lParam);
            else Browser::DiscardOcrPayload(lParam);
        } catch (...) {
            // 返事を組み立てられなかった（メモリ不足など）。窓の手続きの外へ例外を出さない
        }
        return 0;
    case kHookMessage:  // webhook の POST が別スレッドで終わった（中身は結果のポインタ。UI スレッドで左へ渡す）
        try {
            if (g_browser) g_browser->DeliverHook(lParam);
            else Browser::DiscardHookPayload(lParam);
        } catch (...) {
            // 返事を組み立てられなかった（メモリ不足など）。窓の手続きの外へ例外を出さない（文字の読み取りと同じ）
        }
        return 0;
    case WM_COPYDATA: {  // 別のプロセスから「このページを開いて」と届いた（同じデータフォルダのものだけ受け取る）
        const std::wstring url = UrlFromCopyData(reinterpret_cast<const COPYDATASTRUCT*>(lParam));
        if (url.empty()) return FALSE;
        if (g_browser) g_browser->OpenExternalUrl(url);
        else g_earlyUrl = url;
        return TRUE;
    }
    case WM_CLOSE:  // ×ボタンが押された。まず UI に保存を頼み、済んでから閉じる
        if (g_browser && g_browser->RequestClose()) return 0;
        DestroyWindow(hwnd);
        return 0;
    case WM_ACTIVATEAPP:  // ほかのアプリから戻った・移った（「貼りましたか？」を戻ってから数えるため、左の UI へ知らせる。R8）
        if (g_browser) g_browser->OnAppActivate(wParam != FALSE);
        return 0;
    case WM_TIMER:  // タイマーの番号で分ける
        if (wParam == kCloseTimerId) DestroyWindow(hwnd);  // 保存の返事が来ないまま時間切れ → そのまま閉じる
        else if (g_browser) {
            try {
                g_browser->OnTimer(wParam);  // ボットの受け取り口の見回り（kBotInboxTimerId）、録画のコマなど
            } catch (...) {
                // 窓の手続きの外へ例外を出さない（録画の確定の途中なら、次の刻みか「止める」で戻る）
            }
        }
        return 0;
    case WM_DESTROY:  // 閉じられた
        if (g_browser) g_browser->Shutdown();
        g_browser.reset();
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

}  // namespace

// Windows アプリの入口（普通の C++ の main にあたる）
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int showCmd) {
    // 開いてほしいページを引数で渡されたとき：すでに動いている窓があればそちらで開いてもらい、このプロセスは終わる。
    // 引数が無いときは、今までどおり（動いている窓があっても、もう1つ起動する）
    const std::wstring startupUrl = UrlFromCommandLine();
    if (!startupUrl.empty() && ForwardToRunningInstance(startupUrl)) return 0;

    // 高解像度ディスプレイでぼやけないようにする
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    // WebView2 は COM という仕組みの上で動くので、最初に初期化しておく
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 1;

    // 画面の言葉（英語版 E4）：UI が残した lang.txt ＞ Windows の表示言語。起動したときに 1 回だけ決める
    l10n::Init();

    // 見た目のテーマ：前回の色（theme.json）があれば、窓を作る前に地と枠の色を決める（最初の一瞬から、その色の窓）。
    //   自動のときは今の Windows の明暗で組を選ぶ。無ければ今までどおり白
    const std::optional<theme::Theme> startTheme = theme::Load();
    const theme::Slot* startSlot = startTheme ? &theme::Pick(*startTheme, theme::SystemPrefersDark()) : nullptr;
    if (startSlot) theme::SetBackground(startSlot->bg);

    WNDCLASSEXW wc{sizeof(wc)};
    wc.lpfnWndProc = WndProc;
    wc.hInstance = instance;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    wc.lpszClassName = kWindowClass;
    RegisterClassExW(&wc);

    const UINT dpi = GetDpiForSystem();
    HWND hwnd = CreateWindowExW(0, kWindowClass, kAppName, WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                                MulDiv(1280, dpi, 96), MulDiv(800, dpi, 96), nullptr, nullptr, instance, nullptr);
    if (!hwnd) return 1;
    if (startSlot) theme::ApplyFrame(hwnd, *startSlot);
    ShowWindow(hwnd, showCmd);
    UpdateWindow(hwnd);

    g_browser = std::make_unique<Browser>(hwnd);
    g_browser->Start();
    if (!startupUrl.empty()) g_browser->OpenExternalUrl(startupUrl);
    if (!g_earlyUrl.empty()) g_browser->OpenExternalUrl(g_earlyUrl);

    // メッセージループ：ウィンドウが閉じられるまで、届いた出来事を WndProc に回し続ける
    MSG msg{};
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    CoUninitialize();
    return static_cast<int>(msg.wParam);
}
