# Rocks-cells Browser Ver0.04β

> バージョン / Version: **Ver0.04β** (0.0.4, beta / プレリリース). 版の情報は `version.json` 1か所で管理しています / single source: `version.json`.

> 変更点 / Changes: [CHANGELOG.md](CHANGELOG.md)

タブを六角形のハニカム（蜂の巣）に並べる Windows 用ブラウザです。メモ・シート・キャプチャ・単語帳・AI の相棒（Anthropic Claude、任意）などを備え、六角メモ（hex-memo）の Web 版を内蔵しています。

A Windows browser that arranges tabs on a hexagonal honeycomb, with memos, sheets, screen capture, vocabulary cards, an optional AI companion (Anthropic Claude, bring your own key), and a built-in copy of hex-memo (web version).

詳しい機能メモ（日本語・開発時のもの）: [docs/FEATURES.ja.md](docs/FEATURES.ja.md)

## 動かす / Run（はじめての方へ）

1. GitHub の Releases から `RocksCellsBrowser-Ver0.04beta-portable.zip` をダウンロードします。
2. zip を**右クリック →「すべて展開」**で、好きなフォルダに展開します（zip を開いたままの中からは起動しないでください）。
3. 展開したフォルダの **`RocksCellsBrowser.exe` をダブルクリック**します（`Rocks-cells Browser.bat` でも同じです）。インストールは不要で、Node.js やサーバーも要りません（六角メモも中に入っています）。
4. 初回だけ青い「Windows によって PC が保護されました」が出たら、「詳細情報」→「実行」を押します（下の SmartScreen について）。
5. よく使うなら、`RocksCellsBrowser.exe` を右クリック →「スタートにピン留めする」か「ショートカットの作成」で、デスクトップやタスクバーに置けます。

`ui\` と `hexmemo\` のフォルダは exe と同じ場所に置いたままにしてください（exe だけを別の場所に移すと画面が出ません）。

**必要なもの / Requirements**

- Windows 10 / 11（64 ビット）
- **Microsoft Edge WebView2 ランタイム**：Windows 11 と、更新済みの Windows 10 には入っています。無いときは起動時に「WebView2 ランタイムが必要です。入手先を開きますか？」と聞かれます →「はい」で開く [WebView2 ランタイム（Microsoft）](https://developer.microsoft.com/microsoft-edge/webview2/) の「Evergreen Bootstrapper」を入れて、もう一度起動してください。
- Visual C++ ランタイム：exe に組み込んであるので、別に入れる必要はありません（Ver0.031β から）。

Quick start: download the portable zip from Releases, **extract it** (right-click → Extract All), then **double-click `RocksCellsBrowser.exe`**. Keep the `ui\` and `hexmemo\` folders next to the exe. Requires Windows 10/11 x64 and the Microsoft Edge WebView2 Runtime (preinstalled on Windows 11; if it is missing, the app offers to open the download page). The Visual C++ runtime is built into the exe.

- 内蔵の六角メモ: 左サイドバーのシートのメニュー →「六角メモを開く」、またはアドレス欄に `https://hexmemo.local/`。exe の横の `hexmemo\` フォルダを WebView2 が仮想ホストとして見せるので、Node.js やサーバーは不要です。

**SmartScreen について / Unsigned build:** この exe はコード署名されていません。初回起動時に Windows SmartScreen が「Windows によって PC が保護されました」と表示することがあります。「詳細情報」→「実行」で起動できます。気になる場合はソースから自分でビルドしてください。
This executable is not code-signed, so Windows SmartScreen may warn on first launch ("More info" → "Run anyway"). You can always build it yourself from source.

## ビルド / Build

必要: Visual Studio 2022 (C++ デスクトップ開発、Windows SDK)、Node.js 18+。

hex-memo は別のリポジトリです。このフォルダの **隣に `hex-memo` という名前のフォルダ** として clone してください（リポジトリ名が違っても、フォルダ名は `hex-memo` にします。別の場所に置くなら下の `-DHEXMEMO_WEB_DIR`）。
hex-memo is a separate repository: clone it next to this folder as `hex-memo` (whatever the repository is called), or point CMake at it with `-DHEXMEMO_WEB_DIR`.

```powershell
# hex-memo をこのフォルダの隣に clone して、Web 版を作る（build.ps1 でも同じことを自動で行います）
git clone <hex-memo のリポジトリの URL> ..\hex-memo
cd ..\hex-memo; npm.cmd ci; npm.cmd run build:web; cd ..\rocks-cells-browser
# UI と exe（Release）。build\Release\ に exe・ui\・hexmemo\ ができます
powershell -ExecutionPolicy Bypass -File .\build.ps1 -Release -NoRun
```

- UI だけ: `cd ui; npm.cmd ci; npm.cmd run build; npm.cmd test`
- hex-memo の場所を変える: `cmake --preset x64 -DHEXMEMO_WEB_DIR=<path\to\dist-web>`
- 依存（WebView2 SDK, nlohmann/json）は CMake の FetchContent が初回に自動で取得します。

## 任意の Grok Bot 連携 / Optional bot features (off by default)

開発者個人の環境（Grok Bot アプリ・中継フォルダ）向けの機能 —— 右下のボットの巣（bot dock / nest）・受け取り箱（bot inbox, `%LOCALAPPDATA%\RocksCellsRelay`）・「Grok に送る」・「🔍 Grok に調べてもらう」（右クリック / Ctrl+Shift+G）・Grok 用の書き出し / 提案ファイルの取り込み —— は、既定ではオフで画面にも出ません。使う場合は次のようにビルドします。

```powershell
$env:VITE_ROCKSCELLS_BOTS = '1'
cmake --preset x64 -DROCKSCELLS_BOT_FEATURES=ON
powershell -ExecutionPolicy Bypass -File .\build.ps1 -Release -NoRun
```

## データとプライバシー / Data & privacy

- すべてのデータ（タブ・メモ・Cookie・設定）は `%LOCALAPPDATA%\RocksCellsBrowser\` に保存されます（環境変数 `ROCKSCELLS_DATA_DIR` で変更可）。外部へのテレメトリ送信はありません。
- **API キー**: AI の相棒を使う場合のみ、ご自身の Anthropic API キーを入力します。キーは Windows DPAPI で暗号化され `%LOCALAPPDATA%\RocksCellsBrowser\ai-key.bin` に保存されます（同じ Windows ユーザーでしか復号できません）。キーと、AI に頼んだ内容（選んだ文・ページの本文・画像など）は **Anthropic の API (api.anthropic.com) にだけ**送られます。キーを入れなければ AI 機能は何も送信しません。
- All data stays in `%LOCALAPPDATA%\RocksCellsBrowser\`. No telemetry. Your Anthropic API key (optional) is encrypted with Windows DPAPI in `ai-key.bin` and is sent only to api.anthropic.com together with the content you explicitly ask the AI about.
- 内蔵の六角メモのデータは WebView2 の保存領域（`https://hexmemo.local` のオリジン）に残ります。デスクトップ版 hex-memo (`%APPDATA%\hex-memo`) とは別です。

## 貢献 / Contributing

- [CONTRIBUTING.md](CONTRIBUTING.md)

## ライセンス / License

MIT — [LICENSE](LICENSE)。第三者コンポーネント: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)