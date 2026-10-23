// Windows 11 の「ライブキャプション」の文字を読む
#include "livecaptions.h"

#include <windows.h>
#include <objbase.h>  // COM の interface などの定義（WIN32_LEAN_AND_MEAN では入らない）
#include <oleauto.h>  // SysAllocString・VariantInit
#include <shellapi.h>
#include <UIAutomation.h>
#include <wrl/client.h>

#include <filesystem>

#include "strings.h"

using Microsoft::WRL::ComPtr;
using nlohmann::json;

namespace livecaptions {
namespace {

ComPtr<IUIAutomation> automation;

std::filesystem::path ExePath() {
    wchar_t dir[MAX_PATH] = {};
    GetSystemDirectoryW(dir, MAX_PATH);
    return std::filesystem::path(dir) / L"LiveCaptions.exe";
}

// 字幕の文字が入っている部品（AutomationId が CaptionsTextBlock）の文字
std::wstring CaptionText(HWND window) {
    if (!automation &&
        FAILED(CoCreateInstance(__uuidof(CUIAutomation), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&automation)))) {
        return {};
    }
    ComPtr<IUIAutomationElement> root;
    if (FAILED(automation->ElementFromHandle(window, &root)) || !root) return {};
    VARIANT id;
    VariantInit(&id);
    id.vt = VT_BSTR;
    id.bstrVal = SysAllocString(L"CaptionsTextBlock");
    ComPtr<IUIAutomationCondition> condition;
    const HRESULT hr = automation->CreatePropertyCondition(UIA_AutomationIdPropertyId, id, &condition);
    VariantClear(&id);
    if (FAILED(hr)) return {};
    ComPtr<IUIAutomationElement> block;
    if (FAILED(root->FindFirst(TreeScope_Descendants, condition.Get(), &block)) || !block) return {};
    BSTR name = nullptr;
    if (FAILED(block->get_CurrentName(&name)) || !name) return {};
    std::wstring text(name, SysStringLen(name));
    SysFreeString(name);
    return text;
}

}  // namespace

json Read(bool start) {
    std::error_code error;
    const bool available = std::filesystem::exists(ExePath(), error);
    HWND window = FindWindowW(L"LiveCaptionsDesktopWindow", nullptr);
    if (!window && start && available) {
        // 開いていなければ起動する（最初は言語のダウンロードなどを Windows が尋ねる）
        ShellExecuteW(nullptr, L"open", ExePath().c_str(), nullptr, nullptr, SW_SHOWNOACTIVATE);
    }
    if (!window) return {{"available", available}, {"running", false}, {"text", ""}};
    return {{"available", true}, {"running", true}, {"text", ToUtf8(CaptionText(window))}};
}

}  // namespace livecaptions
