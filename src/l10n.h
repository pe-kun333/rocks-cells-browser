#pragma once

// C++ 側の画面の言葉（英語版 E4。計画書 docs/plan-i18n-en.md）
//   ・鍵は日本語の文そのもの。英語の表（l10n.cpp）に無い文は、日本語のまま出す（壊れない）
//   ・言語は起動したときに 1 回だけ決める（Init）。決め方：UI の honeycomb.lang（UI が setLang で送り、
//     データフォルダの lang.txt に残す）＞ 自動なら Windows の表示言語（日本語なら ja、ほかは en）
//   ・UI の言語と同じく、切り替えは次に起動したときから

#include <string>
#include <string_view>

namespace l10n {

// 起動したときに 1 回（窓を作る前）。lang.txt を読み、言語を決める
void Init();
// 英語で出すか（Init の前は false = 日本語）
bool English();
// UI から届いた設定（"auto" | "ja" | "en"）を lang.txt に残す。今の言語は変えない（次の起動から）
void SavePref(const std::string& pref);

// 日本語の文 → 今の言語の文（英語の表に無ければ、渡した文のまま）。返す文字列は静的な表か、渡したもの
const wchar_t* Tr(const wchar_t* ja);
// UTF-8 の文（UI へ送る JSON 用）
std::string TrU8(std::string_view ja);

}  // namespace l10n
