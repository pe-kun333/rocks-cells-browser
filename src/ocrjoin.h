#pragma once

// 読み取った語のつなぎ方と、表の判定。Windows の型には依存しない。
// 日本語の OCR は一文字が一つの語になる。行の文字は、CJK どうしを空白なしでつなぎ、
// 英数字どうしのあいだだけ空白を入れる。
// 表は、語のあいだの小さな間隔では作らない。一定以上の大きな隙間で区切ったかたまりの
// 左端が、複数の行で揃っているときだけ、空ではないセルを ` | ` でつないだ行を足す。

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

namespace ocrjoin {

struct Glyph {
    std::wstring text;
    double left = 0;
    double top = 0;
    double width = 0;
    double height = 0;
    int row = 0;
};

struct TableHit {
    int row = 0;
    std::wstring text;
};

inline bool IsSpaceUnit(wchar_t ch) {
    const unsigned code = static_cast<unsigned>(ch);
    return code == static_cast<unsigned>(L' ') || code == static_cast<unsigned>(L'\t') || code == static_cast<unsigned>(L'\r') || code == static_cast<unsigned>(L'\n') || code == 0x3000 || code == 0x00A0;
}

// ASCII と全角の英数字。これ以外（ひらがな、漢字、記号）のあいだには空白を入れない。
inline bool IsAlnumUnit(wchar_t ch) {
    const unsigned code = static_cast<unsigned>(ch);
    if (code >= static_cast<unsigned>(L'0') && code <= static_cast<unsigned>(L'9')) return true;
    if (code >= static_cast<unsigned>(L'A') && code <= static_cast<unsigned>(L'Z')) return true;
    if (code >= static_cast<unsigned>(L'a') && code <= static_cast<unsigned>(L'z')) return true;
    if (code >= 0xFF10 && code <= 0xFF19) return true;
    if (code >= 0xFF21 && code <= 0xFF3A) return true;
    if (code >= 0xFF41 && code <= 0xFF5A) return true;
    return false;
}

inline double Wider(double a, double b) { return a > b ? a : b; }

inline double AbsDelta(double a, double b) {
    const double delta = a - b;
    return delta < 0 ? -delta : delta;
}

// 英数字のあいだ以外の空白を落とす。OcrLine::Text() が日本語のあいだに入れる空白を、語が無いときの予備に使う。
inline std::wstring TightenSpaces(const std::wstring& text) {
    std::wstring out;
    out.reserve(text.size());
    for (size_t index = 0; index < text.size(); ++index) {
        const wchar_t ch = text[index];
        if (!IsSpaceUnit(ch)) {
            out.push_back(ch);
            continue;
        }
        size_t next = index + 1;
        while (next < text.size() && IsSpaceUnit(text[next])) ++next;
        if (out.empty() || next >= text.size()) continue;
        if (IsAlnumUnit(out.back()) && IsAlnumUnit(text[next]) && !IsSpaceUnit(out.back())) out.push_back(L' ');
    }
    return out;
}

inline void AppendToken(std::wstring& dest, const std::wstring& token) {
    const std::wstring piece = TightenSpaces(token);
    if (piece.empty()) return;
    if (!dest.empty() && IsAlnumUnit(dest.back()) && IsAlnumUnit(piece.front())) dest.push_back(L' ');
    dest += piece;
}

inline std::wstring JoinTokens(const std::vector<std::wstring>& tokens) {
    std::wstring dest;
    for (const std::wstring& token : tokens) AppendToken(dest, token);
    return dest;
}

inline int DistinctRows(std::vector<int> rows) {
    std::sort(rows.begin(), rows.end());
    rows.erase(std::unique(rows.begin(), rows.end()), rows.end());
    return static_cast<int>(rows.size());
}

// 1枚ぶんの語から、表として足す行だけを返す。普通の文章は空。
inline std::vector<TableHit> TableHits(int rowCount, const std::vector<Glyph>& glyphs) {
    std::vector<TableHit> none;
    if (rowCount < 2 || glyphs.size() < 2) return none;

    std::vector<double> widths;
    widths.reserve(glyphs.size());
    for (const Glyph& glyph : glyphs) {
        if (glyph.width > 0 && std::isfinite(glyph.width)) widths.push_back(glyph.width);
    }
    if (widths.empty()) return none;
    std::sort(widths.begin(), widths.end());
    const double median = widths[widths.size() / 2];
    // 日本語の字間や、英単語のあいだ（おおよそ 0.3em）では割らない。2文字ぶん以上の溝だけ。
    const double splitGap = Wider(median * 2.0, 16.0);
    const double alignSlack = Wider(6.0, 0.45 * median);

    struct Cell {
        int row = 0;
        double left = 0;
        std::wstring text;
    };
    std::vector<std::vector<Cell>> perRow(static_cast<size_t>(rowCount));
    std::vector<std::vector<Glyph>> byRow(static_cast<size_t>(rowCount));
    for (const Glyph& glyph : glyphs) {
        if (glyph.row < 0 || glyph.row >= rowCount) continue;
        if (!std::isfinite(glyph.left) || !std::isfinite(glyph.width)) continue;
        Glyph copy = glyph;
        copy.text = TightenSpaces(glyph.text);
        if (copy.text.empty()) continue;
        if (!(copy.width > 0)) copy.width = 0;
        byRow[static_cast<size_t>(glyph.row)].push_back(std::move(copy));
    }

    for (int row = 0; row < rowCount; ++row) {
        std::vector<Glyph>& line = byRow[static_cast<size_t>(row)];
        std::stable_sort(line.begin(), line.end(), [](const Glyph& a, const Glyph& b) { return a.left < b.left; });
        Cell cell;
        bool open = false;
        double prevRight = 0;
        auto close = [&]() {
            if (!open) return;
            if (!cell.text.empty()) perRow[static_cast<size_t>(row)].push_back(std::move(cell));
            cell = Cell{};
            open = false;
        };
        for (const Glyph& glyph : line) {
            const double gap = open ? glyph.left - prevRight : 0;
            if (!open || gap >= splitGap) {
                close();
                cell.row = row;
                cell.left = glyph.left;
                cell.text.clear();
                AppendToken(cell.text, glyph.text);
                open = true;
            } else {
                AppendToken(cell.text, glyph.text);
            }
            prevRight = glyph.left + glyph.width;
        }
        close();
    }

    std::vector<Cell> candidates;
    for (int row = 0; row < rowCount; ++row) {
        if (perRow[static_cast<size_t>(row)].size() < 2) continue;
        for (const Cell& cell : perRow[static_cast<size_t>(row)]) candidates.push_back(cell);
    }
    if (candidates.size() < 2) return none;
    std::stable_sort(candidates.begin(), candidates.end(), [](const Cell& a, const Cell& b) { return a.left < b.left; });

    struct Bucket {
        double anchor = 0;
        std::vector<int> rows;
    };
    std::vector<Bucket> buckets;
    for (const Cell& cell : candidates) {
        if (!buckets.empty() && AbsDelta(cell.left, buckets.back().anchor) <= alignSlack) {
            buckets.back().rows.push_back(cell.row);
            continue;
        }
        buckets.push_back(Bucket{cell.left, {cell.row}});
    }
    std::vector<double> columns;
    for (const Bucket& bucket : buckets) {
        if (DistinctRows(bucket.rows) >= 2) columns.push_back(bucket.anchor);
    }
    if (columns.size() < 2) return none;

    auto columnOf = [&](double left) {
        int found = -1;
        double best = 0;
        for (int index = 0; index < static_cast<int>(columns.size()); ++index) {
            const double gap = AbsDelta(left, columns[static_cast<size_t>(index)]);
            if (gap <= alignSlack && (found < 0 || gap < best)) {
                found = index;
                best = gap;
            }
        }
        return found;
    };

    std::vector<TableHit> hits;
    int qualifiers = 0;
    std::vector<char> qualifies(static_cast<size_t>(rowCount), 0);
    for (int row = 0; row < rowCount; ++row) {
        if (perRow[static_cast<size_t>(row)].size() < 2) continue;
        std::vector<int> seen;
        for (const Cell& cell : perRow[static_cast<size_t>(row)]) {
            const int column = columnOf(cell.left);
            if (column < 0) continue;
            bool known = false;
            for (int item : seen) {
                if (item == column) known = true;
            }
            if (!known) seen.push_back(column);
        }
        if (seen.size() < 2) continue;
        qualifies[static_cast<size_t>(row)] = 1;
        ++qualifiers;
    }
    if (qualifiers < 2) return none;

    for (int row = 0; row < rowCount; ++row) {
        if (!qualifies[static_cast<size_t>(row)]) continue;
        std::wstring joined;
        bool any = false;
        for (const Cell& cell : perRow[static_cast<size_t>(row)]) {
            if (cell.text.empty()) continue;
            if (any) joined += L" | ";
            joined += cell.text;
            any = true;
        }
        if (!any || joined.empty()) continue;
        hits.push_back(TableHit{row, std::move(joined)});
    }
    return hits;
}

}  // namespace ocrjoin
