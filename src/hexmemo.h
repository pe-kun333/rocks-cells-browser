#pragma once

#include <string>

#include <nlohmann/json.hpp>

// 六角メモ（hex-memo）との連携
//   ・六角メモのファイルは読むだけ（メモアプリとノートの一覧）
//   ・送るときは、六角メモの「受け取り口」（データフォルダの inbox/）に置いて合図するだけ。
//     取り込むのは六角メモ自身（六角メモの「コピーして送る」と同じ約束）
namespace hexmemo {

// メモアプリとノートの一覧。{ available, canSignal, apps: [{ id, name, status, boards: [{ id, name, parentId }] }] }
nlohmann::json Catalog();

// ノートの原点の下の階層へ、メモ（records）を送る。{ ok, id, status, signaled } か { ok: false, error }
// offsets：マスどうしの並び（{dq, dr} の配列。records と同じ数）。形を保って置いてもらうときだけ。合わなければ使わない
nlohmann::json Send(const nlohmann::json& appId, const std::string& boardId, const nlohmann::json& records,
                    const nlohmann::json& offsets);

// 送ったものの様子。{ state: done | taking | waiting | gone, result?, reason? }
nlohmann::json Check(const nlohmann::json& appId, const std::string& id);

// ノートのメモをすべて読む（読むだけ。下の階層・未配置の棚も含む。AI の記憶のノート用）
//   { ok, memos: [{ id?, text, createdAt, tags }], truncated } か { ok: false, error }
nlohmann::json ReadBoard(const nlohmann::json& appId, const std::string& boardId);

}  // namespace hexmemo
