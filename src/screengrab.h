#pragma once

#include <windows.h>

#include <vector>

// ブラウザの窓、またはその窓があるモニタを、1枚の JPEG にする（C5）。
//   error は "hidden"（窓が見えていない）か "grab"（撮れなかった）か "tooBig"（渡せない大きさ）か nullptr。
//   graphicsCapture は Windows.Graphics.Capture で撮れたとき true（OS の黄色い枠が出る）。
//   失敗して画面のコピー（BitBlt）に落ちたとき、または最初からそちらで撮ったときは false。
// 録画（C6）は、ここを繰り返し呼ぶのではなく、同じ API でセッションを持ち直す。ここは1枚でプールを閉じる。
struct ScreenGrab {
    std::vector<BYTE> jpeg;
    const char* error = nullptr;
    bool graphicsCapture = false;
};

// desktop が true なら、hwnd があるモニタ1面。false なら hwnd の窓。
// 最小化・見えない・小さすぎる窓は、desktop でなければ error "hidden"（画像は空。黒い画素では判断しない）。
ScreenGrab GrabBrowser(HWND hwnd, bool desktop);
