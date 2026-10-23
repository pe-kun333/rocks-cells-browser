#pragma once

#include <windows.h>

#include <cstdint>
#include <filesystem>
#include <map>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "storage.h"  // kMaxImportFileBytes

// ボットのセル：Grok Bot の返事の受け取り口（第2段 S2.1。docs/bot-cells/plan.md・docs/ideas-bot-cells.md §9.4・§11.2）
//
//   置き場 %LOCALAPPDATA%\RocksCellsRelay\inbox\（中継の取り出す道具が書く。道具は各自で用意する）
//     │ 4秒おきに「取り出す」だけ（名前を r-＋SHA-256 の 32 字に変えて移す。中身のバイトは変えない）
//     ▼
//   受け取り口 <データフォルダ>\bot-inbox\（ブラウザの持ち物）
//     <fileId>.json → <fileId>.taking（取った）→ done\ か rejected\（左の UI の答えで。7日で消す）
//     done\ は上書きしない：同じ名前で中身も同じなら黙って捨て、中身が違えば <fileId>-<中身の SHA-256 の先頭 12 字>.json で別に残す
//
//   ・C++ は中身を判断しない。見るのは形（JSON として読めるか）・大きさ・名前だけ。確かめるのは左の UI（bots.ts）
//   ・受け取るのは、データフォルダごとに1つの窓だけ（名前つきの Mutex。取れなかった窓は何もしない）
//   ・全部 UI のスレッドで動く（スレッドは作らない）
namespace bots {

// 1つのファイルの上限と、1回の見回りで取る数（§9.4）
//   上限は提案・取り込みのファイルと同じ 1 MB（前は 256 KB。D4・D7：ボットの返事のファイルも同じ上限。C++ は中身を判断しない）
constexpr std::uintmax_t kMaxInboxFileBytes = kMaxImportFileBytes;
constexpr size_t kMaxFilesPerScan = 20;

// 置き場（中継の道具が書くフォルダ）。
//   環境変数 ROCKSCELLS_RELAY_DIR があれば <それ>\inbox\（試し用）。
//   ROCKSCELLS_DATA_DIR だけがあるときは空（試しの窓が本物の置き場から返事を持っていかないように）。
//   どちらも無ければ %LOCALAPPDATA%\RocksCellsRelay\inbox\ のフォルダ
std::filesystem::path RelayInboxFolder();

// 受け取り口 <データフォルダ>\bot-inbox\ のフォルダ
std::filesystem::path InboxFolder();

// UTF-8 の文字列の SHA-256（小文字の 16 進 64 字）。失敗したら空
std::string Sha256Hex(const std::string& data);

// 置き場のファイルの名前から、受け取り口での名前（fileId）を作る。形が合わなければ空
//   <requestId>-<id>.json   → r-＋SHA-256("<requestId>:<id>") の先頭 32 字
//   notice-<bot>-<id>.json  → r-＋SHA-256("n:<bot>:<id>") の先頭 32 字
std::string FileIdForRelayName(const std::wstring& name);

// fileId の形か（^[A-Za-z0-9_-]{1,80}$）
bool IsValidFileId(const std::string& fileId);

class Inbox {
public:
    Inbox() = default;
    Inbox(const Inbox&) = delete;
    Inbox& operator=(const Inbox&) = delete;
    ~Inbox();

    // Mutex（Local\RocksCellsBots-<データフォルダから作った番号>）を取る。もう持っているか、取れたら true
    bool TryOwn(const std::wstring& dataFolderKey);
    bool Owner() const { return mutex_ != nullptr; }
    void Release();

    // 見回り1回：置き場から取り込み、受け取り口の .json を（20 件まで）取って、左の UI へ送る botReply を返す。
    // 大きすぎる・JSON として読めないものは、ここで rejected\ へ移す。もう done\ にあるものは黙って捨てる
    std::vector<nlohmann::json> Scan();

    // 左の UI が読み込み直したとき：取ったまま（.taking）のものを、もう一度 botReply にして返す
    std::vector<nlohmann::json> Resend();

    // 左の UI の答え（botReplyTaken）。fileId の形が合い、しかも自分が渡したものだけを done\ か rejected\ へ移す。
    // result は "done" か "rejected"。reason は rejected のときの理由（短い英数字の名前。合わなければ "other"）。
    // done\ に同じ名前のものがもうあれば上書きしない（中身も同じなら捨てる。違えば名前に中身の短いハッシュを足して残す）
    bool Taken(const std::string& fileId, const std::string& result, const std::string& reason);

private:
    void ImportFromRelay();
    void CleanupOld();
    nlohmann::json Deliver(const std::string& fileId, const std::string& receivedAt, nlohmann::json reply);
    void Reject(const std::string& fileId, const std::filesystem::path& from, const std::string& reason, const char* by,
                std::uintmax_t bytes);

    HANDLE mutex_ = nullptr;
    std::map<std::string, std::string> handed_;  // 左の UI へ渡した fileId → 渡したときの receivedAt
    ULONGLONG lastCleanup_ = 0;                  // done\・rejected\ の古いものを最後に消した時刻（GetTickCount64）
};

}  // namespace bots
