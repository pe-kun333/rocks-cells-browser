#pragma once

#include <windows.h>

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

// アプリのセル（docs/plan-app-cells.md）
//   A1：ファイルを選ぶ、ショートカットの中身を読む、アイコンを取る。Pick は起動しない。
//   A2：既にある窓を前に出す。無ければ Launch。
//   A3：PlaceInPage で中央の区画（画面座標）に合わせ、HWND_TOPMOST。ClearTopmost でやめる。
//       起動用の exe と窓の exe が違うとき（Windows 11 のメモ帳など）は、ファイル名と起動直後の新しい窓でも探す。
//   A4：PlaceInPage の quiet で、フォーカスを奪わずに追従する。隠す・出すのは呼ぶ側。
//   A5：ストアアプリは、ショートカットのアプリ ID（System.AppUserModel.ID）と窓のアプリ ID を比べる。
namespace apps {

// 左の UI の pickApp。返す JSON は次のどちらか。
//   選べた：ok true、name、launch、target、args、cwd、shortcut、icon（data:image/png;base64,... か空）、aumid（無ければ空）
//   選べない：ok false、error は cancel（やめた）・type（.exe と .lnk 以外）・missing（ファイルが無い）・dialog（窓を出せない）
// 呼ぶのは UI のスレッドだけ（ファイルを選ぶ窓は、COM の STA が要る）
nlohmann::json Pick(HWND owner);

// ショートカットの System.AppUserModel.ID。無ければ空。起動はしない。
std::wstring ShortcutAppId(const std::wstring& shortcut);

// その窓のアプリ ID。窓のプロパティ、プロセス、子の CoreWindow の順。取れなければ空。
std::wstring WindowAppId(HWND window);

// アプリ ID を、大文字小文字を区別せずに比べる。空や、形の違うものは不一致
bool SameAppId(const std::wstring& a, const std::wstring& b);

// target が空、または実行ファイルの名前が ApplicationFrameHost.exe。
// ストアアプリの窓は別のアプリと exe が同じなので、exe の一致では探さない。
bool IsStoreTarget(const std::wstring& target);

// 実行ファイルのフルパスを、大文字小文字を区別せずに比べる（区切りと \\?\ は揃える）
bool SameExePath(const std::wstring& a, const std::wstring& b);

// 窓をどう特定したか。並びが優先（小さい方が先）。Path / Name / AppId / Pid / Title はすぐ置いてよい。
// FreshFront / FreshOther は、起動前に無かった窓（ファイル名が違うランチャー用）。
// すぐ掴むと起動の途中の別の窓を拾うので、呼ぶ側はファイル名の一致を優先して待ち、最後にこの窓を使う。
// AppId はストアアプリのアプリ ID。Title は、ID が窓から取れないときの題名（登録名）。
enum class FoundVia { None, Path, Name, AppId, Pid, Title, FreshFront, FreshOther };

inline bool SureMatch(FoundVia via) {
    return via == FoundVia::Path || via == FoundVia::Name || via == FoundVia::AppId || via == FoundVia::Pid || via == FoundVia::Title;
}

// 探す条件。earlier が nullptr のときは、新しい窓を候補にしない（起動する前）。
struct WindowLook {
    std::wstring target;  // 台帳の実行ファイル（起動用のパスでもよい）
    std::wstring host;    // 前回掴んだ窓の実行ファイル。空なら使わない
    std::wstring appId;   // ショートカットのアプリ ID。空なら ID では探さない
    std::wstring title;   // ストアアプリの登録名。ID の一致が無いときの題名用。2文字未満は使わない
    DWORD pid = 0;        // ShellExecuteEx のプロセス番号。0 は使わない
    const std::vector<HWND>* earlier = nullptr;
    bool* accessDenied = nullptr;  // パスを聞けない見える窓があったか（管理者。nullptr なら聞かない）
    bool allowFresh = true;        // false のとき、起動前に無かった窓では掴かない（別のストアアプリを避ける）
};

struct FoundWindow {
    HWND hwnd = nullptr;
    std::wstring host;   // その窓のプロセスの実行ファイル。聞けなければ空
    std::wstring appId;  // その窓のアプリ ID。聞けなければ空
    FoundVia via = FoundVia::None;
};

// 見えるトップレベル窓。自分のプロセスと、ツールチップのような窓は除く。起動前の控えに使う。
std::vector<HWND> ListVisibleWindows();

// フルパス（target か host）→ ファイル名（大小無視）→ アプリ ID → プロセス番号 → 題名 → 起動前に無かった窓、の順。
// ApplicationFrameHost.exe は、ストアアプリが同じ exe を共有するので、ファイル名でもプロセス番号でも新しい窓でも掴まない。
// アプリ ID が一致した窓だけを掴む。ID が無い、または窓から ID を読めないときは、登録名が題名のストアの窓。
// 題名の部分一致が2つ以上あるときは掴まない（ほかのアプリの窓は動かさない）。
// 同じ強さなら、オーナーの無い窓を優先し、手前から最初の1つ。
FoundWindow FindAppWindow(const WindowLook& look);

// その窓のプロセスの実行ファイル。聞けなければ空（管理者など）。
std::wstring HostOf(HWND window);

// 最小化なら戻してから SetForegroundWindow する。大きさは変えない。HWND_TOPMOST にはしない。
// 呼ぶ前に AllowSetForegroundWindow(ASFW_ANY) する（押したのは使う人なので、前に出てよい）。
void BringToFront(HWND window);

// 実在する .exe か .lnk か（絶対パスだけ。制御文字は不可）
bool IsLaunchable(const std::wstring& launch);

// ShellExecuteExW で launch を開く。失敗しても Windows のエラー窓は出さない。
// .lnk のときは args と cwd を渡さない（ショートカット自身の引数と作業フォルダを残す）。
// .exe のときだけ、空でない args と、実在する cwd を渡す。
// pid を渡すと、起動したプロセスの番号を入れる（取れなければ 0）。ハンドルはここで閉じる。
bool Launch(HWND owner, const std::wstring& launch, const std::wstring& args, const std::wstring& cwd, DWORD* pid = nullptr);

// 中央の区画へ合わせた結果。page は画面座標（PageRect を ClientToScreen したもの）。
enum class PlaceKind {
    Placed,   // 区画の位置と大きさに合わせ、最前面にした
    Fixed,    // 大きさを変えられないので、中央（大きすぎるときは左上）に寄せて最前面にした
    Denied,   // SetWindowPos が ERROR_ACCESS_DENIED（管理者のアプリ）。最前面にはしていない
    Failed,   // それ以外の理由で動かせなかった
    Missing,  // 窓がもう無い
};

struct PlaceResult {
    PlaceKind kind = PlaceKind::Missing;
    bool overlap = false;  // 固定の窓が区画の外まではみ出す（サイドバーに重なることがある）
};

// ダブルクリックで出すとき。HWND_TOPMOST。大きさを変えられる窓は区画いっぱいにする。
// 最大化・最小化・スナップなら、先に SW_RESTORE する（そのままだと SetWindowPos の大きさが無視される）。
// page は物理ピクセル（このプロセスはモニタごとの DPI）。別の DPI から来た窓は、同じ座標でもう一度置く。
// WS_THICKFRAME が無い、または合わせたあとに幅か高さが 12px 以上足りないときは、中央寄せだけ（1回だけ試す）。
// quiet が true のとき（A4 の追従）：SWP_NOACTIVATE。操作の途中でフォーカスを奪わない。前には出さない。
PlaceResult PlaceInPage(HWND window, const RECT& page, bool quiet = false);

// 最前面をやめる。位置と大きさは変えない。窓は閉じない。追従もここで終わる（呼ぶ側が覚えていた HWND を忘れる）。
void ClearTopmost(HWND window);

}  // namespace apps
