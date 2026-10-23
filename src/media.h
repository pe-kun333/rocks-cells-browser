// 自分の音声・動画のファイル：開くダイアログと、横に置いた字幕のファイル（.srt / .vtt）を読む
#pragma once

#include <windows.h>

#include <cstdint>
#include <string>

#include <nlohmann/json.hpp>

namespace media {

// 音声・動画のファイルを選んでもらう。やめたら空
std::wstring OpenDialog(HWND owner);

// 画像ファイルを選んでもらう（png・jpg・gif・webp・bmp など）。やめたら空
std::wstring OpenImageDialog(HWND owner);

// Grok の提案（patch.v1 などの JSON）のファイルを選んでもらう。やめたら空
std::wstring OpenJsonDialog(HWND owner);

// JSON のファイルを文字で読む（UTF-8・BOM あり・Shift_JIS）。大きすぎれば読まない
//   { ok, name（ファイルの名前）, text（UTF-8） } か { ok:false, error: "notFound" | "big" | "read" }
nlohmann::json ReadJsonText(const std::wstring& path, std::uintmax_t maxBytes);

// メディアのファイル（path）と同じ名前の字幕のファイルを探して読む
//   { ok, name（見つけたファイルの名前）, text（UTF-8） }。Shift_JIS の字幕も読める
nlohmann::json ReadSubtitle(const std::wstring& mediaPath);

}  // namespace media
