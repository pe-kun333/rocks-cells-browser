#pragma once

// 中央のページの録画（C6）。フレームの画素は DevTools の JPEG を渡す。
// Media Foundation のヘッダが無いビルドでは Available() が false で、書き出しはしない。
// Windows.Graphics.Capture は使わない（窓全体にはサイドバーも入るため）。
// 変数名に far / near / min / max / interface は使わない。

#include <cstdint>
#include <filesystem>
#include <vector>

namespace record {

constexpr int kLimitSeconds = 120;
constexpr int kFps = 10;
constexpr int kLongEdge = 1280;
constexpr std::uint64_t kMaxBytes = 80ull * 1024ull * 1024ull;
constexpr int kBitrate = 4000000;

enum class WriteResult { Ok, Full, Failed };

bool Available();

// mp4 を1本書く。Begin のあと WriteBgra、最後に Finalize。途中でやめるときは Abort（ファイルは消す）。
class Writer {
public:
    Writer();
    ~Writer();
    Writer(const Writer&) = delete;
    Writer& operator=(const Writer&) = delete;

    bool Begin(const std::filesystem::path& path);
    // elapsedMs は録画開始からの経過（サンプルの時刻に使う）。長い辺は 1,280、偶数の大きさに揃える。
    WriteResult WriteBgra(const std::uint8_t* pixels, int width, int height, int stride, int elapsedMs);
    bool Poster(std::vector<std::uint8_t>& jpeg) const;
    bool Finalize(std::uint64_t& bytes);
    void Abort();

    int frames() const;
    std::uint64_t estimatedBytes() const;

private:
    struct Impl;
    Impl* impl_ = nullptr;
};

// DevTools の JPEG を、隙間のない BGRA にする。失敗したら false。
bool DecodeJpeg(const std::uint8_t* bytes, std::size_t size, std::vector<std::uint8_t>& pixels, int& width, int& height);

}  // namespace record
