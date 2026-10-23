#pragma once

// 見た目のテーマの、窓の枠の側（計画書 docs/plan-themes.md の T4）。
//   左の UI が setTheme で送る色を theme.json（データフォルダ）に残し、次の起動では窓を作る前に読む（最初の一瞬から、その色の窓）。
//   ここで扱うのは、窓の地（WM_ERASEBKGND）・題名バーと枠（DWM）・面を作るときの地の色・ページの明暗（PreferredColorScheme）の値だけ。
//   theme.json が無い・読めない・形が違うときは、今までどおりの白い既定（DWM も触らない）

#include <windows.h>
#include <wrl.h>  // WebView2.h の前に COM の宣言（browser.h と同じ順）

#include <optional>
#include <string>

#include <nlohmann/json.hpp>

#include "WebView2.h"

namespace theme {

// 1 つのテーマの、窓に使う色
struct Slot {
    std::string id;
    bool dark = false;  // 暗いテーマ（DWM の暗い枠）。明るい・線の濃い明るい（hc）は false
    COLORREF bg = RGB(255, 255, 255);
    COLORREF tbBg = RGB(255, 255, 255);
    COLORREF tbText = RGB(0, 0, 0);
    COLORREF border = RGB(200, 200, 200);
};

struct Theme {
    bool fixed = false;         // いつも同じテーマ（false は自動：Windows の明暗で light と dark を選ぶ）
    bool pagesFollow = true;    // いつも同じテーマのとき、ページ（タブ）の明暗もテーマに合わせる
    Slot light;
    Slot dark;                  // いつも同じテーマのときは light と同じ
};

// setTheme の中身・theme.json を読む。形が違えば nullopt（色は #rrggbb だけ受け取る）
std::optional<Theme> Parse(const nlohmann::json& data);
nlohmann::json ToJson(const Theme& value);

// theme.json を読む・書く（書くのは中身が変わったときだけ）
std::optional<Theme> Load();
bool Save(const Theme& value);

// Windows のアプリの明暗（HKCU の AppsUseLightTheme が 0 なら暗い）。読めなければ明るい
bool SystemPrefersDark();

// 今使う組：自動なら Windows の明暗で、いつも同じなら light
const Slot& Pick(const Theme& value, bool osDark);

// 題名バーと枠（DWM の属性 20 暗い枠・35 題名バーの色・36 題名の字・34 枠の線）。
//   35・36・34 は Windows 11 から。効かない Windows では結果を見て黙る。替えたあとは枠を描き直す
void ApplyFrame(HWND hwnd, const Slot& slot);

// ページの明暗：自動のときと「ページは Windows に従う」のときは AUTO、いつも同じテーマで合わせるときはそのテーマの明暗
COREWEBVIEW2_PREFERRED_COLOR_SCHEME PageScheme(const Theme& value, const Slot& slot);

// WebView2 の地の色（不透明）
COREWEBVIEW2_COLOR WebViewColor(COLORREF color);

// 窓の地を塗る筆（本体と小窓の WM_ERASEBKGND）。テーマが無ければ nullptr（窓の種類の白のまま）
HBRUSH BackgroundBrush();
void SetBackground(COLORREF color);

}  // namespace theme
