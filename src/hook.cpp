// webhook「そのまま送る」（依頼の小窓 v2・R11）。WinHTTP で中継の受け口へ POST する。宣言と決まりは hook.h
#include "hook.h"

#include <windows.h>
#include <winhttp.h>

#include "strings.h"

namespace hook {
namespace {

constexpr int kTimeoutMs = 15000;  // 名前を引く・つなぐ・送る・答えを待つ、それぞれ 15 秒まで
constexpr size_t kMaxUrl = 2048;
constexpr size_t kMaxKey = 1024;

// WinHTTP の取っ手を閉じ忘れない入れ物
class Handle {
public:
    explicit Handle(HINTERNET handle) : handle_(handle) {}
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    ~Handle() {
        if (handle_) WinHttpCloseHandle(handle_);
    }
    HINTERNET get() const { return handle_; }

private:
    HINTERNET handle_;
};

// URL をホスト・番号・パス（? の後ろも）に分ける。https でない・ホストが無い・ユーザー名やパスワード入りなら false
bool Crack(const std::string& url, std::wstring& host, INTERNET_PORT& port, std::wstring& path) {
    if (url.empty() || url.size() > kMaxUrl || url.rfind("https://", 0) != 0) return false;
    const std::wstring wide = ToWide(url);
    wchar_t hostBuf[256] = {};
    wchar_t userBuf[256] = {};
    wchar_t passBuf[256] = {};
    wchar_t pathBuf[kMaxUrl + 1] = {};
    wchar_t extraBuf[kMaxUrl + 1] = {};
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof(parts);
    parts.lpszHostName = hostBuf;
    parts.dwHostNameLength = ARRAYSIZE(hostBuf);
    parts.lpszUserName = userBuf;
    parts.dwUserNameLength = ARRAYSIZE(userBuf);
    parts.lpszPassword = passBuf;
    parts.dwPasswordLength = ARRAYSIZE(passBuf);
    parts.lpszUrlPath = pathBuf;
    parts.dwUrlPathLength = ARRAYSIZE(pathBuf);
    parts.lpszExtraInfo = extraBuf;
    parts.dwExtraInfoLength = ARRAYSIZE(extraBuf);
    const BOOL cracked = WinHttpCrackUrl(wide.c_str(), static_cast<DWORD>(wide.size()), 0, &parts);
    SecureZeroMemory(passBuf, sizeof(passBuf));
    if (!cracked) return false;
    if (parts.nScheme != INTERNET_SCHEME_HTTPS || parts.dwHostNameLength == 0) return false;
    if (parts.dwUserNameLength != 0 || parts.dwPasswordLength != 0) return false;
    host.assign(parts.lpszHostName, parts.dwHostNameLength);
    port = parts.nPort;
    path.assign(parts.lpszUrlPath, parts.dwUrlPathLength);
    path.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);
    if (path.empty()) path = L"/";
    return true;
}

// つながらなかったわけの名前（値は出さない）
std::string FailureName(DWORD error) {
    if (error == ERROR_WINHTTP_TIMEOUT) return "timeout";
    if (error == ERROR_WINHTTP_SECURE_FAILURE) return "tls";
    return "connect";
}

}  // namespace

bool IsHttpsUrl(const std::string& url) {
    std::wstring host;
    std::wstring path;
    INTERNET_PORT port = 0;
    return Crack(url, host, port, path);
}

bool IsKeyText(const std::string& key) {
    if (key.empty() || key.size() > kMaxKey) return false;
    for (const char ch : key) {
        const unsigned char c = static_cast<unsigned char>(ch);
        if (c <= 0x20 || c >= 0x7f) return false;
    }
    return true;
}

Result Post(const std::string& url, const std::string& key, const std::string& body, const std::string& agentId) {
    Result result;
    std::wstring host;
    std::wstring path;
    INTERNET_PORT port = 0;
    if (!IsKeyText(key) || !Crack(url, host, port, path)) {
        result.error = "badUrl";
        return result;
    }
    Handle session(WinHttpOpen(L"RocksCellsBrowser/1", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session.get()) {
        result.error = "connect";
        return result;
    }
    WinHttpSetTimeouts(session.get(), kTimeoutMs, kTimeoutMs, kTimeoutMs, kTimeoutMs);
    DWORD redirect = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;  // 別のホストへ鍵を渡さない
    WinHttpSetOption(session.get(), WINHTTP_OPTION_REDIRECT_POLICY, &redirect, sizeof(redirect));
    Handle connect(WinHttpConnect(session.get(), host.c_str(), port, 0));
    if (!connect.get()) {
        result.error = FailureName(GetLastError());
        return result;
    }
    Handle request(WinHttpOpenRequest(connect.get(), L"POST", path.c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE));
    if (!request.get()) {
        result.error = FailureName(GetLastError());
        return result;
    }
    std::wstring headers = L"Content-Type: application/json; charset=utf-8\r\nAuthorization: Bearer " + ToWide(key) + L"\r\n";
    if (!agentId.empty()) headers += L"X-RocksCells-Agent: " + ToWide(agentId) + L"\r\n";
    const DWORD size = static_cast<DWORD>(body.size());
    const BOOL sent = WinHttpSendRequest(request.get(), headers.c_str(), static_cast<DWORD>(-1L), const_cast<char*>(body.data()), size, size, 0);
    const DWORD sendError = sent ? 0 : GetLastError();
    SecureZeroMemory(headers.data(), headers.size() * sizeof(wchar_t));  // 鍵の入った見出しは使い終わったら消す
    if (!sent) {
        result.error = FailureName(sendError);
        return result;
    }
    if (!WinHttpReceiveResponse(request.get(), nullptr)) {
        result.error = FailureName(GetLastError());
        return result;
    }
    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    if (WinHttpQueryHeaders(request.get(), WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &statusSize, WINHTTP_NO_HEADER_INDEX)) {
        result.status = static_cast<int>(status);
    }
    result.ok = result.status >= 200 && result.status < 300;
    if (!result.ok) result.error = "http";
    return result;
}

}  // namespace hook
