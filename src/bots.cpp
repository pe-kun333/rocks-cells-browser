// ボットのセル：Grok Bot の返事の受け取り口（第2段 S2.1）。くわしい流れは bots.h の頭
#include "bots.h"

#include <bcrypt.h>  // BCryptHash など（SHA-256）
#include <shlobj.h>  // SHGetKnownFolderPath

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <optional>
#include <regex>
#include <system_error>

#include "storage.h"
#include "strings.h"

// bcrypt.h は NT_SUCCESS を定義しない（ntdef.h にある）。ここで同じものを定義する
#ifndef NT_SUCCESS
#define NT_SUCCESS(Status) (((NTSTATUS)(Status)) >= 0)
#endif

using nlohmann::json;
namespace fs = std::filesystem;

namespace bots {
namespace {

// 置き場のファイルの名前（docs/bot-cells/relay-alignment.md・schemas/message.v1.schema.json の requestId・bot・id と同じ形）。
//   <requestId>-<id>.json：requestId の後ろの「-英数字」は、付けられるなら付けて読む（ブラウザが作る requestId はいつも付いている）。
//     id にも - が入るので、名前だけでは分け方が2通りになることがある。いつも同じ分け方になればよい（同じ名前 → 同じ fileId）
//   notice-<bot>-<id>.json：bot には - が入らないので、分け方は1通り
//   .part・.tmp など、ほかの名前は合わない（見ない）
const std::regex kReplyName(R"(^(hb-[0-9]{8}-[0-9]{4,6}(?:-[A-Za-z0-9]{1,32})?)-([A-Za-z0-9_-]{1,64})\.json$)");
const std::regex kNoticeName(R"(^notice-(b[0-9a-z]{4,24})-([A-Za-z0-9_-]{1,64})\.json$)");
const std::regex kFileIdPattern(R"(^[A-Za-z0-9_-]{1,80}$)");
const std::regex kReasonPattern(R"(^[A-Za-z0-9_.:-]{1,64}$)");

constexpr wchar_t kJsonExt[] = L".json";
constexpr wchar_t kTakingExt[] = L".taking";
// 元の名前（置き場でのファイルの名前）を残す小さなファイル <fileId>.source.txt。中身のファイルには書き足さない（バイトを変えない）
constexpr wchar_t kSourceExt[] = L".source.txt";
constexpr wchar_t kReasonExt[] = L".reason.json";

constexpr ULONGLONG kCleanupIntervalMs = 60ull * 60 * 1000;  // done\・rejected\ の古いものを消すのは1時間に1回
constexpr auto kKeepFor = std::chrono::hours(24 * 7);         // done\・rejected\ に残す長さ（7日）
constexpr size_t kMaxListed = 500;                            // 1回に並べて見るファイルの数（多すぎるときの守り）
constexpr size_t kMaxResend = 100;                            // 渡し直す .taking の数
constexpr int kMaxNesting = 32;                               // JSON の入れ子の深さ（message.v1 は 3 段ほど）
constexpr std::uintmax_t kMaxSourceNameBytes = 200;
constexpr size_t kDoneHashChars = 12;                         // done\ で名前が重なったとき、名前に足す中身のハッシュの字数

fs::path DoneFolder() {
    return InboxFolder() / L"done";
}

fs::path RejectedFolder() {
    return InboxFolder() / L"rejected";
}

fs::path FileIn(const fs::path& dir, const std::string& fileId, const wchar_t* ext) {
    return dir / (ToWide(fileId) + ext);
}

fs::path TakingPath(const std::string& fileId) {
    return FileIn(InboxFolder(), fileId, kTakingExt);
}

// 名前を変えて移す（同じドライブなら、途中の形が見えることはない）。replace：行き先に同じ名前があれば置き換える
bool MovePath(const fs::path& from, const fs::path& to, bool replace) {
    return MoveFileExW(from.c_str(), to.c_str(), replace ? MOVEFILE_REPLACE_EXISTING : 0) != FALSE;
}

bool Exists(const fs::path& path) {
    std::error_code error;
    return fs::exists(path, error);
}

void RemoveQuietly(const fs::path& path) {
    std::error_code error;
    fs::remove(path, error);
}

// 更新の時刻を今にする（中身は変えない）。done\・rejected\ の「7日」は、受け取った時から数えるため
void Touch(const fs::path& path) {
    std::error_code error;
    fs::last_write_time(path, fs::file_time_type::clock::now(), error);
}

// ファイルの更新の時刻（UTC の ISO 8601）。読めなければ今の時刻
std::string FileTimeIso(const fs::path& path) {
    WIN32_FILE_ATTRIBUTE_DATA data{};
    SYSTEMTIME t{};
    if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &data) || !FileTimeToSystemTime(&data.ftLastWriteTime, &t)) {
        return IsoNow();
    }
    char text[32];
    snprintf(text, sizeof(text), "%04u-%02u-%02uT%02u:%02u:%02u.%03uZ", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute,
             t.wSecond, t.wMilliseconds);
    return text;
}

// JSON の入れ子が深すぎないか（文字列の中の括弧は数えない）。深すぎるものは読まない（読み書きの手間がかかりすぎないように）
bool NestingWithin(const std::string& text, int maxDepth) {
    int depth = 0;
    bool inString = false;
    bool escaped = false;
    for (const char c : text) {
        if (inString) {
            if (escaped) escaped = false;
            else if (c == '\\') escaped = true;
            else if (c == '"') inString = false;
            continue;
        }
        if (c == '"') {
            inString = true;
        } else if (c == '{' || c == '[') {
            if (++depth > maxDepth) return false;
        } else if (c == '}' || c == ']') {
            --depth;
        }
    }
    return true;
}

// 中身の形だけを見る（C++ は中身を判断しない）。読めれば JSON のオブジェクト、だめなら reason に理由
std::optional<json> ParseShape(const std::string& text, std::string& reason) {
    if (!NestingWithin(text, kMaxNesting)) {
        reason = "tooDeep";
        return std::nullopt;
    }
    json value = json::parse(text, nullptr, false);
    if (value.is_discarded()) {
        reason = "badJson";
        return std::nullopt;
    }
    if (!value.is_object()) {
        reason = "notObject";
        return std::nullopt;
    }
    return value;
}

// 残しておいた元の名前（形の合うものだけ）
std::optional<std::string> ReadSourceName(const fs::path& dir, const std::string& fileId) {
    const auto text = ReadTextFileCapped(FileIn(dir, fileId, kSourceExt), kMaxSourceNameBytes);
    if (!text) return std::nullopt;
    if (!std::regex_match(*text, kReplyName) && !std::regex_match(*text, kNoticeName)) return std::nullopt;
    return text;
}

// done\ の名前は requestId と返事の id だけで決まる（fileId）。中身の違うものが同じ名前で来たときは上書きせず、
// <fileId>-<中身の SHA-256 の先頭 12 字> の名前で別に残す。その名前（拡張子の前まで）。ハッシュが作れなければ空
std::string DoneAltId(const std::string& fileId, const std::string& text) {
    const std::string hex = Sha256Hex(text);
    return hex.size() < kDoneHashChars ? std::string() : fileId + "-" + hex.substr(0, kDoneHashChars);
}

// ファイルの中身のバイトが text と同じか（無い・読めないときは違うことにする）
bool SameText(const fs::path& path, const std::string& text) {
    const auto other = ReadTextFileCapped(path, kMaxInboxFileBytes);
    return other && *other == text;
}

// 中身まで同じものが、もう done\ にあるか（<fileId>.json か、別に残した <fileId>-<ハッシュ>.json）
bool SameInDone(const std::string& fileId, const std::string& text) {
    if (SameText(FileIn(DoneFolder(), fileId, kJsonExt), text)) return true;
    const std::string alt = DoneAltId(fileId, text);
    return !alt.empty() && SameText(FileIn(DoneFolder(), alt, kJsonExt), text);
}

// 受け取り口のファイルを、古い順（更新の時刻。置き場から移したものは 中継の道具が書いた時刻のまま）に並べる
struct Entry {
    fs::path path;
    std::string fileId;
    fs::file_time_type time;
    std::uintmax_t size = 0;
};

std::vector<Entry> ListInbox(const wchar_t* ext) {
    std::vector<Entry> list;
    std::error_code error;
    for (auto it = fs::directory_iterator(InboxFolder(), error); !error && it != fs::directory_iterator(); it.increment(error)) {
        if (list.size() >= kMaxListed) break;
        std::error_code e;
        if (!it->is_regular_file(e) || e) continue;
        const fs::path& path = it->path();
        if (path.extension() != ext) continue;
        const std::string fileId = ToUtf8(path.stem().wstring());
        if (!IsValidFileId(fileId)) continue;
        Entry entry{path, fileId, it->last_write_time(e)};
        if (e) continue;
        entry.size = it->file_size(e);
        if (e) continue;
        list.push_back(std::move(entry));
    }
    std::sort(list.begin(), list.end(), [](const Entry& a, const Entry& b) { return a.time != b.time ? a.time < b.time : a.fileId < b.fileId; });
    return list;
}

}  // namespace

fs::path RelayInboxFolder() {
    wchar_t buffer[MAX_PATH];
    const DWORD relay = GetEnvironmentVariableW(L"ROCKSCELLS_RELAY_DIR", buffer, MAX_PATH);
    if (relay > 0) return relay < MAX_PATH ? fs::path(std::wstring(buffer, relay)) / L"inbox" : fs::path();
    // 試しのデータフォルダで動いている窓は、本物の置き場から取らない（本物の返事を試しの窓が持っていかないように）
    if (GetEnvironmentVariableW(L"ROCKSCELLS_DATA_DIR", nullptr, 0) > 0) return {};
#ifndef ROCKSCELLS_BOT_FEATURES
    return {};  // Bot features are off in this build: never watch a relay folder unless ROCKSCELLS_RELAY_DIR is set
#endif
    PWSTR localAppData = nullptr;
    fs::path path;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &localAppData))) {
        path = fs::path(localAppData) / L"RocksCellsRelay" / L"inbox";
    }
    CoTaskMemFree(localAppData);
    return path;
}

fs::path InboxFolder() {
    const fs::path data = AppDataFolder();
    return data.empty() ? fs::path() : data / L"bot-inbox";
}

std::string Sha256Hex(const std::string& data) {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    if (!NT_SUCCESS(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0))) return {};
    BCRYPT_HASH_HANDLE hash = nullptr;
    UCHAR digest[32]{};
    bool ok = NT_SUCCESS(BCryptCreateHash(algorithm, &hash, nullptr, 0, nullptr, 0, 0));
    if (ok) {
        ok = NT_SUCCESS(BCryptHashData(hash, reinterpret_cast<PUCHAR>(const_cast<char*>(data.data())), static_cast<ULONG>(data.size()), 0));
    }
    if (ok) ok = NT_SUCCESS(BCryptFinishHash(hash, digest, static_cast<ULONG>(sizeof(digest)), 0));
    if (hash) BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    if (!ok) return {};
    static constexpr char kHex[] = "0123456789abcdef";
    std::string out;
    out.reserve(sizeof(digest) * 2);
    for (const UCHAR byte : digest) {
        out.push_back(kHex[byte >> 4]);
        out.push_back(kHex[byte & 0x0f]);
    }
    return out;
}

std::string FileIdForRelayName(const std::wstring& name) {
    if (name.empty() || name.size() > 160) return {};
    const std::string utf8 = ToUtf8(name);
    std::smatch match;
    std::string key;
    if (std::regex_match(utf8, match, kReplyName)) key = match[1].str() + ":" + match[2].str();
    else if (std::regex_match(utf8, match, kNoticeName)) key = "n:" + match[1].str() + ":" + match[2].str();
    else return {};
    const std::string hex = Sha256Hex(key);
    return hex.size() < 32 ? std::string() : "r-" + hex.substr(0, 32);
}

bool IsValidFileId(const std::string& fileId) {
    return fileId.size() <= 80 && std::regex_match(fileId, kFileIdPattern);
}

// ---------- Inbox ----------

Inbox::~Inbox() {
    Release();
}

bool Inbox::TryOwn(const std::wstring& dataFolderKey) {
    if (mutex_) return true;
    if (InboxFolder().empty()) return false;
    const std::string hex = Sha256Hex(ToUtf8(dataFolderKey));
    if (hex.size() < 16) return false;
    const std::wstring name = L"Local\\RocksCellsBots-" + ToWide(hex.substr(0, 16));
    HANDLE handle = CreateMutexW(nullptr, FALSE, name.c_str());
    if (!handle) return false;
    // 待たずに取ってみる。前の持ち主が閉じずに終わっていたとき（WAIT_ABANDONED）も、取れたことになる
    const DWORD wait = WaitForSingleObject(handle, 0);
    if (wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED) {
        mutex_ = handle;
        return true;
    }
    CloseHandle(handle);
    return false;
}

void Inbox::Release() {
    if (!mutex_) return;
    ReleaseMutex(mutex_);
    CloseHandle(mutex_);
    mutex_ = nullptr;
    handed_.clear();
}

// 置き場から受け取り口へ移す（取り込み）。置き場にすることは「取り出す」だけ（書き足す・ほかを消す、はしない）
void Inbox::ImportFromRelay() {
    const fs::path relay = RelayInboxFolder();
    std::error_code error;
    if (relay.empty() || !fs::is_directory(relay, error)) return;
    const fs::path inbox = InboxFolder();

    // 先に名前を集めてから移す（並べている途中のフォルダを変えない）
    std::vector<std::pair<fs::path, std::string>> found;
    for (auto it = fs::directory_iterator(relay, error); !error && it != fs::directory_iterator(); it.increment(error)) {
        if (found.size() >= kMaxFilesPerScan) break;
        std::error_code e;
        if (!it->is_regular_file(e) || e) continue;
        const std::string fileId = FileIdForRelayName(it->path().filename().wstring());
        if (!fileId.empty()) found.emplace_back(it->path(), fileId);
    }
    for (const auto& [path, fileId] : found) {
        // 同じ fileId がまだ受け取り口にある（取る前・左の UI の答え待ち）→ 今は置き場に残す。
        // 済んで done\ に移ったあとで取り込み、Scan の ① で黙って捨てる
        const fs::path target = FileIn(inbox, fileId, kJsonExt);
        if (Exists(target) || Exists(TakingPath(fileId))) continue;
        // 同じドライブなので名前を変えるだけ（違うドライブへはコピーしない。移せなければ置き場に残る）
        if (!MovePath(path, target, false)) continue;
        WriteFileAtomically(FileIn(inbox, fileId, kSourceExt), ToUtf8(path.filename().wstring()));
    }
}

// done\・rejected\ の 7日より古いものを消す（1時間に1回まで）
void Inbox::CleanupOld() {
    const ULONGLONG now = GetTickCount64();
    if (lastCleanup_ != 0 && now - lastCleanup_ < kCleanupIntervalMs) return;
    lastCleanup_ = now;
    const auto limit = fs::file_time_type::clock::now() - kKeepFor;
    for (const fs::path& dir : {DoneFolder(), RejectedFolder()}) {
        std::vector<fs::path> old;
        std::error_code error;
        for (auto it = fs::directory_iterator(dir, error); !error && it != fs::directory_iterator(); it.increment(error)) {
            std::error_code e;
            if (!it->is_regular_file(e) || e) continue;
            const auto time = it->last_write_time(e);
            if (!e && time < limit) old.push_back(it->path());
        }
        for (const fs::path& path : old) RemoveQuietly(path);
    }
}

json Inbox::Deliver(const std::string& fileId, const std::string& receivedAt, json reply) {
    handed_[fileId] = receivedAt;
    json msg = {{"type", "botReply"},
                {"fileId", fileId},
                {"via", "folder"},  // 置いたのがだれか C++ には分からない（ファイルの中の文字は信じない。§9.4）
                {"receivedAt", receivedAt},
                {"transportOk", false},
                {"reply", std::move(reply)}};
    if (const auto source = ReadSourceName(InboxFolder(), fileId)) msg["sourceName"] = *source;
    return msg;
}

void Inbox::Reject(const std::string& fileId, const fs::path& from, const std::string& reason, const char* by, std::uintmax_t bytes) {
    const fs::path dir = RejectedFolder();
    std::error_code error;
    fs::create_directories(dir, error);
    const fs::path to = FileIn(dir, fileId, kJsonExt);
    if (!MovePath(from, to, true)) return;
    Touch(to);
    json info = {{"v", 1}, {"fileId", fileId}, {"reason", reason}, {"by", by}, {"at", IsoNow()}};
    if (bytes > 0) info["bytes"] = bytes;
    if (const auto source = ReadSourceName(InboxFolder(), fileId)) info["sourceName"] = *source;
    MovePath(FileIn(InboxFolder(), fileId, kSourceExt), FileIn(dir, fileId, kSourceExt), true);
    WriteFileAtomically(FileIn(dir, fileId, kReasonExt), info.dump(2));
    handed_.erase(fileId);
}

std::vector<json> Inbox::Scan() {
    std::vector<json> out;
    const fs::path inbox = InboxFolder();
    if (!Owner() || inbox.empty()) return out;
    std::error_code error;
    fs::create_directories(inbox, error);
    ImportFromRelay();
    CleanupOld();

    size_t handled = 0;
    for (const Entry& entry : ListInbox(kJsonExt)) {
        if (handled >= kMaxFilesPerScan) break;
        // 取ったままのもの（.taking）と同じ名前 → 左の UI の答えを待つ（今は触らない）
        if (Exists(TakingPath(entry.fileId))) continue;
        ++handled;  // 捨てた・断ったものも数える（1回の手間を 20 件までにする）
        if (entry.size > kMaxInboxFileBytes) {
            Reject(entry.fileId, entry.path, "tooLarge", "browser", entry.size);
            continue;
        }
        bool tooLarge = false;
        const auto text = ReadTextFileCapped(entry.path, kMaxInboxFileBytes, &tooLarge);
        if (!text) {
            if (tooLarge) Reject(entry.fileId, entry.path, "tooLarge", "browser", entry.size);
            continue;  // 読めない（ほかのプログラムが開いている）ときは、次の回にもう一度
        }
        // ① 同じ fileId がもう done\ にあり（別に残した <fileId>-<ハッシュ>.json も見る）、中身のバイトも同じ → 黙って捨てる（§9.6）。
        //   中身が違うときは捨てずに渡す（fileId は requestId と id だけから作るので、先に置かれた偽物が、
        //   あとから来た本物を消してしまわないように。どちらを使うかは左の UI が check で決める）
        if (SameInDone(entry.fileId, *text)) {
            RemoveQuietly(entry.path);
            RemoveQuietly(FileIn(inbox, entry.fileId, kSourceExt));
            continue;
        }
        std::string reason;
        std::optional<json> reply = ParseShape(*text, reason);
        if (!reply) {
            Reject(entry.fileId, entry.path, reason, "browser", text->size());
            continue;
        }
        // 名前を変えて「取った」印にする。受け取った時刻から 7日を数えるよう、時刻も今にする
        const fs::path taking = TakingPath(entry.fileId);
        if (!MovePath(entry.path, taking, false)) continue;
        Touch(taking);
        out.push_back(Deliver(entry.fileId, IsoNow(), std::move(*reply)));
    }
    return out;
}

std::vector<json> Inbox::Resend() {
    std::vector<json> out;
    if (!Owner() || InboxFolder().empty()) return out;
    for (const Entry& entry : ListInbox(kTakingExt)) {
        if (out.size() >= kMaxResend) break;
        bool tooLarge = false;
        const auto text = ReadTextFileCapped(entry.path, kMaxInboxFileBytes, &tooLarge);
        if (!text) {
            if (tooLarge) Reject(entry.fileId, entry.path, "tooLarge", "browser", entry.size);
            continue;
        }
        std::string reason;
        std::optional<json> reply = ParseShape(*text, reason);
        if (!reply) {
            Reject(entry.fileId, entry.path, reason, "browser", text->size());
            continue;
        }
        // 受け取った時刻：この窓で渡したものは、そのときの時刻。前に動いていた窓が取ったものは、取ったときに付けたファイルの時刻
        const auto known = handed_.find(entry.fileId);
        const std::string receivedAt = known != handed_.end() ? known->second : FileTimeIso(entry.path);
        out.push_back(Deliver(entry.fileId, receivedAt, std::move(*reply)));
    }
    return out;
}

bool Inbox::Taken(const std::string& fileId, const std::string& result, const std::string& reason) {
    if (!Owner() || !IsValidFileId(fileId)) return false;
    // 自分が渡した一覧にあるものだけ（..\ などで、ほかのファイルを動かされないように。形も上で確かめた）
    if (handed_.find(fileId) == handed_.end()) return false;
    const fs::path taking = TakingPath(fileId);
    if (!Exists(taking)) {
        handed_.erase(fileId);
        return false;
    }
    if (result == "done") {
        const fs::path done = DoneFolder();
        std::error_code error;
        fs::create_directories(done, error);
        // done\ に同じ名前のものがもうあっても上書きしない（前のものを残す）：
        //   中身も同じ → 黙って捨てる。中身が違う → <fileId>-<中身のハッシュ 12 字>.json の名前で別に残す
        std::string doneId = fileId;
        if (Exists(FileIn(done, fileId, kJsonExt))) {
            const auto text = ReadTextFileCapped(taking, kMaxInboxFileBytes);
            if (!text) return false;  // 読めない（ほかのプログラムが開いている）→ .taking のまま残す
            if (SameInDone(fileId, *text)) {
                RemoveQuietly(taking);
                if (Exists(taking)) return false;  // 消せなかった → .taking のまま残す
                RemoveQuietly(FileIn(InboxFolder(), fileId, kSourceExt));
                handed_.erase(fileId);
                return true;
            }
            doneId = DoneAltId(fileId, *text);
            if (doneId.empty()) return false;
        }
        // 行き先に同じ名前があれば移さない（上書きしない。.taking のまま残る）
        if (!MovePath(taking, FileIn(done, doneId, kJsonExt), false)) return false;
        MovePath(FileIn(InboxFolder(), fileId, kSourceExt), FileIn(done, doneId, kSourceExt), true);
        handed_.erase(fileId);
        return true;
    }
    if (result == "rejected") {
        Reject(fileId, taking, std::regex_match(reason, kReasonPattern) ? reason : std::string("other"), "ui", 0);
        return !Exists(taking);
    }
    return false;
}

}  // namespace bots
