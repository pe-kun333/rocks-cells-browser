#pragma once

#include "version.h"
#include <windows.h>
#include <wrl.h>

#include <cstdint>
#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "record.h"

#include <nlohmann/json.hpp>

#include "WebView2.h"
#include "bots.h"
#include "theme.h"

// 窓の題名・通知領域・エラーの窓に出す名前
inline constexpr wchar_t kAppName[] = L"Rocks-cells Browser " ROCKSCELLS_VERSION_LABEL_W;  // version label comes from version.json

// ページから「このタブを閉じて」と頼まれたときに、少し後で閉じるための合図（ウィンドウメッセージ）
constexpr UINT kCloseTabMessage = WM_APP + 1;
// 通知領域（タスクバーの右）のアイコンで起きたこと（通知が押された…）
constexpr UINT kTrayMessage = WM_APP + 2;
// 文字の読み取り（C7）。ワーカーが終わったら、結果のポインタを UI スレッドへ届ける。中で .get() はしない
constexpr UINT kOcrMessage = WM_APP + 3;
// webhook「そのまま送る」（依頼の小窓 v2・R11）。POST が別スレッドで終わったら、結果のポインタを UI スレッドへ届ける
constexpr UINT kHookMessage = WM_APP + 4;
// 終了するとき、UI の保存が返ってこなくても閉じるためのタイマー
constexpr UINT_PTR kCloseTimerId = 1;
// ボットの返事の受け取り口（bot-inbox\）を見回るタイマー。4秒おき。台帳にボットがいるときだけ動かす（左の UI が botInboxWatch で知らせる）
constexpr UINT_PTR kBotInboxTimerId = 2;
constexpr UINT kBotInboxIntervalMs = 4000;
// アプリのセル（A2）：起動したあと、窓が出るのを待つ。0.2秒おき、40回（約8秒）
constexpr UINT_PTR kAppWindowTimerId = 3;
constexpr UINT kAppWindowIntervalMs = 200;
constexpr int kAppWindowWaitTicks = 40;
// アプリのセル（A4）：追従中に、窓が閉じたかを見る。0.4秒おき。合わせているあいだだけ
constexpr UINT_PTR kAppFollowTimerId = 4;
constexpr UINT kAppFollowIntervalMs = 400;
// 中央のページの録画（C6）。0.1秒おき。録しているあいだだけ。次のフレームを待っているときは重ねない
constexpr UINT_PTR kRecordTimerId = 5;
constexpr UINT kRecordIntervalMs = 100;
// 録画の 1 コマの返事を待つ上限。過ぎたらそのコマを捨てて次を撮る。続けて kRecordShotMisses 回来なければ、そこまでで止める
constexpr DWORD kRecordShotWaitMs = 3000;
constexpr int kRecordShotMisses = 3;
// 文字の読み取りのワーカーが返事を届けられなかったとき、「使用中」を解く目安（UI の待ちは 90 秒）
constexpr DWORD kOcrStaleMs = 120000;
// 別のプロセスから「このページを開いて」と届くとき（WM_COPYDATA）の目印。中身は「データフォルダ\nURL」（UTF-16）
constexpr ULONG_PTR kOpenUrlCopyData = 0x48435542;

// HRESULT（Windows の結果コード）付きでエラーを表示する
void ShowError(HWND hwnd, const wchar_t* what, HRESULT hr);

// 起動時の引数や外からの頼みで受け取った URL が、開いてよいもの（http / https で、長すぎず、制御文字を含まない）か
bool IsOpenableUrl(const std::wstring& url);

// 「データフォルダ」を表す文字列。同じデータフォルダで動いている窓どうしだけで URL を受け渡すために使う
// （環境変数 ROCKSCELLS_DATA_DIR でデータフォルダを分けたテスト用の窓へ、ふだんの窓の分が紛れ込まないように）
std::wstring DataFolderKey();

// ブラウザの「手足」
//   ・サイドバー用の WebView2（TypeScript の UI。左右に置ける）と、タブごとの WebView2 を作って並べる
//   ・UI から届いた指示（タブを作る・切り替える・閉じる・保存する…）を実行する
//   ・ページで起きたこと（タイトルや URL の変化…）を UI に知らせる
class Browser {
public:
    explicit Browser(HWND hwnd);

    void Start();          // WebView2 の準備を始める
    void Layout();         // ウィンドウの大きさに合わせて並べ直す
    void OnWindowMoved();  // ウィンドウが動いた（ドロップダウンなどの位置合わせ用）
    void CloseTab(int id);
    bool RequestClose();   // 閉じる前に UI へ保存を頼む。頼んだら true（保存が済むとウィンドウが閉じる）
    void Shutdown();       // ウィンドウを閉じる前の後片付け
    void OnTrayMessage(LPARAM lParam);
    // 文字の読み取りが別スレッドで終わったとき（kOcrMessage）。CloseTab や OnTrayMessage と同じく、窓の手続きから呼ぶ
    void DeliverOcr(LPARAM param);
    static void DiscardOcrPayload(LPARAM param);
    // webhook の POST が別スレッドで終わったとき（kHookMessage）。頼んだ面（left）へ botHookSent を返す
    void DeliverHook(LPARAM param);
    static void DiscardHookPayload(LPARAM param);
    // 外から「このページを開いて」と頼まれた（起動時の引数・すでに動いている窓へ渡された URL）。ウィンドウを前に出し、
    // UI の準備ができていれば UI へ、まだなら準備ができたときに渡す。http / https 以外は無視する
    void OpenExternalUrl(const std::wstring& url);
    // kCloseTimerId 以外のタイマー（ボットの受け取り口、アプリの窓、録画）
    void OnTimer(UINT_PTR id);
    // ほかのアプリから戻った（active）・ほかのアプリへ移った（WM_ACTIVATEAPP）。左の UI へ appActive で知らせるだけ
    // （依頼の小窓 v2・R8：Grok Bot アプリから戻ってから「貼りましたか？」を数える。貼ったかどうかは知れないので、聞くだけ）
    void OnAppActivate(bool active);

private:
    friend LRESULT CALLBACK PopoutWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);
    // サイドバー（TypeScript の UI を表示する WebView2）。名前は "left" / "right" / "reader" / "memo"
    struct Surface {
        int widthDip = 280;  // 幅（96dpi のときのピクセル数）
        bool visible = false;
        // 読む画面だけ：ページの場所のどこに出すか。"" はページに重ねる、"right" は右側（左にページ）、"bottom" は下側（上にページ）
        std::string split;
        int heightDip = 340;  // 読む画面の split が bottom のときの高さ。下のメモの区画（memo）の高さにも使う
        // 下のメモだけ。"" はページの下の帯。"upper" は左右の間いっぱい（Grok Cards の上半分。段 9）。欄を送らないあいだは ""
        std::string place;
        bool creating = false;
        Microsoft::WRL::ComPtr<ICoreWebView2Controller> controller;
        Microsoft::WRL::ComPtr<ICoreWebView2> webview;
    };

    // タブ。状態は次の3つ
    //   起きている：WebView2 がある（表示中、または裏で待機中）
    //   一時停止  ：WebView2 はあるが、ページの動きを止めてメモリを減らしている（suspended）
    //   休眠      ：WebView2 を閉じて、URL だけを覚えている（asleep）
    struct Tab {
        int id = 0;
        std::wstring url;
        bool waking = false;        // WebView2 を作っている途中
        bool suspended = false;     // 一時停止中
        std::wstring navUri;        // いまの読み込みが開こうとした URL（失敗した画像のファイルの有無を見る）
        double restoreScrollY = -1;  // 休眠から起きたときに戻すスクロール位置（-1 = なし）
        Microsoft::WRL::ComPtr<ICoreWebView2Controller> controller;  // 表示の外枠（位置・大きさ・表示/非表示）
        Microsoft::WRL::ComPtr<ICoreWebView2> webview;               // ページ本体
        bool asleep() const { return !controller; }
    };
    using TabReady = std::function<void(Tab&)>;

    // ---- サイドバーと UI とのやりとり（browser.cpp） ----
    void CreateSurface(const std::string& name);
    void HandleUiMessage(const std::string& from, const nlohmann::json& msg);
    void HandleDataMessage(const std::string& from, const std::string& type, const nlohmann::json& msg);
    // ボットのセル：エージェントの id を確かめ、grokbot://app/v1/agent?id=<id> を組み立てて Grok Bot アプリを開く
    void OpenBotApp(const std::string& from, const nlohmann::json& msg);
    // アプリのセル（A5）：既にある窓を中央の区画に合わせ最前面にする。無ければ起動して、約8秒、窓を待つ。左からだけ
    // ストアアプリはアプリ ID で探す。合わせたあとは、ブラウザの移動・大きさ・サイドバー・下のメモに追従する（FollowPinned）
    void SummonApp(const nlohmann::json& msg);
    void PollAppWindows();
    void FollowPinned();   // 最前面の1つの窓を、今の中央の区画へ（フォーカスは奪わない）
    void RevealPinned();   // 最小化で隠していた窓を、フォーカスを奪わずに戻す
    void DropFollow(const char* reason);  // 窓が閉じた、または動かせなくなった。UI の「最前面」も外す
    // host は掴んだ窓の実行ファイル（台帳が次から探す）。appId はストアアプリのアプリ ID。空なら付けない
    void SendAppSummon(const nlohmann::json& requestId, bool ok, const char* action, const char* error, bool overlap = false,
                       const std::wstring& host = {}, const std::wstring& appId = {});
    RECT PageScreen();  // PageRect を画面座標にしたもの（外の窓を置く場所。物理ピクセル）
    void PlacePinned(HWND window, const std::wstring& target, const nlohmann::json& requestId, const std::wstring& appId = {});
    void ReleasePinned(const nlohmann::json& requestId);
    // ボットの返事の受け取り口（第2段 S2.1。中身は bots.cpp）：botReplyTaken・botCheck・botInboxWatch。左のサイドバーからだけ受ける
    void HandleBotMessage(const std::string& from, const std::string& type, const nlohmann::json& msg);
    void ScanBotInbox();                                    // 見回り1回（取ったものを左の UI へ botReply で送る）
    bool ClaimBotInbox();                                   // Mutex を取ってみる。今まで持っておらず、取れたら true
    void BotInboxReady();                                   // 左の UI へ受け取り口の様子を知らせ、取ったままのものを渡し直す
    void SendBotInboxState(const nlohmann::json& requestId);
    void UpdateBotTimer();
    // データ置き場：サイドバーの決まった範囲を撮って、ui-data\vault\img\ に画像として保存する（DevTools の Page.captureScreenshot）
    void CaptureSurface(const std::string& from, const nlohmann::json& msg);
    void SendToSurface(const std::string& name, const nlohmann::json& msg);
    void Broadcast(const nlohmann::json& msg);  // すべてのサイドバーへ
    void SendTabUpdate(int id, nlohmann::json patch);
    nlohmann::json SidebarState() const;
    void WatchShortcuts(ICoreWebView2Controller* controller);
    void UpdateWindowTitle();
    bool Notify(const std::wstring& title, const std::wstring& body);  // Windows の通知を出す（出せたら true）
    LONG ToPixels(int dip) const;

    // ---- タブ（tabs.cpp） ----
    // background：裏で開くタブ（表示はしない）。UI に知らせて、盤面のセルを光らせてもらう
    int AddTab(const std::wstring& url, std::optional<int> parentId, const nlohmann::json& requestId, bool asleep, bool background = false);
    void WakeTab(int id, TabReady onReady = nullptr);
    void WatchTab(int id);
    void WatchContextMenu(int id);  // ページの右クリックに撮影・「Grok に調べてもらう」・「単語帳のカードにする」・リンクを「セルに追加」を足す
    void BotLinkBlocked(int id, bool userInitiated);  // ページから grokbot:// を開こうとして止めた（人が押したときだけ左の UI に知らせる）
    // 下のメモが左右の間を覆うか（段 9 の上半分）。読む画面が出ているあいだは覆わない
    bool MemoCoversPage() const;
    RECT PageRect();                // ページを出す場所（左右のサイドバーの間。下のメモの区画が見えていればその分を引く。上半分のあいだは引かない）。裏で読み込むタブの大きさにも使う
    void ActivateTab(int id);
    void CaptureTab(int id);
    // maxEdge が 0 より大きいとき：見えている範囲だけを、長い辺がその長さ以下の JPEG で返す（下のメモの区画・右の撮影から）
    //   rect（省いてよい。null は無し）：見えている所の左上からの CSS ピクセルの矩形（依頼① I1。画像の要素）。見えている範囲との交わりだけを撮る
    //   0 のとき：今までどおり、表示中のページ全体を CapturePreview で撮る（六角形スクショ）。rect は受けない
    void CaptureFull(int id, const std::string& surface, const nlohmann::json& requestId, int maxEdge, const nlohmann::json& rect);
    void CaptureViewport(int id, const std::string& surface, const nlohmann::json& requestId, int maxEdge, const nlohmann::json& rect);
    // ページ全体（スクロールで隠れた所も含む）を JPEG にして、ピクチャのフォルダへ書く（M4。画像そのものは返さない）
    void CapturePage(int id, const std::string& surface, const nlohmann::json& requestId, const std::string& name);
    // カードの画像（JPEG か PNG の Base64）を、同じフォルダへ書く。開く・フォルダで選ぶ
    void ExportMemoImage(const std::string& surface, const nlohmann::json& msg);
    void OpenExported(const nlohmann::json& msg);
    void RevealExported(const nlohmann::json& msg);
    void SuspendTab(int id);  // 一時停止させる
    void DiscardTab(int id);  // 休眠させる（WebView2 を閉じる）
    void ResumeTab(Tab& tab);  // 一時停止から戻す
    void SetMuted(int id, bool muted);
    void SendPageText(const std::string& surface, int id, const nlohmann::json& requestId);  // AI 用にページの文章を渡す
    void SendScroll(const std::string& surface, int id, const nlohmann::json& requestId);    // どこまで読んだか（スクロール位置）
    void EvalInTab(const std::string& surface, int id, const std::string& script, const nlohmann::json& requestId);
    Tab* FindTab(int id);
    nlohmann::json DescribeTab(const Tab& tab);
    struct DownloadItem;
    // ダウンロード（既定の保存ダイアログはそのまま。終わったら棚に載せる。開くのは人が押したときだけ）
    void WatchDownloads(int id);
    void RememberDownload(ICoreWebView2DownloadOperation* operation);
    void DropDownload(ICoreWebView2DownloadOperation* operation);
    void LoadDownloads();
    void SaveDownloads();
    void SendDownloads();
    void OpenDownload(const std::string& id);
    void RevealDownload(const std::string& id);
    void ForgetDownload(const std::string& id);
    DownloadItem* FindDownload(const std::string& id);
    // ライブの小窓（P2）：どのタブでも、大きい窓の外の小さな窓に出す（kMaxPopouts 個まで）。
    //   窓ごとに番号（slot 0〜3）があり、UI が覚えている位置・大きさ・最前面（places[slot]）で出す。
    //   動かした・大きさを変えた・最前面を切り替えたら popoutPlace で UI に返す（UI が prefs に残す）
    static constexpr int kMaxPopouts = 4;
    struct Popout {
        HWND hwnd = nullptr;
        int slot = 0;
        bool top = true;  // 最前面に固定
    };
    bool IsPopped(int id) const { return popouts_.count(id) != 0; }
    int PopoutIdOf(HWND hwnd) const;
    HWND CreatePopoutWindow(int slot, const nlohmann::json& place, bool* top);
    void ShowPopout(int id, const nlohmann::json& places = nlohmann::json());
    void DockPopout(int id, bool notify = true);
    void DockAllPopouts();
    void LayoutPopout(int id);
    void LayoutPopouts();
    // 見た目のテーマ（左の setTheme）。窓の地・題名バーと枠・面の地の色・ページの明暗を合わせ、theme.json に残す
    void ApplyTheme(const nlohmann::json& msg);
    void ApplyPageScheme();  // ページの明暗（プロファイル全体の PreferredColorScheme）。テーマが無ければ触らない
    void UpdatePopoutTitle(int id);
    void SetPopoutTop(int id, bool top);
    void SendPopouts(const char* error = nullptr);
    void SendPopoutPlace(int id);

    struct DownloadItem {
        std::string id;
        std::string name;
        std::wstring path;
        std::int64_t bytes = 0;
        std::int64_t at = 0;
    };

    // 中央のページの録画（C6）。右の「撮影」からだけ。mp4 は ui-data\captures\<id>.mp4。使えるときだけメニューに出す
    void HandleRecord(const std::string& from, const nlohmann::json& msg);
    void RecordTick();
    void RecordGrab();
    void RecordOnShot(int generation, const std::string& jpegBase64);
    void RecordStop();
    // 録画を確定して右へ recordDone を送る。mp4 を残せたら true（error はそこまでで止めた理由。コマがあれば残す）
    bool RecordFinish(const char* error);
    void RecordAbort();
    bool RecordFile(const std::string& id, std::filesystem::path& out) const;
    void SendRecord(const nlohmann::json& requestId, bool ok, const char* error);
    // 文字の読み取り（C7）。右と、読む画面・左（依頼の小窓 v2・R7c の隠す候補）から。返事は頼んだ面（to）へ。
    //   query はコンパイルされているか。read は別スレッドで Windows.Media.Ocr
    void HandleOcr(const std::string& from, const nlohmann::json& msg);
    void SendOcr(const std::string& to, const nlohmann::json& requestId, bool ok, const char* error, const nlohmann::json* lines);
    // webhook「そのまま送る」（依頼の小窓 v2・R11・D20）。setBotHook・getBotHook・deleteBotHook は左と右から（返すのは「ある／ない」だけ）、
    //   botHookSend は左からだけ（DPAPI の bot-hook.bin の宛先と鍵で、別スレッドで POST）
    void HandleBotHook(const std::string& from, const std::string& type, const nlohmann::json& msg);
    void SendBotHook(const std::string& from, const nlohmann::json& msg);

    HWND hwnd_;
    Microsoft::WRL::ComPtr<ICoreWebView2Environment> env_;
    std::map<std::string, Surface> surfaces_;
    std::map<int, Tab> tabs_;
    int activeId_ = 0;  // 0 = 表示中のタブなし
    int nextId_ = 1;
    bool closing_ = false;
    bool sessionRotated_ = false;  // この起動で、盤面の台帳の控え（session.bak1〜3）をもう回したか
    bool trayAdded_ = false;  // 通知領域にアイコンを出したか
    bool leftReady_ = false;  // 左のサイドバー（主な UI）が「準備ができた」と伝えてきたか
    std::wstring pendingUrl_;  // 外から頼まれたが、UI の準備がまだで渡せていない URL
    bool linkBackground_ = false;  // ページのリンクから開く新しいタブを、裏で開く（UI の設定「いつも裏で開く」）
    std::optional<theme::Theme> theme_;  // 見た目のテーマ（theme.json・setTheme）。無ければ今までどおり白い既定
    theme::Slot themeSlot_;              // 今付けている組（theme_ があるときだけ使う）
    bots::Inbox botInbox_;         // ボットの返事の受け取り口（データフォルダごとに1つの窓だけが受け取る）
    bool botWatch_ = false;        // 左の UI が「見回って」と言っている（台帳にボットがいる）
    bool botTimerOn_ = false;      // kBotInboxTimerId が動いている
    std::string botScanAt_;        // 最後に見回った時刻（UTC の ISO。botInboxState の lastScanAt。R8 の中継の見張り）
    // 起動したあと、窓が出るのを待っているアプリ（A2）。同時にいくつでも待てる。タイマーは1つ
    struct AppSummonWait {
        nlohmann::json requestId;
        std::wstring launch;        // 起動したパス。ストアアプリは target が同じホストになるので、待ちの同一性はこちら
        std::wstring target;
        std::wstring host;          // 台帳が覚えている、前回の窓の実行ファイル
        std::wstring appId;         // ショートカットのアプリ ID。空なら ID では探さない
        std::wstring title;         // ストアアプリの登録名。ID が窓に無いときの題名
        DWORD pid = 0;              // ShellExecuteEx のプロセス番号。パスが違っても、その窓は候補
        bool accessDenied = false;  // パスを聞けない窓があった（すでに動いている管理者のアプリ）
        int ticksLeft = kAppWindowWaitTicks;
        std::vector<HWND> earlier;  // 起動前に見えていた窓。この中に無い窓も候補
        HWND freshHwnd = nullptr;   // ファイル名では特定できない、新しい窓。待ちの最後に掴む（ストアアプリでは使わない）
    };
    std::vector<AppSummonWait> appSummons_;
    HWND pinnedHwnd_ = nullptr;     // 中央に合わせて最前面にしている窓（同時に1つ。移動や大きさに追従する）
    std::wstring pinnedTarget_;
    bool pinnedHidden_ = false;     // ブラウザを最小化しているあいだ、外の窓を隠している
    bool following_ = false;        // FollowPinned の途中（入れ子で動かさない）
    bool haveLastFollow_ = false;   // lastFollow_ に、前回合わせた画面座標がある
    bool pinnedOverlap_ = false;    // この追従で、はみ出す知らせを既に出した
    RECT lastFollow_{};             // 同じ区画なら、ドラッグしていないのに置き直さない
    std::map<int, Popout> popouts_;                 // ライブの小窓に出しているタブ → 窓
    std::map<int, nlohmann::json> popoutAfterWake_;  // 起こし終わったら小窓に出すタブ → UI が渡した places
    std::vector<DownloadItem> downloads_;
    std::vector<Microsoft::WRL::ComPtr<ICoreWebView2DownloadOperation>> activeDownloads_;
    bool recordOn_ = false;
    bool recordAwait_ = false;
    DWORD recordAwaitSince_ = 0;   // 今のコマを頼んだ時刻（GetTickCount）
    int recordMisses_ = 0;         // 返事が上限までに来なかったコマが、続けて何回か
    DWORD recordIdleSince_ = 0;    // 撮る相手（中央のタブ）が無くなった時刻。0 は相手がいる
    std::string closeAwaitId_;       // 閉じる途中：確定した録画（この id）のカードを、右が保存し終えるのを待っている（上限は 1.5 秒のまま）
    bool closeLeftDone_ = false;     // 閉じる途中：左の最後の保存が済んだ
    bool recordStop_ = false;
    int recordGen_ = 0;
    int recordSentSecond_ = -1;
    DWORD recordTick_ = 0;
    std::string recordId_;
    std::filesystem::path recordPath_;
    std::vector<int> recordTimes_;
    std::unique_ptr<record::Writer> recordWriter_;
    bool ocrBusy_ = false;
    DWORD ocrSince_ = 0;           // 読み取りを始めた時刻（GetTickCount）
    std::string ocrVideoId_;       // 読み取りのワーカーが mp4 を開いている撮影の id（mp4 を読まないときは空）
    int ocrGen_ = 0;
};
