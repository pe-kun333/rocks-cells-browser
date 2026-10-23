// 見た目のテーマの、窓の枠の側（theme.h）

#include "theme.h"

#include <cstdio>

#include "storage.h"

namespace theme {

namespace {

std::filesystem::path ThemeFile() {
    return AppDataFolder() / L"theme.json";
}

// "#rrggbb" だけを受け取る
std::optional<COLORREF> ParseColor(const nlohmann::json& value) {
    if (!value.is_string()) return std::nullopt;
    const std::string text = value.get<std::string>();
    if (text.size() != 7 || text[0] != '#') return std::nullopt;
    unsigned int parts[3] = {};
    for (int i = 0; i < 3; ++i) {
        unsigned int v = 0;
        for (int j = 0; j < 2; ++j) {
            const char c = text[1 + i * 2 + j];
            v <<= 4;
            if (c >= '0' && c <= '9') v |= c - '0';
            else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10;
            else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10;
            else return std::nullopt;
        }
        parts[i] = v;
    }
    return RGB(parts[0], parts[1], parts[2]);
}

std::string ColorText(COLORREF color) {
    char text[8];
    snprintf(text, sizeof(text), "#%02x%02x%02x", GetRValue(color), GetGValue(color), GetBValue(color));
    return text;
}

// テーマの id は英小文字だけ（UI の themes.ts と同じ形。表示には使わない）
bool IsThemeId(const nlohmann::json& value) {
    if (!value.is_string()) return false;
    const std::string id = value.get<std::string>();
    if (id.empty() || id.size() > 32) return false;
    for (const char c : id) {
        if (c < 'a' || c > 'z') return false;
    }
    return true;
}

std::optional<Slot> ParseSlot(const nlohmann::json& data) {
    if (!data.is_object() || !IsThemeId(data.value("id", nlohmann::json()))) return std::nullopt;
    const std::string kind = data.value("kind", "");
    if (kind != "light" && kind != "dark" && kind != "hc") return std::nullopt;
    const auto bg = ParseColor(data.value("bg", nlohmann::json()));
    const auto tbBg = ParseColor(data.value("tbBg", nlohmann::json()));
    const auto tbText = ParseColor(data.value("tbText", nlohmann::json()));
    const auto border = ParseColor(data.value("border", nlohmann::json()));
    if (!bg || !tbBg || !tbText || !border) return std::nullopt;
    Slot slot;
    slot.id = data["id"].get<std::string>();
    slot.dark = kind == "dark";
    slot.bg = *bg;
    slot.tbBg = *tbBg;
    slot.tbText = *tbText;
    slot.border = *border;
    return slot;
}

nlohmann::json SlotJson(const Slot& slot) {
    return {{"id", slot.id},
            {"kind", slot.dark ? "dark" : "light"},
            {"bg", ColorText(slot.bg)},
            {"tbBg", ColorText(slot.tbBg)},
            {"tbText", ColorText(slot.tbText)},
            {"border", ColorText(slot.border)}};
}

HBRUSH g_brush = nullptr;

}  // namespace

std::optional<Theme> Parse(const nlohmann::json& data) {
    if (!data.is_object()) return std::nullopt;
    const std::string mode = data.value("mode", "");
    const std::string pages = data.value("pages", "");
    if ((mode != "auto" && mode != "fixed") || (pages != "theme" && pages != "os")) return std::nullopt;
    const auto light = ParseSlot(data.value("light", nlohmann::json()));
    const auto dark = ParseSlot(data.value("dark", nlohmann::json()));
    if (!light || !dark) return std::nullopt;
    Theme value;
    value.fixed = mode == "fixed";
    value.pagesFollow = pages == "theme";
    value.light = *light;
    value.dark = value.fixed ? *light : *dark;
    return value;
}

nlohmann::json ToJson(const Theme& value) {
    return {{"version", 1},
            {"mode", value.fixed ? "fixed" : "auto"},
            {"pages", value.pagesFollow ? "theme" : "os"},
            {"light", SlotJson(value.light)},
            {"dark", SlotJson(value.dark)}};
}

std::optional<Theme> Load() {
    const nlohmann::json data = ReadJsonFile(ThemeFile());
    if (!data.is_object() || data.value("version", 0) != 1) return std::nullopt;
    return Parse(data);
}

bool Save(const Theme& value) {
    const nlohmann::json next = ToJson(value);
    if (ReadJsonFile(ThemeFile()) == next) return true;  // 同じなら書かない
    return WriteFileAtomically(ThemeFile(), next.dump(2));
}

bool SystemPrefersDark() {
    DWORD light = 1;
    DWORD size = sizeof(light);
    const LSTATUS status = RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
                                        L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &light, &size);
    return status == ERROR_SUCCESS && light == 0;
}

const Slot& Pick(const Theme& value, bool osDark) {
    if (value.fixed) return value.light;
    return osDark ? value.dark : value.light;
}

void ApplyFrame(HWND hwnd, const Slot& slot) {
    // dwmapi はリンクせず、使うときに読む（apps.cpp の WindowCloaked と同じ形）
    using AttrFn = HRESULT(WINAPI*)(HWND, DWORD, const void*, DWORD);
    static const AttrFn fn = []() -> AttrFn {
        HMODULE library = GetModuleHandleW(L"dwmapi.dll");
        if (!library) library = LoadLibraryW(L"dwmapi.dll");
        if (!library) return nullptr;
        return reinterpret_cast<AttrFn>(GetProcAddress(library, "DwmSetWindowAttribute"));
    }();
    if (!fn || !hwnd) return;
    const BOOL dark = slot.dark ? TRUE : FALSE;
    fn(hwnd, 20, &dark, sizeof(dark));                   // DWMWA_USE_IMMERSIVE_DARK_MODE
    fn(hwnd, 35, &slot.tbBg, sizeof(slot.tbBg));         // DWMWA_CAPTION_COLOR（Windows 11 から。失敗は黙る）
    fn(hwnd, 36, &slot.tbText, sizeof(slot.tbText));     // DWMWA_TEXT_COLOR
    fn(hwnd, 34, &slot.border, sizeof(slot.border));     // DWMWA_BORDER_COLOR
    SetWindowPos(hwnd, nullptr, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
}

COREWEBVIEW2_PREFERRED_COLOR_SCHEME PageScheme(const Theme& value, const Slot& slot) {
    if (!value.fixed || !value.pagesFollow) return COREWEBVIEW2_PREFERRED_COLOR_SCHEME_AUTO;
    return slot.dark ? COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK : COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT;
}

COREWEBVIEW2_COLOR WebViewColor(COLORREF color) {
    return {255, GetRValue(color), GetGValue(color), GetBValue(color)};
}

HBRUSH BackgroundBrush() {
    return g_brush;
}

void SetBackground(COLORREF color) {
    HBRUSH next = CreateSolidBrush(color);
    if (!next) return;
    if (g_brush) DeleteObject(g_brush);
    g_brush = next;
}

}  // namespace theme
