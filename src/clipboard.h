// Windows のクリップボード（文字と HTML・画像）の読み書き
//   HTML は「HTML Format」（CF_HTML）。六角メモはマスの中身をこの HTML に埋め込むので、
//   ここで読み書きすると、六角メモとのあいだでマスを並びごとコピー・貼り付けできる
//   画像を書くのは、六角スクショを Grok Bot のチャットに貼るとき（第3段 S3.12）
//   画像を読むのは、盤面のセルへ「画像を貼る」とき。UI の CSP では data: の fetch が通らず、
//   WebView2 の navigator.clipboard も画像を返せないことがあるので、ここで読む
//   noHistory：Windows のクリップボード履歴（Win+V）と、ほかの端末への同期に入れない印を同じ Open の中で一緒に置く
//   （依頼の小窓 v2・R2・D6。Grok Bot への依頼とその画像だけ。印を見て外すのは Windows で、ここは印を置くだけ）
//   画像と文を一つの貼り付けで（依頼の小窓 v2・R7d・D16。試し）：WriteImageWithText が、画像と文を同じ Open で置く。
//   貼る側のアプリが HTML の画像を受けるかは、ここからは分からない（受けなければ文だけが貼られる）
#pragma once

#include <windows.h>

#include <cstdint>
#include <string>
#include <vector>

namespace clipboard {

struct Content {
    std::string text;  // UTF-8
    std::string html;  // HTML Format の中身（見出し行も含めたまま。UTF-8）
};

Content Read(HWND owner);
bool Write(HWND owner, const std::string& text, const std::string& html, bool noHistory);

// 画像の透明な所の塗り方（貼った先のアプリが透明を黒く出すことがあるので、既定は白で塗る）
enum class ImageFill { White, Dark, None };

// 画像（PNG。WIC が読める形なら webp なども）をクリップボードに入れる。
//   CF_DIBV5（32 ビット・アルファつき）と、登録した形式「PNG」の両方を書く（どちらを読むかは貼る側のアプリが決める）。
//   fill が White・Dark なら、透明な所をその色で塗って不透明にしてから書く。読めない・書けないときは false
bool WriteImage(HWND owner, const std::vector<uint8_t>& image, ImageFill fill, bool noHistory);

// 画像と文を一つの貼り付けで（R7d）：WriteImage の CF_DIBV5・PNG に、同じ Open で CF_UNICODETEXT（text。文だけ）と
//   HTML Format（html の断片の頭に、書く PNG を data: の <img> にして置く）も書く。CF_HTML の画像は、PNG・CF_DIBV5 と同じ画素（塗ったあと）。
//   html は文の断片（画像は入れずに渡す。空なら文の断片なし）。noHistory の印は 4 つの形式のどれにも効く（同じ Open に置く）
bool WriteImageWithText(HWND owner, const std::vector<uint8_t>& image, ImageFill fill, const std::string& text, const std::string& html, bool noHistory);

// クリップボードに画像があるか（PNG・CF_DIBV5・CF_DIB・CF_BITMAP）。中身は読まない
bool HasImage();

// クリップボードの画像を、長い辺 1600px までの JPEG にする（UI のスレッドから。COM は main.cpp で初期化してある）
//   error は "empty"（画像が無い）・"missing"（ファイルが無い）・"type"（画像の拡張子ではない）・
//   "decode"（読めない）・"big"（渡せない大きさ）・nullptr（jpeg に中身がある）
struct ImageRead {
    std::vector<BYTE> jpeg;
    const char* error = nullptr;
};

ImageRead ReadImage(HWND owner);

// 画像ファイルを、長い辺 edge px までの JPEG にする（セルの縮図。0 なら 1600）。UI のスレッドから
ImageRead ReadImageFile(const std::wstring& path, UINT edge);

}  // namespace clipboard
