#pragma once

// 文字の読み取り（C7）。Windows.Media.Ocr。クラウドには出さない。
// ヘッダが無いビルドでは Available() が false。UI は「文字を読む」を出さない。
// Read は UI スレッドから呼ばない。中で別スレッドのアパートメントを初期化し、RecognizeAsync().get() で待つ。
// 型は winrt::Windows::Media::Ocr（C++/WinRT）。ABI の ::Windows:: とは混ぜない。
// 変数名に far / near / min / max / interface は使わない。

#include <cstdint>
#include <string>
#include <vector>

namespace ocr {

bool Available();

struct Line {
    std::string text;
    double x = 0;  // 画像の幅に対する割合（0〜1）
    double y = 0;
    double w = 0;
    double h = 0;
    bool table = false;  // 揃った表の行を `|` でつないだ追加の行
    int at = -1;         // 0 以上なら録画のミリ秒。-1 は静止画
};

enum class Failure { None, Unavailable, NoJapanese, Decode, Engine };

struct Outcome {
    Failure failure = Failure::Unavailable;
    std::vector<Line> lines;
};

// failure が None のときは nullptr
const char* FailureName(Failure failure);

// jpeg はカードの JPEG。videoPath が空でなければ、times（ミリ秒、最大20）のフレームを読む。
// 動画を開けないときは jpeg を、times の先頭の時刻として読む。
// 日本語の認識データが無いときは NoJapanese（行は空。呼び出し側は台帳を消さない）。
Outcome Read(const std::vector<std::uint8_t>& jpeg, const std::wstring& videoPath, const std::vector<int>& times);

}  // namespace ocr
