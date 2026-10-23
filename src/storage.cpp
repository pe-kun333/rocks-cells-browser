#include "storage.h"

#include <objbase.h>   // CoCreateGuid
#include <shlobj.h>    // SHGetKnownFolderPath
#include <wincrypt.h>  // CryptBinaryToStringA・CryptStringToBinaryA
#include <dpapi.h>     // CryptProtectData

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cwchar>
#include <fstream>
#include <iterator>
#include <regex>

#include "strings.h"

std::filesystem::path AppDataFolder() {
    // 開発中のテスト用：環境変数 ROCKSCELLS_DATA_DIR があれば、そちらを使う（普段のタブや Cookie を汚さない）
    wchar_t custom[MAX_PATH];
    const DWORD length = GetEnvironmentVariableW(L"ROCKSCELLS_DATA_DIR", custom, MAX_PATH);
    if (length > 0 && length < MAX_PATH) return std::filesystem::path(custom);

    // データは %LOCALAPPDATA%\RocksCellsBrowser に置く。
    // タブ・メモ・Cookie・API キー・ボットの台帳を、ここにまとめて置く
    PWSTR localAppData = nullptr;
    std::filesystem::path path;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &localAppData))) {
        path = std::filesystem::path(localAppData) / L"RocksCellsBrowser";
    }
    CoTaskMemFree(localAppData);
    return path;
}

nlohmann::json ReadJsonFile(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return nullptr;
    nlohmann::json data = nlohmann::json::parse(in, nullptr, false);
    return data.is_discarded() ? nlohmann::json(nullptr) : data;
}

JsonFileRead ReadJsonFileChecked(const std::filesystem::path& path, int attempts) {
    JsonFileRead result;
    for (int attempt = 0; attempt < std::max(1, attempts); ++attempt) {
        if (attempt > 0) Sleep(100);
        std::error_code error;
        const bool exists = std::filesystem::exists(path, error);
        if (!error && !exists) {
            result = {JsonFileState::Missing, nullptr, ""};
            return result;
        }
        std::ifstream in(path, std::ios::binary);
        if (!in) {
            result = {JsonFileState::Unreadable, nullptr, "open"};  // ある（か、あるか分からない）のに開けない：読み直す
            continue;
        }
        nlohmann::json data = nlohmann::json::parse(in, nullptr, false);
        if (data.is_discarded()) return {JsonFileState::Unreadable, nullptr, "parse"};  // 壊れた中身は読み直しても同じ
        return {JsonFileState::Ok, std::move(data), ""};
    }
    return result;
}

std::filesystem::path GenerationBackupFile(const std::filesystem::path& file, int generation) {
    std::filesystem::path name = file.stem();
    name += L".bak" + std::to_wstring(generation) + file.extension().wstring();
    return file.parent_path() / name;
}

bool RotateGenerationBackups(const std::filesystem::path& file, int generations) {
    if (generations < 1) return false;
    std::error_code error;
    std::filesystem::remove(GenerationBackupFile(file, generations), error);
    for (int g = generations - 1; g >= 1; --g) {
        const auto from = GenerationBackupFile(file, g);
        if (std::filesystem::exists(from, error)) std::filesystem::rename(from, GenerationBackupFile(file, g + 1), error);
    }
    // 写しは .tmp を経て置き換える（途中で止まっても半端な bak1 を残さない）。
    //   CopyFileW は元の「書いた時刻」を保つので、bak1 の時刻は「その盤面を保存した時刻」になる
    const auto target = GenerationBackupFile(file, 1);
    std::filesystem::path temp = target;
    temp += L".tmp";
    if (!CopyFileW(file.c_str(), temp.c_str(), FALSE)) return false;
    return MoveFileExW(temp.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != FALSE;
}

std::optional<std::filesystem::path> QuarantineCopy(const std::filesystem::path& file) {
    const auto text = ReadTextFile(file);
    if (!text) return std::nullopt;
    std::wstring prefix = file.stem().wstring() + L".corrupt-";
    std::error_code error;
    for (const auto& entry : std::filesystem::directory_iterator(file.parent_path(), error)) {
        const std::wstring name = entry.path().filename().wstring();
        if (!entry.is_regular_file() || name.rfind(prefix, 0) != 0) continue;
        std::error_code sizeError;
        if (entry.file_size(sizeError) != text->size() || sizeError) continue;
        if (const auto other = ReadTextFile(entry.path()); other && *other == *text) return entry.path();  // 同じ中身の写しがもうある
    }
    SYSTEMTIME t{};
    GetLocalTime(&t);
    wchar_t stamp[32];
    swprintf(stamp, 32, L"%04u%02u%02u-%02u%02u%02u", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond);
    const auto target = file.parent_path() / (prefix + stamp + file.extension().wstring());
    // 同じ秒に二つ目を作ることはまず無いが、あれば上書きしない（CopyFileW の失敗にする）
    if (!CopyFileW(file.c_str(), target.c_str(), TRUE)) return std::nullopt;
    return target;
}

long long FileWriteTimeMs(const std::filesystem::path& file) {
    WIN32_FILE_ATTRIBUTE_DATA data{};
    if (!GetFileAttributesExW(file.c_str(), GetFileExInfoStandard, &data)) return 0;
    const unsigned long long ticks = (static_cast<unsigned long long>(data.ftLastWriteTime.dwHighDateTime) << 32) | data.ftLastWriteTime.dwLowDateTime;
    constexpr unsigned long long kEpoch = 116444736000000000ULL;  // 1601-01-01 → 1970-01-01（100 ns 単位）
    return ticks > kEpoch ? static_cast<long long>((ticks - kEpoch) / 10000ULL) : 0;
}

bool IsUsableSession(const nlohmann::json& data) {
    if (!data.is_object()) return false;
    const auto version = data.find("version");
    const auto tabs = data.find("tabs");
    return version != data.end() && version->is_number_integer() && version->get<long long>() == 1 && tabs != data.end() && tabs->is_array();
}

nlohmann::json LoadSessionForUi(const std::filesystem::path& file) {
    JsonFileRead read = ReadJsonFileChecked(file);
    if (read.state == JsonFileState::Ok && !IsUsableSession(read.value)) {
        read.state = JsonFileState::Unreadable;  // JSON としては読めたが、知らない形（新しい版など）。上書きしない
        read.reason = "shape";
    }
    if (read.state == JsonFileState::Ok) return {{"session", std::move(read.value)}, {"sessionState", "ok"}};
    if (read.state == JsonFileState::Missing) return {{"session", nullptr}, {"sessionState", "missing"}};
    nlohmann::json recovery = {{"reason", read.reason}};
    if (const auto copy = QuarantineCopy(file)) recovery["quarantine"] = ToUtf8(copy->filename().wstring());
    nlohmann::json session = nullptr;
    for (int g = 1; g <= kSessionGenerations; ++g) {
        const auto backup = GenerationBackupFile(file, g);
        JsonFileRead b = ReadJsonFileChecked(backup, 1);
        if (b.state != JsonFileState::Ok || !IsUsableSession(b.value)) continue;
        session = std::move(b.value);
        recovery["backup"] = ToUtf8(backup.filename().wstring());
        recovery["backupSavedAt"] = FileWriteTimeMs(backup);
        break;
    }
    return {{"session", std::move(session)}, {"sessionState", "unreadable"}, {"sessionRecovery", std::move(recovery)}};
}

bool SaveSessionWithBackups(const std::filesystem::path& file, const std::string& text, bool& rotated) {
    const auto bak1 = GenerationBackupFile(file, 1);
    const long long now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
    const long long bak1At = FileWriteTimeMs(bak1);
    if (!rotated || bak1At == 0 || now - bak1At > kSessionBackupEveryMs) {
        // 壊れた・知らない形の session.json は控えに回さない（よい控えを押し出さない）
        const JsonFileRead current = ReadJsonFileChecked(file, 1);
        if (current.state == JsonFileState::Ok && IsUsableSession(current.value)) RotateGenerationBackups(file, kSessionGenerations);
        rotated = true;
    }
    return WriteFileAtomically(file, text);
}

bool WriteFileAtomically(const std::filesystem::path& path, const std::string& text) {
    std::error_code error;
    std::filesystem::create_directories(path.parent_path(), error);
    std::filesystem::path temp = path;
    temp += L".tmp";
    {
        std::ofstream out(temp, std::ios::binary | std::ios::trunc);
        out << text;
        if (!out) return false;
    }
    return MoveFileExW(temp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != FALSE;
}

std::string Base64(const std::vector<BYTE>& data) {
    if (data.empty()) return {};
    const DWORD flags = CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF;
    DWORD size = 0;
    CryptBinaryToStringA(data.data(), static_cast<DWORD>(data.size()), flags, nullptr, &size);
    std::string out(size, '\0');
    CryptBinaryToStringA(data.data(), static_cast<DWORD>(data.size()), flags, out.data(), &size);
    out.resize(size);
    return out;
}

bool SaveSecret(const std::filesystem::path& path, const std::string& secret) {
    DATA_BLOB plain{static_cast<DWORD>(secret.size()), reinterpret_cast<BYTE*>(const_cast<char*>(secret.data()))};
    DATA_BLOB sealed{};
    if (!CryptProtectData(&plain, L"Rocks-cells Browser", nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &sealed)) {
        return false;
    }
    const std::string bytes(reinterpret_cast<const char*>(sealed.pbData), sealed.cbData);
    LocalFree(sealed.pbData);
    return WriteFileAtomically(path, bytes);
}

std::string LoadSecret(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return {};
    std::string bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    DATA_BLOB sealed{static_cast<DWORD>(bytes.size()), reinterpret_cast<BYTE*>(bytes.data())};
    DATA_BLOB plain{};
    if (!CryptUnprotectData(&sealed, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &plain)) return {};
    std::string secret(reinterpret_cast<const char*>(plain.pbData), plain.cbData);
    SecureZeroMemory(plain.pbData, plain.cbData);
    LocalFree(plain.pbData);
    return secret;
}

std::optional<std::string> ReadTextFile(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

std::optional<std::string> ReadTextFileCapped(const std::filesystem::path& path, std::uintmax_t maxBytes, bool* tooLarge) {
    if (tooLarge) *tooLarge = false;
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    // 先に大きさを見る（大きいファイルを全部読まない）。書き足されている途中のこともあるので、読んだ量でもう一度見る
    std::error_code error;
    const std::uintmax_t size = std::filesystem::file_size(path, error);
    if (!error && size > maxBytes) {
        if (tooLarge) *tooLarge = true;
        return std::nullopt;
    }
    std::string text;
    char buffer[16384];
    while (in.read(buffer, sizeof(buffer)) || in.gcount() > 0) {
        text.append(buffer, static_cast<size_t>(in.gcount()));
        if (text.size() > maxBytes) {
            if (tooLarge) *tooLarge = true;
            return std::nullopt;
        }
    }
    if (in.bad()) return std::nullopt;
    return text;
}

std::string NewUuid() {
    GUID g{};
    CoCreateGuid(&g);
    char text[40];
    snprintf(text, sizeof(text), "%08lx-%04x-%04x-%02x%02x-%02x%02x%02x%02x%02x%02x", g.Data1, g.Data2, g.Data3,
             g.Data4[0], g.Data4[1], g.Data4[2], g.Data4[3], g.Data4[4], g.Data4[5], g.Data4[6], g.Data4[7]);
    return text;
}

std::string IsoNow() {
    SYSTEMTIME t{};
    GetSystemTime(&t);
    char text[32];
    snprintf(text, sizeof(text), "%04u-%02u-%02uT%02u:%02u:%02u.%03uZ", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute,
             t.wSecond, t.wMilliseconds);
    return text;
}

std::optional<std::filesystem::path> UiDataFile(const std::string& name) {
    static const std::regex pattern(R"(^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+){0,3}\.json$)");
    if (name.size() > 200 || !std::regex_match(name, pattern)) return std::nullopt;
    return AppDataFolder() / L"ui-data" / ToWide(name);
}

std::optional<std::filesystem::path> UiDataDir(const std::string& name) {
    static const std::regex pattern(R"(^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+){0,3}$)");
    if (name.size() > 200 || !std::regex_match(name, pattern)) return std::nullopt;
    return AppDataFolder() / L"ui-data" / ToWide(name);
}

std::filesystem::path VaultFolder() {
    return AppDataFolder() / L"ui-data" / L"vault";
}

std::optional<std::filesystem::path> VaultImageFile(const std::string& name) {
    static const std::regex pattern(R"(^vault/img/[A-Za-z0-9_-]{1,80}\.(png|webp|jpg)$)");
    if (name.size() > 120 || !std::regex_match(name, pattern)) return std::nullopt;
    return AppDataFolder() / L"ui-data" / ToWide(name);
}

std::optional<std::vector<BYTE>> FromBase64(const std::string& text) {
    if (text.empty() || text.size() > 0x7fffffff) return std::nullopt;
    DWORD size = 0;
    if (!CryptStringToBinaryA(text.data(), static_cast<DWORD>(text.size()), CRYPT_STRING_BASE64, nullptr, &size, nullptr, nullptr)) {
        return std::nullopt;
    }
    std::vector<BYTE> out(size);
    if (!CryptStringToBinaryA(text.data(), static_cast<DWORD>(text.size()), CRYPT_STRING_BASE64, out.data(), &size, nullptr, nullptr)) {
        return std::nullopt;
    }
    out.resize(size);
    return out;
}

std::uintmax_t FolderSize(const std::filesystem::path& dir, std::uintmax_t& files) {
    std::uintmax_t total = 0;
    files = 0;
    std::error_code error;
    for (auto it = std::filesystem::recursive_directory_iterator(dir, error); !error && it != std::filesystem::recursive_directory_iterator();
         it.increment(error)) {
        std::error_code sizeError;
        if (!it->is_regular_file(sizeError) || sizeError) continue;
        const std::uintmax_t size = it->file_size(sizeError);
        if (sizeError) continue;
        total += size;
        ++files;
    }
    return total;
}
