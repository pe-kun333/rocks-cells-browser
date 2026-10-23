// Windows 11 の「ライブキャプション」（パソコンで流れている音声を、パソコンの中で文字にする機能）の文字を読む
//   ライブキャプションの窓の文字を、アクセシビリティの仕組み（UI オートメーション）で読むだけ。音声には触れない
#pragma once

#include <nlohmann/json.hpp>

namespace livecaptions {

// { available（この Windows にあるか）, running（窓が開いているか）, text（いま出ている文字） }
// start が true で開いていなければ、ライブキャプションを起動する
nlohmann::json Read(bool start);

}  // namespace livecaptions
