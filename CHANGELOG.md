# 変更点 / CHANGELOG

## Ver0.033β（2026-11-14）

### 新しくできること

- **カードの印（いいね・色）**：コメントボードのカードに、♥ のいいね（1〜3）と色の印（水・若草・赤紫）を付けられるようになりました。色はカードの淡い地と記号で出ます。ボードを小さくしても ♥ の枠は見えたままです。印はタグの 1 つとして数えます。
- **カードの削除**：ボードのカードの右クリックに「削除」が入りました。選んだ何枚かをまとめて削除することもできます。
- **［全体］の間**：［全体］を押したあとは、印の付いたカードに吹き出しが出て、上の区画の高さを借りて広く見られます。倍率の表示を押すか Esc で、［全体］の前の見え方に戻ります。
- **右の検索**：「カードの ♥」でいいねの付いたカードを探せます（♥1 以上・♥2 以上・新しい順）。「まとめてコピー」と、カードを上のボードで開く「上で開く」も入りました。
- **ポータル**：盤面の空いたマスを右クリック →「ここにポータルを置く」で、シートごとに 6 つまで目印を置けます。棚の「ポータル」の番号を押すと、そのマスが盤面のまん中に来ます。右クリックで、動かす・番号を替える・入れ替える・外す、ができます。
- **🌙 先生つき**：AI パネルの三人組で、返事の途中に先生（Claude 先生・フェイブル先生）に見てもらえるようにしました。押すと確認の欄が出て、先生を付ける体を選べます。今日の残りの回数と料金の目安も出ます（API の料金がかかります。練習モードでは何も送りません）。

### 変わったこと

- 新しい画面の文も英語にしました（約 90 件）。英語の画面では、ポータルは「Waypoints」、先生は「mentor」（先生つきは「With mentor」）と出ます。日本語版と英語版は同じ exe で、見た目（テーマ）の小窓の「言語 / Language」で切り替えます。
- 先生つきの会話の途中に出る案内の一部（先生に見てもらったときの知らせ・回数の上限・止まった理由など）は、英語の画面でも日本語のまま出ます。

### New

- **Card marks (likes and colors)**: you can now add a ♥ like (1–3) and a color mark (Aqua, Leaf green, Magenta) to cards on the comment board. Colors show as a soft card tint and a symbol, and the ♥ frame stays visible when zoomed out. Marks count as one tag each.
- **Deleting cards**: "Delete" is now on a board card's right-click menu, and you can delete several selected cards at once.
- **The "All" view**: after you press "All", marked cards get callouts and the board borrows height from the upper area. Click the zoom indicator or press Esc to return to the view before "All".
- **Right search**: "Card ♥" finds liked cards (♥1+, ♥2+, newest first). "Copy all" and "Open above" (open a card in the upper board) were added too.
- **Waypoints**: right-click an empty cell on the honeycomb → "Place a waypoint here" to place up to 6 waypoints per sheet. Click a number under "Waypoints" on the shelf to center that cell. Right-click a waypoint to move, renumber, swap or remove it.
- **🌙 With mentor**: in the AI panel's trio, members can have a mentor (Claude or Fable) review a reply midway. Clicking it shows a confirmation where you choose the members with mentor, with today's remaining uses and cost estimates (API charges apply; practice mode sends nothing).

### Changed

- The new UI text is translated into English too (about 90 strings). The Japanese and English versions are the same exe — switch with "Language" in the appearance (theme) popup.
- Some messages shown during a with-mentor conversation (the review notice, use limits, why a reply stopped, etc.) still appear in Japanese in the English UI.

## Ver0.032β（2026-11-11）

### 新しくできること

- **コメントボード**：上の区画に出したボードで、カードの右クリック・ダブルクリックのメニュー（全文・行き先・関連・書いた順・コピー・📌 留める）、編集の行（書き直す・関連線を足す・タグを足す…・型を足す…）、二本指とホイールでの移動、ピンチと Ctrl＋ホイールでの拡大縮小、道具の列とタグの行を畳む、写真を落として題を付ける、などができるようになりました。
- **正六角のボード**：ボードを「⬡ 六角」に切り替えると、カードが正六角形で並び、自由な位置に動かせます。四角と六角の並びは別々に残ります。関連の線は、ほかのカードの文を避けて引かれます。
- **型（テンプレート）を足す**：カードの右クリックの「型を足す…」で、そのカードの右と下に型のカードを足せます。ボードから型を作る・型を消すこともできます。
- **ボードの空いた所**：右クリックで「ここに書く」「型を足す…」「整理」、ダブルクリックでその場に書けます。
- **下の区画のコメントカード**：「カードを整頓」で道具をしまって面を広くする、「つなぐ ▾」で足すカードへ直前のカードから線を引く、写真の拡大と倍率（合わせる・100%・200%）。
- **右クリックの新しい項目**：メモのセルの「上のコメントボードで開く」、右のメモの区画の「下で開く」。
- **シートの一覧**：フォルダの段（入口だけを並べたシート）、検索、最近使った順を保つ並び、何枚かを選んでフォルダへまとめて入れる。

### 変わったこと

- 新しい画面の文も英語にしました（約 230 件。英語の画面は Ver0.031β-en から）。日本語版と英語版は同じ exe で、見た目（テーマ）の小窓の「言語 / Language」で切り替えます。

### New

- **Comment board**: on the board shown in the upper area you can now use the card menu (right-click or double-click: full text, destinations, links, writing order, copy, 📌 pin), an edit row (rewrite, add link line, add tag…, add template…), two-finger / wheel panning, pinch and Ctrl+wheel zoom, fold the toolbar and tag row, and drop photos with captions.
- **Hex board**: switch the board to "⬡ Hex" to show cards as regular hexagons that you can place freely. Square and hex layouts are kept separately. Link lines route around other cards' text.
- **Templates**: "Add template…" on a card's right-click menu adds a template's cards to the right of and below that card. You can also save a template from the board and delete templates.
- **Empty space on the board**: right-click for "Write here", "Add template…" and "Tidy"; double-click to write right there.
- **Comment cards in the bottom pane**: "Compact cards" puts the tools away for more room, "Link ▾" draws a line from the previous card to each card you add, and photo zoom (fit, 100%, 200%).
- **New right-click items**: "Open in the upper comment board" on memo cells, and "Open below" in the right memo pane.
- **Sheet list**: folder levels (sheets that hold only portals), search, recency kept, and moving several sheets into a folder at once.

### Changed

- The new UI text is translated into English too (about 230 strings; the English UI started in Ver0.031β-en). The Japanese and English versions are the same exe — switch with "Language" in the appearance (theme) popup.

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

