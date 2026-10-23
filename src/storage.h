#pragma once

#include <windows.h>

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

// 外から読み込むファイル（Grok の提案 patch.v1・取り込み hcb-memo-interchange）の大きさの上限（バイト）。
//   3 つの入口（ファイルを開く・落とす・受け取り口）で同じ数。UI 側の同じ数は ui/src/import-limits.ts の IMPORT_FILE_BYTES
//   3 MB へ上げるのは、C++ から面へ送れる大きさを実機で測ってから（設計 §3.5。後回し D6）
constexpr std::uintmax_t kMaxImportFileBytes = 1024 * 1024;

// %LOCALAPPDATA%\RocksCellsBrowser（データを置く場所）
// 環境変数 ROCKSCELLS_DATA_DIR があれば、そちらを使う（テスト用）
std::filesystem::path AppDataFolder();

// JSON ファイルを読む。無いときや壊れているときは null を返す（「無い」と「壊れた」を分けるときは ReadJsonFileChecked）
nlohmann::json ReadJsonFile(const std::filesystem::path& path);

// 「無い」と「あるのに読めない」を分けて JSON ファイルを読む（盤面の台帳 session.json の守り）
//   missing：ファイルが無い／unreadable：あるのに開けない（reason "open"）・JSON が壊れている（"parse"）
//   開けないときは、ほかのアプリが一瞬つかんでいることがあるので、少し待って何回か読み直す（attempts 回まで）
enum class JsonFileState { Ok, Missing, Unreadable };
struct JsonFileRead {
    JsonFileState state = JsonFileState::Missing;
    nlohmann::json value;  // ok のときだけ
    std::string reason;    // unreadable のとき："open"・"parse"
};
JsonFileRead ReadJsonFileChecked(const std::filesystem::path& path, int attempts = 3);

// 世代の控え：<名前>.bak1.json（新しい）〜 <名前>.bakN.json（古い）。例 session.json → session.bak1.json
std::filesystem::path GenerationBackupFile(const std::filesystem::path& file, int generation);
// 控えを一つずつ古い方へずらし（いちばん古いものは消える）、今の file を bak1 に写す。写せたら true
bool RotateGenerationBackups(const std::filesystem::path& file, int generations);
// 壊れたファイルの写しを、同じフォルダの <名前>.corrupt-YYYYMMDD-HHMMSS.json に作る（元は動かさない）。
//   同じ中身の写しがもうあれば、作らずにその名前を返す。写せなければ nullopt
std::optional<std::filesystem::path> QuarantineCopy(const std::filesystem::path& file);
// ファイルを最後に書いた時刻（1970-01-01 からのミリ秒、UTC）。分からなければ 0
long long FileWriteTimeMs(const std::filesystem::path& file);

// ---- 盤面の台帳（データフォルダ直下の session.json）の守り ----
//   session.json は ui-data の外にあり、壊れると盤面がまるごと消えるので、ほかの台帳より一段かたく守る
constexpr int kSessionGenerations = 3;               // session.bak1〜3.json
constexpr long long kSessionBackupEveryMs = 3600000;  // 起動して初めて書く前と、bak1 が 1 時間より古いときに控えを回す

// UI の parseSession が受け取れる形か（version 1 で tabs が配列）
bool IsUsableSession(const nlohmann::json& data);

// 起動のあいさつ（hello）に入れる盤面：
//   {"session": 中身か null, "sessionState": "ok"|"missing"|"unreadable",
//    "sessionRecovery"（unreadable のときだけ）: {"reason": "open"|"parse"|"shape", "quarantine": 写しの名前, "backup": 使った控えの名前, "backupSavedAt": ミリ秒}}
//   unreadable のときは、壊れたファイルの写しを作り（元は動かさない）、使える控えを新しい順に探して session に入れる
nlohmann::json LoadSessionForUi(const std::filesystem::path& file);

// 盤面を書く。書く前に、控えを回す時期なら、今の session.json（使える形のときだけ）を bak1 へ回す。
//   rotated：この起動でもう回したか（初めて書く前に一回は回す）。書けたら true
bool SaveSessionWithBackups(const std::filesystem::path& file, const std::string& text, bool& rotated);

// 書いている途中で止まっても元のファイルが壊れないよう、一時ファイルに書いてから置き換える
bool WriteFileAtomically(const std::filesystem::path& path, const std::string& text);

// ファイルの中身をそのまま読む。無い・読めないときは nullopt
std::optional<std::string> ReadTextFile(const std::filesystem::path& path);

// 大きさの上限つきで、ファイルの中身をそのまま読む（maxBytes バイトまで）。
// 無い・読めない・maxBytes より大きいときは nullopt。大きすぎたときは tooLarge（渡したときだけ）を true にする
std::optional<std::string> ReadTextFileCapped(const std::filesystem::path& path, std::uintmax_t maxBytes, bool* tooLarge = nullptr);

// 新しい UUID（小文字の 16 進。例 1b4e28ba-2fa1-11d2-883f-0016d3cca427）
std::string NewUuid();

// 今の時刻（UTC の ISO 8601。例 2026-10-09T01:16:40.123Z）
std::string IsoNow();

// UI が自由に使える保存場所（データフォルダの ui-data\ の中だけ）。
// 名前は「英数字・-・_」を / でつないだもの（4段まで）で、ファイルは .json だけ。合わない名前は nullopt
std::optional<std::filesystem::path> UiDataFile(const std::string& name);
std::optional<std::filesystem::path> UiDataDir(const std::string& name);

// バイト列を Base64 文字列にする（画像を UI へ渡すのに使う）
std::string Base64(const std::vector<BYTE>& data);

// 秘密の文字列（API キーなど）を Windows の DPAPI で暗号化して保存する。
// 同じ Windows ユーザーでログインしているときだけ読み戻せる
bool SaveSecret(const std::filesystem::path& path, const std::string& secret);
std::string LoadSecret(const std::filesystem::path& path);  // 無い・読めないときは空

// ---- データ置き場（ui-data\vault\） ----
// 置き場のフォルダ（index.json・items\・img\ が入る）
std::filesystem::path VaultFolder();

// 置き場の画像（ui-data\vault\img\ の中だけ）。名前は "vault/img/<英数字・-・_>.png"（.webp・.jpg も可）。合わない名前は nullopt
std::optional<std::filesystem::path> VaultImageFile(const std::string& name);

// Base64 の文字列をバイト列に戻す（DevTools が返す画像用）。戻せなければ nullopt
std::optional<std::vector<BYTE>> FromBase64(const std::string& text);

// フォルダの中のファイルの大きさの合計（下のフォルダも数える）。files にファイルの数
std::uintmax_t FolderSize(const std::filesystem::path& dir, std::uintmax_t& files);
