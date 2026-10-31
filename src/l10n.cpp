#include "l10n.h"

#include <windows.h>

#include <filesystem>
#include <fstream>
#include <string>
#include <unordered_map>

#include "storage.h"
#include "strings.h"

namespace l10n {
namespace {

bool english = false;

std::filesystem::path PrefFile() {
    return AppDataFolder() / L"lang.txt";
}

std::string ReadPref() {
    std::ifstream in(PrefFile(), std::ios::binary);
    std::string text;
    if (in) std::getline(in, text);
    while (!text.empty() && (text.back() == '\r' || text.back() == ' ')) text.pop_back();
    return text == "ja" || text == "en" ? text : "auto";
}

// 英語の表（日本語 → 英語）。公開版の台本（rebuild-public.ps1）が足す WebView2 の案内の文も、ここに入れておく
const std::unordered_map<std::wstring_view, const wchar_t*>& Table() {
    static const std::unordered_map<std::wstring_view, const wchar_t*> table = {
    {L"アプリ（実行ファイルとショートカット）", L"Apps (programs and shortcuts)"},
    {L"実行ファイル", L"Programs"},
    {L"ショートカット", L"Shortcuts"},
    {L"盤面に登録するアプリを選ぶ", L"Choose an app to register on the honeycomb"},
    {L"アプリ", L"App"},
    {L"%s に失敗しました (HRESULT 0x%08X)", L"%s failed (HRESULT 0x%08X)"},
    {L"WebView2 環境の作成", L"Creating the WebView2 environment"},
    {L"WebView2 の起動", L"Starting WebView2"},
    {L"サイドバーの作成", L"Creating the sidebar"},
    {L"タブの作成", L"Creating a tab"},
    {L"ファイル", L"File"},
    {L"この種類は実行しません。フォルダを開きました", L"Files of this type aren't run. Opened the folder instead"},
    {L"小窓", L"Mini window"},
    {L"最前面に固定", L"Keep on top"},
    {L"サイドバーへ戻す", L"Return to sidebar"},
    {L"（最前面でない）", L" (not on top)"},
    {L"六角メモ", L"hex-memo"},
    {L"ノートの指定が正しくありません", L"The notebook is specified incorrectly"},
    {L"ノートが見つかりません", L"Notebook not found"},
    {L"ノートを読めませんでした", L"Could not read the notebook"},
    {L"送り先か内容の形が正しくありません", L"The destination or content format is incorrect"},
    {L"送り先のメモアプリが見つかりません", L"The destination memo app was not found"},
    {L"六角メモの受け取り口に置けませんでした", L"Could not put it in hex-memo's inbox"},
    {L"音声・動画", L"Audio and video"},
    {L"すべてのファイル", L"All files"},
    {L"音声・動画のファイルを開く（同じ名前の .srt / .vtt があれば字幕も読みます）", L"Open an audio or video file (subtitles are loaded too if a .srt / .vtt with the same name exists)"},
    {L"画像", L"Images"},
    {L"画像ファイルを開く", L"Open an image file"},
    {L"提案のファイル（JSON）", L"Proposal files (JSON)"},
    {L"Grok の提案ファイルを開く（patch.v1 の JSON）", L"Open a Grok proposal file (patch.v1 JSON)"},
    {L"🔍 Grok に調べてもらう", L"🔍 Have Grok research it"},
    {L"📝 下のメモに引用", L"📝 Quote in the memo below"},
    {L"単語帳のカードにする", L"Make a word card"},
    {L"🖼 画像を撮影に送る", L"🖼 Send image to Capture"},
    {L"中央の見えている所", L"Visible part of the center"},
    {L"中央を録画", L"Record the center"},
    {L"ブラウザの窓全体", L"Whole browser window"},
    {L"この画面のデスクトップ", L"Desktop of this screen"},
    {L"範囲を指定…", L"Select an area…"},
    {L"セルに追加（ページはこのまま）", L"Add to a cell (stay on this page)"},
    {L"六角スクショを表紙にして、セルに追加", L"Add to a cell with a hexagon screenshot as the cover"},
    {L"WebView2 ランタイムが必要です。入手先を開きますか？\n\n「はい」で Microsoft の WebView2 のページを開きます。「Evergreen Bootstrapper」をダウンロードして入れてから、もう一度起動してください。", L"The WebView2 Runtime is required. Open the download page?\n\n“Yes” opens Microsoft's WebView2 page. Download and install the “Evergreen Bootstrapper”, then start the app again."},
    };
    return table;
}

}  // namespace

void Init() {
    const std::string pref = ReadPref();
    if (pref == "ja") english = false;
    else if (pref == "en") english = true;
    else english = PRIMARYLANGID(GetUserDefaultUILanguage()) != LANG_JAPANESE;  // 自動：Windows の表示言語
}

bool English() {
    return english;
}

void SavePref(const std::string& pref) {
    if (pref != "auto" && pref != "ja" && pref != "en") return;
    if (ReadPref() == pref) return;
    std::ofstream out(PrefFile(), std::ios::binary | std::ios::trunc);
    if (out) out << pref << "\n";
}

const wchar_t* Tr(const wchar_t* ja) {
    if (!english || !ja) return ja;
    const auto& table = Table();
    const auto found = table.find(ja);
    return found != table.end() ? found->second : ja;
}

std::string TrU8(std::string_view ja) {
    if (!english) return std::string(ja);
    const std::wstring wide = ToWide(ja);
    const wchar_t* out = Tr(wide.c_str());
    return out == wide.c_str() ? std::string(ja) : ToUtf8(out);
}

}  // namespace l10n
