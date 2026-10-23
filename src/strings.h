#pragma once

#include <windows.h>
#include <objbase.h>  // CoTaskMemFree

#include <string>
#include <string_view>

// Windows と WebView2 の文字列は UTF-16（wchar_t）、JSON ライブラリは UTF-8（char）。その相互変換
inline std::string ToUtf8(std::wstring_view text) {
    if (text.empty()) return {};
    const int length = static_cast<int>(text.size());
    const int size = WideCharToMultiByte(CP_UTF8, 0, text.data(), length, nullptr, 0, nullptr, nullptr);
    std::string out(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.data(), length, out.data(), size, nullptr, nullptr);
    return out;
}

inline std::wstring ToWide(std::string_view text) {
    if (text.empty()) return {};
    const int length = static_cast<int>(text.size());
    const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), length, nullptr, 0);
    std::wstring out(size, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), length, out.data(), size);
    return out;
}

// WebView2 から受け取る文字列（LPWSTR）は、使い終わったら CoTaskMemFree で返す決まり。
// その後片付けを自動でやってくれる入れ物
class CoString {
public:
    CoString() = default;
    CoString(const CoString&) = delete;
    CoString& operator=(const CoString&) = delete;
    ~CoString() { CoTaskMemFree(ptr_); }

    LPWSTR* put() { return &ptr_; }
    std::wstring str() const { return ptr_ ? ptr_ : L""; }

private:
    LPWSTR ptr_ = nullptr;
};
