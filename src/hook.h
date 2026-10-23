#pragma once

// webhook「そのまま送る」（依頼の小窓 v2）。中継の受け口（各自で用意する）へ、依頼の JSON を HTTPS で POST する。
//   宛先の URL と鍵は DPAPI の bot-hook.bin（読み書きは browser.cpp）。ここは渡された値で 1 回送るだけで、値を覚えない・書き出さない・ログに出さない。
//   Post は UI スレッドから呼ばない（WinHTTP の同期の呼び出しで待つ）。browser.cpp が別スレッドで呼び、kHookMessage で UI スレッドへ戻す。
//   リダイレクトは追わない（鍵を別のホストへ渡さない）。返事の本文は読まない（状態の番号だけ）

#include <string>

namespace hook {

// 送った結果。error：badUrl（URL か鍵の形が違う）・timeout（15 秒で答えが無い）・tls（証明書など）・connect（つながらない）・http（2xx でない）
struct Result {
    bool ok = false;
    int status = 0;  // HTTP の状態の番号（つながらなければ 0）
    std::string error;
};

// https の URL か（https:// で始まり、ホストがあり、2048 字まで。ユーザー名・パスワード入りは断る）
bool IsHttpsUrl(const std::string& url);

// 鍵の形（1〜1024 字、空白と改行の無い見える ASCII だけ。Authorization の見出しに入れるので）
bool IsKeyText(const std::string& key);

// POST する。body は依頼の JSON（UTF-8）。見出しは Content-Type・Authorization: Bearer <key>・X-RocksCells-Agent（agentId があるとき）。
//   待つのは段ごとに 15 秒まで
Result Post(const std::string& url, const std::string& key, const std::string& body, const std::string& agentId);

}  // namespace hook
