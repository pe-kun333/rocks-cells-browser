// 依頼の小窓（第3段 S3.5。docs/bot-cells/plan-s3-nest.md §3・S3.5、見本 docs/bot-cells/mocks/request-menu-popup.png の右の小窓）
//   ・DOM だけの部品。置く場所は使う側が決める（右サイドバーでは巣の上に重ねる〔bot-dock.ts〕。
//     ページの右クリック・Ctrl+Shift+G・メモのセルの「🔍 Grok に調べてもらう」では読む画面の重ね窓に出す〔reader/ask.ts。S3.11〕。あとで六角スクショ）
//   ・中身（上から。依頼の小窓 v2・R1 で並びを変え、R4a で計画書 §3 の図の順〔送るもの → 定型の組 → 定型 6 つ → 依頼文 → 役の文 → 宛て先 → 返し先〕にした。
//     docs/bot-cells/plan-request-v2.md D1〜D4・D9）
//       送るもの：ページの URL・ページの題名・選んだ文・ページの本文（全体）。付けられるものだけカードで出し、押して外す。本文ははじめは外す。
//         URL は ? と # から後ろを消したものを見せて、そのまま送る（D14）。外したものは依頼の JSON にも文にも入れない。
//         選んだ文・本文は cleanBotText で見えない文字を消し、消した数をカードに出す
//       定型（R4a・D9。bot-presets.ts、左の presets.json の写し）：「定型の組 ◀ 読みもの ▶」（はじめの組は開いた入口〔ページ・メモのセル・六角スクショ・巣〕で決まる）・
//         「その他 ▾」（棚の定型の小さな一覧）・6 つのボタン。押すと依頼文の最後の行に入り、もう一度押すと外れる（押した印は依頼文の中身から出す）。
//         数字 1〜6（文字欄の外）・Alt+1〜6（文字欄の中でも。テンキーは見ない）でも同じ。Alt+Shift+数字（席）は R4b。
//         穴 {選んだ文}・{題名} は付けているものだけで埋める（選んだ文は頭の見本）。埋まらない定型は押せない。
//         入れたあとで付けるものを外すと、その行は埋め直し、埋まらなければ依頼文から外す（外したものの見本を依頼に残さない）。
//         押した・取り込んだら host.presetUsed（左が使った時刻と回数を足す。R4b からそのときの組も渡す）。
//         その他 ▾ の足に「棚を整える…」（R4b）：巣では ⚙ の「定型」タブを開く（host.openShelf）。読む画面では巣の ⚙ で整えると知らせる
//       前と同じで（R6・D14。組の行の「その他 ▾」の前）：前回送った依頼の選び方（左の last-request.json の写し lastRequest）を当てる。
//         定型の組と定型・宛て先・返し先・朱書き・URL／題名／選んだ文の印を戻し、本文は外す。書きかけの依頼文には触らない（空のときだけ定型を入れる）。
//         Ctrl+Shift+G を素早く 2 回でも同じ（左が時刻で見て botAsk の same。open の same）。送るときの選び方は DraftRequest の choice（choiceNow。文は入れない）
//       依頼文：複数行。空でも、選んだ文・本文・画像のどれかが付いていれば送れる（役が補う一文を頼む文にする。impliedText）。
//         何も付けていなければ送れない。みんなに聞く・グループは今までどおり文が要る
//         打ちながら候補（R4a）：最後の行が今の組の定型の頭と同じなら、下に候補を出し、→（行の終わりで）か Ctrl+Space で取り込む
//         （押してもよい）。日本語入力の変換中は出さない。Tab は欄を移るまま
//       朱書き（R3・D8）：至急・短く／じっくり／出典必須／反対意見も／断定しないで（至急とじっくりは片方だけ）。
//         押したものは、送るときに頼む文の末尾に「（朱書き・役より優先：…）」の 1 行で入る（みんなに聞く・グループも同じ文。draftFromForm の形は変えない）
//       役の文（R3・D7）：依頼の頭に入る役の文（roleInstructions）を欄に出して直せる。宛て先を替えると欄も替わる（直した分があれば残して知らせる）。
//         直したら「今回だけ」（roleText で左へ。台帳の役は変えない）。「この役として保存」は、決まった部分（見出し〜役の決まりの文）は
//         そのままで、その後ろに書いた説明の文を台帳の役の instructions に書く（host.saveRole → 命令 setBotRole。役の形は変えない）。
//         決まった部分を直したときは保存できない（今回だけ）。みんなに聞く・グループ・まとめ役は欄を出さず、一言だけ
//       続きとして（R5・D11。宛て先の上）：最近の確かめが通った返事（受け取り箱の一覧の写しの 5 件。recentReplies）から選ぶ。
//         選ぶと、依頼文の頭に「#0010 の続き：（返事の頭の 1 行）」が入り（回答カードの「続けて聞く」と同じ文。書きかけの文はその下に残す）、
//         宛て先がその依頼の席に替わる。要点の行（左が記録の全文から作る。host.answerLines → 命令 botAnswerLines）が印つきで並び、
//         印を付けた行だけが、添えた情報の枠の中に「前の返事 #0010（データ）：」として入る（DraftAttach の priorReply。頼む文には入れない）。
//         定型の穴 {前の返事の要点} は、印が 1 つでもあれば「#0010 の要点」で埋まる。送ると依頼に続きの元（parentRequestId）が付き、
//         受け取り箱で同じ糸に束なる（1体・代表にまとめて・六角スクショ。みんなの 1体ずつ・グループ・まとめ役は糸にしない）。
//         回答カード・巣の「続けて聞く」は、これが選ばれた状態で開く（open の follow。入口は「続けて聞く」）。
//         「前と同じで」（R6）は続きの選びと要点の印に触らない（last-request.json に続きの元は入れない。計画書 §4.1・D14）
//       受け取り箱の「もう一度 ▾」（R9・D19。開くのは巣〔bot-dock.ts〕）：別の子へ渡す（open の follow ＋ passTo。続きとして選んだうえで、
//         宛て先だけ次の子に替える。要点の行は R5 と同じく添えた情報の枠へ）・言い換えてもう一回（open の retryOf。送る依頼に retryOf が付き、
//         受け取り箱では #0010-2）・頼み方を直す（open の presetIds。元の依頼で使った定型を依頼文の行に戻す。使った回数は足さない）。
//         送る依頼には、依頼文の行と同じ文になっている定型の id（presetIds。choice の presets と同じ見分け）を載せる（印を定型へ戻すため）
//       宛て先：1体を選ぶ。巣の席の順 → 巣に置いていない台帳の Grok-Bot（台帳の順）→ みんな（S3.6）。
//         巣のボットは役と席が依頼の頭に入る。巣に置いていないボットは席なし（そのボットに役があれば役は入る）。リンクの無いボットは選べない
//       返し先：受け取り箱（中継）が既定。「アプリのチャットだけ」は返事の決まりと JSON を付けず、依頼を作らない（pending.json に記録しない）
//       みんな（S3.6。bot-ask-all.ts）：巣の設定の送り方で
//         A 1体ずつ（既定）：押すと組を作り、1席めを送ってから案内のモードになる。「1/6 調査：コピーしてアプリを開く」→ 貼って送ったら
//           「次：要約（2/6）」…と順に案内する。次へ進むのは使う人が押したときだけ（自動でアプリを切り替えない）。
//           途中で閉じたら、作った分だけが残る（まだの席の依頼は作らない）。案内の間は依頼文・添付・返し先・宛て先は変えられない
//         B 代表にまとめて：代表の1体に、全員の役を並べた依頼を1つ。代表が台帳から消えている・リンクが無いときは A に戻して知らせる
//         どちらも、送る前に host.beforeAskAll を待つ（S3.7：合体 Grok の演出がオンなら、巣の上で「許可しますか？」と聞く。
//         答えがどちらでも、そのあと同じ依頼をそのまま送る。演出は見た目だけ）
//       送る前の1行（R1。send-preview.ts の renderBotLine）：宛て先｜付けるもの｜字数（役・自分・添えたもの／2 万字）｜返し先 を常に 1 行で。
//         前回送った依頼（R6 から、左の last-request.json の写しか、この面で送ったもののうち新しい方。無ければ開いたとき）から
//         変わった区切りに色を付ける（比べるのは宛て先・付けたものの種類・返し先の鍵。字数では色を付けない）。料金は出さない（Grok Bot 側なので分からない）
//       鍵の見張りの帯（R2・D5）：送る文（付けた選んだ文・本文と依頼文。R3 から役の文も）に鍵らしき文字（bot-replies.ts の findSecretish）があれば、
//         1 行の上に帯を出し、「〔鍵1〕に置き換えて送る」か「選んだ文を外す」（本文なら「本文を外す」）まで送れない（Ctrl+Enter は帯を光らせて理由を出す）。
//         生の値はカードの見本にも 1 行にも描かない（見本は置き換えた文から作る）。閉じて下書きに残すときも置き換える。画像の中は R7c まで見ない
//       「コピーしてアプリを開く」（Ctrl+Enter。日本語入力の変換中〔isComposing〕は送らない）・「やめる」（Esc）。
//         コピーはクリップボード履歴（Win+V）と同期に入れない印つき（R2・D6。印を付けるのは bots.ts・bot-shot.ts → C++ の clipboard.cpp。足に小さく書く）
//   ・送るのは BotSender（S3.4。右では AskLeftSender → 命令 botDraftV2 → 左の ClipboardSender）。中身は draftFromForm（bot-send.ts）で作る
//   ・はじめての「外のアプリを開きます」は、小窓の下の確かめの帯で聞く（盤面のボットのセル・巣と同じ設定。確かめたら host.confirmed）
//   ・六角スクショ（S3.12。open の image）：上にサムネイルと「画像は Grok Bot に送られます」、送るのは2回貼る
//     （① 画像をコピーしてアプリを開く → ② 文をコピー。② は ① の後で押せる。逃げ道つき。panels/bot-shot-steps.ts）。
//     宛て先は1体だけ（みんなは選べない）。依頼の text には頼む文の後ろに「画像を1枚、チャットに添えました（六角スクショ・題名）」とだけ足す
//     （画像の中身は依頼に入れない。② の経路は今の draftFromForm → BotSender のまま）
//   ・クリップボードの画像の候補（依頼の小窓 v2・R7a・D15。open の candidate。読む画面だけ＝host.shot があるとき。六角スクショのときは出さない）：
//     左が開くときに読んだ画像（長い辺 1600px の JPEG の data URL）を、送るもののカード「画像（いまクリップボードにあるもの）」に縮小図で出す。
//     印は外した状態。印を付けたら、先にブラウザが写しを取り（clipToPng で PNG → host.shot.saveImage で bot-shots\<shotId>.png）、
//     その写しで六角スクショと同じ二段（① 画像をコピーしてアプリを開く → ② 文）にする。一文は「画像を1枚、チャットに添えました（クリップボードの画像）」。
//     印を外したら二段を閉じる（写しは、もう一度付けたときに使い回す）。閉じたら・渡し止めで外したら、画像も写しも持ち続けない
//   ・画像に書き足す（依頼の小窓 v2・R7b・D15。読む画面だけ＝host.editImage があるとき）：画像のカード（六角スクショは上のカード、候補は送るもののカード）の
//     「書き足す →」で、読む画面の重ね窓に書き足しの面（panels/bot-image-edit.ts）を開く（小窓は隠れるだけ）。戻ったら、渡す画像（書き足した版か元の画像）で
//     二段を開き直す（候補は印を付け、写しを渡す画像で取り直す）。カードに「この画像で送るもの」の 1 行、一文は「（…・書き足した版・印 n・箱 n・隠し n・指さし n）」。
//     依頼文の末尾に箱の問い「①の箱：…」と、指さしがあれば「ここは何？」を足す（同じ箱の行・同じ文がもうあれば足さない）。足した行は editLines で追い、
//     画像を外した・元の画像にしたら外す（自分で直した行は追わない）。足した行は定型の行と見なさない（textLines。usedPresetIds の見分けを壊さない）
//   ・画像と文を一つの貼り付けで（依頼の小窓 v2・R7d・D16・Q2。open の pasteMode が html＝巣の設定。既定は 2 回貼り）：二段の ① を出さず、
//     主のボタンは「コピーしてアプリを開く」1 回。押したら ShotSteps.prepareOne が渡す画像の写しを bot-shots に保存し、その名前（ShotRef）を
//     SendAfter の image で送る（右・読む画面は botDraftV2 の withImage で左へ。左が依頼の文と一緒に 1 回で書く）。経路の札は「画像入り 1 回で貼る」、
//     送る前の 1 行に「画像入り 1 回（受けないと画像が落ちる）」。アプリが受けたかは分からないので、自動で 2 回貼りに戻したりはしない
//   ・webhook「そのまま送る」（依頼の小窓 v2・R11・D20）：足の控えめなボタン「そのまま送る（webhook）」。押すと送る前の 1 行のすぐ下が
//     「↑ この内容で中継へ直接送ります（鍵は画面に出ない・貼る手は無い）［送る］［戻る］」の二段になり、足は隠す（確かめた中身だけを送る：
//     確かめたあとに中身が変わった・渡し止めで外れたら、送らずに確かめ直し）。送ると DraftRequest に via: 'hook'（右・読む画面は AskLeftSender が
//     左の結果を待つ）。押せないとき（鍵が無い・返し先がチャットだけ・画像あり）は、足の上に小さくわけを出す。
//     届かなければ、二段が「同じ依頼（#0012・2 回目）を『コピーしてアプリを開く』に切り替える」に変わる（host.hookFallback → 命令 botHookFallback）。
//     鍵が有るかは左の写しの「ある／ない」だけ（setHook）。鍵・URL はこの面に来ない
//   ・みんなに聞くの一括（依頼の小窓 v2・R12）：webhook のときは、みんなの A（1体ずつ）とグループも案内を出さずに、席ごとに依頼を作って
//     中継へ送る（bot-ask-all.ts の sendAskAllAtOnce。1 体ずつ答えを待つ）。B（代表にまとめて）は 1 つの依頼なので 1体と同じ。
//     届かない席があればそこで止め、その席は同じ依頼をコピーに切り替えられる。まだ送っていない席は下書きに残す（送れた席・切り替えられる席は外す）
//   ・返し先「六角メモにも届く」（依頼の小窓 v2・R10・D13・Q6）：返し先の 3 つ目（memoRadio）。ラジオなので「アプリのチャットだけ」とは同時に選べない
//     （JSON が無いと返事が受け取り箱に届かず、写せない）。選ぶと、どの送り方（1体・六角スクショ・代表・1体ずつ・グループ・まとめ役）の依頼にも
//     deliverTo: 'hex'（draftFromForm・createAskAllRun・askLeadDraft の opts）。左が確かめの通った返事を、相棒の設定で選んだノートに写す。
//     送る前の 1 行の返し先は「受け取り箱 → 六角メモにも写す」、選び方（R6）の replyTo は 'memo'（「前と同じで」で戻る）
//   ・隠す候補（依頼の小窓 v2・R7c）：書き足しの面がメール・電話番号・鍵らしき文字の行を点線で示す。戻ったとき候補が残っていても止めない（隠すかは本人）が、
//     カードの 1 行に「候補 n 未決」、送る前の 1 行に「画像 1 枚（候補 n 未決）」と出す。何も描かず候補だけ見た書き足しも持っておく（keptEdit）
//   ・check は知らない（作るのは左）。動き（アニメーション）は使わない。色は CSS 変数だけ（明るい画面・暗い画面。sheets.css の .brf）
import { BLOCK_NOTE, ensureBlocklist, isBlockedUrl } from '../blocklist';
import { type BotAnswerLines, type BotBrief, type BotPasteMode, type BotRecentReply, requestNo } from '../bots';
import type { BotRole } from '../bot-roles';
import {
  type AskAllNest,
  type AskAllPlan,
  type AskAllRun,
  type TeamAsk,
  askAllFinished,
  askAllSeatDraft,
  askLeadDraft,
  createAskAllRun,
  nextAskAllSeat,
  planAskAll,
  roleNameOf,
  sendAskAllAtOnce,
  sendAskAllSeat,
} from '../bot-ask-all';
import { type BotRoleGroup, cleanRoleInstructions, cleanRoleText, ROLE_INSTRUCTIONS_MAX, ROLE_TEXT_MAX, roleGroupLabel, roleInstructions } from '../bot-roles';
import {
  type BotPreset,
  type BotPresetEntry,
  type BotPresets,
  fillPreset,
  PRESET_ENTRY_LABEL,
  PRESET_HAND_MAX,
  presetHand,
  presetHoles,
  presetMatches,
  presetParts,
  presetSetIndex,
  presetShelf,
} from '../bot-presets';
import type { BotLastChoice, BotLastReplyTo, BotLastRequest } from '../bot-last-request';
import { type BotSender, type DraftAttach, draftFromForm, type DraftRequest, HOOK_REFUSE, type SendAfter, type SendResult, sendableUrl } from '../bot-send';
import { addSingleDraft, type BotDraft, flagsOf, markDraftCopied, newDraftId, putAskAllDrafts } from '../drafts';
import { BOT_COST_NOTE, type BotLineSeg, renderBotLine } from '../send-preview';
import { BOT_LIMITS, type BotDeliverTo, cleanBotLine, cleanBotText, countInvisible, findSecretish } from '../bot-replies';
import { savedHexMemoTarget } from '../integrations/hexmemo';
import { el } from '../util';
import type { MergeAskInfo } from './bot-nest-merge';
import type { ImageEditPrior, ImageEditResult } from './bot-image-edit';
import { type ShotCopy, type ShotLook, ShotSteps, type ShotStepsHost } from './bot-shot-steps';
import { clipToPng, editedImageLine, editedImageNote, newShotId, openHints, type ShotRef } from '../bot-shot';

// 宛て先に選べる1体
export interface BotRequestTarget {
  id: string;
  name: string;
  linked: boolean; // リンク（エージェントの id）がある。無ければ選べない（アプリを開けない）
  role?: BotRole;
  seat?: number; // 巣の席（1〜6）。巣に置いていなければ無し
}

// 「みんな」の宛て先（S3.6。巣の設定の送り方で A 1体ずつ／B 代表にまとめて）
export const ASK_ALL = '*all';

// 宛て先の並び：巣の席の順 → 巣に置いていない台帳のボット（台帳の順）。台帳にいない席は飛ばす（席の番号は dock の順のまま）
export function botRequestTargets(bots: readonly BotBrief[], dock: readonly string[]): BotRequestTarget[] {
  const of = (bot: BotBrief, seat?: number): BotRequestTarget => ({
    id: bot.id,
    name: bot.name,
    linked: !!bot.agentId,
    ...(bot.role ? { role: bot.role } : {}),
    ...(seat ? { seat } : {}),
  });
  const seated: BotRequestTarget[] = [];
  dock.forEach((id, i) => {
    const bot = bots.find((b) => b.id === id);
    if (bot && !seated.some((t) => t.id === id)) seated.push(of(bot, i + 1));
  });
  const rest = bots.filter((b) => !seated.some((t) => t.id === b.id)).map((b) => of(b));
  return [...seated, ...rest];
}

// 小窓に渡すページのこと（付けられるものだけ。空・URL でないものは出さない）
export interface BotRequestContext {
  url?: string;
  title?: string;
  selection?: string;
  body?: string; // ページの本文の全体
}

export interface BotRequestFormOpen {
  targets: BotRequestTarget[];
  to?: string; // はじめに選ぶ宛て先（ボットの id か ASK_ALL）。無ければ最初の選べる1体
  context?: BotRequestContext;
  text?: string; // 書きかけの依頼文
  confirmApp?: boolean; // はじめての「外のアプリを開きます」をまだ確かめていない
  nest?: AskAllNest; // みんなに聞くの送り方と代表（台帳の nest。無ければ A）
  pasteMode?: BotPasteMode; // 画像を付けたときの貼り方（R7d。巣の設定 pasteMode。無ければ 2 回貼り）
  heading?: string; // 1体に頼むときの見出し（無ければ「Grok Bot に頼む」。右クリックからは「Grok に調べてもらう」）
  // 六角スクショ（S3.12。切り取った六角形の data URL）。あれば画像つきの二段で、みんなは選べない（host.shot が要る）。
  //   撮る画面で書いたコメントは text（頼む文の最初の行）で渡す
  image?: string;
  // クリップボードの画像の候補（R7a。左が読んだ長い辺 1600px の JPEG の data URL）。送るもののカードに印を外した状態で出す。
  //   印を付けたら写しを取って二段に（host.shot が要る。image があるときは使わない）
  candidate?: { image: string };
  note?: string; // 渡し止めなど、開いたときに出す一行
  skipCloseDraft?: boolean; // 閉じても下書きを足さない（合図が、すでに下書きへ入れてある）
  teamAsk?: TeamAsk; // グループに頼む（G2）。宛て先はこのグループの役のボットに固定。案内はみんなに聞く A と同じ
  handoff?: { group: number; team: BotRoleGroup }; // まとめ役に渡す（G3）。この文を、役を足さずに同じ組のまとめとして送る
  // 定型（依頼の小窓 v2・R4a。左の presets.json の組・手元・棚の写し。無い・組が無いときは定型の欄を出さない）
  presets?: BotPresets;
  entry: BotPresetEntry; // 開いた入口（ページ・メモのセル・六角スクショ・巣）。はじめの定型の組を決める
  // 前回送った依頼の選び方（R6。左の last-request.json の写し）と、開いたらすぐ「前と同じで」を当てるか（Ctrl+Shift+G を素早く 2 回）
  lastRequest?: BotLastRequest;
  same?: boolean;
  // 続きとして（R5）：選び口に出す最近の返事（受け取り箱の一覧の写しから。無ければ選び口を出さない）と、
  //   はじめから選んでおく返事（回答カード・巣の「続けて聞く」。頼む文の頭の「#0010 の続き：…」は text で渡す）
  replies?: BotRecentReply[];
  follow?: { botId: string; requestId: string; no?: string }; // no：画面の番号（言い換えなら #0010-2。R9。無ければ requestId から）
  // 受け取り箱の「もう一度 ▾」（R9）。passTo：別の子へ渡す（follow で続きとして選んだあと、宛て先をこの子にする）
  //   retryOf：言い換えてもう一回の元の依頼（no は #0010 の表示）　presetIds：はじめから依頼文の行に入れておく定型（頼み方を直す）
  passTo?: string;
  retryOf?: { requestId: string; no: string };
  presetIds?: string[];
}

export interface BotRequestFormHost {
  sender: BotSender;
  confirmed?(): void; // はじめての確かめを済ませた（次からは聞かない）
  sent?(req: DraftRequest, target: BotRequestTarget): void; // 送る部品に渡せた（1体なら、このあと閉じる。みんなの A は1席ごと）
  // みんなに聞くを送る前（S3.7。合体 Grok の許可の確認。終わるまで小窓は送らない。答えによらず、このあと同じ依頼を送る）
  beforeAskAll?(info: MergeAskInfo): Promise<void>;
  closed(text: string, sent: boolean): void; // 閉じた（text：その時の依頼文。保存はしない。sent：1つでも送る部品に渡せた）
  secret?(text: string): string; // 段 5。鍵に似た字の知らせ（止めない。空なら出さない）
  askAllRun?(group: number): void; // 段 5。みんなの組ができた（依頼はまだ。札の「送った:gN」はここ）
  shot?: ShotStepsHost; // 六角スクショの二段で使う C++ への頼みごと（読む画面の重ね窓だけ。無ければ image を渡されても画像なしで開く）
  // 画像に書き足す（R7b）：書き足しの面を開き、戻ったら結果（やめたら null）。prior：前に書き足した分（続きから）。
  //   読む画面の重ね窓だけ。無ければ画像のカードに「書き足す →」を出さない
  editImage?(image: string, prior: ImageEditPrior | null): Promise<ImageEditResult | null>;
  // 役の文を「この役として保存」（R3。左に命令 setBotRole を頼む。台帳を書くのは左）。無ければ保存のボタンを出さない
  saveRole?(botId: string, role: BotRole): void;
  // 定型を押した・候補を取り込んだ（R4a。左に命令 botPresetUsed を頼む。使った時刻と回数を書くのは左）。外したときは呼ばない。
  //   set：そのときの組の id（R4b。棚から使った定型の、入れ替えの声かけの相手の手元）
  presetUsed?(id: string, set?: string): void;
  // その他 ▾ の「棚を整える…」（R4b）：巣の ⚙ の「定型」タブを開く（巣が小窓を閉じてから開く。書きかけは「やめる」と同じに残る）。
  //   無ければ（読む画面）、巣の ⚙ で整えることを知らせるだけ
  openShelf?(): void;
  // 続きとして選んだ返事の要点の行（R5。左に命令 botAnswerLines を頼み、relay の返事を待つ。待ちきれなければ null）。無ければ要点の行を出さない
  answerLines?(botId: string, requestId: string): Promise<BotAnswerLines | null>;
  // webhook で届かなかった依頼を、同じ依頼でコピーに切り替える（R11。左に命令 botHookFallback を頼む）。無ければ切り替えのボタンを出さない
  hookFallback?(botId: string, requestId: string): void;
}

// webhook「そのまま送る」が押せないときの、足の上の小さな 1 行（くわしくはボタンの説明。R11）
const HOOK_WHY_SHORT = {
  noKey: 'そのまま送る：鍵が無いので押せません（巣の ⚙「送り方」）',
  chatOnly: 'そのまま送る：返し先が「アプリのチャットだけ」なので押せません',
  image: 'そのまま送る：画像は依頼の JSON に入らないので押せません',
} as const;
const HOOK_CHANGED = 'そのまま送る前に中身が変わりました。もう一度「そのまま送る」で確かめてください';

type AttachKey = 'url' | 'title' | 'selection' | 'body';

const ATTACH_ROWS: { key: AttachKey; label: string; short: string; on: boolean }[] = [
  { key: 'url', label: 'ページの URL', short: 'URL', on: true },
  { key: 'title', label: 'ページの題名', short: '題名', on: true },
  { key: 'selection', label: '選んだ文', short: '選んだ文', on: true },
  { key: 'body', label: 'ページの本文（全体）', short: '本文', on: false },
];

const MAX_HEIGHT = 560; // 小窓のいちばん高いとき（px。窓が低ければ、窓に収まるだけ）
const SNIPPET = 60; // 選んだ文・本文の見本の字数
const LINE_WARN = Math.floor(BOT_LIMITS.requestChars * 0.9); // 送る前の 1 行で字数を赤にする目安（上限の 9 割）

// 依頼文が空のとき、役が補う一文（R1・D4。計画の Q10）。役の名前で選ぶ。画像だけのときは画像について
const IMPLIED_BY_ROLE: Record<string, string> = {
  調査: '選んだ文について調べてください。',
  要約: '選んだ文を要約してください。',
  批判と検証: '選んだ文のどこが怪しいか、確かめてください。',
  発想: '選んだ文から考えを広げてください。',
};
const IMPLIED_DEFAULT = '選んだ文について答えてください。';
const IMPLIED_IMAGE = '添えた画像について答えてください。';

// 朱書き（R3・D8）：押した言葉を頼む文の末尾に 1 行で入れる。group が同じもの（至急とじっくり）は片方だけ。
//   id は前回の依頼を戻す（R6 の last-request.json の stamps）ときの名前なので変えない
const STAMPS: readonly { id: string; label: string; say: string; group?: string }[] = [
  { id: 'rush', label: '至急・短く', say: '急ぎ。3 行以内で。', group: 'speed' },
  { id: 'slow', label: 'じっくり', say: '急がない。じっくり。', group: 'speed' },
  { id: 'sources', label: '出典必須', say: '出典を必ず付けて。' },
  { id: 'counter', label: '反対意見も', say: '反対の意見も一つ入れて。' },
  { id: 'hedge', label: '断定しないで', say: '断定せず、確からしさを書いて。' },
];

// 鍵の見張り（R2・D5）：見る欄と、帯・知らせでの呼び名。外せるのはカードの欄だけ（依頼文は置き換えるか、自分で消す）。
//   前の返事の要点の行（R5）も送る文なので見る（外すときは行の印を外す）
type SecretKey = 'selection' | 'body' | 'text' | 'role' | 'prior';
const SECRET_WHERE: Record<SecretKey, string> = { selection: '選んだ文', body: '本文', text: '依頼文', role: '役の文', prior: '前の返事の要点' };
const SECRET_LABEL_RE = /〔鍵(\d{1,4})〕/g;
const SECRET_FLASH_MS = 600; // 送れないのに押したとき、帯を光らせておく時間（動きは付けない。枠の色を出して消すだけ）

// 次に使う〔鍵n〕の番号（どの欄にもまだ無い番号。前に置き換えた〔鍵1〕と、ほかの値が同じ番号にならないように）
function nextSecretLabel(...texts: (string | undefined)[]): number {
  let max = 0;
  for (const text of texts) for (const m of (text ?? '').matchAll(SECRET_LABEL_RE)) max = Math.max(max, Number(m[1]));
  return max + 1;
}

const secretRange = (first: number, count: number) => (count > 1 ? `〔鍵${first}〕〜〔鍵${first + count - 1}〕` : `〔鍵${first}〕`);

// 鍵らしき文字を、欄をまたいで続きの番号で置き換える（texts のどこにもまだ無い番号から。帯の「〔鍵1〕」と同じ数え方）
function secretMasker(...texts: (string | undefined)[]) {
  const first = nextSecretLabel(...texts);
  let next = first;
  return {
    first,
    used: () => next - first,
    mask(value: string): string {
      const found = findSecretish(value, next);
      next += found.count;
      return found.masked;
    },
  };
}

// 送る前の 1 行の色を決める鍵（R6 で文から選び方に替えた）：宛て先（ボットの id・みんな・グループ）・付けたものの種類・返し先。字数は比べない
//   （選んだ文の字数がちがうだけでは色を付けない。「前と同じで」で戻したあとは、前回送った依頼と同じ鍵になって色が付かない）
type LineKeys = { to: string; items: string; reply: string };

// この面で前回送った依頼の鍵（at：送った時刻）。左の last-request.json の写しの方が新しければ、そちらと比べる（右の巣と読む画面の間でも同じ元になる）
let lastSent: { at: number; keys: LineKeys } | null = null;

// 前回送った依頼の選び方を、1 行の鍵にする（本文と画像の印は持たないので、付けていないものとして比べる）
function lastRequestKeys(last: BotLastRequest): LineKeys {
  return {
    to: last.to.all ? ASK_ALL : (last.to.botId ?? ''),
    items: (['url', 'title', 'selection'] as const).filter((key) => last.attach[key]).join(','),
    reply: last.replyTo,
  };
}

const chars = (text: string) => [...text].length;

// 書き足し（R7b）から依頼文に足す行：箱ごとの問い「①の箱：…」（問いが空なら「①の箱：」まで）と、指さしがあれば「ここは何？」
const CIRCLED = '①②③④⑤⑥⑦⑧⑨';
function editRequestLines(edit: ImageEditResult): string[] {
  const lines = edit.boxes.filter((box) => box.n >= 1 && box.n <= CIRCLED.length).map((box) => `${CIRCLED[box.n - 1]}の箱：${cleanBotLine(box.question)}`);
  if (edit.points > 0) lines.push('ここは何？');
  return lines;
}

// 書き足しの面から戻った結果のうち、持っておくもの（印があるか、隠す候補を見つけたとき。R7c）。どちらも無ければ書き足していないのと同じ
const keptEdit = (result: ImageEditResult) => (result.marks.length || result.hints.found ? result : null);

// 候補のカードの、付けたあとの行（R7d：画像入り 1 回なら貼る回数も替える）
const clipOnNote = (one: boolean) =>
  `付けた：ブラウザが写しを取りました（bot-shots に保存）。${one ? '画像と文を一つの貼り付けで（試し）' : '① 画像 → ② 文の 2 回貼り'}`;

// 候補の渡す画像（書き足した版があればそれ。R7b）
const clipImage = (clip: { image: string; edit: ImageEditResult | null }) => clip.edit?.image ?? clip.image;
const snippet = (text: string) => {
  const line = cleanBotLine(text);
  return chars(line) > SNIPPET ? `${[...line].slice(0, SNIPPET).join('')}…` : line;
};
const shown = (url: string) => url.replace(/^https?:\/\//, '');
const replyTime = (at: number) => (at > 0 ? new Date(at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// 文字を打つ欄か（定型の数字キー 1〜6 は、ここでは文字を打つので見ない。Alt+数字だけ。R4a・Q8）
const isTextField = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(target.type)) ||
  (target instanceof HTMLElement && target.isContentEditable);

export class BotRequestForm {
  readonly element = el('section', 'brf');
  private blockLoads = 0; // 渡し止めの読み直しが重なったとき、あとから終わった方だけを見る
  // クリップボードの画像の候補（R7a）。image：左が読んだ JPEG（元の画像）　on：印　busy：写しを取っている　copy：取った写し（付け直しで使い回す）
  //   copyOf：写しを取った画像（渡す画像が変わったら取り直す）　edit：書き足し（R7b。無ければ null。渡す画像は edit.image）
  private clip: { image: string; on: boolean; busy: boolean; copy: ShotCopy | null; copyOf: string; edit: ImageEditResult | null } | null = null;
  private clipSub: HTMLElement | null = null; // 候補のカードの「付けた：…」の行（貼る回数は小窓の中でも替わるので、refresh で直す。R7d）
  private pasteMode: BotPasteMode = 'two'; // 巣の設定の画像の貼り方（R7d。開くたびに）
  private clipLoads = 0; // 開き直した・閉じたら、写しを取り終えた古い結果を捨てる
  // 画像に書き足す（R7b）。shotSrc：六角スクショの元の画像　shotEdit：六角スクショの書き足し（無ければ null）
  //   editLines：書き足しから依頼文に入れた行（箱の問い・ここは何？。そのままの文で残っているものだけ追う）
  private shotSrc = '';
  private shotEdit: ImageEditResult | null = null;
  private editLines: string[] = [];
  private editLoads = 0; // 開き直した・閉じたら、書き足しの面から戻った古い結果を捨てる
  private readonly uid = `brf${Math.random().toString(36).slice(2, 8)}`;
  private readonly title = el('span', 'brf-title', 'Grok Bot に頼む');
  private readonly via = el('span', 'brf-via', 'クリップボードで送る');
  private readonly body = el('div', 'brf-body');
  private readonly text = el('textarea', 'brf-text');
  private readonly attachBox = el('fieldset', 'brf-group');
  private readonly attachList = el('div', 'brf-attach');
  private readonly checks = new Map<AttachKey, HTMLInputElement>();
  private readonly relayRadio = el('input', 'brf-radio');
  private readonly chatRadio = el('input', 'brf-radio');
  private readonly memoRadio = el('input', 'brf-radio'); // 六角メモにも届く（R10）
  private readonly replyNote = el('p', 'brf-note');
  private readonly toSelect = el('select', 'brf-select');
  private readonly toNote = el('p', 'brf-note');
  private readonly stampBox = el('div', 'brf-stamps'); // 朱書き（R3）
  private readonly stampButtons = new Map<string, HTMLButtonElement>();
  private readonly roleBox = el('div', 'brf-role'); // 役の文（R3）
  private readonly roleEdit = el('div', 'brf-role-edit');
  private readonly roleInput = el('textarea', 'brf-role-text');
  private readonly roleOps = el('div', 'brf-role-ops');
  private readonly roleSave = el('button', 'brf-button', 'この役として保存');
  private readonly roleReset = el('button', 'brf-button', '元に戻す');
  private readonly roleMark = el('span', 'brf-role-mark', '（今回だけ直してあります）');
  private readonly roleNote = el('p', 'brf-note');
  private roleFor: string | null = null; // 欄の文がどの宛て先のものか（ボットの id。開いた直後は null）
  private roleBase = ''; // その宛て先の役の文（直したかは、これと比べる）
  private readonly presetBox = el('div', 'brf-pre'); // 定型（R4a）：組の行・棚の一覧・6 つのボタン・キーの案内
  private readonly presetSetName = el('b', 'brf-pre-name');
  private readonly presetSetAxis = el('span', 'brf-pre-hint');
  private readonly presetPrev = el('button', 'brf-button brf-pre-step', '◀');
  private readonly presetNext = el('button', 'brf-button brf-pre-step', '▶');
  private readonly presetOther = el('button', 'brf-button brf-pre-step', 'その他 ▾');
  private readonly presetShelfBox = el('div', 'brf-pre-shelf'); // その他 ▾ の小さな一覧（棚の定型）
  private readonly presetButtons: HTMLButtonElement[] = []; // 6 つ（いつも同じ要素。組を替えても作り直さない〔押した所に入力先を残す〕）
  private readonly candBar = el('div', 'brf-pre-cand'); // 打ちながら候補（R4a）
  private readonly candButton = el('button', 'brf-pre-cand-text');
  private presets: BotPresets | null = null;
  private presetSet = -1; // 今の組（presets.sets の何番め。無ければ -1）
  private entry: BotPresetEntry = 'nest'; // 開いた入口
  private readonly presetLines = new Map<string, string>(); // 小窓で入れた定型の行（id → 埋めた文）。付けるものが変わったら埋め直す
  private candidate: BotPreset | null = null; // いま出している候補
  private composing = false; // 日本語入力の変換中（候補を出さない）
  private readonly line = el('div', 'brf-line');
  private readonly status = el('div', 'brf-status');
  private readonly secretNote = el('p', 'brf-note');
  private readonly sendButton = el('button', 'brf-button brf-primary', 'コピーしてアプリを開く');
  private readonly cancelButton = el('button', 'brf-button', 'やめる');
  private readonly confirmBar = el('div', 'brf-confirm');
  private readonly confirmGo = el('button', 'brf-button brf-primary', 'コピーして開く');
  private readonly confirmBack = el('button', 'brf-button', '戻る');
  // webhook「そのまま送る」（R11・D20）：足の控えめなボタン・押せないわけ・二段の確かめ（confirm）と届かなかったときの切り替え（failed）
  private readonly hookButton = el('button', 'brf-button brf-hook', 'そのまま送る（webhook）');
  private readonly hookWhy = el('div', 'brf-hook-why');
  private readonly hookBar = el('div', 'brf-hook-confirm');
  private readonly hookText = el('span', 'brf-confirm-text');
  private readonly hookGo = el('button', 'brf-button brf-primary', '送る');
  private readonly hookBack = el('button', 'brf-button', '戻る');
  private readonly foot = el('div', 'brf-foot');
  private hookReady = false; // 中継の宛先と鍵があるか（左の写しの「ある／ない」）
  private hookMode: 'confirm' | 'failed' | null = null;
  private hookSnap = ''; // 確かめたときの中身（変わったら送らずに確かめ直す）
  private hookFailed: { botId: string; requestId: string; no: string } | null = null; // 届かなかった依頼（同じ依頼でコピーに切り替えられる）
  private hookViaPrev: string | null = null; // 確かめのあいだ「中継へ直接送る」にした経路の札の、元の文
  private sending: 'copy' | 'hook' = 'copy'; // 今の送り方（submit が決め、sendOne が見る）
  private readonly secretBar = el('div', 'brf-secret'); // 鍵の見張りの帯（R2）
  private readonly secretText = el('span', 'brf-secret-text');
  private readonly secretMask = el('button', 'brf-button', '〔鍵1〕に置き換えて送る');
  private readonly secretDropSelection = el('button', 'brf-button', '選んだ文を外す');
  private readonly secretDropBody = el('button', 'brf-button', '本文を外す');
  private secretFlash = 0;
  private secretWhy = ''; // 帯が出ているとき、送れないわけ（ボタンの説明と知らせ）
  private readonly guide = el('div', 'brf-guide'); // みんなに聞く A の案内（S3.6）
  private readonly guideAsk = el('p', 'brf-guide-ask');
  private readonly guideList = el('ol', 'brf-guide-list');
  private readonly guideMsg = el('p', 'brf-guide-msg');
  private targets: BotRequestTarget[] = [];
  private nest: AskAllNest = {};
  private run: AskAllRun<BotRequestTarget> | null = null; // A の案内のあいだだけ
  private teamAsk: TeamAsk | null = null; // グループに頼む（案内に入る前）
  private handoff: { group: number; team: BotRoleGroup } | null = null; // まとめ役に渡す
  private context: BotRequestContext = {};
  private rawUrl: string | undefined; // 開いたときの URL（? と # が付いていたかをカードに書く。カードを描き直すとき用）
  private cleaned = { selection: 0, body: 0 }; // 開いたときに消した見えない文字の数（R1）
  private openKeys: LineKeys | null = null; // 開いたときの 1 行の鍵（前回送った依頼が無いときの比べる元）
  private keysNow: LineKeys = { to: '', items: '', reply: '' }; // いま描いている 1 行の鍵（送れたら lastSent にする）
  private lastRequest: BotLastRequest | null = null; // 前回送った依頼の選び方（R6。左の last-request.json の写し）
  private runChoice: BotLastChoice | null = null; // みんなに聞く A の組を作ったときの選び方（席ごとの依頼に載せる）
  private runPresetIds: string[] = []; // みんなに聞く A・グループの組を作ったときに使っていた定型（席ごとの依頼に載せる。R9）
  private retryOf: { requestId: string; no: string } | null = null; // 言い換えてもう一回（R9）の元の依頼。送る依頼に retryOf を付ける
  private readonly presetSame = el('button', 'brf-button brf-pre-step', '前と同じで'); // R6・D14
  private readonly followBox = el('div', 'brf-follow'); // 続きとして（R5・D11）：選び口・要点の行・知らせ
  private readonly followSelect = el('select', 'brf-select');
  private readonly followList = el('div', 'brf-follow-lines');
  private replies: BotRecentReply[] = []; // 選び口に出す返事（新しい返事から）
  // 選んでいる返事と要点の行（state：loading 読んでいる・ready 読めた・missing 記録に無い・none 頼む口が無い／待ちきれなかった）
  private follow: { reply: BotRecentReply; lines: { text: string; on: boolean }[]; state: 'loading' | 'ready' | 'missing' | 'none' } | null = null;
  private followHead: string | null = null; // 依頼文の頭に入れた「#0010 の続き：…」の行（そのままなら、選び直したときに入れ替える）
  private followLoads = 0; // 要点の行の読み込みが重なったとき、あとから頼んだものだけを見る
  private heading = 'Grok Bot に頼む';
  private needConfirm = false;
  private busy = false;
  private readonly shot: ShotSteps | null; // 六角スクショの部分（S3.12。host.shot があるときだけ）
  private afterConfirm: (() => void) | null = null; // はじめての確かめのあとに続けること（無ければ送る）
  private skipCloseDraft = false;
  private readonly onResize = () => this.fit();

  constructor(private readonly host: BotRequestFormHost) {
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.title.id = `${this.uid}-title`;
    this.element.setAttribute('aria-labelledby', this.title.id);

    // 見出し：G の印・題・送り方
    const head = el('div', 'brf-head');
    const mark = el('span', 'brf-mark', 'G');
    mark.setAttribute('aria-hidden', 'true');
    this.via.title = '依頼をクリップボードに入れて、Grok Bot アプリのチャットを開きます。貼って送るのは使う人です';
    head.append(mark, this.title, this.via);

    const body = this.body;

    // 依頼文
    const textLabel = el('label', 'brf-label', '依頼文');
    this.text.id = `${this.uid}-text`;
    textLabel.htmlFor = this.text.id;
    this.text.rows = 3;
    this.text.maxLength = BOT_LIMITS.requestChars;
    this.text.placeholder = 'Grok Bot に頼むこと（空でも、選んだ文や本文を付けていれば送れます。Ctrl+Enter でコピーしてアプリを開く・Esc でやめる）';
    this.text.addEventListener('input', (e) => {
      this.refresh();
      if (!(e as InputEvent).isComposing) this.updateCandidate();
    });
    // 打ちながら候補（R4a）：変換中は出さない。変換を決めたら見直す。欄を離れたら消す
    this.text.addEventListener('compositionstart', () => {
      this.composing = true;
      this.hideCandidate();
    });
    this.text.addEventListener('compositionend', () => {
      this.composing = false;
      this.updateCandidate();
    });
    this.text.addEventListener('blur', () => this.hideCandidate());
    this.candBar.hidden = true;
    this.candBar.setAttribute('aria-live', 'polite');
    this.candButton.type = 'button';
    this.candButton.title = '押すか、→（行の終わりで）か Ctrl+Space で、最後の行をこの定型にします';
    this.candButton.addEventListener('mousedown', (e) => e.preventDefault()); // 押しても依頼文から入力先を移さない（候補を消さない）
    this.candButton.addEventListener('click', () => this.acceptCandidate());
    this.candBar.append(el('span', 'brf-pre-hint', '→ か Ctrl+Space で取り込む：'), this.candButton);

    // 定型（R4a・D9）：組の行（◀ 名前 ▶・入口・その他 ▾）、棚の小さな一覧、6 つのボタン、キーの案内
    this.presetBox.setAttribute('role', 'group');
    this.presetBox.setAttribute('aria-label', '定型');
    this.presetPrev.type = 'button';
    this.presetPrev.title = '前の定型の組';
    this.presetPrev.addEventListener('click', () => this.stepPresetSet(-1));
    this.presetNext.type = 'button';
    this.presetNext.title = '次の定型の組';
    this.presetNext.addEventListener('click', () => this.stepPresetSet(1));
    this.presetShelfBox.id = `${this.uid}-shelf`;
    this.presetShelfBox.hidden = true;
    this.presetShelfBox.setAttribute('role', 'group');
    this.presetShelfBox.setAttribute('aria-label', '棚の定型');
    this.presetOther.type = 'button';
    this.presetOther.title = '棚の定型（全部の組で一つ）を出します。押すと依頼文に入ります';
    this.presetOther.setAttribute('aria-expanded', 'false');
    this.presetOther.setAttribute('aria-controls', this.presetShelfBox.id);
    this.presetOther.addEventListener('click', () => this.toggleShelf());
    const setRow = el('div', 'brf-pre-set');
    // 前と同じで（R6・D14。計画書 §3 の図のとおり、組の行の「その他 ▾」の前）
    this.presetSame.type = 'button';
    this.presetSame.title =
      '前回送った依頼の、定型の組と定型・宛て先・返し先・朱書き・URL／題名／選んだ文の印を戻します。本文は外したまま。書きかけの依頼文には触りません（空のときだけ定型を入れます）。Ctrl+Shift+G を素早く 2 回でも同じ';
    this.presetSame.addEventListener('click', () => this.applySame());
    setRow.append(el('span', 'brf-pre-hint', '定型の組'), this.presetPrev, this.presetSetName, this.presetNext, this.presetSetAxis, el('span', 'brf-pre-gap'), this.presetSame, this.presetOther);
    const six = el('div', 'brf-pre-six');
    for (let i = 0; i < PRESET_HAND_MAX; i++) {
      const button = el('button', 'brf-pre-item');
      button.type = 'button';
      button.hidden = true;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-keyshortcuts', `${i + 1} Alt+${i + 1}`);
      button.addEventListener('click', () => this.pressPreset(i));
      this.presetButtons.push(button);
      six.append(button);
    }
    this.presetBox.append(setRow, this.presetShelfBox, six, el('p', 'brf-pre-keys', '数字 1〜6 で入れる（文字欄の中では Alt+数字）。もう一度押すと外す'));

    // 送るもの（付けられるものだけ。render で作る。R1：依頼文より上に置き、押して外す）
    const attachLegend = el('legend', 'brf-legend', '送るもの（押して外す。外したものはどこにも入りません）');
    this.attachBox.append(attachLegend, this.attachList);

    // 返し先
    const replyBox = el('fieldset', 'brf-group');
    replyBox.append(el('legend', 'brf-legend', '返し先'));
    const radio = (input: HTMLInputElement, value: string, label: string, hint: string) => {
      input.type = 'radio';
      input.name = `${this.uid}-reply`;
      input.value = value;
      input.addEventListener('change', () => this.refresh());
      const row = el('label', 'brf-check');
      row.title = hint;
      row.append(input, el('span', 'brf-check-label', label));
      return row;
    };
    replyBox.append(
      radio(this.relayRadio, 'relay', '受け取り箱（中継）', '返事は中継から右の受け取り箱に届きます（返事の決まりと依頼の JSON を付けて、依頼を記録します）'),
      radio(this.chatRadio, 'chat', 'アプリのチャットだけ', '返事は Grok Bot アプリのチャットで読みます（返事の決まりと JSON を付けず、記録もしません）'),
      radio(
        this.memoRadio,
        'memo',
        '六角メモにも届く（確かめたあと、ブラウザが写す・箱にも残る）',
        '返事は受け取り箱に届きます。確かめが通ったら、ブラウザが六角メモ（相棒の設定の「六角メモへ」で選んだノート）に 1 マス写します。アプリのチャットだけとは一緒に選べません（JSON が無いと届かないので）',
      ),
      this.replyNote,
    );

    // 宛て先
    const toLabel = el('label', 'brf-label', '宛て先');
    this.toSelect.id = `${this.uid}-to`;
    toLabel.htmlFor = this.toSelect.id;
    this.toSelect.addEventListener('change', () => this.refresh());

    // 朱書き（R3・D8）：押すと頼む文の末尾に 1 行。至急とじっくりは片方だけ
    this.stampBox.setAttribute('role', 'group');
    this.stampBox.setAttribute('aria-label', '朱書き');
    this.stampBox.append(el('span', 'brf-stamps-hint', '朱書き（役の長さ・考え方より優先）：'));
    for (const stamp of STAMPS) {
      const button = el('button', 'brf-stamp', stamp.label);
      button.type = 'button';
      button.title = `頼む文の末尾に「${stamp.say}」を足します${stamp.group ? '（至急とじっくりは片方だけ）' : ''}`;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => this.toggleStamp(stamp.id));
      this.stampButtons.set(stamp.id, button);
      this.stampBox.append(button);
    }

    // 役の文（R3・D7）：鉛筆の印・欄・「この役として保存」・「（今回だけ直してあります）」
    const roleLabel = el('label', 'brf-label', '役の文（依頼の頭に入る。宛て先で替わる。直せる）');
    this.roleInput.id = `${this.uid}-role`;
    roleLabel.htmlFor = this.roleInput.id;
    this.roleInput.rows = 4;
    this.roleInput.maxLength = ROLE_TEXT_MAX;
    this.roleInput.spellcheck = false;
    this.roleInput.addEventListener('input', () => this.refresh());
    const pen = el('span', 'brf-role-pen', '✎');
    pen.setAttribute('aria-hidden', 'true');
    this.roleSave.type = 'button';
    this.roleSave.addEventListener('click', () => this.saveRole());
    this.roleReset.type = 'button';
    this.roleReset.title = '宛て先の役の文（台帳の役）に戻します';
    this.roleReset.hidden = true;
    this.roleReset.addEventListener('click', () => this.resetRole());
    this.roleMark.hidden = true;
    this.roleOps.append(this.roleSave, this.roleReset, this.roleMark);
    this.roleEdit.append(pen, this.roleInput);
    this.roleNote.hidden = true;
    this.roleBox.append(roleLabel, this.roleEdit, this.roleOps, this.roleNote);

    // 続きとして（R5・D11）：選び口と、要点の行（印つき）。見本 ① の「続きとして（選ぶと、その依頼の席に替わる）」
    const followLabel = el('label', 'brf-label', '続きとして（選ぶと、その依頼の席に替わる）');
    this.followSelect.id = `${this.uid}-follow`;
    followLabel.htmlFor = this.followSelect.id;
    this.followSelect.title = '最近の返事（確かめが通ったもの）から選ぶと、依頼文の頭に「#番号 の続き」が入り、宛て先がその依頼の席に替わります';
    this.followSelect.addEventListener('change', () => this.pickFollow(this.followSelect.value));
    this.followList.hidden = true;
    this.followList.setAttribute('role', 'group');
    this.followList.setAttribute('aria-live', 'polite');
    this.followBox.hidden = true;
    this.followBox.append(followLabel, this.followSelect, this.followList);

    // 並びは計画書 §3 の図の順（R4a）：送るもの → 定型の組・定型 6 つ → 依頼文（候補・朱書き）→ 役の文 → 続きとして（R5）→ 宛て先 → 返し先
    body.append(this.attachBox, this.presetBox, textLabel, this.text, this.candBar, this.stampBox, this.roleBox, this.followBox, toLabel, this.toSelect, this.toNote, replyBox);

    // みんなに聞く A の案内（案内のあいだは上の欄の代わりに出す）
    this.guide.hidden = true;
    this.guide.setAttribute('role', 'group');
    this.guide.setAttribute('aria-label', 'みんなに聞く：1体ずつの案内');
    this.guideMsg.setAttribute('aria-live', 'polite');
    this.guide.append(this.guideAsk, this.guideList, this.guideMsg);

    // 送る前の1行・知らせ
    this.line.setAttribute('aria-live', 'polite');
    this.status.setAttribute('role', 'status');

    // はじめての「外のアプリを開きます」
    this.confirmBar.hidden = true;
    this.confirmBar.setAttribute('role', 'group');
    this.confirmBar.setAttribute('aria-label', '外のアプリ（Grok Bot）を開きます');
    this.confirmGo.type = 'button';
    this.confirmGo.addEventListener('click', () => {
      const then = this.afterConfirm;
      this.needConfirm = false;
      this.host.confirmed?.();
      this.hideConfirm(false);
      if (then) then();
      else void this.submit();
    });
    this.confirmBack.type = 'button';
    this.confirmBack.addEventListener('click', () => this.hideConfirm(true));
    this.confirmBar.append(el('span', 'brf-confirm-text', '依頼をコピーしてから、Grok Bot アプリ（外のアプリ）のチャットを開きます。次からは聞きません'), this.confirmGo, this.confirmBack);

    // 鍵の見張りの帯（R2・D5）：出ているあいだは送れない。文は watchSecrets が書く
    this.secretBar.hidden = true;
    this.secretBar.setAttribute('role', 'group');
    this.secretBar.setAttribute('aria-label', '鍵らしき文字があります');
    this.secretText.setAttribute('aria-live', 'polite');
    const secretMark = el('span', 'brf-secret-mark', '⚠');
    secretMark.setAttribute('aria-hidden', 'true');
    this.secretMask.type = 'button';
    this.secretMask.title = '送る文の中の鍵らしき文字を〔鍵1〕のような印に置き換えます（元の値は残しません）。置き換えたら「コピーしてアプリを開く」で送れます';
    this.secretMask.addEventListener('click', () => this.maskSecrets());
    this.secretDropSelection.type = 'button';
    this.secretDropSelection.title = '選んだ文を、鍵らしき文字ごと送るものから外します';
    this.secretDropSelection.addEventListener('click', () => this.dropSecret('selection'));
    this.secretDropBody.type = 'button';
    this.secretDropBody.title = '本文を、鍵らしき文字ごと送るものから外します';
    this.secretDropBody.addEventListener('click', () => this.dropSecret('body'));
    this.secretBar.append(secretMark, this.secretText, this.secretMask, this.secretDropSelection, this.secretDropBody);

    // 下：Ctrl+Enter の案内・履歴に入れない印・やめる・そのまま送る（R11）・コピーしてアプリを開く
    const foot = this.foot;
    const keys = el('span', 'brf-keys', 'Ctrl+Enter');
    keys.title = 'Ctrl+Enter でコピーしてアプリを開く・Esc でやめる';
    keys.setAttribute('aria-hidden', 'true');
    const clip = el('span', 'brf-clip', '履歴・同期には入れない印を付けてコピー');
    clip.title = '依頼（と六角スクショの画像）は、Windows のクリップボード履歴（Win+V）と、ほかの端末との同期に入れない印を付けてクリップボードに置きます';
    this.cancelButton.type = 'button';
    this.cancelButton.title = 'やめる（Esc）。依頼は作りません';
    this.cancelButton.addEventListener('click', () => this.close(false)); // 案内のあいだは、作った分があれば sent になる（close が見る）
    this.sendButton.type = 'button';
    this.sendButton.setAttribute('aria-keyshortcuts', 'Control+Enter');
    this.sendButton.addEventListener('click', () => void this.submit());
    // webhook「そのまま送る」（R11・D20）：二段の確かめは送る前の 1 行のすぐ下に出し、そのあいだ足は隠す
    this.hookButton.type = 'button';
    this.hookButton.addEventListener('click', () => this.showHook());
    this.hookWhy.hidden = true;
    this.hookBar.hidden = true;
    this.hookBar.setAttribute('role', 'group');
    this.hookBar.setAttribute('aria-label', '中継へ直接送ります');
    this.hookText.setAttribute('aria-live', 'polite');
    this.hookGo.type = 'button';
    this.hookGo.addEventListener('click', () => this.hookGoClick());
    this.hookBack.type = 'button';
    this.hookBack.addEventListener('click', () => {
      if (this.hookMode === 'failed') this.close(true); // 依頼は受け取り箱に残っている（伝票からも切り替えられる）
      else this.hideHook(true);
    });
    this.hookBar.append(this.hookText, this.hookGo, this.hookBack);
    foot.append(keys, clip, this.cancelButton, this.hookButton, this.sendButton);

    // 六角スクショ（S3.12）：上にサムネイル、依頼文などの下に ① と貼れなかったとき（② は下の主のボタン）
    this.shot = host.shot ? new ShotSteps(host.shot, () => this.refresh(), () => this.shotFirst(), host.editImage ? () => void this.editShot() : undefined) : null;
    this.secretNote.hidden = true;
    if (this.shot) this.element.append(head, this.shot.top, body, this.guide, this.shot.steps, this.secretBar, this.line, this.secretNote, this.hookBar, this.status, this.confirmBar, this.hookWhy, foot);
    else this.element.append(head, body, this.guide, this.secretBar, this.line, this.secretNote, this.hookBar, this.status, this.confirmBar, this.hookWhy, foot);
    this.element.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen() {
    return !this.element.hidden;
  }

  // 開く（開いていれば中身を入れ替える）
  open(options: BotRequestFormOpen) {
    this.targets = options.targets;
    const rawSelection = String(options.context?.selection ?? '');
    const rawBody = String(options.context?.body ?? '');
    this.cleaned = { selection: countInvisible(rawSelection), body: countInvisible(rawBody) };
    this.context = {
      url: sendableUrl(options.context?.url),
      title: cleanBotLine(String(options.context?.title ?? '')),
      selection: cleanBotText(rawSelection),
      body: cleanBotText(rawBody),
    };
    this.openKeys = null; // 開き直したら、色の比べる元を取り直す（前回送った依頼があればそちら）
    this.lastRequest = options.lastRequest ?? null;
    this.runChoice = null;
    this.runPresetIds = [];
    this.retryOf = options.retryOf ?? null;
    this.needConfirm = options.confirmApp === true;
    this.heading = options.heading || 'Grok Bot に頼む';
    this.busy = false;
    this.hideHook(false); // webhook の二段（R11）。経路の札は、このあと setImageMode が入れ直す
    this.nest = { ...(options.nest ?? {}) };
    this.leaveGuide();
    this.teamAsk = options.teamAsk ?? null;
    this.handoff = options.handoff ?? null;
    this.chatRadio.disabled = !!this.handoff;
    const image = this.shot && options.image && /^data:image\//.test(options.image) ? options.image : '';
    this.pasteMode = options.pasteMode === 'html' ? 'html' : 'two';
    this.shot?.setOneShot(this.pasteMode === 'html'); // 画像の貼り方（R7d）：開くたびに巣の設定から（「この回は 2 回貼りで」は持ち越さない）
    if (image) this.shot?.open(image, this.context.title ?? '');
    else this.shot?.close();
    // 画像に書き足す（R7b）：元の画像を持つ。前の書き足し・足した行は持ち越さない
    this.shotSrc = image;
    this.shotEdit = null;
    this.editLines = [];
    this.editLoads++;
    // クリップボードの画像の候補（R7a）：六角スクショでないときだけ。印は外した状態
    this.clipLoads++;
    const candidate = !image && this.shot && options.candidate && /^data:image\//.test(options.candidate.image) ? options.candidate.image : '';
    this.clip = candidate ? { image: candidate, on: false, busy: false, copy: null, copyOf: '', edit: null } : null;
    this.setImageMode(!!image);
    this.text.value = options.text ?? '';
    // 定型（R4a）：はじめの組は開いた入口で決める（前に開いたときの組は持ち越さない）。入れた行の覚えも消す
    this.entry = options.entry;
    this.presets = null;
    this.presetSet = -1;
    this.presetLines.clear();
    this.composing = false;
    this.hideShelf(false);
    this.hideCandidate();
    this.setPresets(options.presets);
    this.relayRadio.checked = true;
    for (const button of this.stampButtons.values()) button.setAttribute('aria-pressed', 'false'); // 朱書きは開くたびに外す
    this.roleFor = null; // 役の文は refresh が宛て先の役で入れる
    this.roleBase = '';
    this.roleInput.value = '';
    this.rawUrl = options.context?.url;
    this.secretBar.classList.remove('brf-secret-flash');
    this.renderAttach(this.rawUrl);
    this.renderTargets(options.to);
    this.status.textContent = options.note ?? '';
    this.skipCloseDraft = options.skipCloseDraft === true;
    this.hideConfirm(false);
    if (options.presetIds?.length) this.insertPresets(options.presetIds); // 頼み方を直す（R9）：元の依頼の定型を行に戻す
    // 続きとして（R5）：選び口を作り直し、はじめから選ぶ返事があれば選ぶ（頭の行は text で渡されている。そのまま入れ替えの元にする）
    this.followLoads++;
    this.follow = null;
    this.followHead = null;
    this.replies = [...(options.replies ?? [])];
    if (options.follow) {
      // 頭の行が「#0010 の続き…」なら、入れ替えの元にする（言い換えの依頼は #0010-2 の続き。R9）
      const head = this.text.value.split('\n')[0]?.trim() ?? '';
      this.followHead = head.startsWith(`${requestNo(options.follow.requestId)} の続き`) || /^#\d{4,6}-\d{1,3} の続き/.test(head) ? head : null;
      this.pickFollow(options.follow.requestId, options.follow.botId, options.follow.no);
      if (options.passTo) this.passTarget(options.passTo); // 別の子へ渡す（R9）：宛て先だけ次の子に
    } else this.renderFollow();
    void this.withholdBlocked();
    this.element.hidden = false;
    this.refresh();
    this.fit();
    window.addEventListener('resize', this.onResize);
    this.text.focus({ preventScroll: true });
    this.text.setSelectionRange(this.text.value.length, this.text.value.length);
    if (options.same) this.applySame(); // Ctrl+Shift+G を素早く 2 回（R6）
  }

  // 前回送った依頼の選び方の写しを新しくする（R6。左から写しが届いた）。描き直しは次の refresh で（updateTargets・applySame）
  setLastRequest(last: BotLastRequest | null | undefined) {
    this.lastRequest = last ?? null;
  }

  // 続きとして選べる返事の写しを新しくする（R5。左から一覧の写しが届いた）。選んでいる返事は、一覧から外れても残す
  setReplies(replies: BotRecentReply[] | undefined) {
    if (!this.isOpen) return;
    this.replies = [...(replies ?? [])];
    this.renderFollow();
  }

  // 宛て先の写しを新しくする（左から台帳の写しが届いた。選んでいた宛て先は残す。いなくなったら最初の選べる1体）
  //   みんなの A の案内のあいだは、組の席は変えない（作った組のまま進む）。presets：定型の写し（R4a。渡したときだけ。今の組は残す）
  updateTargets(targets: BotRequestTarget[], nest?: AskAllNest, presets?: BotPresets) {
    if (!this.isOpen) return;
    const current = this.toSelect.value;
    this.targets = targets;
    if (nest) this.nest = { ...nest };
    if (presets) this.setPresets(presets);
    if (!this.run) this.renderTargets(current);
    this.refresh();
  }

  // 閉じる（sent：送る部品に渡せた。みんなの A は、1席でも渡せていれば sent。まだの席の依頼は作らない。下書きには残る）
  close(sent: boolean) {
    if (!this.isOpen) return;
    const text = this.text.value;
    const draft = !this.skipCloseDraft && !this.run && !sent ? this.singleDraft(text.trim()) : null;
    this.skipCloseDraft = false;
    const anySent = sent || !!this.run?.sent.some(Boolean);
    this.element.hidden = true;
    this.hideConfirm(false);
    this.hideHook(false);
    this.leaveGuide();
    this.shot?.close(); // 画像を持ち続けない
    this.clip = null; // クリップボードの画像の候補と写しも（R7a。保存した写しは bot-shots に 7 日残る）
    this.clipLoads++;
    this.shotSrc = ''; // 書き足した版も（R7b）
    this.shotEdit = null;
    this.editLines = [];
    this.editLoads++;
    window.removeEventListener('resize', this.onResize);
    if (draft) void addSingleDraft(draft);
    this.host.closed(text, anySent);
  }

  // 1体の小窓を、コピーせずに閉じたとき。受け取り箱の上の下書きに残す（依頼は作らない）
  //   鍵らしき文字は〔鍵1〕…に置き換えてから残す（R2・D5。下書きは drafts.json と受け取り箱の上に出るので、生の値を残さない）
  private singleDraft(typed: string): BotDraft | null {
    const target = this.target();
    if (!typed || !target?.linked || this.toSelect.value === ASK_ALL) return null;
    const attach = this.attach();
    const edited = this.editedRoleText(target); // 直した役の文（R3。今回だけ）も下書きに残す
    const masker = secretMasker(attach.selection, attach.body, typed, edited, ...(attach.priorReply?.lines ?? []));
    if (attach.selection) attach.selection = masker.mask(attach.selection);
    if (attach.body) attach.body = masker.mask(attach.body);
    const text = masker.mask(typed);
    const roleText = edited === undefined ? undefined : masker.mask(edited);
    if (attach.priorReply) attach.priorReply = { ...attach.priorReply, lines: attach.priorReply.lines.map((line) => masker.mask(line)) }; // 前の返事の要点の行（R5）
    const image = !!this.shot?.active;
    const stamped = this.withStamps(text); // 朱書きは頼む文の末尾に（R3）。下書きの見出しの text は打った文のまま
    const asked = image && this.shot ? `${stamped}\n\n${this.shot.imageLine()}` : stamped;
    return {
      id: newDraftId(),
      createdAt: Date.now(),
      text,
      botId: target.id,
      botName: target.name,
      ...(target.role?.name ? { roleName: target.role.name } : {}),
      ...(target.seat ? { seat: target.seat } : {}),
      next: true,
      chatOnly: this.chatOnly,
      attach: flagsOf(attach, image),
      req: {
        ...draftFromForm(target.id, asked, attach, { chatOnly: this.chatOnly, role: target.role ?? null, deliverTo: this.deliverTo }),
        ...(roleText !== undefined ? { roleText } : {}),
        ...(this.follow ? { parentRequestId: this.follow.reply.requestId } : {}), // 続きの元（R5。下書きからコピーしても糸になる）
        ...(this.retryOf ? { retryOf: this.retryOf.requestId } : {}), // 言い換えの元（R9。下書きからコピーしても #0010-2）
        ...(this.usedPresetIds().length ? { presetIds: this.usedPresetIds() } : {}), // 使った定型（R9）
      },
    };
  }

  // ---------- 内側 ----------

  // Ctrl+Enter：送る（変換中は送らない）。Esc：その他 ▾ の一覧・候補が出ていれば閉じる、確かめの帯なら戻る、ふだんは閉じる
  //   （変換中の Esc は変換を消すだけ）。定型のキーは presetKey
  private onKey(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!this.presetShelfBox.hidden) this.hideShelf(true);
      else if (!this.candBar.hidden) this.hideCandidate();
      else if (!this.confirmBar.hidden) this.hideConfirm(true);
      else if (!this.hookBar.hidden) this.hookBack.click(); // webhook の二段（R11）：戻る（届かなかったあとは閉じる）
      else this.close(false);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (!this.confirmBar.hidden) this.confirmGo.click();
      else if (!this.hookBar.hidden) this.hookGo.click(); // webhook の二段（R11）：送る／コピーに切り替える
      else void this.submit();
    } else if (this.presetKey(e)) {
      e.preventDefault();
      e.stopPropagation(); // 右の相棒の Alt+1〜6（ai-panel.ts の document の keydown）に渡さない
    }
  }

  // 定型のキー（R4a・Q8）。使ったら true
  //   候補の取り込み：→（依頼文の終わりで、修飾キーなし）・Ctrl+Space。
  //   数字 1〜6：文字を打つ欄の外で（修飾キーなし。テンキーも）。Alt+1〜6：どこでも（上の段の数字だけ。テンキーの Alt+数字は Windows の文字の入力）。
  //   Ctrl・Shift つきの数字は見ない（Alt+Shift+数字の席は R4b）
  private presetKey(e: KeyboardEvent): boolean {
    if (this.presetBox.hidden || this.body.hidden) return false;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    if (e.target === this.text && this.candidate) {
      const end = this.text.value.length;
      const atEnd = this.text.selectionStart === end && this.text.selectionEnd === end;
      if ((plain && e.key === 'ArrowRight' && atEnd) || (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.code === 'Space')) return this.acceptCandidate();
    }
    if (e.ctrlKey || e.metaKey || e.shiftKey) return false;
    const n = e.altKey ? Number(/^Digit([1-6])$/.exec(e.code)?.[1] ?? 0) : !isTextField(e.target) && /^[1-6]$/.test(e.key) ? Number(e.key) : 0;
    if (!n) return false;
    this.pressPreset(n - 1);
    return true;
  }

  // 添付する情報の行（付けられるものだけ。何も無ければ「付けられる情報はありません」）
  //   rawUrl：? や # が付いていたら、消して送ることを添える。keep：いまの印（付ける・外す）を残して描き直す（鍵を置き換えたあと。R2）
  private renderAttach(rawUrl: string | undefined, keep = false) {
    const was = keep ? new Map([...this.checks].map(([key, input]) => [key, input.checked])) : null;
    this.checks.clear();
    const rows: HTMLElement[] = [];
    for (const row of ATTACH_ROWS) {
      const value = this.context[row.key] ?? '';
      if (!value) continue;
      const input = el('input', 'brf-checkbox');
      input.type = 'checkbox';
      input.checked = was?.get(row.key) ?? row.on;
      input.dataset.attach = row.key;
      input.addEventListener('change', () => this.refresh());
      this.checks.set(row.key, input);
      const label = el('label', 'brf-check');
      const textBox = el('span', 'brf-check-text');
      const n = chars(value);
      const name = row.key === 'selection' || row.key === 'body' ? `${row.label}（${n.toLocaleString()} 字${n > BOT_LIMITS.bodyChars ? '・2 万字で切る' : ''}）` : row.label;
      // 選んだ文・本文の見本は、鍵らしき文字を伏せた文から作る（R2。生の値はカードに描かない）
      const secret = row.key === 'selection' || row.key === 'body' ? findSecretish(value) : null;
      const sub = row.key === 'url' ? shown(value) : row.key === 'title' ? value : `「${snippet(secret?.masked ?? '')}」`;
      const subLine = el('span', 'brf-check-sub', sub);
      subLine.title = row.key === 'url' ? value : sub;
      textBox.append(el('span', 'brf-check-label', name), subLine);
      if (row.key === 'url' && rawUrl && /[?#]/.test(rawUrl)) textBox.append(el('span', 'brf-check-sub brf-check-warn', '? と # から後ろは送りません'));
      const removed = row.key === 'selection' ? this.cleaned.selection : row.key === 'body' ? this.cleaned.body : 0;
      if (removed) textBox.append(el('span', 'brf-check-sub brf-check-warn', `見えない文字を ${removed.toLocaleString('ja-JP')} つ消しました`));
      if (secret?.count) textBox.append(el('span', 'brf-check-sub brf-check-warn', `鍵らしき文字が ${secret.count.toLocaleString('ja-JP')} つあります（ここでは〔鍵〕で伏せて見せています）`));
      label.append(input, textBox);
      rows.push(label);
    }
    if (this.clip) rows.push(this.clipCard(this.clip)); // クリップボードの画像の候補（R7a）
    if (!rows.length) rows.push(el('p', 'brf-note', '付けられるものはありません（頼む文だけを送ります）'));
    this.attachList.replaceChildren(...rows);
  }

  // ---------- クリップボードの画像の候補（R7a・D15） ----------

  // 送るもののカード：縮小図・「画像（いまクリップボードにあるもの）」。印は外した状態で出し、付けたら写しを取る
  private clipCard(clip: NonNullable<BotRequestForm['clip']>): HTMLElement {
    const input = el('input', 'brf-checkbox');
    input.type = 'checkbox';
    input.checked = clip.on;
    input.disabled = clip.busy;
    input.dataset.attach = 'clip';
    input.addEventListener('change', () => void this.toggleClip(input.checked));
    const thumb = el('img', 'brf-cand-thumb');
    thumb.src = clipImage(clip); // 書き足した版があればそれ（R7b）
    thumb.alt = clip.edit ? 'クリップボードの画像（渡す画像）の縮小図' : 'クリップボードの画像の縮小図';
    const textBox = el('span', 'brf-check-text');
    const sub = clip.busy ? '写しを取っています…' : clip.on ? clipOnNote(!!this.shot?.oneShot) : '押して付ける。付けるとブラウザが先に写しを取る';
    this.clipSub = el('span', 'brf-check-sub brf-cand-sub', sub);
    textBox.append(el('span', 'brf-check-label', '画像（いまクリップボードにあるもの）'), this.clipSub);
    if (clip.edit) textBox.append(el('span', 'brf-check-sub brf-cand-sub', editedImageNote(clip.edit))); // この画像で送るもの（R7b）
    if (clip.on) textBox.append(el('span', 'brf-check-sub brf-check-warn', '⚠ 画像は Grok Bot に送られます'));
    const label = el('label', 'brf-check brf-cand');
    label.title = clip.on
      ? '印を外すと、画像は付けずに送ります（取った写しは、付け直すときに使います）'
      : `小窓を開いたときクリップボードにあった画像です。付けると、ブラウザが先に写しを取って bot-shots に保存し、六角スクショと同じく${this.pasteMode === 'html' ? '、画像と文を一つの貼り付けで（試し）' : ' ① 画像 → ② 文の 2 回貼りで'}送ります（みんなには送れません）`;
    label.append(input, thumb, textBox);
    // 書き足す（R7b。読む画面だけ）：カードの中のボタン（押しても印は変わらない。戻ったら印が付く）
    if (this.host.editImage) {
      const edit = el('button', 'brf-button brf-cand-edit', '書き足す →');
      edit.type = 'button';
      edit.disabled = clip.busy;
      edit.dataset.edit = 'clip';
      edit.title = '画像に丸・矢印・四角（箱ごとに問い）・番号・文字を書き足したり、黒塗り・ぼかしで隠したり、一点を指さしたりします。戻ると画像を付けます（元の画像は手元に残ります）';
      edit.addEventListener('click', (e) => {
        e.preventDefault(); // カードの印は変えない
        void this.editClip();
      });
      label.append(edit);
    }
    return label;
  }

  // 印を付けた：写しがまだなら取る（PNG にして bot-shots に保存）→ その写しで二段に。外した：二段を閉じる
  //   渡す画像は、書き足した版があればそれ（R7b。写しは渡す画像が変わったら取り直す）。focus：終わったら当てる所（印・「書き足す →」）
  private async toggleClip(on: boolean, focus: 'check' | 'edit' = 'check') {
    const clip = this.clip;
    const shot = this.shot;
    const save = this.host.shot;
    if (!clip || !shot || !save || clip.busy) return;
    if (!on) {
      clip.on = false;
      shot.close();
      this.afterClip(focus);
      return;
    }
    const image = clipImage(clip);
    if (!clip.copy || clip.copyOf !== image) {
      const loads = this.clipLoads;
      clip.busy = true;
      this.renderAttach(this.rawUrl, true);
      const png = await clipToPng(image);
      const shotId = newShotId();
      const path = png ? await save.saveImage(shotId, png) : null;
      if (loads !== this.clipLoads || this.clip !== clip || !this.isOpen) return; // 待つあいだに閉じた・開き直した
      clip.busy = false;
      if (!png || !path) {
        this.status.textContent = png ? '画像の写しを保存できなかったので、付けていません（もう一度押せます）' : '画像を読めなかったので、付けていません';
        this.renderAttach(this.rawUrl, true);
        this.focusClip();
        this.refresh();
        return;
      }
      clip.copy = { shotId, png, path };
      clip.copyOf = image;
    }
    clip.on = true;
    shot.open(image, this.context.title ?? '', clip.copy, this.editLook(clip.edit, null));
    this.afterClip(focus);
  }

  // 付けた・外したあと：経路の札・依頼文の案内・カード・宛て先（画像は 1 体だけ。みんなは出さない）・書き足しの行（R7b）を直す
  private afterClip(focus: 'check' | 'edit' = 'check') {
    const on = !!this.clip?.on;
    const wasAll = this.toSelect.value === ASK_ALL;
    this.setImageMode(on);
    this.renderAttach(this.rawUrl, true);
    if (!this.run) this.renderTargets(this.toSelect.value);
    if (on && wasAll) this.status.textContent = '画像を付けたので、宛て先を 1 体にしました（画像は 1 体だけに送ります）';
    this.syncEditLines(on ? (this.clip?.edit ?? null) : null); // 画像を外したら、足した行も外す
    if (focus === 'edit') this.focusClipEdit();
    else this.focusClip();
    this.refresh();
  }

  private focusClip() {
    this.attachList.querySelector<HTMLInputElement>('input[data-attach="clip"]')?.focus({ preventScroll: true });
  }

  private focusClipEdit() {
    this.attachList.querySelector<HTMLButtonElement>('button[data-edit="clip"]')?.focus({ preventScroll: true });
  }

  // ---------- 画像に書き足す（R7b・D15） ----------

  // 候補のカードの「書き足す →」：書き足しの面を開く → 戻ったら印を付け、渡す画像で写しを取り直す（同じ画像のままなら一文と 1 行だけ替える）
  private async editClip() {
    const clip = this.clip;
    const edit = this.host.editImage;
    if (!clip || !edit || clip.busy || this.busy || this.run) return;
    const loads = ++this.editLoads;
    const result = await edit(clip.image, clip.edit);
    if (loads !== this.editLoads || this.clip !== clip || !this.isOpen) return; // 待つあいだに閉じた・開き直した
    if (!result) {
      this.focusClipEdit(); // やめた：何も変えない
      return;
    }
    clip.edit = keptEdit(result); // 何も描かず、隠す候補も無ければ、書き足していないのと同じ
    if (clip.on && clip.copy && clip.copyOf === clipImage(clip)) {
      this.shot?.setLook(this.editLook(clip.edit, null));
      this.afterClip('edit');
      return;
    }
    await this.toggleClip(true, 'edit');
  }

  // 六角スクショの上のカードの「書き足す →」：書き足しの面を開く → 戻ったら渡す画像で二段を開き直す（同じ画像のままなら一文と 1 行だけ替える）
  private async editShot() {
    const shot = this.shot;
    const edit = this.host.editImage;
    if (!shot?.active || !edit || !this.shotSrc || this.busy || this.run) return;
    const loads = ++this.editLoads;
    const before = this.shotEdit?.image ?? this.shotSrc;
    const result = await edit(this.shotSrc, this.shotEdit);
    if (loads !== this.editLoads || !this.isOpen || !shot.active) return;
    if (result) {
      this.shotEdit = keptEdit(result);
      const image = this.shotEdit?.image ?? this.shotSrc;
      const look = this.editLook(this.shotEdit, this.context.title ?? '');
      if (image === before) shot.setLook(look);
      else shot.open(image, this.context.title ?? '', undefined, look); // 画像が変わった：① からやり直す
      this.syncEditLines(this.shotEdit);
      this.refresh();
    }
    shot.focusEdit();
  }

  // いま付けている画像の書き足し（候補の画像に印を付けていればその書き足し、でなければ六角スクショの書き足し）
  private imageEdit(): ImageEditResult | null {
    if (!this.shot?.active) return null;
    return this.clip?.on ? this.clip.edit : this.shotEdit;
  }

  // 書き足した画像の一文と 1 行（二段に渡す）。title：六角スクショの題名（候補なら null）。書き足していなければ undefined（ふつうの一文）
  private editLook(edit: ImageEditResult | null, title: string | null): ShotLook | undefined {
    return edit ? { line: (path) => editedImageLine(edit, title, path), note: editedImageNote(edit) } : undefined;
  }

  // 書き足しの行を依頼文の末尾に合わせる：箱ごとの問い「①の箱：…」と、指さしがあれば「ここは何？」（元の画像・画像なしなら無し）。
  //   前に入れた行のうち要らなくなったもの（そのままの文で残っているもの）は外す。同じ箱の行・同じ文がもうあれば足さない（打ち直した文を残す）
  private syncEditLines(edit: ImageEditResult | null) {
    const want = edit?.version === 'annotated' ? editRequestLines(edit) : [];
    const lines = this.text.value.split('\n');
    const kept: string[] = [];
    let removed = false;
    for (const old of this.editLines) {
      const at = lines.findIndex((line) => line.trim() === old);
      if (at < 0) continue; // 自分で直した・消した行は、もう追わない
      if (want.includes(old)) kept.push(old);
      else {
        lines.splice(at, 1);
        removed = true;
      }
    }
    const added: string[] = [];
    for (const line of want) {
      const head = /^[①-⑨]の箱：/.exec(line)?.[0];
      if (lines.some((l) => l.trim() === line || (!!head && l.trim().startsWith(head)))) continue;
      if (!added.length) while (lines.length && !lines[lines.length - 1].trim()) lines.pop(); // 終わりの空の行は詰めて、次の行に入れる
      lines.push(line);
      added.push(line);
    }
    if (!removed && !added.length) {
      this.editLines = kept;
      return;
    }
    const next = lines.join('\n');
    if (chars(next) > BOT_LIMITS.requestChars) {
      this.status.textContent = `依頼文が ${BOT_LIMITS.requestChars.toLocaleString('ja-JP')} 字を超えるので、箱の問いを入れられません`;
      return;
    }
    this.text.value = next;
    this.editLines = [...kept, ...added];
  }

  // 画像を付けているか（六角スクショ・クリップボードの画像）で、経路の札と依頼文の案内を替える
  //   画像入り 1 回（R7d。ShotSteps.oneShot）なら「画像入り 1 回で貼る」。1 回か 2 回かは小窓の中でも替わる（「この回は 2 回貼りで」）ので、refresh からも呼ぶ
  private setImageMode(image: boolean) {
    const one = image && !!this.shot?.oneShot;
    this.via.textContent = image ? (one ? '画像入り 1 回で貼る' : 'クリップボードで2回貼る') : 'クリップボードで送る';
    this.text.placeholder = image
      ? `この画像について Grok Bot に頼むこと（例：これは何？・この図を説明して。空でも送れます）。${one ? '画像と文を一つの貼り付けで貼ります（試し）' : '① 画像 → ② 文の順に貼ります'}`
      : 'Grok Bot に頼むこと（空でも、選んだ文や本文を付けていれば送れます。Ctrl+Enter でコピーしてアプリを開く・Esc でやめる）';
  }

  // 宛て先の一覧（巣の席 → 巣に置いていないボット → みんな）。グループに頼むときは、そのグループに固定する
  private renderTargets(want: string | undefined) {
    const ask = this.teamAsk;
    if (ask) {
      const o = el('option', '', `グループ：${ask.label}（${ask.seats.length}体）`);
      o.value = 'team';
      this.toSelect.replaceChildren(o);
      this.toSelect.value = 'team';
      this.toSelect.disabled = true;
      return;
    }
    const seated = this.targets.filter((t) => t.seat);
    const rest = this.targets.filter((t) => !t.seat);
    const option = (t: BotRequestTarget) => {
      const role = t.role ? t.role.name : '役なし';
      const label = t.seat ? `席${t.seat} ${role}・${t.name}` : `${t.name}（巣の外・${role}）`;
      const o = el('option', '', t.linked ? label : `${label}（リンクなし）`);
      o.value = t.id;
      o.disabled = !t.linked;
      return o;
    };
    const groups: HTMLElement[] = [];
    if (seated.length) {
      const g = el('optgroup');
      g.label = '巣の席';
      g.append(...seated.map(option));
      groups.push(g);
    }
    if (rest.length) {
      const g = el('optgroup');
      g.label = '巣に置いていない Grok-Bot（台帳）';
      g.append(...rest.map(option));
      groups.push(g);
    }
    if (seated.length && !this.shot?.active) {
      // みんなに聞く（六角スクショのときは出さない：貼る回数が増えるので、画像は1体だけに送る）
      const plan = this.plan();
      const g = el('optgroup');
      g.label = 'みんなに聞く';
      const label = plan.way === 'lead' ? `⬡ みんな（代表「${plan.lead?.name ?? ''}」にまとめて・${plan.roles.length}役）` : `⬡ みんな（1体ずつ・${plan.seats.length}体）`;
      const o = el('option', '', plan.way === 'each' && !plan.seats.length ? '⬡ みんな（リンクのある席がありません）' : label);
      o.value = ASK_ALL;
      o.disabled = plan.way === 'each' && !plan.seats.length;
      g.append(o);
      groups.push(g);
    }
    if (!groups.length) {
      const o = el('option', '', '（台帳に Grok-Bot がいません）');
      o.value = '';
      o.disabled = true;
      groups.push(o);
    }
    this.toSelect.replaceChildren(...groups);
    const options = [...this.toSelect.options];
    const pick = options.find((o) => o.value === want && !o.disabled) ?? options.find((o) => !o.disabled && o.value);
    if (pick) pick.selected = true;
    else this.toSelect.selectedIndex = 0;
    this.toSelect.disabled = !pick || !!this.handoff;
  }

  // みんなに聞くの送り方と聞く順（巣の席だけ）
  private plan(): AskAllPlan<BotRequestTarget> {
    return planAskAll(this.targets, this.nest);
  }

  // 選んでいる宛て先（みんなは、A なら最初に聞く席・B なら代表）
  private target(): BotRequestTarget | undefined {
    const value = this.toSelect.value;
    if (!value) return undefined;
    if (value === ASK_ALL) {
      const plan = this.plan();
      return plan.way === 'lead' ? plan.lead : plan.seats[0];
    }
    return this.targets.find((t) => t.id === value);
  }

  private get chatOnly() {
    return this.chatRadio.checked;
  }

  // 返し先「六角メモにも届く」（R10）：写す先（受け取り箱のときだけ。アプリのチャットだけとは両立しない）
  private get deliverTo(): BotDeliverTo | undefined {
    return this.memoRadio.checked && !this.chatOnly ? 'hex' : undefined;
  }

  // 返し先の種類（1 行の鍵・選び方の replyTo。R6・R10）
  private replyKind(chatOnly = this.chatOnly, deliverTo = this.deliverTo): BotLastReplyTo {
    return chatOnly ? 'chat' : deliverTo ? 'memo' : 'inbox';
  }

  // 返し先の説明（六角メモは、相棒の設定で選んだノートの名前も。まだ選んでいなければそう書く）
  private replyNoteText(): string {
    if (this.chatOnly) return '返事の決まりと依頼の JSON を付けず、記録もしません（付けた情報は頼む文の後ろに入ります。返事は受け取り箱に届きません）';
    if (!this.deliverTo) return '返事は中継から受け取り箱に届きます（返事の決まりと依頼の JSON を付けます）';
    const target = savedHexMemoTarget();
    const board = target ? target.label.split(' › ').pop() || target.label : '';
    return board
      ? `返事は受け取り箱に届き、確かめが通ったら、ブラウザが六角メモ「${board}」ノートに 1 マス写します（箱にも残ります。2 回は写しません）`
      : '返事は受け取り箱に届きます。六角メモの写す先がまだ決まっていません（相棒の設定の「六角メモへ」でノートを選ぶと写せます）';
  }

  // 付けると決めたもの（外したものは入れない）。続きとして選んだ返事の、印を付けた要点の行も（R5）
  private attach(): DraftAttach {
    const a: DraftAttach = {};
    for (const [key, input] of this.checks) if (input.checked && this.context[key]) a[key] = this.context[key];
    const prior = this.priorReply();
    if (prior) a.priorReply = prior;
    return a;
  }

  // 依頼文・添付・返し先・宛て先が変わった：送る前の1行・宛て先の説明・押せるかを直す（A の案内のあいだは案内を描く）
  private refresh() {
    this.refreshMain();
    this.syncHook(); // webhook「そのまま送る」（R11）：主のボタンが押せるか・送り方・中身を見て
    // 札（Grok Cards の段 5）から開いたときの鍵に似た字の知らせ。鍵の見張りの帯（R2）が出ていれば、そちらだけにする（同じことを 2 つ出さない）
    const secret = this.host.secret?.(this.text.value) ?? '';
    this.secretNote.textContent = secret;
    this.secretNote.hidden = !secret || !this.secretBar.hidden;
  }

  private refreshMain() {
    if (this.run) {
      this.secretBar.hidden = true; // 組は見張りを通ってから作る（文と添付は組のまま変わらない）
      this.renderGuide(this.run);
      return;
    }
    this.followBox.hidden = !!this.teamAsk || !!this.handoff || (!this.replies.length && !this.follow); // 続きとして（R5）
    this.refreshPresets(this.attach()); // 定型（R4a）：付けるものが変わっていれば入れた行を埋め直す（下で依頼文を読む前に）
    if (this.teamAsk) {
      this.refreshTeam(this.teamAsk);
      return;
    }
    const text = this.text.value.trim();
    const all = this.toSelect.value === ASK_ALL;
    const plan = all ? this.plan() : null;
    const target = this.target();
    const attach = this.attach();
    this.title.textContent = all ? '⬡ みんなに聞く' : this.heading;

    // 役の文の欄（R3。1体のときだけ直せる。みんな・まとめ役は一言だけ）
    this.syncRole(
      target,
      plan
        ? plan.way === 'lead'
          ? '代表への 1 つの依頼に、席ごとの役の文が並んで入ります（ここでは直せません）'
          : 'みんな：席ごとの役の文が、それぞれの依頼の頭に入ります（ここでは直せません）'
        : this.handoff
          ? 'まとめ役への依頼には、席の役を足しません'
          : target
            ? null
            : '',
    );

    // 宛て先の説明（依頼の頭に入る役。みんなは聞く順・代表）
    if (plan) this.toNote.replaceChildren(...(plan.notice ? [el('span', 'brf-check-warn', `${plan.notice}。`)] : []), this.askAllNote(plan)); // A に戻したわけは目立つ色で
    else if (!target) this.toNote.textContent = this.targets.length ? '選べる Grok-Bot がいません（リンクを貼ると選べます）' : '台帳に Grok-Bot がいません。巣の空いた席の ＋ から置けます';
    else if (this.handoff) this.toNote.textContent = 'まとめ役への依頼です。下の文がそのまま届きます（席の役は足しません）。ほかのボットの返事はデータとして囲んであります。コピーするまでアプリは開きません';
    else if (this.editedRoleText(target) !== undefined) this.toNote.textContent = '依頼の頭に、上で直した役の文が入ります（今回だけ。台帳の役は変えません）';
    else this.toNote.textContent = target.role ? `依頼の頭に役「${target.role.name}${target.seat ? `（巣の席${target.seat}）` : ''}」が入ります` : '役なしで送ります';

    // 返し先の説明
    this.replyNote.textContent = this.replyNoteText();

    const to = plan
      ? plan.way === 'lead'
        ? `みんな（代表「${plan.lead?.name ?? ''}」に${plan.roles.length}役をまとめて）`
        : `みんな（1体ずつ・${plan.seats.length}体）`
      : target
        ? target.seat
          ? `席${target.seat} ${roleNameOf(target)}・${target.name}`
          : `${target.name}（巣の外）`
        : '（なし）';
    const shot = this.shot?.active ? this.shot : null;
    this.showPreview(to, this.withStamps(text), attach, !!shot, plan ? plan.seats[0] : target);
    const secret = this.watchSecrets(attach); // 鍵の見張り（R2）：帯が出ているあいだは送れない

    // 頼む中身：文があるか、1体に頼むなら選んだ文・本文・画像のどれかが付いていればよい（R1・D4。みんなは文が要る）
    const payload = !all && this.hasPayload(attach, !!shot);
    const filled = !!text || payload;

    // 六角スクショ（S3.12）：② は ① を済ませた（か、飛ばした）後で押せる。画像入り 1 回（R7d）なら、はじめから「コピーしてアプリを開く」
    if (shot) {
      shot.refresh(!!target?.linked);
      const ok = filled && !!target?.linked && !this.busy && shot.ready && !secret;
      this.sendButton.disabled = !ok;
      this.cancelButton.textContent = 'やめる';
      this.cancelButton.title = text ? 'やめる（Esc）。依頼は作りません。書いた文は、受け取り箱の上の下書きに残します' : 'やめる（Esc）。依頼は作りません';
      this.setImageMode(true);
      if (this.clipSub && this.clip?.on && !this.clip.busy) this.clipSub.textContent = clipOnNote(shot.oneShot); // 貼る回数が替わったかもしれない（R7d）
      if (shot.oneShot) {
        this.sendButton.textContent = 'コピーしてアプリを開く';
        this.sendButton.title = secret
          ? this.secretWhy
          : !filled
            ? '依頼文を書くと押せます'
            : !target?.linked
              ? '宛て先を選ぶと押せます'
              : `依頼の文と画像を一つの貼り付けにしてコピーし、Grok Bot アプリの「${target.name}」のチャットを開きます。貼って（Ctrl+V）送ってください。アプリが画像入りの貼り付けを受けないと、文だけが貼られて画像は落ちます（Ctrl+Enter）`;
        return;
      }
      this.sendButton.textContent = '② 文をコピー';
      this.sendButton.title = secret
        ? this.secretWhy
        : !filled
          ? '依頼文を書くと押せます'
          : !target?.linked
            ? '宛て先を選ぶと押せます'
            : !shot.ready
              ? '先に「① 画像をコピーしてアプリを開く」を押してください（貼れないときは「画像を貼らずに ② へ」か「貼れなかったとき」）'
              : `依頼の文をコピーして、Grok Bot アプリの「${target.name}」のチャットを開きます。画像の後に貼って（Ctrl+V）送ってください（Ctrl+Enter）`;
      return;
    }

    // 押せるか。みんなの A は「1/6 調査：コピーしてアプリを開く」
    const ok = filled && !!target?.linked && !this.busy && !secret;
    this.sendButton.disabled = !ok;
    this.cancelButton.textContent = 'やめる';
    this.cancelButton.title = text ? 'やめる（Esc）。依頼は作りません。書いた文は、受け取り箱の上の下書きに残します' : 'やめる（Esc）。依頼は作りません';
    this.sendButton.textContent = plan?.way === 'each' && target ? `1/${plan.seats.length} ${roleNameOf(target)}：コピーしてアプリを開く` : 'コピーしてアプリを開く';
    this.sendButton.title = secret
      ? this.secretWhy
      : !filled
        ? all
          ? 'みんなに聞くときは、依頼文を書くと押せます'
          : '依頼文を書くか、選んだ文・本文を付けると押せます'
        : !target?.linked
          ? '宛て先を選ぶと押せます'
          : plan?.way === 'each'
            ? `1体めの「${target.name}」の依頼をコピーして、Grok Bot アプリのチャットを開きます。貼って送ったら、小窓の「次」で次の席へ進みます（Ctrl+Enter）`
            : `依頼をコピーして、Grok Bot アプリの「${target.name}」のチャットを開きます（Ctrl+Enter）`;
  }

  // みんなの宛て先の説明（聞く順・飛ばす席・代表。A に戻したわけは refresh が前に足す）
  private askAllNote(plan: AskAllPlan<BotRequestTarget>): string {
    const notes: string[] = [];
    if (plan.way === 'lead' && plan.lead) {
      notes.push(`B 代表にまとめて：代表「${plan.lead.name}」に、${plan.roles.map(roleNameOf).join('・')} の${plan.roles.length}役を並べた依頼を1つ送ります（返事は役ごとの見出しと「まとめ」。貼るのは1回）`);
    } else if (plan.seats.length) {
      notes.push(`A 1体ずつ：${plan.seats.map((t, i) => `${i + 1} ${roleNameOf(t)}`).join(' → ')} の順に、1体ずつ「コピーしてアプリを開く」を案内します。次の席へ進むのは「次」を押したときだけです`);
    } else notes.push('リンクのある席がありません（席のボットにリンクを貼ると聞けます）');
    if (plan.way === 'each' && plan.skipped.length) notes.push(`リンクの無い席は飛ばします（${plan.skipped.map((t) => `席${t.seat} ${t.name}`).join('・')}）`);
    return notes.join('。');
  }

  private howWords(kind: BotLastReplyTo): string {
    return kind === 'chat' ? 'アプリのチャットだけ（JSON・記録なし）' : kind === 'memo' ? '受け取り箱 → 六角メモにも写す' : '受け取り箱へ';
  }

  // 渡し止めのサイトなら、URL・選んだ文・本文・スクショを外す。人が書いた頼む文は残す。
  private async withholdBlocked(): Promise<void> {
    const url = this.context.url ?? '';
    if (!url) return;
    const generation = ++this.blockLoads;
    const hosts = await ensureBlocklist();
    if (generation !== this.blockLoads || !this.isOpen || !isBlockedUrl(url, hosts)) return;
    this.context = { ...this.context, url: '', selection: '', body: '' };
    this.shot?.close();
    this.clip = null; // クリップボードの画像の候補も外す（R7a。渡し止めのページの写しかもしれない）
    this.clipLoads++;
    this.shotEdit = null; // 書き足した版と、足した行も（R7b）
    this.editLoads++;
    this.syncEditLines(null);
    this.via.textContent = 'クリップボードで送る';
    this.status.textContent = BLOCK_NOTE;
    this.renderAttach(undefined);
    this.refresh();
  }

  // 送る：はじめての確かめ → draftFromForm → BotSender。渡せたら閉じる。だめならわけを出して開いたまま
  //   みんなの A：組を作って案内のモードに入り、1席めを送る（案内のあいだは guideStep）。B：代表に1つ送って閉じる
  private async submit(way: 'copy' | 'hook' = 'copy') {
    if (this.busy || !this.isOpen) return;
    this.sending = way; // webhook（R11）か、コピーしてアプリを開くか（sendOne・sendAllAtOnce が見る）
    if (way === 'hook' && (this.run || this.shot?.active)) return; // 押せない形（syncHook が止めている）
    if (this.run) {
      await this.guideStep();
      return;
    }
    if (this.secretBlocked()) return; // 鍵の見張り（R2）：置き換えるか外すまで送らない
    if (this.teamAsk) {
      await this.submitTeam();
      return;
    }
    const typed = this.text.value.trim();
    const target = this.target();
    const all = this.toSelect.value === ASK_ALL;
    if (!typed && (all || this.handoff || !this.hasPayload(this.attach(), !!this.shot?.active))) {
      this.status.textContent = all || this.handoff ? '依頼文が空です。書いてから、もう一度どうぞ' : '頼む中身がありません。依頼文を書くか、選んだ文・本文・画像を付けてください';
      this.text.focus();
      return;
    }
    if (!target?.linked) return;
    await this.withholdBlocked();
    if (this.secretBlocked()) return; // 待つあいだに打った文も見る
    // webhook（R11）：確かめたあとに中身が変わった（待つあいだに打った・渡し止めで外れた）なら送らない。確かめた中身だけを送る
    if (way === 'hook' && (this.hookMode !== 'confirm' || this.hookSnapshot() !== this.hookSnap)) {
      this.hideHook(false, HOOK_CHANGED);
      this.refresh();
      return;
    }
    // 渡し止めで選んだ文・本文が消えたら、空の依頼文では送れない（withholdBlocked のあとでもう一度見る）
    if (!typed && !this.hasPayload(this.attach(), !!this.shot?.active)) {
      this.status.textContent = '頼む中身がありません。依頼文を書くか、選んだ文・本文・画像を付けてください';
      this.text.focus();
      return;
    }
    const shot = this.shot?.active ? this.shot : null;
    const text = this.withStamps(typed || this.impliedText(target, !!shot)); // 空なら、役が補う一文（R1・D4）。朱書きは末尾に 1 行（R3）
    const roleText = this.editedRoleText(target); // 直した役の文（R3。1体のときだけ。直していなければ undefined＝左が台帳の役で作る）
    const withRole = (req: DraftRequest): DraftRequest => (roleText !== undefined ? { ...req, roleText } : req);
    const choice = this.choiceNow(); // 選び方（R6。文は入れない。左が送れたら last-request.json に書く。まとめ役は null）
    // 続きの元（R5。糸にする）：1体・代表にまとめて・六角スクショの依頼に付ける（みんなの 1体ずつは組のカードのまま、糸にしない）
    const parent = this.follow ? this.follow.reply.requestId : undefined;
    // 言い換えの元と使った定型（R9）：1体・代表にまとめて・六角スクショの依頼に付ける（みんなの 1体ずつ・グループは席ごとに定型だけ。sendSeat）
    const retryOf = this.retryOf?.requestId;
    const presetIds = this.usedPresetIds();
    const withChoice = (req: DraftRequest): DraftRequest => ({
      ...req,
      ...(choice ? { choice } : {}),
      ...(parent ? { parentRequestId: parent } : {}),
      ...(retryOf ? { retryOf } : {}),
      ...(presetIds.length ? { presetIds } : {}),
    });
    if (shot && !shot.ready) {
      this.shotFirst(); // 六角スクショ：① がまだなら、Ctrl+Enter は ①
      return;
    }
    if (this.needConfirm && way === 'copy') {
      this.showConfirm(); // 外のアプリを開く前のはじめての確かめ（webhook はアプリを開かないので聞かない）
      return;
    }
    if (shot) {
      // ② 文をコピー：頼む文の後ろに画像の一文を足すだけ（画像は依頼に入れない。経路は1体のときと同じ）
      //   画像入り 1 回（R7d）：先に渡す画像の写しを保存し、その名前を SendAfter の image で（保存できなければ 2 回貼りに戻して、ここで止める）
      let image: ShotRef | undefined;
      if (shot.oneShot) {
        this.busy = true;
        this.refresh();
        const ref = await shot.prepareOne();
        this.busy = false;
        if (!this.isOpen || !shot.active) return; // 待つあいだに閉じた
        if (!ref) {
          this.refresh();
          return;
        }
        image = ref;
      }
      const asked = `${text}\n\n${shot.imageLine()}`;
      await this.sendOne(withChoice(withRole(draftFromForm(target.id, asked, this.attach(), { chatOnly: this.chatOnly, role: target.role ?? null, deliverTo: this.deliverTo }))), target, image ? { image } : undefined);
      return;
    }
    if (this.handoff) {
      await this.sendOne(draftFromForm(target.id, text, this.attach(), { role: null, group: this.handoff.group, team: this.handoff.team, summary: true, seat: 0, deliverTo: this.deliverTo }), target);
      return;
    }
    if (all) {
      if (!(await this.askAllGate())) return;
      const plan = this.plan();
      if (plan.way === 'each' && way === 'hook') {
        // webhook（R12）：案内を出さず、席ごとに一度に送る
        await this.sendAllAtOnce(createAskAllRun(plan.seats, text, this.attach(), { chatOnly: false, deliverTo: this.deliverTo }), choice, presetIds);
        return;
      }
      if (plan.way === 'each') {
        // 組を作る（依頼はまだ作らない。席は下書きに残す）→ 1席めを送る
        this.run = createAskAllRun(plan.seats, text, this.attach(), { chatOnly: this.chatOnly, deliverTo: this.deliverTo });
        this.host.askAllRun?.(this.run.group);
        this.runChoice = choice; // 席ごとの依頼に同じ選び方を載せる（sendSeat）
        this.runPresetIds = presetIds; // 使った定型も席ごとに（R9）
        void putAskAllDrafts(this.run);
        this.body.hidden = true;
        this.guide.hidden = false;
        this.guideMsg.textContent = '';
        await this.sendSeat();
        return;
      }
      const req = askLeadDraft(plan, text, this.attach(), { chatOnly: this.chatOnly, deliverTo: this.deliverTo });
      if (req) await this.sendOne(withChoice(req), target);
      return;
    }
    await this.sendOne(withChoice(withRole(draftFromForm(target.id, text, this.attach(), { chatOnly: this.chatOnly, role: target.role ?? null, deliverTo: this.deliverTo }))), target);
  }

  // みんなに聞くを送る前の確認（S3.7。host.beforeAskAll）。待つあいだは押しても重ならない（busy）。
  //   待つあいだに小窓が閉じた・宛て先が変わったら送らない（false）
  private async askAllGate(): Promise<boolean> {
    if (!this.host.beforeAskAll) return true;
    const plan = this.plan();
    this.busy = true;
    this.refresh();
    try {
      await this.host.beforeAskAll(plan.way === 'lead' ? { way: 'lead', count: plan.roles.length, lead: plan.lead?.name } : { way: 'each', count: plan.seats.length });
    } finally {
      this.busy = false;
    }
    if (!this.isOpen || this.run || this.toSelect.value !== ASK_ALL) return false;
    this.refresh();
    this.sendButton.focus({ preventScroll: true });
    return true;
  }

  // 1つ送って閉じる（1体・B）。after：画像入り 1 回の写し（R7d）
  private async sendOne(req: DraftRequest, target: BotRequestTarget, after?: SendAfter) {
    const hook = this.sending === 'hook'; // webhook（R11）：中継へ直接。結果を待ってから閉じる
    this.busy = true;
    this.refresh();
    this.status.textContent = hook ? '中継へ送っています…（答えを 15 秒ほど待ちます）' : 'コピーしています…';
    const result = await this.host.sender.send(hook ? { ...req, via: 'hook' } : req, after);
    this.busy = false;
    if (!result.ok) {
      this.status.textContent = result.message;
      if (hook) this.hookFailedBar(req.botId, result);
      this.refresh();
      return;
    }
    this.rememberSent();
    this.host.sent?.(req, target);
    this.close(true);
  }

  // 送れた：いまの「送る前の 1 行」を、次に色を比べる元にする（R1・D2。この面のあいだ覚える）
  private rememberSent() {
    lastSent = { at: Date.now(), keys: { ...this.keysNow } };
  }

  // 1体に頼むとき、文が空でも送れる中身があるか（選んだ文・本文・画像。R1・D4）
  private hasPayload(attach: DraftAttach, image: boolean): boolean {
    return !!attach.selection || !!attach.body || image;
  }

  // 依頼文が空のときに頼む文にする、役が補う一文（R1・D4。計画の Q10）
  private impliedText(target: BotRequestTarget | undefined, image: boolean): string {
    if (image && !this.attach().selection && !this.attach().body) return IMPLIED_IMAGE;
    const name = target?.role?.name ?? '';
    return IMPLIED_BY_ROLE[name] ?? IMPLIED_DEFAULT;
  }

  // ---------- 定型（R4a・D9） ----------

  // 定型の写しを入れる（開いたとき・写しが届いたとき）。組・定型の中身が同じなら、回数などを入れ替えるだけ（ボタンは描き直さない）。
  //   変わったら、今の組が残っていればその組・無ければ入口の組で描き直す
  private setPresets(next: BotPresets | undefined) {
    const usable = next && next.sets.length ? next : null;
    const shape = (p: BotPresets | null) => JSON.stringify(p ? [p.sets, p.presets.map((x) => [x.id, x.text, x.shelf])] : null);
    const same = shape(usable) === shape(this.presets);
    const setId = this.presets?.sets[this.presetSet]?.id;
    this.presets = usable;
    if (same) return;
    const keep = usable && setId ? usable.sets.findIndex((s) => s.id === setId) : -1;
    this.presetSet = usable ? (keep >= 0 ? keep : presetSetIndex(usable.sets, this.entry)) : -1;
    this.renderPresetSet();
    if (!this.presetShelfBox.hidden) this.renderShelf();
  }

  private presetById(id: string | undefined): BotPreset | undefined {
    return id ? this.presets?.presets.find((p) => p.id === id) : undefined;
  }

  // 付けているものだけで穴を埋めた文（埋まらなければ null）。{前の返事の要点}（R5）は要点の行に印があるときだけ「#0010 の要点」
  //   （要点の中身は頼む文に入れず、添えた情報の枠の「前の返事 #0010（データ）：」で渡す）
  private fillOf(preset: BotPreset, attach: DraftAttach): string | null {
    const summary = attach.priorReply?.lines.length ? `${requestNo(attach.priorReply.requestId)} の要点` : undefined;
    return fillPreset(preset.text, { selection: attach.selection, title: attach.title, summary });
  }

  // 埋まらない定型のわけ（ボタンの説明・押したときの知らせ）
  private unfilledNote(preset: BotPreset): string {
    const why = presetHoles(preset.text).map((hole) => (hole === '前の返事の要点' ? '前の返事の要点が無い（続きとして頼むときだけ）' : `${hole}を付けていない`));
    return `${why.join('・') || '埋めるものが無い'}ので、この定型は使えません`;
  }

  // 依頼文の行（定型の見分けに使う）。画像の書き足しが入れた行（R7b：箱の問い・ここは何？）は定型の行と見なさない
  //   （押して入れた定型と同じ文なら、定型として見る）
  private textLines(): string[] {
    const lines = this.text.value.split('\n').map((line) => line.trim());
    if (!this.editLines.length) return lines;
    const pressed = new Set(this.presetLines.values());
    const ours = new Set(this.editLines.filter((line) => !pressed.has(line)));
    return lines.filter((line) => !ours.has(line));
  }

  // 今の組の名前・入口と、6 つのボタンの中身（数字の札と、穴に色を付けた文）。押せるか・押した印は refreshPresets
  private renderPresetSet() {
    const presets = this.presets;
    const set = presets?.sets[this.presetSet];
    const hand = presets && set ? presetHand(presets, set) : [];
    this.presetSetName.textContent = set?.name ?? '';
    this.presetSetAxis.textContent = set ? `（入口「${PRESET_ENTRY_LABEL[set.entry]}」の組）` : '';
    const many = (presets?.sets.length ?? 0) > 1;
    this.presetPrev.disabled = !many;
    this.presetNext.disabled = !many;
    this.presetButtons.forEach((button, i) => {
      const preset = hand[i];
      button.hidden = !preset;
      button.dataset.preset = preset?.id ?? '';
      if (preset) button.replaceChildren(el('span', 'brf-pre-key', String(i + 1)), this.presetTextNode(preset));
      else button.replaceChildren();
    });
    this.presetOther.hidden = !presets; // 棚が空でも出す（足の「棚を整える…」へ。R4b）
    if (this.presetOther.hidden) this.hideShelf(false);
  }

  private presetTextNode(preset: BotPreset): HTMLElement {
    const text = el('span', 'brf-pre-text');
    text.append(...presetParts(preset.text).map((part) => el('span', part.hole ? 'brf-pre-hole' : '', part.text)));
    return text;
  }

  // 定型の欄を、いまの付けるもの・依頼文に合わせる（押せるか・押した印・説明）。付けるものが変わったら、入れた行を埋め直す
  private refreshPresets(attach: DraftAttach) {
    const show = !!this.presets && this.presetSet >= 0 && !this.handoff;
    this.presetBox.hidden = !show;
    if (!show) {
      this.hideShelf(false);
      this.hideCandidate();
      return;
    }
    this.refillPresetLines(attach);
    const lines = this.textLines();
    const paint = (button: HTMLButtonElement) => {
      const preset = this.presetById(button.dataset.preset);
      if (!preset || button.hidden) return;
      const filled = this.fillOf(preset, attach);
      const on = !!filled && lines.includes(filled);
      button.disabled = !filled;
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.title = filled ? `${on ? 'もう一度押すと、依頼文から外します' : '依頼文の最後の行に入れます'}：${filled}` : this.unfilledNote(preset);
      button.querySelector<HTMLElement>('.brf-pre-empty')?.toggleAttribute('hidden', !!filled);
    };
    this.presetButtons.forEach(paint);
    for (const button of this.presetShelfBox.querySelectorAll<HTMLButtonElement>('button[data-preset]')) paint(button);
  }

  // 入れた定型の行を、いまの付けるもので埋め直す（外した選んだ文・題名の見本を依頼に残さない。D9「埋まらない穴の一文は消える」）。
  //   行が見つからない（自分で直した・消した）ものは、もう追わない
  private refillPresetLines(attach: DraftAttach) {
    if (!this.presetLines.size) return;
    const lines = this.text.value.split('\n');
    let changed = false;
    let dropped = 0;
    for (const [id, was] of [...this.presetLines]) {
      const preset = this.presetById(id);
      const now = preset ? this.fillOf(preset, attach) : was;
      if (now === was) continue;
      const at = lines.findIndex((line) => line.trim() === was);
      if (at < 0) {
        this.presetLines.delete(id);
        continue;
      }
      if (now) {
        lines[at] = now;
        this.presetLines.set(id, now);
      } else {
        lines.splice(at, 1);
        this.presetLines.delete(id);
        dropped++;
      }
      changed = true;
    }
    if (!changed) return;
    this.text.value = lines.join('\n');
    if (dropped) this.status.textContent = `付けるものを外したので、埋まらなくなった定型の行を依頼文から外しました（${dropped.toLocaleString('ja-JP')} 行）`;
  }

  // 6 つのボタンの i 番め（数字キー i+1）を押した
  private pressPreset(index: number) {
    const button = this.presetButtons[index];
    const preset = button && !button.hidden ? this.presetById(button.dataset.preset) : undefined;
    if (preset) this.togglePreset(preset);
  }

  // 定型を依頼文の最後の行に入れる。もう入っていれば（同じ行があれば）外す。入れたときだけ host.presetUsed
  private togglePreset(preset: BotPreset) {
    const filled = this.fillOf(preset, this.attach());
    if (!filled) {
      this.status.textContent = this.unfilledNote(preset);
      return;
    }
    const lines = this.text.value.split('\n');
    const at = lines.findIndex((line) => line.trim() === filled);
    if (at >= 0 && this.editLines.includes(filled) && !this.presetLines.has(preset.id)) {
      // 画像の書き足し（R7b）が入れた同じ文の行は、外さずに、押した定型の行として引き取る
      this.editLines = this.editLines.filter((line) => line !== filled);
      this.presetLines.set(preset.id, filled);
      this.host.presetUsed?.(preset.id, this.presets?.sets[this.presetSet]?.id);
      this.hideCandidate();
      this.refresh();
      return;
    }
    if (at >= 0) {
      lines.splice(at, 1);
      this.presetLines.delete(preset.id);
    } else {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop(); // 終わりの空の行は詰めて、次の行に入れる
      lines.push(filled);
      if (chars(lines.join('\n')) > BOT_LIMITS.requestChars) {
        this.status.textContent = `依頼文が ${BOT_LIMITS.requestChars.toLocaleString('ja-JP')} 字を超えるので、定型を入れられません`;
        return;
      }
      this.presetLines.set(preset.id, filled);
      this.host.presetUsed?.(preset.id, this.presets?.sets[this.presetSet]?.id);
    }
    this.text.value = lines.join('\n');
    this.hideCandidate();
    if (document.activeElement === this.text) this.text.setSelectionRange(this.text.value.length, this.text.value.length);
    this.refresh();
  }

  // ◀ ▶：組を替える（輪のように回る）
  private stepPresetSet(delta: number) {
    const n = this.presets?.sets.length ?? 0;
    if (n < 2) return;
    this.presetSet = (this.presetSet + delta + n) % n;
    this.renderPresetSet();
    this.hideCandidate();
    this.refresh();
  }

  // その他 ▾：棚の定型の小さな一覧を出し入れする（出したら最初の押せる定型へ）
  private toggleShelf() {
    if (!this.presetShelfBox.hidden) {
      this.hideShelf(true);
      return;
    }
    if (!this.presets) return;
    this.renderShelf();
    this.presetShelfBox.hidden = false;
    this.presetOther.setAttribute('aria-expanded', 'true');
    this.refreshPresets(this.attach());
    this.presetShelfBox.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  // 棚の一覧を作る（押すと入る・もう一度で外れる。埋まらない定型は「いまは空」で押せない）。押せるか・押した印は refreshPresets
  private renderShelf() {
    const items = (this.presets ? presetShelf(this.presets) : []).map((preset) => {
      const button = el('button', 'brf-pre-shelf-item');
      button.type = 'button';
      button.dataset.preset = preset.id;
      button.setAttribute('aria-pressed', 'false');
      button.append(this.presetTextNode(preset), el('span', 'brf-pre-hint brf-pre-empty', '（いまは空）'));
      button.addEventListener('click', () => {
        this.hideShelf(true);
        this.togglePreset(preset);
      });
      return button;
    });
    // 足（R4b）：棚を整える…（巣の ⚙ の「定型」タブ。読む画面では、巣の ⚙ で整えることを知らせる）
    const tidy = el('button', 'brf-button brf-pre-tidy', '棚を整える…');
    tidy.type = 'button';
    tidy.title = this.host.openShelf
      ? '巣の ⚙ の「定型」タブを開きます（手元・棚・蔵・寿命・送った依頼から拾う）。小窓は閉じ、書きかけの依頼文は「やめる」と同じに残ります'
      : '定型の棚は、右の巣の ⚙ の「定型」タブで整えます';
    tidy.addEventListener('click', () => {
      if (this.host.openShelf) {
        this.host.openShelf();
        return;
      }
      this.hideShelf(true);
      this.status.textContent = '定型の棚（手元・棚・蔵・寿命・送った依頼から拾う）は、右の巣の ⚙ の「定型」タブで整えます';
    });
    const foot = el('div', 'brf-pre-shelf-foot');
    foot.append(el('p', 'brf-pre-keys', items.length ? '棚の定型（全部の組で一つ）。押すと依頼文に入り、もう一度押すと外れます' : '棚は空です'), tidy);
    this.presetShelfBox.replaceChildren(...items, foot);
  }

  private hideShelf(focusOther: boolean) {
    if (this.presetShelfBox.hidden) return;
    this.presetShelfBox.hidden = true;
    this.presetOther.setAttribute('aria-expanded', 'false');
    if (focusOther) this.presetOther.focus({ preventScroll: true });
  }

  // 打ちながら候補（D9）：依頼文に入力先があり、変換中でなく、最後の行が今の組の定型の頭と同じなら出す（もう入っている定型は出さない）
  private updateCandidate() {
    const presets = this.presets;
    const set = presets?.sets[this.presetSet];
    if (!presets || !set || this.composing || this.presetBox.hidden || this.body.hidden || document.activeElement !== this.text) {
      this.hideCandidate();
      return;
    }
    const value = this.text.value;
    const last = value.slice(value.lastIndexOf('\n') + 1);
    const attach = this.attach();
    const lines = this.textLines();
    let hit: { preset: BotPreset; filled: string } | null = null;
    for (const preset of presetHand(presets, set)) {
      const filled = this.fillOf(preset, attach);
      if (filled && !lines.includes(filled) && presetMatches(preset.text, filled, last)) {
        hit = { preset, filled };
        break;
      }
    }
    this.candidate = hit?.preset ?? null;
    this.candBar.hidden = !hit;
    this.candButton.textContent = hit?.filled ?? '';
  }

  private hideCandidate() {
    this.candidate = null;
    this.candBar.hidden = true;
  }

  // 候補を取り込む：最後の行を、その定型を埋めた文にする
  private acceptCandidate(): boolean {
    const preset = this.candidate;
    const filled = preset ? this.fillOf(preset, this.attach()) : null;
    if (!preset || !filled) return false;
    const value = this.text.value;
    const next = value.slice(0, value.lastIndexOf('\n') + 1) + filled;
    if (chars(next) > BOT_LIMITS.requestChars) return false;
    this.text.value = next;
    this.presetLines.set(preset.id, filled);
    this.host.presetUsed?.(preset.id, this.presets?.sets[this.presetSet]?.id);
    this.hideCandidate();
    this.text.focus({ preventScroll: true });
    this.text.setSelectionRange(next.length, next.length);
    this.refresh();
    return true;
  }

  // ---------- 鍵の見張り（R2・D5） ----------

  // 送る文のうち、鍵らしき文字がある欄とその数（選んだ文・本文は付けているものだけ。画像の中は R7c まで見ない）
  private secretsNow(attach: DraftAttach): { key: SecretKey; count: number }[] {
    const sources: [SecretKey, string | undefined][] = [
      ['selection', attach.selection],
      ['body', attach.body],
      ['text', this.text.value],
      ['role', this.roleOne() ? this.roleInput.value : undefined], // 役の文（R3。1体のときだけ欄が送られる）
      ['prior', attach.priorReply?.lines.join('\n')], // 前の返事の要点の行（R5。印を付けたものだけ）
    ];
    const found: { key: SecretKey; count: number }[] = [];
    for (const [key, value] of sources) {
      const count = value ? findSecretish(value).count : 0;
      if (count) found.push({ key, count });
    }
    return found;
  }

  // 帯を出し入れする（出ていれば true＝送れない）。帯の文・置き換える番号・外せる欄のボタン・送れないわけを決める
  private watchSecrets(attach: DraftAttach): boolean {
    const found = this.secretsNow(attach);
    this.secretBar.hidden = !found.length;
    if (!found.length) {
      this.secretBar.classList.remove('brf-secret-flash');
      if (this.secretWhy && this.status.textContent === this.secretWhy) this.status.textContent = '';
      this.secretWhy = '';
      return false;
    }
    const range = secretRange(nextSecretLabel(this.context.selection, this.context.body, this.text.value, this.roleInput.value, ...this.followTexts()), found.reduce((sum, f) => sum + f.count, 0));
    this.secretText.textContent = `送る文のどこか（${found.map((f) => SECRET_WHERE[f.key]).join('／')}）に鍵らしき文字があります。このままでは送れません`;
    this.secretMask.textContent = `${range}に置き換えて送る`;
    this.secretDropSelection.hidden = !found.some((f) => f.key === 'selection');
    this.secretDropBody.hidden = !found.some((f) => f.key === 'body');
    const ways = found.map((f) => (f.key === 'text' || f.key === 'role' ? `${SECRET_WHERE[f.key]}から消す` : f.key === 'prior' ? `${SECRET_WHERE.prior}の行の印を外す` : `${SECRET_WHERE[f.key]}を外す`));
    this.secretWhy = `鍵らしき文字を${range}に置き換えるか、${ways.join('か、')}まで送れません`;
    return true;
  }

  // 送ろうとした（ボタン・Ctrl+Enter）：帯が出ていれば、帯を光らせて知らせにわけを出し、送らない
  private secretBlocked(): boolean {
    if (!this.watchSecrets(this.attach())) return false;
    this.secretBar.classList.add('brf-secret-flash');
    window.clearTimeout(this.secretFlash);
    this.secretFlash = window.setTimeout(() => this.secretBar.classList.remove('brf-secret-flash'), SECRET_FLASH_MS);
    this.status.textContent = this.secretWhy;
    return true;
  }

  // 「〔鍵1〕に置き換えて送る」：付けた選んだ文・本文と依頼文・役の文（R3）の鍵らしき文字を〔鍵n〕にする（元の値は持たない）。
  //   送るのは、このあと使う人が「コピーしてアプリを開く」を押したとき
  private maskSecrets() {
    const attach = this.attach();
    const masker = secretMasker(this.context.selection, this.context.body, this.text.value, this.roleInput.value, ...this.followTexts());
    if (attach.selection) this.context.selection = masker.mask(attach.selection);
    if (attach.body) this.context.body = masker.mask(attach.body);
    // 前の返事の要点の行（R5。印を付けた行だけ。描き直して見本にも生の値を残さない）
    const priorBefore = masker.used();
    for (const line of this.follow?.lines ?? []) if (line.on) line.text = masker.mask(line.text);
    if (masker.used() > priorBefore) this.renderFollowLines();
    const typed = this.text.value;
    const masked = masker.mask(typed);
    if (masked !== typed) this.text.value = masked;
    if (this.roleOne()) {
      const role = this.roleInput.value;
      const maskedRole = masker.mask(role);
      if (maskedRole !== role) this.roleInput.value = maskedRole; // 役の文を直したことになる（今回だけ。roleText で送る）
    }
    if (masker.used()) {
      this.renderAttach(this.rawUrl, true);
      this.status.textContent = `${secretRange(masker.first, masker.used())}に置き換えました。元の値は残しません`;
    }
    this.refresh();
    (this.secretBar.hidden ? this.sendButton : this.secretMask).focus({ preventScroll: true });
  }

  // 「選んだ文を外す」「本文を外す」：カードの印を外す（鍵らしき文字ごと、どこにも入らない）
  private dropSecret(key: 'selection' | 'body') {
    const input = this.checks.get(key);
    if (!input) return;
    input.checked = false;
    this.status.textContent = `${SECRET_WHERE[key]}を、鍵らしき文字ごと外しました（どこにも入りません）`;
    this.refresh();
    (this.secretBar.hidden ? this.sendButton : this.secretMask).focus({ preventScroll: true });
  }

  // ---------- 役の文と朱書き（R3・D7・D8） ----------

  // 役の文の欄を直せるのは、1体に頼むときだけ（みんな・グループ・まとめ役・案内のあいだは、席ごとの役の文がそのまま入る）
  private roleOne(): boolean {
    return !this.run && !this.teamAsk && !this.handoff && this.toSelect.value !== ASK_ALL && !!this.target();
  }

  private roleEditedNow(): boolean {
    return this.roleInput.value.trim() !== this.roleBase.trim();
  }

  // 役の文の欄を宛て先に合わせる。note が null なら欄を出す（1体）。文字なら欄を隠して、その一言だけ（空なら何も出さない）
  //   宛て先が替わった：直していなければ、その宛て先の役の文に入れ替える。直していれば残して知らせる（「元に戻す」で戻せる）
  //   同じ宛て先で役が変わった（保存した・台帳の写しが届いた）：直していなければ、新しい役の文にする
  private syncRole(target: BotRequestTarget | undefined, note: string | null) {
    const one = note === null && !!target && this.roleOne();
    this.roleEdit.hidden = !one;
    this.roleOps.hidden = !one;
    this.roleNote.textContent = one ? '' : (note ?? '');
    this.roleNote.hidden = one || !note;
    if (!one || !target) return;
    const def = roleInstructions(target.role ?? null, target.seat);
    const edited = this.roleEditedNow();
    if (target.id !== this.roleFor) {
      if (edited && this.roleFor !== null) this.status.textContent = '役の文を、今回だけ直した分は残してあります（宛て先の役の文にするには「元に戻す」）';
      else this.roleInput.value = def;
      this.roleFor = target.id;
      this.roleBase = def;
    } else if (def !== this.roleBase) {
      if (!edited) this.roleInput.value = def;
      this.roleBase = def;
    }
    const nowEdited = this.roleEditedNow();
    this.roleMark.hidden = !nowEdited;
    this.roleReset.hidden = !nowEdited;
    this.roleInput.placeholder = target.role ? '' : '役なし（ここに書くと、今回だけ依頼の頭に入ります）';
    this.roleSave.hidden = !this.host.saveRole || !target.role; // 役なしのボットには保存しない（役は巣の ⚙ で付ける）
    this.roleSave.disabled = !nowEdited || this.busy;
    this.roleSave.title = nowEdited
      ? `決まった部分（【あなたの役…】から役の決まりの文まで）の後ろに書いた文を、「${target.name}」の役「${target.role?.name ?? ''}」の説明の文として台帳に保存します（次からの依頼にも入ります）`
      : '役の文を直すと押せます。直しただけなら今回だけです';
  }

  // 送る役の文：直していれば今回だけの文（cleanRoleText で 1,200 字まで。空にしたなら空＝役の部分なし）。
  //   直していない・1体でないときは undefined（左が台帳の役で roleInstructions を入れる）
  private editedRoleText(target: BotRequestTarget | undefined): string | undefined {
    if (!target || !this.roleOne() || this.roleFor !== target.id || !this.roleEditedNow()) return undefined;
    return cleanRoleText(this.roleInput.value);
  }

  // 「元に戻す」：その宛て先の役の文に戻す
  private resetRole() {
    this.roleInput.value = this.roleBase;
    this.refresh();
    this.roleInput.focus({ preventScroll: true });
  }

  // 「この役として保存」：決まった部分（見出し〜役の決まりの文）はそのままで、その後ろに書いた文を台帳の役の説明の文（instructions）にする。
  //   役の形（preset・細かい設定・考え方）は変えない（botcell.v1 の botRole の instructions は、決まった部分の後ろに足す説明の文なので）。
  //   決まった部分を直した・説明の文が 800 字を超える・鍵らしき文字があるときは保存しない（今回だけ使える）
  private saveRole() {
    const target = this.target();
    const role = target?.role;
    if (!target || !role || !this.roleOne() || !this.host.saveRole || !this.roleEditedNow()) return;
    const text = this.roleInput.value.replace(/\r\n?/g, '\n').trim();
    const fixed = roleInstructions({ ...role, instructions: undefined }, target.seat);
    if (!text.startsWith(fixed)) {
      this.status.textContent = '役の決まった部分（【あなたの役…】から役の決まりの文まで）を直したので、保存できません（今回だけ使います）。役に足したい説明は、最後の行の後ろに書くと保存できます';
      return;
    }
    if (findSecretish(text).count) {
      this.status.textContent = '役の文に鍵らしき文字があるので、台帳には保存しません。〔鍵1〕に置き換えるか消してからどうぞ';
      return;
    }
    const tail = text.slice(fixed.length).trim();
    if (chars(tail) > ROLE_INSTRUCTIONS_MAX) {
      this.status.textContent = `役に足す説明の文は ${ROLE_INSTRUCTIONS_MAX} 字までです（いま ${chars(tail).toLocaleString('ja-JP')} 字）。短くしてから保存してください`;
      return;
    }
    const instructions = cleanRoleInstructions(tail);
    const saved: BotRole = { ...role };
    if (instructions) saved.instructions = instructions;
    else delete saved.instructions;
    this.host.saveRole(target.id, saved);
    this.targets = this.targets.map((t) => (t.id === target.id ? { ...t, role: saved } : t)); // 左の写しが届くまでの間も、保存した役で
    this.roleBase = roleInstructions(saved, target.seat);
    this.roleInput.value = this.roleBase;
    this.status.textContent = `「${target.name}」の役「${saved.name}」に、${instructions ? '説明の文を保存しました' : '説明の文を消して保存しました'}（次からの依頼にも入ります）`;
    this.refresh();
  }

  // 朱書きを押した（至急とじっくりは片方だけ）
  private toggleStamp(id: string) {
    const stamp = STAMPS.find((s) => s.id === id);
    const button = this.stampButtons.get(id);
    if (!stamp || !button) return;
    const on = button.getAttribute('aria-pressed') !== 'true';
    if (on && stamp.group) for (const other of STAMPS) if (other.group === stamp.group) this.stampButtons.get(other.id)?.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.refresh();
  }

  // 頼む文の末尾に、押した朱書きの 1 行を足す（無ければそのまま）。役の長さ・考え方より優先と書き添える（D8）
  private withStamps(text: string): string {
    const says = STAMPS.filter((s) => this.stampButtons.get(s.id)?.getAttribute('aria-pressed') === 'true').map((s) => s.say);
    if (!says.length) return text;
    const line = `（朱書き・役より優先：${says.join('')}）`;
    return text ? `${text}\n${line}` : line;
  }

  // グループに頼む（案内に入る前）。宛て先は固定。ボタンは「1/n 役：コピーしてアプリを開く」
  private refreshTeam(ask: TeamAsk) {
    const text = this.text.value.trim();
    const first = ask.seats[0];
    const attach = this.attach();
    this.title.textContent = `グループ：${ask.label}（${ask.seats.length}体）`;
    const who = ask.seats.map((t) => `${roleNameOf(t)}・${t.name}`).join(' → ');
    const skip = ask.skipped.length ? `リンクの無い役は飛ばします（${ask.skipped.join('・')}）。` : '';
    this.toNote.textContent = `${who}。${skip}依頼の頭には、グループで受け持つ役の文が入ります（細かい設定と考え方は、その役の既定のまま）`;
    this.syncRole(first, 'グループで受け持つ役の文が、それぞれの依頼の頭に入ります（ここでは直せません）');
    this.replyNote.textContent = this.replyNoteText();
    this.showPreview(`グループ：${ask.label}（${ask.seats.length}体）`, this.withStamps(text), attach, false, first);
    const secret = this.watchSecrets(attach);
    const ok = !!text && !!first && !this.busy && !secret;
    this.sendButton.disabled = !ok;
    this.cancelButton.hidden = false;
    this.cancelButton.textContent = 'やめる';
    this.cancelButton.title = 'やめる（Esc）。依頼は作りません（コピーしたあとの残りだけ、下書きに残ります）';
    this.sendButton.textContent = first ? `1/${ask.seats.length} ${roleNameOf(first)}：コピーしてアプリを開く` : 'コピーしてアプリを開く';
    this.sendButton.title = secret
      ? this.secretWhy
      : !text
        ? '依頼文を書くと押せます'
        : `1体めの「${first.name}」の依頼をコピーして、Grok Bot アプリのチャットを開きます。貼って送ったら、小窓の「次」で次の役へ進みます（Ctrl+Enter）`;
  }

  // グループの組を作って、1体めを送る（合体 Grok の確認はしない。まとめ役には送らない）
  private async submitTeam() {
    const ask = this.teamAsk;
    if (!ask || this.busy || !this.isOpen) return;
    const text = this.text.value.trim();
    if (!text) {
      this.status.textContent = '依頼文が空です。書いてから、もう一度どうぞ';
      this.text.focus();
      return;
    }
    if (!ask.seats.length) return;
    await this.withholdBlocked();
    if (!this.isOpen || this.teamAsk !== ask) return;
    if (this.secretBlocked()) return;
    const hook = this.sending === 'hook'; // webhook（R12）：案内を出さず、席ごとに一度に送る
    if (hook && (this.hookMode !== 'confirm' || this.hookSnapshot() !== this.hookSnap)) {
      this.hideHook(false, HOOK_CHANGED); // 確かめたあとに中身が変わった（渡し止めで外れた）
      this.refresh();
      return;
    }
    if (hook) {
      await this.sendAllAtOnce(createAskAllRun(ask.seats, this.withStamps(text), this.attach(), { chatOnly: false, team: ask.group, deliverTo: this.deliverTo }), null, this.usedPresetIds());
      return;
    }
    if (this.needConfirm) {
      this.showConfirm();
      return;
    }
    this.runPresetIds = this.usedPresetIds(); // 使った定型を席ごとの依頼に（R9。text を作る前の、依頼文の行で見る）
    this.run = createAskAllRun(ask.seats, this.withStamps(text), this.attach(), { chatOnly: this.chatOnly, team: ask.group, deliverTo: this.deliverTo }); // 朱書きもグループの同じ文に（R3）
    this.host.askAllRun?.(this.run.group);
    void putAskAllDrafts(this.run);
    this.body.hidden = true;
    this.guide.hidden = false;
    this.guideMsg.textContent = '';
    await this.sendSeat();
  }

  // ---------- みんなに聞く A の案内（S3.6） ----------

  // 案内の「主」のボタン：今の席がまだなら送る。送ってあれば次の席へ進んで送る（使う人が押したときだけ）。最後まで送ってあれば閉じる
  private async guideStep() {
    const run = this.run;
    if (!run || this.busy) return;
    if (!run.sent[run.index]) {
      await this.sendSeat();
      return;
    }
    if (nextAskAllSeat(run)) {
      await this.sendSeat();
      return;
    }
    this.close(true);
  }

  // 今の席の1つぶんを送る（はじめての確かめが要れば先に聞く）
  private async sendSeat() {
    const run = this.run;
    if (!run || this.busy) return;
    if (this.needConfirm) {
      this.showConfirm();
      return;
    }
    this.busy = true;
    this.status.textContent = '';
    this.guideMsg.textContent = 'コピーしています…';
    this.refresh();
    const seatIndex = run.index;
    const choice = this.runChoice;
    const presetIds = this.runPresetIds;
    // 選び方（R6）と使った定型（R9）を席の依頼に載せる
    const sender: BotSender =
      choice || presetIds.length ? { send: (req, after) => this.host.sender.send({ ...req, ...(choice ? { choice } : {}), ...(presetIds.length ? { presetIds } : {}) }, after) } : this.host.sender;
    const { result, req, target } = await sendAskAllSeat(run, sender);
    this.busy = false;
    if (result.ok) await markDraftCopied(run.group, seatIndex);
    if (this.run !== run) return; // 送るあいだに閉じた
    const i = run.index;
    const total = run.seats.length;
    const who = `${i + 1}/${total} ${roleNameOf(target)}（${target.name}）`;
    if (!result.ok) {
      this.status.textContent = result.message;
      this.guideMsg.textContent = `${who}は、まだ送れていません。もう一度押せます`;
      this.refresh();
      return;
    }
    this.rememberSent();
    this.host.sent?.(req, target);
    const next = run.seats[i + 1];
    this.guideMsg.textContent = next
      ? `${who}の依頼をコピーして、アプリを開きました。チャットに貼って（Ctrl+V）送ったら、「次：${roleNameOf(next)}（${i + 2}/${total}）」を押してください`
      : `${who}の依頼をコピーして、アプリを開きました。チャットに貼って（Ctrl+V）送ったら終わりです（${total}体に頼みました）`;
    this.refresh();
    this.sendButton.focus({ preventScroll: true });
  }

  // 案内を描く（席ごとの「コピーした・いま・まだ」、送る前の1行、ボタン）
  private renderGuide(run: AskAllRun<BotRequestTarget>) {
    const total = run.seats.length;
    const i = run.index;
    const done = askAllFinished(run);
    this.title.textContent = run.team ? `グループ：${roleGroupLabel(run.team)} ${run.sent.filter(Boolean).length}/${total}` : `⬡ みんなに聞く ${run.sent.filter(Boolean).length}/${total}`;
    this.guide.setAttribute('aria-label', run.team ? `グループ：${roleGroupLabel(run.team)}：1体ずつの案内` : 'みんなに聞く：1体ずつの案内');
    this.guideAsk.textContent = `「${snippet(run.text)}」`;
    this.guideAsk.title = run.text;
    this.guideList.replaceChildren(
      ...run.seats.map((t, k) => {
        const state = run.sent[k] ? 'sent' : k === i ? 'now' : 'todo';
        const li = el('li', 'brf-guide-seat');
        li.dataset.state = state;
        if (k === i && !done) li.setAttribute('aria-current', 'step');
        const name = el('span', 'brf-guide-name', `${roleNameOf(t)}・${t.name}`);
        name.title = `${t.seat ? `席${t.seat} ` : ''}${roleNameOf(t)}・${t.name}`;
        li.append(el('span', 'brf-guide-n', `${k + 1}/${total}`), name, el('span', 'brf-guide-state', state === 'sent' ? '✓ コピーした' : state === 'now' ? 'いま' : 'まだ'));
        return li;
      }),
    );
    const made = run.sent.filter(Boolean).length;
    const nowSeat = run.seats[i];
    const kind = run.team ? `グループ：${roleGroupLabel(run.team)}` : 'みんなに聞く';
    this.showPreview(
      nowSeat ? `${kind} ${i + 1}/${total} ${roleNameOf(nowSeat)}・${nowSeat.name}${run.sent[i] ? '' : run.team ? '（いまコピーする役）' : '（次の席）'}` : `${kind} ${made}/${total}`,
      run.text,
      run.attach,
      false,
      nowSeat,
    );

    const now = run.seats[i];
    const sentNow = run.sent[i];
    const next = run.seats[i + 1];
    this.sendButton.disabled = this.busy;
    if (!sentNow) {
      this.sendButton.textContent = `${i + 1}/${total} ${roleNameOf(now)}：コピーしてアプリを開く`;
      this.sendButton.title = `「${now.name}」の依頼をコピーして、Grok Bot アプリのチャットを開きます（Ctrl+Enter）`;
    } else if (next) {
      this.sendButton.textContent = `次：${roleNameOf(next)}（${i + 2}/${total}）`;
      this.sendButton.title = `貼って送ったら押してください。「${next.name}」の依頼をコピーして、Grok Bot アプリのチャットを開きます（Ctrl+Enter）`;
    } else {
      this.sendButton.textContent = '閉じる';
      this.sendButton.title = `${total}体ぶんをコピーしました。小窓を閉じます（返事は受け取り箱に届きます）`;
    }
    this.cancelButton.hidden = done;
    this.cancelButton.textContent = 'やめる';
    this.cancelButton.title = made
      ? `ここでやめます（Esc）。コピーした ${made} 体は受け取り箱に残ります。まだの ${total - made} 体は下書きに残り、待っている依頼にはしません`
      : 'やめる（Esc）。依頼は作りません。席は下書きに残します（待っている依頼にはしません）';
  }

  // 送る前の 1 行（R1・D2）：宛て先｜付けるもの｜字数（役・自分・添えたもの／2 万字）｜返し先。
  //   色は、前回送った依頼（左の last-request.json の写しか、この面で送ったもののうち新しい方。無ければ開いたとき）から
  //   変わった区切りだけ。比べるのは選び方の鍵（LineKeys。R6）で、字数には色を付けない。
  //   roleTarget：役の文の字数を数える相手（みんな・グループは、いま送る席）。料金は Grok Bot 側なので出さない（題に添えるだけ）
  private showPreview(to: string, text: string, attach: DraftAttach, image: boolean, roleTarget?: BotRequestTarget) {
    const n = (value: number) => value.toLocaleString('ja-JP');
    const items: string[] = [];
    if (attach.url) items.push('URL');
    if (attach.title) items.push('題名');
    if (attach.selection) items.push(`選んだ文 ${n(chars(attach.selection))} 字`);
    if (attach.priorReply) items.push(`続き：${requestNo(attach.priorReply.requestId)} の要点 ${n(attach.priorReply.lines.length)} 行`); // R5
    if (attach.body) items.push(`本文 ${n(chars(attach.body))} 字`);
    if (image) {
      const open = openHints(this.imageEdit()?.hints); // 隠す候補の未決（R7c）
      items.push(open ? `画像 1 枚（候補 ${open} 未決）` : '画像 1 枚');
      if (this.shot?.oneShot) items.push('画像入り 1 回（受けないと画像が落ちる）'); // 貼る回数（R7d。2 回貼りは経路の札だけ）
    }
    const reply = this.run ? this.replyKind(this.run.chatOnly, this.run.deliverTo) : this.replyKind(); // 返し先（R10：六角メモにも写す）
    // 役の字数：1体なら欄の文（直した分も。R3）、みんな・グループは今送る席の役の文
    const roleChars = this.handoff ? 0 : this.roleOne() ? chars(cleanRoleText(this.roleInput.value)) : chars(roleInstructions(roleTarget?.role ?? null, roleTarget?.seat));
    const own = chars(text);
    const prior = (attach.priorReply?.lines ?? []).reduce((sum, line) => sum + chars(line), 0);
    const attached = (attach.url ? chars(attach.url) : 0) + (attach.title ? chars(attach.title) : 0) + (attach.selection ? chars(attach.selection) : 0) + prior + (attach.body ? chars(attach.body) : 0);
    const total = roleChars + own + attached;
    const now: Record<string, string> = {
      to: `→ ${to}`,
      items: items.length ? items.join('・') : '（何も付けない）',
      chars: `全体 ${n(total)} 字（役 ${n(roleChars)}・自分 ${n(own)}・添えたもの ${n(attached)}）／2 万字`,
      reply: this.howWords(reply),
    };
    const kinds = [attach.url && 'url', attach.title && 'title', attach.selection && 'selection', attach.priorReply && 'prior', attach.body && 'body', image && 'image'];
    const keys: LineKeys = { to: this.toKey(), items: kinds.filter(Boolean).join(','), reply };
    if (!this.openKeys) this.openKeys = { ...keys };
    this.keysNow = keys;
    const base = this.baseKeys();
    const segs: BotLineSeg[] = (['to', 'items', 'chars', 'reply'] as const).map((key) => ({
      key,
      text: now[key],
      ...(key !== 'chars' && base.keys[key] !== keys[key] ? { changed: true } : {}),
      ...(key === 'chars' && total > LINE_WARN ? { bad: true } : {}),
    }));
    renderBotLine(this.line, segs, this.status.textContent === BLOCK_NOTE ? BLOCK_NOTE : undefined);
    this.line.title = `${base.sent ? '色：前回送った依頼から変わった所' : '色：開いたときから変わった所'}。${BOT_COST_NOTE}`;
  }

  // 1 行の宛て先の鍵（1体はボットの id、みんなは ASK_ALL、グループは team:組、まとめ役は handoff:id）
  private toKey(): string {
    if (this.run) return this.run.team ? `team:${this.run.team}` : ASK_ALL;
    if (this.teamAsk) return `team:${this.teamAsk.group}`;
    return this.handoff ? `handoff:${this.toSelect.value}` : this.toSelect.value;
  }

  // 色の比べる元：前回送った依頼（写しとこの面のうち新しい方）。どちらも無ければ開いたとき（sent: false）
  private baseKeys(): { keys: LineKeys; sent: boolean } {
    const copy = this.lastRequest ? { at: Date.parse(this.lastRequest.at), keys: lastRequestKeys(this.lastRequest) } : null;
    const pick = copy && (!lastSent || copy.at >= lastSent.at) ? copy : lastSent;
    return pick ? { keys: pick.keys, sent: true } : { keys: this.openKeys ?? this.keysNow, sent: false };
  }

  // ---------- 続きとして（R5・D11） ----------

  // 印を付けた要点の行（添えた情報の枠に入れる。グループ・まとめ役では使わない。印が無ければ無し）
  private priorReply(): DraftAttach['priorReply'] {
    const follow = this.follow;
    if (!follow || this.teamAsk || this.handoff) return undefined;
    const lines = follow.lines.filter((line) => line.on).map((line) => line.text);
    return lines.length ? { requestId: follow.reply.requestId, lines } : undefined;
  }

  // 要点の行の文（印の有無によらず。鍵の番号を数える）
  private followTexts(): string[] {
    return (this.follow?.lines ?? []).map((line) => line.text);
  }

  // 選び口の 1 行（#番号・頼む文の頭〔設定でオンのときだけ〕・宛て先・返事の時刻）
  private followLabel(reply: BotRecentReply): string {
    const target = this.targets.find((t) => t.id === reply.botId);
    const who = target ? (target.seat ? `席${target.seat} ${target.role?.name ?? '役なし'}・${target.name}` : target.name) : (reply.role ?? '台帳にいないボット');
    const time = replyTime(reply.at);
    return `${reply.no}${reply.head ? ` ${reply.head}` : ''}（${who}${time ? `・${time}` : ''}）`;
  }

  // 選び口を作り直す（選んでいる返事が一覧に無ければ、先頭に足して残す）と、要点の行
  private renderFollow() {
    const list = [...this.replies];
    const picked = this.follow?.reply;
    if (picked && !list.some((r) => r.requestId === picked.requestId)) list.unshift(picked);
    const none = el('option', '', '（新しく頼む）');
    none.value = '';
    this.followSelect.replaceChildren(
      none,
      ...list.map((reply) => {
        const o = el('option', '', this.followLabel(reply));
        o.value = reply.requestId;
        return o;
      }),
    );
    this.followSelect.value = picked?.requestId ?? '';
    this.renderFollowLines();
  }

  // 要点の行（印つき）。読んでいるあいだ・無いときは一言
  private renderFollowLines() {
    const follow = this.follow;
    this.followList.hidden = !follow;
    if (!follow) {
      this.followList.replaceChildren();
      return;
    }
    const no = follow.reply.no;
    this.followList.setAttribute('aria-label', `${no} の要点の行`);
    if (follow.state !== 'ready' || !follow.lines.length) {
      const say =
        follow.state === 'loading'
          ? `${no} の返事から、要点の行を読んでいます…`
          : follow.state === 'missing'
            ? `${no} の返事が記録に見つかりませんでした（古い記録は片づけています）。頭の 1 行だけで続けます`
            : follow.state === 'none'
              ? '要点の行を読めませんでした（左の窓が応えません）。頭の 1 行だけで続けます'
              : `${no} の返事に、要点の行が見つかりませんでした。頭の 1 行だけで続けます`;
      this.followList.replaceChildren(el('span', 'brf-follow-hint', say));
      return;
    }
    const rows = follow.lines.map((line, i) => {
      const input = el('input', 'brf-checkbox');
      input.type = 'checkbox';
      input.checked = line.on;
      input.addEventListener('change', () => {
        line.on = input.checked;
        this.refresh();
      });
      const label = el('label', 'brf-follow-line');
      const secret = findSecretish(line.text); // 生の値は見本に描かない（R2。送る前に帯で置き換えるか外す）
      const text = el('span', '', secret.masked);
      if (secret.count) text.classList.add('brf-check-warn');
      label.title = `印を付けた行だけが、添えた情報の枠に「前の返事 ${no}（データ）」として入ります（${i + 1} 行め）`;
      label.append(input, text);
      return label;
    });
    this.followList.replaceChildren(el('span', 'brf-follow-hint', `${no} の要点（印を付けた行だけが、添えた情報の枠に入ります）`), ...rows);
  }

  // 続きとして選ぶ（requestId が空なら選ばない）。頭の行を入れ替え、宛て先をその依頼の席にして、要点の行を左に頼む。
  //   botId：一覧に無い返事を選ぶとき（回答カードの「続けて聞く」で、新しい 5 件より前の返事）。no：そのときの画面の番号（R9 の #0010-2）
  private pickFollow(requestId: string, botId?: string, no?: string) {
    const loads = ++this.followLoads;
    const known = this.replies.find((r) => r.requestId === requestId) ?? (this.follow?.reply.requestId === requestId ? this.follow.reply : undefined);
    const reply = known ?? (requestId && botId ? { botId, requestId, no: no && /^#\d{4,6}(-\d{1,3})?$/.test(no) ? no : requestNo(requestId), at: 0 } : undefined);
    if (!reply) {
      this.follow = null;
      this.setFollowHead(null);
      this.renderFollow();
      this.refresh();
      return;
    }
    const fromCard = !!botId && this.followHead !== null; // 回答カードから：頭の行はもう入っている
    this.follow = { reply, lines: [], state: this.host.answerLines ? 'loading' : 'none' };
    if (!fromCard) this.setFollowHead(`${reply.no} の続き：`);
    // 宛て先をその依頼の席に（グループ・まとめ役・案内のあいだは変えない）
    let moved = true;
    if (!this.teamAsk && !this.handoff && !this.run) {
      const option = [...this.toSelect.options].find((o) => o.value === reply.botId && !o.disabled);
      if (option) this.toSelect.value = option.value;
      else moved = false;
    }
    this.renderFollow();
    this.refresh();
    if (!moved) this.status.textContent = `${reply.no} のボットは今は選べないので、宛て先はそのままです`;
    const ask = this.host.answerLines?.(reply.botId, reply.requestId);
    if (!ask) return;
    void ask.then((result) => {
      const follow = this.follow;
      if (loads !== this.followLoads || !this.isOpen || follow?.reply.requestId !== reply.requestId) return; // 選び直した・閉じた
      follow.state = !result ? 'none' : !result.found ? 'missing' : 'ready';
      follow.lines = (result?.lines ?? []).map((text) => ({ text, on: true }));
      if (result?.line) this.setFollowHead(`${reply.no} の続き：${result.line}`, true);
      this.renderFollowLines();
      this.refresh();
      this.fit();
    });
  }

  // 別の子へ渡す（R9）：続きとして選んだあとで、宛て先を botId にする（選べなければそのままにして知らせる。グループ・まとめ役・案内のあいだは変えない）
  private passTarget(botId: string) {
    if (this.teamAsk || this.handoff || this.run) return;
    const option = [...this.toSelect.options].find((o) => o.value === botId && !o.disabled);
    if (!option) {
      this.status.textContent = '渡す先のボットは今は選べないので、宛て先を選んでください';
      return;
    }
    this.toSelect.value = option.value;
    this.refresh();
  }

  // 依頼文の頭の「#0010 の続き：…」を next にする（null なら外す）。前に入れた行がそのままなら入れ替え、無ければ頭に足す。
  //   onlyReplace：入れ替えるだけ（使う人が直していたら触らず、もう追わない）
  private setFollowHead(next: string | null, onlyReplace = false) {
    const lines = this.text.value.split('\n');
    const kept = this.followHead !== null && lines[0]?.trim() === this.followHead;
    if (kept) {
      if (next) lines[0] = next;
      else lines.splice(0, 1);
    } else if (onlyReplace) {
      this.followHead = null;
      return;
    } else if (next) {
      if (lines.length === 1 && !lines[0].trim()) lines.push('');
      lines.unshift(next);
      if (lines.length === 3 && !lines[1].trim() && !lines[2].trim()) lines.pop();
    }
    this.text.value = lines.join('\n');
    this.followHead = next;
    if (document.activeElement === this.text) this.text.setSelectionRange(this.text.value.length, this.text.value.length);
  }

  // ---------- 前と同じで（R6・D14） ----------

  // いまの選び方（送るときに DraftRequest の choice に載せる。文は入れない）。
  //   定型は、依頼文の行と同じ文になっている定型（行の順）。グループ・まとめ役は「前と同じで」で戻せないので null
  private choiceNow(): BotLastChoice | null {
    if (this.teamAsk || this.handoff) return null;
    const all = this.toSelect.value === ASK_ALL;
    const target = all ? undefined : this.target();
    if (!all && !target) return null;
    const attach = this.attach();
    const set = this.presets?.sets[this.presetSet];
    return {
      entry: this.entry,
      ...(set ? { set: set.id } : {}),
      presets: this.usedPresetIds(),
      to: target ? { botId: target.id, ...(target.seat ? { seat: target.seat } : {}) } : { all: true },
      replyTo: this.replyKind(), // 六角メモにも届くは 'memo'（R10）
      stamps: STAMPS.filter((s) => this.stampButtons.get(s.id)?.getAttribute('aria-pressed') === 'true').map((s) => s.id),
      attach: { url: !!attach.url, title: !!attach.title, selection: !!attach.selection },
    };
  }

  // 依頼文の行と同じ文になっている定型の id（行の順。R6 の choice の presets と、R9 の presetIds）。まとめ役では定型を出さないので空
  private usedPresetIds(): string[] {
    if (this.handoff) return [];
    const attach = this.attach();
    const lines = this.textLines();
    const used: { id: string; at: number }[] = [];
    for (const preset of this.presets?.presets ?? []) {
      const filled = this.fillOf(preset, attach);
      const at = filled ? lines.indexOf(filled) : -1;
      if (at >= 0) used.push({ id: preset.id, at });
    }
    return used.sort((a, b) => a.at - b.at).map((u) => u.id);
  }

  // はじめから依頼文の行に入れておく定型（R9「頼み方を直す」：元の依頼で使った定型）。知らない・埋まらない・もう入っている定型は入れない。
  //   入れた行は押したものと同じに追う（付けるものを外したら埋め直す）。使った回数は足さない（押したわけではないので）
  private insertPresets(ids: readonly string[]) {
    const attach = this.attach();
    const lines = this.text.value.split('\n');
    for (const id of ids) {
      const preset = this.presetById(id);
      const filled = preset ? this.fillOf(preset, attach) : null;
      if (!preset || !filled || lines.some((line) => line.trim() === filled)) continue;
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      lines.push(filled);
      this.presetLines.set(preset.id, filled);
    }
    this.text.value = lines.join('\n');
  }

  // 「前と同じで」：前回送った依頼の選び方を当てる。定型の組・宛て先（ボットの id、いなければ同じ席）・返し先・朱書き・
  //   URL／題名／選んだ文の印を戻し、本文は外す（画像の候補は R7 で外したままにする。六角スクショの画像はそのまま）。
  //   書きかけの依頼文には触らない（空のときだけ、前回の定型を前回の順に入れる。埋まらない定型は入れない）。
  //   グループ・まとめ役のときは宛て先を変えない。みんなに聞く A の案内のあいだは何もしない
  applySame() {
    if (!this.isOpen || this.run || this.busy) return;
    const last = this.lastRequest;
    if (!last) {
      this.status.textContent = '前回の依頼がまだありません（一度コピーしてアプリを開くと、次から戻せます）';
      return;
    }
    const notes: string[] = [];
    // 定型の組
    const setAt = last.set ? (this.presets?.sets ?? []).findIndex((s) => s.id === last.set) : -1;
    if (setAt >= 0 && setAt !== this.presetSet) {
      this.presetSet = setAt;
      this.renderPresetSet();
    }
    // 宛て先
    if (!this.teamAsk && !this.handoff) {
      const byId = last.to.botId && this.targets.some((t) => t.id === last.to.botId) ? last.to.botId : undefined;
      const want = last.to.all ? ASK_ALL : (byId ?? (last.to.seat ? this.targets.find((t) => t.seat === last.to.seat)?.id : undefined));
      const option = want ? [...this.toSelect.options].find((o) => o.value === want && !o.disabled) : undefined;
      if (option) this.toSelect.value = option.value;
      else notes.push('前回の宛て先は選べないので、宛て先はそのままです');
    }
    // 返し先（六角メモにも届くも戻す。R10）
    if (last.replyTo === 'chat' && !this.chatRadio.disabled) this.chatRadio.checked = true;
    else if (last.replyTo === 'memo' && !this.memoRadio.disabled) this.memoRadio.checked = true;
    else this.relayRadio.checked = true;
    // 朱書き（至急とじっくりは片方だけ。両方あれば前のもの）
    const groups = new Set<string>();
    for (const stamp of STAMPS) {
      let on = last.stamps.includes(stamp.id);
      if (on && stamp.group) {
        if (groups.has(stamp.group)) on = false;
        else groups.add(stamp.group);
      }
      this.stampButtons.get(stamp.id)?.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    // 付けるものの印（本文は外す）。この画面に無いものは付けられない
    for (const [key, input] of this.checks) input.checked = key === 'body' ? false : last.attach[key];
    const missing = (['url', 'title', 'selection'] as const).filter((key) => last.attach[key] && !this.checks.has(key)).map((key) => ATTACH_ROWS.find((r) => r.key === key)?.short ?? key);
    if (missing.length) notes.push(`${missing.join('・')}はこの画面に無いので付けていません`);
    // 定型（書きかけの文には触らない）
    const typed = !!this.text.value.trim();
    let put = 0;
    let skipped = 0;
    if (!typed) {
      for (const id of last.presets) {
        const preset = this.presetById(id);
        if (preset && this.fillOf(preset, this.attach())) {
          this.togglePreset(preset); // 依頼文は空なので、入れるだけ（使った回数も足す）
          put++;
        } else skipped++;
      }
    } else if (last.presets.length) notes.push('書きかけの依頼文には触っていません（前回の定型は入れていません）');
    if (skipped) notes.push(`埋まらない・無くなった定型 ${skipped.toLocaleString('ja-JP')} つは入れていません`);
    this.refresh();
    if (this.status.textContent === BLOCK_NOTE) return; // 渡し止めの知らせは消さない（1 行にも出ている）
    const what = `定型の組${put ? `と定型 ${put.toLocaleString('ja-JP')} つ` : ''}・宛て先・返し先・朱書き・URL／題名／選んだ文の印`;
    this.status.textContent = [`前と同じで：${what}を、前回送った依頼に戻しました（本文は外したまま）`, ...notes].join('。');
  }

  // 案内のモードを出る（開き直した・閉じた）
  private leaveGuide() {
    this.run = null;
    this.runChoice = null;
    this.teamAsk = null;
    this.handoff = null;
    this.body.hidden = false;
    this.guide.hidden = true;
    this.guideMsg.textContent = '';
    this.cancelButton.hidden = false;
  }

  // 六角スクショの ①（S3.12）：画像をコピーしてアプリを開く（はじめての確かめが要れば先に聞く）。ファイルの逃げ道ならアプリは開かない
  private shotFirst() {
    const shot = this.shot;
    if (!shot?.active || this.busy || !this.isOpen) return;
    const target = this.target();
    if (shot.opensApp) {
      if (!target?.linked) return;
      if (this.needConfirm) {
        this.showConfirm(() => this.shotFirst());
        return;
      }
    }
    void shot.runFirst(target?.id);
  }

  // ---------- webhook「そのまま送る」（依頼の小窓 v2・R11・D20） ----------

  // 中継の宛先と鍵があるか（左の写しの「ある／ない」。巣は写しが届いたとき、読む画面は開く前に渡す）
  setHook(ready: boolean) {
    if (this.hookReady === ready) return;
    this.hookReady = ready;
    if (this.isOpen) this.refresh();
  }

  // 送り方の形で押せないわけ（押せるなら null）。文が空・宛て先なし・鍵らしき文字は主のボタンと同じなので、ここでは見ない
  private hookBlock(): keyof typeof HOOK_WHY_SHORT | null {
    if (!this.hookReady) return 'noKey';
    if (this.chatOnly) return 'chatOnly';
    if (this.shot?.active || this.clip?.on) return 'image';
    return null; // みんなに聞く・グループも送れる（R12。席ごとに一度に）
  }

  // 確かめた中身（送る前の 1 行の鍵・依頼文〔朱書きつき〕・役の文・付けるもの・宛て先・返し先）。送る前に、変わっていないかを見る
  private hookSnapshot(): string {
    return JSON.stringify([this.withStamps(this.text.value.trim()), this.roleInput.value, this.keysNow, this.attach(), this.toSelect.value, this.replyKind()]);
  }

  // refresh のたびに：ボタンを押せるか・わけの 1 行・二段のあいだに中身が変わったか
  private syncHook() {
    const guide = !!this.run || this.body.hidden; // みんなの A の案内のあいだは出さない
    const block = guide ? null : this.hookBlock();
    const can = !guide && !block && !this.sendButton.disabled && !this.busy;
    if (this.hookMode === 'confirm' && !this.busy) {
      if (this.hookSnapshot() !== this.hookSnap) this.hideHook(false, HOOK_CHANGED);
      else if (!can) this.hideHook(false);
    }
    const refuse = block ? HOOK_REFUSE[block] : '';
    this.hookButton.hidden = guide;
    this.hookButton.disabled = !can;
    this.hookButton.title =
      refuse ||
      (this.sendButton.disabled
        ? `「コピーしてアプリを開く」が押せるときに押せます（${this.sendButton.title}）`
        : '送る前の 1 行のとおりに、依頼の JSON を中継へ直接送ります。押すと確かめの 1 行が出ます（鍵は画面に出ません・貼る手は要りません）');
    this.hookWhy.textContent = block ? HOOK_WHY_SHORT[block] : '';
    this.hookWhy.title = refuse;
    this.hookWhy.hidden = !block || !this.hookBar.hidden;
    this.hookGo.disabled = this.busy;
  }

  // 「そのまま送る」を押した：二段の確かめ（送る前の 1 行の下）。足は隠す
  private showHook() {
    this.refresh();
    if (this.hookButton.disabled || this.secretBlocked()) return;
    this.hookMode = 'confirm';
    this.hookFailed = null;
    this.hookSnap = this.hookSnapshot();
    if (this.status.textContent === HOOK_CHANGED) this.status.textContent = ''; // 前の「中身が変わりました」は消す（渡し止めの知らせは残す）
    const seats = this.hookSeats(); // みんな・グループは席の数だけ（R12）
    this.hookText.textContent =
      seats > 1 ? `↑ この内容で ${seats} 体に 1 つずつ、中継へ直接送ります（案内なし・鍵は画面に出ない・貼る手は無い）` : '↑ この内容で中継へ直接送ります（鍵は画面に出ない・貼る手は無い）';
    this.hookGo.textContent = '送る';
    this.hookGo.title = '送る前の 1 行のとおりに、依頼の JSON を中継へ送ります（Ctrl+Enter）。中身を変えたら、確かめ直しになります';
    this.hookGo.hidden = false;
    this.hookBack.textContent = '戻る';
    this.hookBack.title = '送らずに戻ります（Esc）';
    this.hookBar.hidden = false;
    this.hookWhy.hidden = true;
    this.foot.hidden = true;
    if (this.hookViaPrev === null) this.hookViaPrev = this.via.textContent;
    this.via.textContent = '中継へ直接送る';
    this.hookGo.focus({ preventScroll: true });
  }

  // 一度に送る依頼の数（みんなの A・グループは席の数。B 代表・1体・まとめ役は 1。R12）
  private hookSeats(): number {
    if (this.teamAsk) return this.teamAsk.seats.length;
    if (this.toSelect.value !== ASK_ALL) return 1;
    const plan = this.plan();
    return plan.way === 'each' ? plan.seats.length : 1;
  }

  // みんなに聞く・グループを webhook で一度に（依頼の小窓 v2・R12・D20）：案内を出さず、席ごとに依頼を作って中継へ（1 体ずつ答えを待つ）。
  //   届かない席があればそこで止める（sendAskAllAtOnce）。その席は同じ依頼をコピーに切り替えられ、まだの席は下書きに残す
  private async sendAllAtOnce(run: AskAllRun<BotRequestTarget>, choice: BotLastChoice | null, presetIds: string[]) {
    const total = run.seats.length;
    this.host.askAllRun?.(run.group); // 札（Grok Cards の段 5）に組の「送った」を付ける（1体ずつの案内と同じ）
    this.busy = true;
    this.refresh();
    this.status.textContent = `中継へ送っています…（${total} 体。1 体ずつ答えを待ちます）`;
    const sender: BotSender = { send: (req, after) => this.host.sender.send({ ...req, via: 'hook', ...(choice ? { choice } : {}), ...(presetIds.length ? { presetIds } : {}) }, after) };
    const results = await sendAskAllAtOnce(run, sender);
    this.busy = false;
    const made = run.sent.filter(Boolean).length;
    const failed = results.find((r): r is Extract<SendResult, { ok: false }> => !r.ok);
    const stuck = run.sent.findIndex((s) => !s); // 止まった席（届かなかった席）
    run.sent.forEach((sent, k) => {
      if (sent) this.host.sent?.(askAllSeatDraft(run, k), run.seats[k]); // 合体の数・巣の選び（右の巣）
    });
    // まだ送っていない席は下書きに（送れた席と、コピーに切り替えられる席は外す）。依頼を 1 つも作れなかったら小窓に残す
    if ((made || failed?.fallback) && stuck >= 0) {
      await putAskAllDrafts(run);
      for (let k = 0; k < total; k++) if (run.sent[k] || (k === stuck && failed?.fallback)) await markDraftCopied(run.group, k);
    }
    if (!this.isOpen) return; // 送るあいだに閉じた
    if (made) this.rememberSent();
    if (!failed) {
      this.close(true);
      return;
    }
    const rest = total - made - 1;
    const kept = made || failed.fallback; // 下書きに残したか（上と同じ決め方）
    const note = [made ? `${made} 体は中継へ送りました` : '', rest ? `残り ${rest} 体はまだ送っていません${kept ? '（下書きに残ります）' : ''}` : ''].filter(Boolean).join('。');
    this.status.textContent = failed.fallback ? '' : `${failed.message}${note ? `（${note}）` : ''}`;
    if (failed.fallback) this.hookFailedBar(run.seats[stuck]?.id ?? '', failed, note);
    else if (made) this.close(true);
    else this.hideHook(false);
    this.refresh();
  }

  // 二段を閉じて足に戻す（note：わけ）
  private hideHook(focus: boolean, note?: string) {
    if (note) this.status.textContent = note;
    if (this.hookMode === null) return;
    this.hookMode = null;
    this.hookFailed = null;
    this.hookBar.hidden = true;
    this.foot.hidden = false;
    if (this.hookViaPrev !== null) this.via.textContent = this.hookViaPrev;
    this.hookViaPrev = null;
    if (focus) (this.hookButton.disabled ? this.sendButton : this.hookButton).focus({ preventScroll: true });
  }

  private hookGoClick() {
    if (this.hookMode === 'failed') {
      this.copyInstead();
      return;
    }
    if (this.hookMode !== 'confirm' || this.busy) return;
    void this.submit('hook');
  }

  // 届かなかった：同じ依頼をコピーに切り替える二段に（依頼を作る前に断られたときは、足に戻してわけだけ）。note：みんなのとき、送れた席と残りの席（R12）
  private hookFailedBar(botId: string, result: Extract<SendResult, { ok: false }>, note = '') {
    if (!result.fallback) {
      this.hideHook(false);
      return;
    }
    const { requestId, no } = result.fallback;
    this.hookMode = 'failed';
    this.hookFailed = { botId, requestId, no };
    this.status.textContent = ''; // わけは二段の文に（同じ文を 2 回出さない）
    this.hookText.textContent = `${result.message}（依頼は受け取り箱に残っています。切り替えると ${no} の 2 回目として送ります）${note ? `。${note}` : ''}`;
    this.hookGo.textContent = 'コピーしてアプリを開く';
    this.hookGo.title = `同じ依頼 ${no}（requestId は同じ・2 回目）をコピーして、Grok Bot アプリのチャットを開きます。貼って（Ctrl+V）送ってください（Ctrl+Enter）`;
    this.hookGo.hidden = !this.host.hookFallback;
    this.hookBack.textContent = '閉じる';
    this.hookBack.title = 'あとで送るときは、受け取り箱の伝票の「コピーして開く」から（この窓を閉じるまで）';
    this.hookBar.hidden = false;
    this.foot.hidden = true;
    this.hookGo.focus({ preventScroll: true });
  }

  // 同じ依頼をコピーに切り替える（左に頼む。アプリを開くので、はじめてなら先に確かめる）
  private copyInstead() {
    const failed = this.hookFailed;
    if (!failed || !this.host.hookFallback) return;
    if (this.needConfirm) {
      this.showConfirm(() => this.copyInstead());
      return;
    }
    this.host.hookFallback(failed.botId, failed.requestId);
    this.rememberSent();
    this.close(true);
  }

  // then：確かめたあとに続けること（無ければ送る）
  private showConfirm(then?: () => void) {
    this.afterConfirm = then ?? null;
    this.confirmBar.hidden = false;
    this.confirmGo.focus({ preventScroll: true });
  }

  private hideConfirm(focusSend: boolean) {
    this.afterConfirm = null;
    this.confirmBar.hidden = true;
    if (focusSend) this.sendButton.focus({ preventScroll: true });
  }

  // 高さを窓に収める（下の端は置いた所の下の端。そこから上に使えるだけ。WebView の外にはみ出さない）
  private fit() {
    if (!this.isOpen) return;
    const bottom = this.element.parentElement?.getBoundingClientRect().bottom ?? window.innerHeight;
    const room = Math.floor(Math.min(bottom, window.innerHeight) - 8);
    this.element.style.maxHeight = `${Math.max(200, Math.min(MAX_HEIGHT, room))}px`;
  }
}
