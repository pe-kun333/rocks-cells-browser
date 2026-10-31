#include "hexmemo.h"

#include <windows.h>

#include <chrono>
#include <cstdio>
#include <filesystem>
#include <functional>
#include <regex>

#include "storage.h"
#include "strings.h"
#include "l10n.h"

using nlohmann::json;
namespace fs = std::filesystem;

namespace hexmemo {
namespace {

const std::regex kAppIdPattern("^[0-9a-f]{8}$");
const std::regex kBoardIdPattern("^[a-z0-9]{1,32}$");
const std::regex kBoardFilePattern(R"(^memos(-[a-z0-9]{1,32})?\.json$)");
const std::regex kUuidPattern("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");

std::wstring Env(const wchar_t* name) {
    wchar_t buffer[MAX_PATH];
    const DWORD length = GetEnvironmentVariableW(name, buffer, MAX_PATH);
    return length > 0 && length < MAX_PATH ? std::wstring(buffer, length) : std::wstring();
}

// 六角メモの大もとのデータフォルダ（六角メモと同じく HEX_MEMO_HOME で変えられる。テスト用）
fs::path Root() {
    if (const std::wstring home = Env(L"HEX_MEMO_HOME"); !home.empty()) return fs::path(home);
    const std::wstring appData = Env(L"APPDATA");
    return appData.empty() ? fs::path() : fs::path(appData) / L"hex-memo";
}

bool ValidAppId(const json& appId) {
    return appId.is_null() || (appId.is_string() && std::regex_match(appId.get<std::string>(), kAppIdPattern));
}

fs::path DataDir(const json& appId) {
    return appId.is_null() ? Root() : Root() / L"apps" / ToWide(appId.get<std::string>());
}

json BoardsOf(const fs::path& dir) {
    json out = json::array();
    const json data = ReadJsonFile(dir / L"boards.json");
    if (!data.is_object() || !data.contains("boards") || !data["boards"].is_array()) return out;
    for (const json& board : data["boards"]) {
        if (!board.is_object() || !board.contains("id") || !board["id"].is_string()) continue;
        const std::string id = board["id"].get<std::string>();
        if (!std::regex_match(id, kBoardIdPattern)) continue;
        out.push_back({{"id", id},
                       {"name", board.value("name", "")},
                       {"parentId", board.contains("parentId") && board["parentId"].is_string() ? board["parentId"] : json(nullptr)}});
    }
    return out;
}

// 六角メモ（そのメモアプリ）が動いているか：stopped / ready（受け取れる版が動いている） / old（受け取れない古い版）
std::string Status(const fs::path& dir) {
    std::error_code error;
    if (!fs::exists(dir / L"lockfile", error)) return "stopped";
    const json alive = ReadJsonFile(dir / L"inbox" / L".alive");
    if (!alive.is_object() || !alive.contains("pid") || !alive["pid"].is_number_integer()) return "old";
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, alive["pid"].get<DWORD>());
    if (!process) return GetLastError() == ERROR_ACCESS_DENIED ? "ready" : "stopped";
    DWORD code = 0;
    GetExitCodeProcess(process, &code);
    CloseHandle(process);
    return code == STILL_ACTIVE ? "ready" : "stopped";
}

// 六角メモのプログラムのフォルダ：起動ファイル（名前.cmd）の場所から探す
fs::path InstallDir() {
    const json apps = ReadJsonFile(Root() / L"apps.json");
    if (!apps.is_object() || !apps.contains("apps") || !apps["apps"].is_array()) return {};
    for (const json& app : apps["apps"]) {
        if (!app.is_object() || !app.contains("launcher") || !app["launcher"].is_string()) continue;
        const fs::path dir = fs::path(ToWide(app["launcher"].get<std::string>())).parent_path();
        std::error_code error;
        if (fs::exists(dir / L"node_modules" / L"electron" / L"dist" / L"electron.exe", error)) return dir;
    }
    return {};
}

// 環境変数を一時的に変え、終わったら元の値（無かったなら無い状態）に戻す
class EnvOverride {
public:
    EnvOverride(const wchar_t* name, const wchar_t* value) : name_(name) {
        wchar_t buffer[MAX_PATH];
        const DWORD length = GetEnvironmentVariableW(name, buffer, MAX_PATH);
        if (length > 0 && length < MAX_PATH) previous_ = std::wstring(buffer, length);
        had_ = length > 0 && length < MAX_PATH;
        SetEnvironmentVariableW(name, value);
    }
    ~EnvOverride() { SetEnvironmentVariableW(name_, had_ ? previous_.c_str() : nullptr); }
    EnvOverride(const EnvOverride&) = delete;
    EnvOverride& operator=(const EnvOverride&) = delete;

private:
    const wchar_t* name_;
    std::wstring previous_;
    bool had_ = false;
};

// 六角メモに「受け取り口を見て」と合図する。動いていればそのアプリが取り込み、止まっていれば画面を出さずに取り込んで終わる
bool Signal(const json& appId) {
    const fs::path install = InstallDir();
    if (install.empty()) return false;
    const fs::path exe = install / L"node_modules" / L"electron" / L"dist" / L"electron.exe";

    // 六角メモがどのメモアプリとして起動するかは、環境変数で決まる（起動する子に渡したら、こちらは元に戻す）
    const std::wstring root = Root().wstring();
    const std::wstring id = appId.is_null() ? std::wstring() : ToWide(appId.get<std::string>());
    EnvOverride home(L"HEX_MEMO_HOME", root.c_str());
    EnvOverride app(L"HEX_MEMO_APP_ID", appId.is_null() ? nullptr : id.c_str());
    EnvOverride dataDir(L"HEX_MEMO_DATA_DIR", nullptr);
    EnvOverride name(L"HEX_MEMO_APP_NAME", nullptr);

    std::wstring commandLine = L"\"" + exe.wstring() + L"\" \"" + install.wstring() + L"\" hexmemo://inbox";
    STARTUPINFOW startup{sizeof(startup)};
    PROCESS_INFORMATION process{};
    const BOOL started = CreateProcessW(exe.c_str(), commandLine.data(), nullptr, nullptr, FALSE, DETACHED_PROCESS, nullptr,
                                        install.c_str(), &startup, &process);
    if (!started) return false;
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return true;
}

}  // namespace

json Catalog() {
    const fs::path root = Root();
    std::error_code error;
    if (root.empty() || !fs::exists(root / L"boards.json", error)) return {{"available", false}, {"apps", json::array()}};

    json apps = json::array();
    apps.push_back({{"id", nullptr}, {"name", l10n::TrU8("六角メモ")}, {"status", Status(root)}, {"boards", BoardsOf(root)}});
    const json registry = ReadJsonFile(root / L"apps.json");
    if (registry.is_object() && registry.contains("apps") && registry["apps"].is_array()) {
        for (const json& app : registry["apps"]) {
            if (!app.is_object() || !app.contains("id") || !ValidAppId(app["id"]) || app["id"].is_null()) continue;
            const fs::path dir = DataDir(app["id"]);
            apps.push_back({{"id", app["id"]}, {"name", app.value("name", "")}, {"status", Status(dir)}, {"boards", BoardsOf(dir)}});
        }
    }
    // 登録してあるタグ（名前と色）。ブラウザのタグも同じ名前・同じ色にそろえる（読むだけ）
    json tags = json::array();
    const json settings = ReadJsonFile(root / L"settings.json");
    if (settings.is_object() && settings.contains("tags") && settings["tags"].is_array()) {
        for (const json& tag : settings["tags"]) {
            if (!tag.is_object() || !tag.contains("name") || !tag["name"].is_string()) continue;
            tags.push_back({{"name", tag["name"]}, {"color", tag.value("color", "")}});
            if (tags.size() >= 200) break;
        }
    }
    return {{"available", true}, {"canSignal", !InstallDir().empty()}, {"apps", apps}, {"tags", tags}};
}

// ノートのファイル名（boards.json の file。最初のノートは memos.json）
std::string BoardFile(const fs::path& dir, const std::string& boardId) {
    const json index = ReadJsonFile(dir / L"boards.json");
    if (index.is_object() && index.contains("boards") && index["boards"].is_array()) {
        for (const json& board : index["boards"]) {
            if (!board.is_object() || board.value("id", "") != boardId) continue;
            const std::string file = board.value("file", boardId == "main" ? "memos.json" : "");
            return std::regex_match(file, kBoardFilePattern) ? file : std::string();
        }
    }
    return boardId == "main" ? "memos.json" : std::string();
}

json ReadBoard(const json& appId, const std::string& boardId) {
    if (!ValidAppId(appId) || !std::regex_match(boardId, kBoardIdPattern)) return {{"ok", false}, {"error", l10n::TrU8("ノートの指定が正しくありません")}};
    const fs::path dir = DataDir(appId);
    const std::string file = BoardFile(dir, boardId);
    if (file.empty()) return {{"ok", false}, {"error", l10n::TrU8("ノートが見つかりません")}};
    const json data = ReadJsonFile(dir / ToWide(file));
    if (!data.is_object()) return {{"ok", false}, {"error", l10n::TrU8("ノートを読めませんでした")}};

    constexpr size_t kMaxMemos = 300;
    json memos = json::array();
    bool truncated = false;
    // 1つのマス（と、そのまわりの下の階層）
    std::function<void(const json&, int)> visitLayer;
    const auto visitRecord = [&](const json& record, int depth) {
        if (memos.size() >= kMaxMemos) {
            truncated = true;
            return;
        }
        if (record.is_string()) {
            memos.push_back({{"text", record}, {"createdAt", ""}, {"tags", json::array()}});
            return;
        }
        if (!record.is_object()) return;
        const json text = record.value("text", json());
        if (text.is_string() && !text.get<std::string>().empty()) {
            json memo = {{"text", text},
                         {"createdAt", record.value("createdAt", json(""))},
                         {"tags", record.contains("tags") && record["tags"].is_array() ? record["tags"] : json::array()}};
            if (record.contains("id") && record["id"].is_string()) memo["id"] = record["id"];
            memos.push_back(memo);
        }
        if (depth >= 20) return;
        if (record.contains("children")) visitLayer(record["children"], depth + 1);
        if (record.contains("moreLayers") && record["moreLayers"].is_array()) {
            for (const json& layer : record["moreLayers"]) visitLayer(layer, depth + 1);
        }
    };
    visitLayer = [&](const json& layer, int depth) {
        if (!layer.is_object() || !layer.contains("memos")) return;
        const json& list = layer["memos"];
        if (list.is_object()) {
            for (const auto& item : list.items()) visitRecord(item.value(), depth);
        } else if (list.is_array()) {
            for (const json& item : list) visitRecord(item, depth);
        }
    };
    visitLayer(data, 0);
    if (data.contains("shelf") && data["shelf"].is_array()) {
        for (const json& item : data["shelf"]) visitRecord(item, 0);
    }
    return {{"ok", true}, {"memos", memos}, {"truncated", truncated}};
}

// 並び（{dq, dr} の整数の組）が records と同じ数だけそろっているときだけ、そのまま渡す（六角メモも確かめ直す）
static json CheckedOffsets(const json& offsets, size_t count) {
    if (!offsets.is_array() || offsets.size() != count) return nullptr;
    json out = json::array();
    for (const json& o : offsets) {
        if (!o.is_object() || !o.contains("dq") || !o.contains("dr") || !o["dq"].is_number_integer() ||
            !o["dr"].is_number_integer()) {
            return nullptr;
        }
        const int dq = o["dq"].get<int>();
        const int dr = o["dr"].get<int>();
        if (dq < -10000 || dq > 10000 || dr < -10000 || dr > 10000) return nullptr;
        out.push_back({{"dq", dq}, {"dr", dr}});
    }
    return out;
}

json Send(const json& appId, const std::string& boardId, const json& records, const json& offsets) {
    if (!ValidAppId(appId) || !std::regex_match(boardId, kBoardIdPattern) || !records.is_array() || records.empty() ||
        records.size() > 50) {
        return {{"ok", false}, {"error", l10n::TrU8("送り先か内容の形が正しくありません")}};
    }
    const fs::path dir = DataDir(appId);
    std::error_code error;
    if (!fs::exists(dir, error)) return {{"ok", false}, {"error", l10n::TrU8("送り先のメモアプリが見つかりません")}};

    // 書きかけを読まれないよう、<id>.part に書いてから名前を変える（六角メモの約束どおり）
    const std::string status = Status(dir);
    const std::string id = NewUuid();
    const fs::path inbox = dir / L"inbox";
    const fs::path part = inbox / ToWide(id + ".part");
    const json payload = {{"target", {{"kind", "board"}, {"appId", appId}, {"boardId", boardId}}},
                          {"records", records},
                          {"offsets", CheckedOffsets(offsets, records.size())},
                          {"from", {{"appId", nullptr}, {"appName", "Rocks-cells Browser"}}},
                          {"sentAt", IsoNow()},
                          {"v", 1},
                          {"id", id}};
    fs::create_directories(part / L"files", error);
    if (error || !WriteFileAtomically(part / L"payload.json", payload.dump(-1, ' ', false, json::error_handler_t::replace))) {
        fs::remove_all(part, error);
        return {{"ok", false}, {"error", l10n::TrU8("六角メモの受け取り口に置けませんでした")}};
    }
    for (int attempt = 0;; ++attempt) {
        fs::rename(part, inbox / ToWide(id), error);
        if (!error) break;
        if (attempt >= 9) {
            fs::remove_all(part, error);
            return {{"ok", false}, {"error", l10n::TrU8("六角メモの受け取り口に置けませんでした")}};
        }
        Sleep(60);
    }
    // 受け取れない古い版が動いているときは、合図しない（置いたものは、六角メモを起動し直したときに取り込まれる）
    const bool signaled = status != "old" && Signal(appId);
    return {{"ok", true}, {"id", id}, {"status", status}, {"signaled", signaled}};
}

json Check(const json& appId, const std::string& id) {
    if (!ValidAppId(appId) || !std::regex_match(id, kUuidPattern)) return {{"state", "gone"}};
    const fs::path inbox = DataDir(appId) / L"inbox";
    const fs::path result = inbox / L"results" / ToWide(id + ".json");
    std::error_code error;
    if (fs::exists(result, error)) {
        json value = ReadJsonFile(result);
        fs::remove(result, error);
        return {{"state", "done"}, {"result", value}};
    }
    if (fs::exists(inbox / ToWide(id + ".taking"), error)) return {{"state", "taking"}};
    if (fs::exists(inbox / ToWide(id), error)) {
        const json wait = ReadJsonFile(inbox / L"results" / ToWide(id + ".wait.json"));
        return {{"state", "waiting"}, {"reason", wait.is_object() ? wait.value("reason", "") : ""}};
    }
    return {{"state", "gone"}};
}

}  // namespace hexmemo
