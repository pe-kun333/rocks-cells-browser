# 変更点 / CHANGELOG

## Ver0.031β-en（2026-11-01）

### 新しくできること

- **英語の画面**：Windows の表示言語が日本語以外なら、はじめから英語で動きます（日本語なら日本語）。見た目（テーマ）の小窓の「言語 / Language」で、日本語・English・自動を選べます（次の起動から全体に効きます）。
  - メニュー・ボタン・知らせ・設定の文など、画面の文の大半（約 3,800 件）を英語にしました。exe 側の文（右クリックのメニュー・小窓の題・WebView2 ランタイムの案内など）も英語になります。
  - 英語の表に無い文は、日本語のまま出ます。AI への指示の文（プロンプト）と、保存するデータの文字（つながりの種類・スタンプの名前など）は、この版では日本語のままです（AI の指示の英語は次の版で）。

### 変わったこと

- exe の版の番号を 0.0.31.1 にしました（Ver0.031β と同じ機能に、英語の画面を足した版）。

### New

- **English UI**: when the Windows display language is not Japanese, the app starts in English (Japanese Windows stays Japanese). Switch in the appearance (theme) popup → "Language": 日本語 / English / Auto (applies fully after restarting the app).
  - Most UI text (about 3,800 strings: menus, buttons, notices, settings) is translated. Text from the exe (context menus, mini window titles, the WebView2 Runtime prompt) is also in English.
  - Text not yet in the English table falls back to Japanese. AI prompts and stored data labels (link kinds, stamp names, etc.) stay Japanese in this version (English AI prompts are planned for the next version).

### Changed

- The exe version is 0.0.31.1 (Ver0.031β plus the English UI).

## Ver0.031β（2026-11-01）

### 新しくできること

- **コメントカードの「型」（テンプレート）**：下のメモの区画で選んだカードを「型にする…」で登録し、「型を貼る ▾」や型の窓（`/` キーでも開く）から、いつでも同じ並びのカードを貼れます。
  - 型の窓：検索・フォルダ・サムネイル・矢印キーで選ぶ・名前の変更・削除・窓の行をつまんでカードの区画へドラッグして貼る。貼る前に、入る場所を点線で見せます。
  - 型のモード：そのまま／骨組み（題の 1 行だけ）／穴あき（`{{空欄}}` を貼る前の小窓で埋める）。内蔵サンプルと「初期サンプルを復元」つき。
  - 型の書き出し・読み込み（JSON ファイル）。300 枚を超える貼り付けは、全体を断ります。
- **シートへの入口の小窓で、メモを書ける**：入口を押して出る小窓の中の空いたセルを右クリック →「メモを書く」で、入口先のシートにメモのセルを作れます。
- **Grok Cards の枠とボード**：右の Grok Cards の枠を、公開版でも出すようにしました（Grok を設定していなくても、カードを並べる場所として使えます）。
  - ボード：カードを自由に置ける板。Ctrl+Enter で選んだカードの右、Shift+Enter で下に足す。矢印キーで見る場所を動かし、Enter で［＋カード］。
  - カードを上に出す・メモの切り替え。
- **六角で見る（動画の区間セル）**：YouTube などの動画を、区間ごとのマスで読む機能を大きく広げました。
  - 読む画面の一行の欄から、マスやカードに書く・カードと結ぶ。カードの「▶ 時刻」で、その場面へ。
  - 区間を複数選んでくり返す（回し方・回数・休みと秒読み・速さの段上げ）。名前つきの組として 20 まで保存。
  - 再生に合わせて光る、時刻順の一覧、900 マスの知らせ、全体の地図、YouTube のコメント用に写す。
  - AI（Claude。自分の API キーを ⚙ で設定したときだけ）による区間の分析と AI のカード、料金の目安、右の相棒とのやり取りの型（ツッコんでみる・続きを当てる・問いでふりかえる 等）と「📌 カードへ」。
- **コメントカードのキーボード操作**：Shift+Enter で次の行の 1 列目に足す、＋コメントの「次の行に」、書く欄が空のとき ↑↓ でカードの区画を上下に流す。
- 新しいメモに、直前に開いていたメモの呼称セットを付けます。

### 変わったこと

- 「提案・取り込みファイルを開く…」と同じファイル選びを、下のメモの区画からも使えるようにしました。
- コメントカードの区画で、一番下のカードの下に空きが見えるところまでスクロールできます。
- 字数の上限を超えた材料は、落とさず印を外して残します。
- README の最初に、はじめての起動の手順（zip を展開して `RocksCellsBrowser.exe` をダブルクリック）と、必要なもの（WebView2 ランタイム）を書きました。
- Visual C++ ランタイムを exe に組み込みました。vc_redist（Visual C++ 再頒布可能パッケージ）を入れていない PC でも起動します。
- WebView2 ランタイムが無い PC では、起動時に「WebView2 ランタイムが必要です。入手先を開きますか？」と聞き、「はい」で Microsoft のページを開きます。

### 公開版で既定オフのもの

- Grok Bot とつなぐ機能（Grok への依頼、依頼の小窓、「この島を頼む」、型の窓の「Grok に頼む…」など）は、これまでどおり既定でオフです。

