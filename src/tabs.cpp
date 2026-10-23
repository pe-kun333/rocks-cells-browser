// タブ（ページ用の WebView2）の作成・休眠からの起床・切り替え・閉じる・サムネイル撮影
#include <cmath>
#include <filesystem>
#include <cwchar>
#include <functional>
#include <memory>
#include <vector>

#include "browser.h"
#include "storage.h"
#include "strings.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
using nlohmann::json;

namespace {

// grokbot://（Grok Bot アプリ）の URL か。ページ・リンク・アドレス欄からは開かない（S1.11）
//   開くのはボットのセルの openBotApp だけ（UI は id だけを渡し、URL は browser.cpp が組み立てる）
//   スキームは大文字と小文字を区別しないので、そろえて比べる（前の空白・制御文字は念のため飛ばす）
bool IsGrokBotUri(const std::wstring& uri) {
    constexpr wchar_t kScheme[] = L"grokbot:";
    const size_t length = wcslen(kScheme);
    size_t start = 0;
    while (start < uri.size() && uri[start] <= L' ') ++start;
    return uri.size() - start >= length && _wcsnicmp(uri.c_str() + start, kScheme, length) == 0;
}

// 右クリックの「🔍 Grok に調べてもらう」で左へ送る、選んだ文の上限（S3.11。UTF-16 の字数）
constexpr size_t kAskGrokMaxText = 4000;

bool IsImageDocument(const std::wstring& uri) {
    std::wstring path = uri;
    const size_t hash = path.find(L'#');
    if (hash != std::wstring::npos) path.resize(hash);
    const size_t query = path.find(L'?');
    if (query != std::wstring::npos) path.resize(query);
    const size_t slash = path.find_last_of(L"/\\");
    const size_t dot = path.rfind(L'.');
    if (dot == std::wstring::npos || (slash != std::wstring::npos && dot < slash)) return false;
    std::wstring ext = path.substr(dot);
    for (wchar_t& ch : ext) {
        if (ch >= L'A' && ch <= L'Z') ch = static_cast<wchar_t>(ch - L'A' + L'a');
    }
    return ext == L".png" || ext == L".jpg" || ext == L".jpeg" || ext == L".gif" || ext == L".webp" || ext == L".bmp" || ext == L".tif" || ext == L".tiff";
}

bool IsFileUri(const std::wstring& uri) {
    return uri.size() >= 5 && _wcsnicmp(uri.c_str(), L"file:", 5) == 0;
}

int HexDigit(wchar_t ch) {
    if (ch >= L'0' && ch <= L'9') return ch - L'0';
    if (ch >= L'a' && ch <= L'f') return ch - L'a' + 10;
    if (ch >= L'A' && ch <= L'F') return ch - L'A' + 10;
    return -1;
}

// %E7%94%BB のような UTF-8 のパーセント表記を戻す。すでにワイド文字のところはそのまま
std::wstring DecodePercent(const std::wstring& raw) {
    std::wstring out;
    std::string bytes;
    auto flush = [&] {
        if (bytes.empty()) return;
        out += ToWide(bytes);
        bytes.clear();
    };
    for (size_t i = 0; i < raw.size(); ++i) {
        if (raw[i] == L'%' && i + 2 < raw.size()) {
            const int hi = HexDigit(raw[i + 1]);
            const int lo = HexDigit(raw[i + 2]);
            if (hi >= 0 && lo >= 0) {
                bytes.push_back(static_cast<char>((hi << 4) | lo));
                i += 2;
                continue;
            }
        }
        if (raw[i] < 128) bytes.push_back(static_cast<char>(raw[i]));
        else {
            flush();
            out.push_back(raw[i]);
        }
    }
    flush();
    return out;
}

// file:///C:/a%20b.png → C:\a b.png　file://server/share/a.png → \\server\share\a.png
std::wstring PathOfFileUri(const std::wstring& uri) {
    size_t start = 0;
    while (start < uri.size() && uri[start] <= L' ') ++start;
    if (uri.size() - start < 5 || _wcsnicmp(uri.c_str() + start, L"file:", 5) != 0) return {};
    std::wstring rest = uri.substr(start + 5);
    const size_t hash = rest.find(L'#');
    if (hash != std::wstring::npos) rest.resize(hash);
    const size_t query = rest.find(L'?');
    if (query != std::wstring::npos) rest.resize(query);
    std::wstring path;
    if (rest.size() >= 2 && rest[0] == L'/' && rest[1] == L'/') {
        const size_t slash = rest.find(L'/', 2);
        const std::wstring host = slash == std::wstring::npos ? rest.substr(2) : rest.substr(2, slash - 2);
        const std::wstring after = slash == std::wstring::npos ? std::wstring() : rest.substr(slash);
        const bool local = host.empty() || _wcsicmp(host.c_str(), L"localhost") == 0;
        path = local ? after : L"//" + host + after;
    } else {
        path = rest;
    }
    if (path.size() >= 3 && path[0] == L'/' && (path[2] == L':' || path[2] == L'|')) {
        path.erase(path.begin());
        path[1] = L':';
    }
    path = DecodePercent(path);
    for (wchar_t& ch : path) {
        if (ch == L'/') ch = L'\\';
    }
    return path;
}

// 長いパスは \\?\ を付ける（MAX_PATH を超えると GetFileAttributesW が失敗する）
std::wstring ExtendPath(const std::wstring& path) {
    if (path.size() < MAX_PATH || path.rfind(L"\\\\?\\", 0) == 0) return path;
    if (path.rfind(L"\\\\", 0) == 0) return L"\\\\?\\UNC\\" + path.substr(2);
    return L"\\\\?\\" + path;
}

bool ImageFilePresent(const std::wstring& path) {
    const DWORD attr = GetFileAttributesW(ExtendPath(path).c_str());
    return attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

// 別のページへ移る途中で、前の読み込みが取り消された。値 14 は最初の WebView2 SDK からある。
//   FILE_NOT_FOUND（後から足された）は SDK によって無いので、ここには置かない。
#ifndef COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED
#define COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED static_cast<COREWEBVIEW2_WEB_ERROR_STATUS>(14)
#endif

bool NavigationCanceled(ICoreWebView2NavigationCompletedEventArgs* args) {
    if (!args) return false;
    COREWEBVIEW2_WEB_ERROR_STATUS status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
    return SUCCEEDED(args->get_WebErrorStatus(&status)) && status == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED;
}

// 画像ファイルのページを、区画に合わせて縮める。クリックと Ctrl+ホイールで拡大できる
constexpr wchar_t kFitImageScript[] = LR"HC((function(){var tries=0;function run(){var img=document.images&&document.images[0];if(!img){if(tries++<12)setTimeout(run,50);return;}if(img.dataset.honeycombFit)return;img.dataset.honeycombFit='1';var zoom=0;function apply(){var nw=img.naturalWidth||1;var nh=img.naturalHeight||1;var fit=Math.min(window.innerWidth/nw,window.innerHeight/nh,1);var factor=zoom<=0?fit:zoom;img.style.maxWidth='none';img.style.maxHeight='none';img.style.width=Math.max(1,Math.round(nw*factor))+'px';img.style.height='auto';}document.body.style.margin='0';document.body.style.background='#1c1a17';document.body.style.minHeight='100vh';document.body.style.display='flex';document.body.style.alignItems='center';document.body.style.justifyContent='center';img.style.cursor='zoom-in';img.title='クリックで拡大。Ctrl+ホイールでも拡大できます';window.addEventListener('resize',apply);img.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();zoom=zoom<=0?1:(zoom<4?zoom*1.5:0);apply();},true);img.addEventListener('wheel',function(e){if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();var nw=img.naturalWidth||1;var nh=img.naturalHeight||1;var fit=Math.min(window.innerWidth/nw,window.innerHeight/nh,1);var current=zoom<=0?fit:zoom;zoom=Math.min(8,Math.max(0.2,current*(e.deltaY<0?1.12:0.89)));apply();},{passive:false,capture:true});if(img.complete&&img.naturalWidth)apply();else img.addEventListener('load',apply);}run();})())HC";

constexpr wchar_t kMissingImageScript[] = LR"HC((function(){if(document.getElementById('honeycomb-image-missing'))return;document.documentElement.innerHTML='<head><meta charset="utf-8"><title>画像</title></head><body id="honeycomb-image-missing" style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#1c1a17;color:#f3eee6;font:16px sans-serif"><p>この画像ファイルは、もうありません</p></body>';})())HC";

constexpr wchar_t kUnopenableImageScript[] = LR"HC((function(){if(document.getElementById('honeycomb-image-missing'))return;document.documentElement.innerHTML='<head><meta charset="utf-8"><title>画像</title></head><body id="honeycomb-image-missing" style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#1c1a17;color:#f3eee6;font:16px sans-serif"><p>この画像ファイルは、開けません</p></body>';})())HC";

// ページで言葉を拾う。右クリックは単語と前後の文を覚えておき、Alt+クリックは「単語帳へ」を出す。
//   fetch も file: も使わない。ホストへは chrome.webview.postMessage だけ（CSP の connect-src を通らない）
constexpr wchar_t kVocabHookScript[] = LR"VB((function(){
if(window.top!==window||window.__honeycombVocabHook)return;
window.__honeycombVocabHook=1;
function latin(ch){var c=ch.charCodeAt(0);return (c>=48&&c<=57)||(c>=65&&c<=90)||(c>=97&&c<=122)||c===39||c===45||c===0x2019;}
function cjk(ch){var c=ch.charCodeAt(0);return (c>=0x3040&&c<=0x30ff)||(c>=0x3400&&c<=0x9fff);}
function expand(text,offset,pred,cap){var a=offset,b=offset;while(a>0&&pred(text.charAt(a-1))&&offset-a<cap)a--;while(b<text.length&&pred(text.charAt(b))&&b-offset<cap)b++;return text.slice(a,b).trim();}
function wordAt(text,offset){
  try{
    if(typeof Intl!=='undefined'&&Intl.Segmenter){
      var index=0,it=new Intl.Segmenter('ja',{granularity:'word'}).segment(text)[Symbol.iterator](),step=it.next();
      while(!step.done){var part=step.value,end=index+part.segment.length;if(offset>=index&&offset<=end)return part.isWordLike===false?'':part.segment.trim();index=end;step=it.next();}
    }
  }catch(e){}
  var ch=text.charAt(Math.min(offset,Math.max(0,text.length-1)));
  if(latin(ch))return expand(text,offset,latin,40);
  if(cjk(ch))return expand(text,offset,cjk,12);
  return '';
}
function pick(x,y){
  var node=null,offset=0;
  if(document.caretRangeFromPoint){var range=document.caretRangeFromPoint(x,y);if(range){node=range.startContainer;offset=range.startOffset;}}
  else if(document.caretPositionFromPoint){var pos=document.caretPositionFromPoint(x,y);if(pos){node=pos.offsetNode;offset=pos.offset;}}
  if(!node||node.nodeType!==3)return null;
  var text=node.textContent||'';
  var word=wordAt(text,offset);
  if(!word)return null;
  var block=((node.parentElement&&node.parentElement.innerText)||text).replace(/\s+/g,' ').trim();
  var at=block.indexOf(word);
  var sentence=block;
  if(at>=0){var from=Math.max(0,at-80),to=Math.min(block.length,at+word.length+80);sentence=(from>0?'…':'')+block.slice(from,to)+(to<block.length?'…':'');}
  if(sentence.length>300)sentence=sentence.slice(0,300);
  return {word:word.slice(0,400),sentence:sentence};
}
function remember(x,y,front){
  var picked=pick(x,y);
  var sel=String(window.getSelection?window.getSelection():'').replace(/\s+/g,' ').trim();
  window.__honeycombVocab={front:(front||sel||(picked&&picked.word)||'').slice(0,400),example:(picked&&picked.sentence)||''};
}
document.addEventListener('contextmenu',function(e){remember(e.clientX,e.clientY);},true);
var box=null;
function hide(){if(box){box.remove();box=null;}}
function skip(node){
  var cur=node;
  while(cur&&cur!==document){
    if(cur.nodeType===1){
      var tag=cur.tagName;
      if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return true;
      if(cur.isContentEditable)return true;
    }
    cur=cur.parentNode;
  }
  return false;
}
document.addEventListener('click',function(e){
  if(box&&(e.target===box||box.contains(e.target)))return;
  if(box)hide();
  if(!e.altKey||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey)return;
  var el=e.target;
  if(!el||skip(el))return;
  var picked=pick(e.clientX,e.clientY);
  if(!picked)return;
  e.preventDefault();
  e.stopPropagation();
  remember(e.clientX,e.clientY,picked.word);
  hide();
  box=document.createElement('button');
  box.type='button';
  box.textContent='単語帳へ';
  box.setAttribute('style','position:fixed;z-index:2147483647;padding:4px 8px;border:1px solid #c4a574;border-radius:8px;background:#1c1a17;color:#f3eee6;font:12px sans-serif;cursor:pointer');
  box.style.left=Math.max(4,Math.min(e.clientX,window.innerWidth-88))+'px';
  box.style.top=Math.max(4,Math.min(e.clientY+12,window.innerHeight-32))+'px';
  box.addEventListener('click',function(ev){
    ev.preventDefault();
    ev.stopPropagation();
    hide();
    try{if(window.chrome&&chrome.webview)chrome.webview.postMessage({type:'vocabPick',front:picked.word,example:picked.sentence||''});}catch(err){}
  });
  document.documentElement.appendChild(box);
},true);
document.addEventListener('keydown',function(e){if(e.key==='Escape')hide();},true);
window.addEventListener('scroll',hide,true);
})())VB";
// ページの画像の右クリック（依頼① I1）。押した img（picture の中の img も）を覚える。矩形はここでは測らない（右が撮る直前に測る）。
//   右クリックのたびに作り直し、画像でなければ空にする。要素は WeakRef で持つ。ページの値はデータとして扱う（右が測るときに確かめ、C++ が見えている範囲に切り詰める）
constexpr wchar_t kImageHookScript[] = LR"IH((function(){
if(window.top!==window||window.__honeycombImageHook)return;
window.__honeycombImageHook=1;
document.addEventListener('contextmenu',function(e){
  var img=null;
  try{
    var path=e.composedPath?e.composedPath():[e.target];
    for(var i=0;i<path.length&&i<8;i++){
      var n=path[i];
      if(!n||n.nodeType!==1)continue;
      if(n.tagName==='IMG'){img=n;break;}
      if(n.tagName==='PICTURE'){img=n.querySelector('img');break;}
    }
  }catch(err){img=null;}
  window.__honeycombImage=img&&typeof WeakRef==='function'?{ref:new WeakRef(img),src:String(img.currentSrc||img.src||'').slice(0,8192),at:Date.now()}:null;
},true);
})())IH";
// 「📝 下のメモに引用」で左へ送る、選んだ文の上限（M4。引用の文は 2,000 字）
constexpr size_t kMemoQuoteMaxText = 2000;

// 文を limit 字までにする。絵文字など2つで1字のもの（サロゲートの組）の途中では切らない
std::wstring CutText(const std::wstring& text, size_t limit) {
    if (text.size() <= limit) return text;
    size_t end = limit;
    if (end > 0 && IS_HIGH_SURROGATE(text[end - 1])) --end;
    return text.substr(0, end);
}

}  // namespace

// ページから grokbot:// を開こうとして止めた。人が押したときだけ左の UI に知らせる（勝手に動くページで、知らせが続かないように）
void Browser::BotLinkBlocked(int id, bool userInitiated) {
    if (userInitiated) SendToSurface("left", {{"type", "botLinkBlocked"}, {"id", id}});
}

// タブを台帳に加えて UI に知らせる。この時点ではまだ WebView2 は無い（眠っている）
int Browser::AddTab(const std::wstring& url, std::optional<int> parentId, const json& requestId, bool asleep, bool background) {
    const int id = nextId_++;
    Tab& tab = tabs_[id];
    tab.id = id;
    tab.url = url;
    Broadcast({{"type", "tabCreated"},
               {"id", id},
               {"parentId", parentId ? json(*parentId) : json(nullptr)},
               {"requestId", requestId},
               {"url", ToUtf8(url)},
               {"asleep", asleep},
               {"background", background}});
    return id;
}

// 眠っているタブに WebView2 を作って起こす。作り終わったら覚えていた URL を開く
//   onReady: 「新しいウィンドウで開く」リンクのとき、作ったタブを元のページへ渡すために使う（URL は開かない）
void Browser::WakeTab(int id, TabReady onReady) {
    Tab* tab = FindTab(id);
    if (!tab || tab->controller || tab->waking) return;
    tab->waking = true;
    HRESULT hr = env_->CreateCoreWebView2Controller(
        hwnd_, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                   [this, id, onReady](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                       Tab* tab = FindTab(id);
                       if (!tab) {  // 作っている間に閉じられた
                           if (SUCCEEDED(result)) controller->Close();
                           return S_OK;
                       }
                       tab->waking = false;
                       if (FAILED(result)) {
                           ShowError(hwnd_, L"タブの作成", result);
                           return result;
                       }
                       tab->controller = controller;
                       controller->put_IsVisible(FALSE);
                       // 裏で読み込むタブも、表示するときと同じ大きさで並べる（大きさ 0 のままだと、ページの組み方が崩れる）
                       if (id != activeId_) controller->put_Bounds(PageRect());
                       controller->get_CoreWebView2(&tab->webview);
                       WatchTab(id);
                       WatchShortcuts(controller);
                       SendTabUpdate(id, {{"asleep", false}});

                       if (onReady) {
                           onReady(*tab);  // 中身は元のページが読み込む
                       } else if (!tab->url.empty()) {
                           tab->webview->Navigate(tab->url.c_str());
                       }
                       if (id == activeId_) {  // 起こしている間に表示するよう頼まれていた
                           controller->put_IsVisible(TRUE);
                           Layout();
                           UpdateWindowTitle();
                       }
                       if (auto wait = popoutAfterWake_.find(id); wait != popoutAfterWake_.end()) {
                           const nlohmann::json places = wait->second;
                           popoutAfterWake_.erase(wait);
                           ShowPopout(id, places);
                       }
                       return S_OK;
                   })
                   .Get());
    if (FAILED(hr)) {
        tab->waking = false;
        ShowError(hwnd_, L"タブの作成", hr);
    }
}

// ページで起きたことを UI に知らせるための「見張り」を付ける
void Browser::WatchTab(int id) {
    Tab* tab = FindTab(id);
    ICoreWebView2* webview = tab->webview.Get();

    webview->add_DocumentTitleChanged(Callback<ICoreWebView2DocumentTitleChangedEventHandler>(
                                          [this, id](ICoreWebView2* sender, IUnknown*) -> HRESULT {
                                              CoString title;
                                              sender->get_DocumentTitle(title.put());
                                              SendTabUpdate(id, {{"title", ToUtf8(title.str())}});
                                              if (id == activeId_) UpdateWindowTitle();
                                              UpdatePopoutTitle(id);
                                              return S_OK;
                                          })
                                          .Get(),
                                      nullptr);

    webview->add_SourceChanged(Callback<ICoreWebView2SourceChangedEventHandler>(
                                   [this, id](ICoreWebView2* sender, ICoreWebView2SourceChangedEventArgs* args) -> HRESULT {
                                       CoString uri;
                                       sender->get_Source(uri.put());
                                       // data: のページなどでは空で届くことがある。休眠から起こすときに使うので、空では上書きしない
                                       if (uri.str().empty()) return S_OK;
                                       if (Tab* tab = FindTab(id)) tab->url = uri.str();
                                       // newDocument：新しいページを読み込んだ（false はページの中で URL だけ変わった。順路で使う）
                                       BOOL isNewDocument = TRUE;
                                       args->get_IsNewDocument(&isNewDocument);
                                       SendTabUpdate(id, {{"url", ToUtf8(uri.str())}, {"newDocument", isNewDocument != FALSE}});
                                       return S_OK;
                                   })
                                   .Get(),
                               nullptr);

    webview->add_HistoryChanged(Callback<ICoreWebView2HistoryChangedEventHandler>(
                                    [this, id](ICoreWebView2* sender, IUnknown*) -> HRESULT {
                                        BOOL canGoBack = FALSE, canGoForward = FALSE;
                                        sender->get_CanGoBack(&canGoBack);
                                        sender->get_CanGoForward(&canGoForward);
                                        SendTabUpdate(id, {{"canGoBack", canGoBack != FALSE},
                                                           {"canGoForward", canGoForward != FALSE}});
                                        return S_OK;
                                    })
                                    .Get(),
                                nullptr);

    webview->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [this, id](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                // grokbot:// へは移らない（ページのリンク・リダイレクト・アドレス欄・前回のタブのどこからでも）
                CoString uri;
                if (SUCCEEDED(args->get_Uri(uri.put()))) {
                    if (Tab* tab = FindTab(id)) tab->navUri = uri.str();
                    if (IsGrokBotUri(uri.str())) {
                        args->put_Cancel(TRUE);
                        BOOL userInitiated = FALSE;
                        args->get_IsUserInitiated(&userInitiated);
                        BotLinkBlocked(id, userInitiated != FALSE);
                        return S_OK;
                    }
                }
                SendTabUpdate(id, {{"loading", true}});
                return S_OK;
            })
            .Get(),
        nullptr);

    webview->add_NavigationCompleted(
        Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [this, id](ICoreWebView2* sender, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                SendTabUpdate(id, {{"loading", false}});
                // 休眠から起きた直後なら、眠る前のスクロール位置に戻す
                Tab* tab = FindTab(id);
                if (tab && tab->restoreScrollY > 0) {
                    const std::wstring script = L"window.scrollTo(0, " + std::to_wstring(tab->restoreScrollY) + L")";
                    sender->ExecuteScript(script.c_str(), nullptr);
                }
                if (tab) tab->restoreScrollY = -1;
                // 画像ファイルは、中央の区画に合わせて縮める。失敗したときはファイルの有無で理由を出す
                //   （COREWEBVIEW2_WEB_ERROR_STATUS_FILE_NOT_FOUND は古い WebView2 SDK に無い）
                CoString uri;
                const bool gotSource = SUCCEEDED(sender->get_Source(uri.put()));
                const std::wstring source = gotSource ? uri.str() : std::wstring();
                const std::wstring requested = tab ? tab->navUri : std::wstring();
                const std::wstring& imageUri = IsImageDocument(source) ? source : requested;
                if (IsImageDocument(imageUri)) {
                    BOOL success = FALSE;
                    if (args) args->get_IsSuccess(&success);
                    if (success && IsImageDocument(source)) {
                        sender->ExecuteScript(kFitImageScript, nullptr);
                    } else if (!success && IsFileUri(imageUri) && !NavigationCanceled(args)) {
                        const std::wstring path = PathOfFileUri(imageUri);
                        const bool present = !path.empty() && ImageFilePresent(path);
                        sender->ExecuteScript(present ? kUnopenableImageScript : kMissingImageScript, nullptr);
                    }
                }
                sender->ExecuteScript(kVocabHookScript, nullptr);
                sender->ExecuteScript(kImageHookScript, nullptr);  // 画像の右クリック（I1。最上位の枠だけ）
                return S_OK;
            })
            .Get(),
        nullptr);

    // 音が鳴り始めた・止まった（音が出ているタブは眠らせない）
    ComPtr<ICoreWebView2_8> webview8;
    if (SUCCEEDED(tab->webview.As(&webview8))) {
        webview8->add_IsDocumentPlayingAudioChanged(
            Callback<ICoreWebView2IsDocumentPlayingAudioChangedEventHandler>(
                [this, id](ICoreWebView2* sender, IUnknown*) -> HRESULT {
                    ComPtr<ICoreWebView2_8> page;
                    if (FAILED(sender->QueryInterface(IID_PPV_ARGS(&page)))) return S_OK;
                    BOOL playing = FALSE;
                    page->get_IsDocumentPlayingAudio(&playing);
                    SendTabUpdate(id, {{"audible", playing != FALSE}});
                    return S_OK;
                })
                .Get(),
            nullptr);
    }

    // ファビコン（サイトの小さなアイコン）が変わった
    ComPtr<ICoreWebView2_15> webview15;
    if (SUCCEEDED(tab->webview.As(&webview15))) {
        webview15->add_FaviconChanged(Callback<ICoreWebView2FaviconChangedEventHandler>(
                                          [this, id](ICoreWebView2* sender, IUnknown*) -> HRESULT {
                                              ComPtr<ICoreWebView2_15> page;
                                              if (FAILED(sender->QueryInterface(IID_PPV_ARGS(&page)))) return S_OK;
                                              CoString uri;
                                              page->get_FaviconUri(uri.put());
                                              SendTabUpdate(id, {{"favicon", ToUtf8(uri.str())}});
                                              return S_OK;
                                          })
                                          .Get(),
                                      nullptr);
    }

    // ページが外のアプリ（OS に登録されたスキーム）を開こうとした：grokbot:// だけは止める（iframe からのものも、ここに届く）
    //   ほかのスキーム（mailto: など）は今までどおり WebView2 に任せる（「開きますか？」が出る）
    ComPtr<ICoreWebView2_18> webview18;
    if (SUCCEEDED(tab->webview.As(&webview18))) {
        webview18->add_LaunchingExternalUriScheme(
            Callback<ICoreWebView2LaunchingExternalUriSchemeEventHandler>(
                [this, id](ICoreWebView2*, ICoreWebView2LaunchingExternalUriSchemeEventArgs* args) -> HRESULT {
                    CoString uri;
                    if (FAILED(args->get_Uri(uri.put())) || !IsGrokBotUri(uri.str())) return S_OK;
                    args->put_Cancel(TRUE);
                    BOOL userInitiated = FALSE;
                    args->get_IsUserInitiated(&userInitiated);
                    BotLinkBlocked(id, userInitiated != FALSE);
                    return S_OK;
                })
                .Get(),
            nullptr);
    }

    // リンクが「新しいウィンドウ」で開かれようとした → 新しいタブにする（UI が元のタブの隣に置く）
    webview->add_NewWindowRequested(
        Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [this, id](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                CoString uri;
                args->get_Uri(uri.put());
                // grokbot:// を新しい窓で開こうとした（target="_blank" のリンク・window.open）：タブのセルを作らない
                //   （作ると空のセルが残り、起こすたびに開こうとする）。GetDeferral より前に返す（後だと「待って」を終えないまま戻る）
                if (IsGrokBotUri(uri.str())) {
                    args->put_Handled(TRUE);
                    BOOL userInitiated = FALSE;
                    args->get_IsUserInitiated(&userInitiated);
                    BotLinkBlocked(id, userInitiated != FALSE);
                    return S_OK;
                }
                // 表示していない（裏の）タブが開こうとした窓は、表に出さない（読んでいるページはこのまま）
                //   押されずに開こうとした窓（読み込みの途中やタイマーで開く広告など）は開かない。WebView2 には Edge のポップアップブロックが無い
                const bool fromHidden = id != activeId_;
                if (fromHidden) {
                    BOOL userInitiated = TRUE;
                    args->get_IsUserInitiated(&userInitiated);
                    if (!userInitiated) {
                        args->put_Handled(TRUE);
                        return S_OK;
                    }
                }
                ComPtr<ICoreWebView2NewWindowRequestedEventArgs> request = args;
                ComPtr<ICoreWebView2Deferral> deferral;
                args->GetDeferral(&deferral);  // 「タブができるまで待って」と伝える
                // 「いつも裏で開く」の設定なら、表示はせずセルに足すだけ。ただし大きさや位置を決めた小さな窓（ログインなど）は表に出す
                bool popup = false;
                ComPtr<ICoreWebView2WindowFeatures> features;
                if (SUCCEEDED(args->get_WindowFeatures(&features)) && features) {
                    BOOL hasSize = FALSE, hasPosition = FALSE;
                    features->get_HasSize(&hasSize);
                    features->get_HasPosition(&hasPosition);
                    popup = hasSize || hasPosition;
                }
                const bool background = fromHidden || (linkBackground_ && !popup);
                const int newId = AddTab(uri.str(), id, nullptr, false, background);
                WakeTab(newId, [request, deferral](Tab& tab) {
                    request->put_NewWindow(tab.webview.Get());
                    deferral->Complete();
                });
                if (!background) ActivateTab(newId);
                return S_OK;
            })
            .Get(),
        nullptr);

    // ページの「単語帳へ」ボタン。最初からある WebMessageReceived だけを使う。型が vocabPick のときだけ左へ渡す
    webview->add_WebMessageReceived(
        Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [this, id](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                CoString raw;
                if (FAILED(args->get_WebMessageAsJson(raw.put()))) return S_OK;
                const std::string utf8 = ToUtf8(raw.str());
                if (utf8.size() > 8000) return S_OK;
                try {
                    const json msg = json::parse(utf8, nullptr, false);
                    if (msg.is_discarded() || !msg.is_object()) return S_OK;
                    const auto type = msg.find("type");
                    if (type == msg.end() || !type->is_string() || type->get_ref<const std::string&>() != "vocabPick") return S_OK;
                    const auto frontIt = msg.find("front");
                    if (frontIt == msg.end() || !frontIt->is_string()) return S_OK;
                    std::string front = frontIt->get_ref<const std::string&>();
                    std::string example;
                    const auto exampleIt = msg.find("example");
                    if (exampleIt != msg.end() && exampleIt->is_string()) example = exampleIt->get_ref<const std::string&>();
                    auto trim = [](std::string& s) {
                        if (s.size() <= 2000) return;
                        size_t end = 2000;
                        while (end > 0 && (static_cast<unsigned char>(s[end]) & 0xC0) == 0x80) --end;
                        s.resize(end);
                    };
                    trim(front);
                    trim(example);
                    if (front.empty()) return S_OK;
                    SendToSurface("left", {{"type", "vocabPick"}, {"id", id}, {"front", front}, {"example", example}});
                } catch (...) {
                    return S_OK;
                }
                return S_OK;
            })
            .Get(),
        nullptr);

    // Built-in hex-memo: map the "hexmemo" folder next to the exe to https://hexmemo.local/ (no Node / serve-web.js needed)
    {
        wchar_t exePath[MAX_PATH];
        GetModuleFileNameW(nullptr, exePath, MAX_PATH);
        const std::filesystem::path hexmemoDir = std::filesystem::path(exePath).parent_path() / L"hexmemo";
        std::error_code hexmemoError;
        ComPtr<ICoreWebView2_3> hexmemoView;
        if (std::filesystem::exists(hexmemoDir / L"index.html", hexmemoError) && SUCCEEDED(webview->QueryInterface(IID_PPV_ARGS(&hexmemoView)))) {
            hexmemoView->SetVirtualHostNameToFolderMapping(L"hexmemo.local", hexmemoDir.c_str(),
                                                           COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS);
        }
    }

    WatchContextMenu(id);
    WatchDownloads(id);

    // ページが自分で window.close() した。イベントの途中で閉じないよう、少し後で閉じる
    webview->add_WindowCloseRequested(Callback<ICoreWebView2WindowCloseRequestedEventHandler>(
                                          [this, id](ICoreWebView2*, IUnknown*) -> HRESULT {
                                              PostMessageW(hwnd_, kCloseTabMessage, static_cast<WPARAM>(id), 0);
                                              return S_OK;
                                          })
                                          .Get(),
                                      nullptr);
}

// ページの右クリックのメニューの、いちばん上に項目を足す
//   いつでも（C2・C5）：
//     「中央の見えている所」：左へ captureCenter。右の「撮影」が、中央に見えている所を残す（右が閉じていれば開く）
//     「中央を録画」：録画できるときだけ。captureRecord。録画中にもう一度押すと停止（右が決める）
//     「ブラウザの窓全体」「この画面のデスクトップ」「範囲を指定…」：captureWindow / captureDesktop / captureRegion
//   選んだ文の上（S3.11）：
//     「🔍 Grok に調べてもらう」：選んだ文（4,000 字まで）とページの URL（http / https のときだけ。ほかは空）を渡し、依頼の小窓を開いてもらう
//   選んだ文の上で、下のメモの区画が見えているとき（M4）：
//     「📝 下のメモに引用」：選んだ文（2,000 字まで）を左へ。カードを足すのは左
//   リンク（http / https）の上：
//     「セルに追加（ページはこのまま）」：裏で読み込む新しいタブにする
//     「六角スクショを表紙にして、セルに追加」：今のページを六角形に切り取ってから、それを表紙にして裏で開く
//   文を選んでいれば Grok が先、その次が「単語帳のカードにする」（選んでいなくても出す。言葉はページが覚えた単語）。
//   画像の上なら、その次に「🖼 画像を撮影に送る」（依頼① I1）。その次が撮影の4つ。リンクの項目はそのあと
// 押されたら UI（左のサイドバー）に { type:"linkMenu", action, id, url, text } で伝える。タブ・小窓を作るのは UI
void Browser::WatchContextMenu(int id) {
    Tab* tab = FindTab(id);
    ComPtr<ICoreWebView2_11> webview11;
    ComPtr<ICoreWebView2Environment9> env9;
    if (!tab || FAILED(tab->webview.As(&webview11)) || FAILED(env_.As(&env9))) return;
    webview11->add_ContextMenuRequested(
        Callback<ICoreWebView2ContextMenuRequestedEventHandler>(
            [this, id, env9](ICoreWebView2*, ICoreWebView2ContextMenuRequestedEventArgs* args) -> HRESULT {
                ComPtr<ICoreWebView2ContextMenuTarget> target;
                if (FAILED(args->get_ContextMenuTarget(&target))) return S_OK;
                ComPtr<ICoreWebView2ContextMenuItemCollection> items;
                if (FAILED(args->get_MenuItems(&items))) return S_OK;
                UINT32 index = 0;
                // 押されたら左の UI に知らせる項目を、メニューの index の所に足す（url・text は押したときに送る値）
                auto add = [&](const wchar_t* label, const char* action, const std::wstring& url, const std::wstring& text) {
                    ComPtr<ICoreWebView2ContextMenuItem> item;
                    if (FAILED(env9->CreateContextMenuItem(label, nullptr, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND, &item))) return;
                    const std::string kind = action;
                    item->add_CustomItemSelected(
                        Callback<ICoreWebView2CustomItemSelectedEventHandler>(
                            [this, id, url, text, kind](ICoreWebView2ContextMenuItem*, IUnknown*) -> HRESULT {
                                SendToSurface("left", {{"type", "linkMenu"}, {"action", kind}, {"id", id}, {"url", ToUtf8(url)}, {"text", ToUtf8(text)}});
                                return S_OK;
                            })
                            .Get(),
                        nullptr);
                    if (SUCCEEDED(items->InsertValueAtIndex(index, item.Get()))) ++index;
                };

                // 選んだ文の上：「🔍 Grok に調べてもらう」（キーの表示は付けない）
                BOOL hasSelection = FALSE;
                target->get_HasSelection(&hasSelection);
                std::wstring vocabText;
                if (hasSelection) {
                    CoString selection;
                    target->get_SelectionText(selection.put());
                    const std::wstring full = selection.str();
                    if (full.find_first_not_of(L" \t\r\n\u3000") != std::wstring::npos) {
                        vocabText = CutText(full, 400);
                        CoString page;
                        target->get_PageUri(page.put());
                        const std::wstring pageUrl = IsOpenableUrl(page.str()) ? page.str() : std::wstring();  // http / https だけ
#ifdef ROCKSCELLS_BOT_FEATURES
                        add(L"🔍 Grok に調べてもらう", "askGrok", pageUrl, CutText(full, kAskGrokMaxText));
#endif
                        // 下の区画が開いているときだけ。文を選んでいなければ出さない（空白だけも出さない）
                        if (surfaces_["memo"].visible) add(L"📝 下のメモに引用", "memoQuote", pageUrl, CutText(full, kMemoQuoteMaxText));
                    }
                }

                // 単語帳。選んだ文が無くても出す（右クリックした単語は、ページが覚えたものを左が読む）
                {
                    CoString pageUri;
                    target->get_PageUri(pageUri.put());
                    std::wstring pageUrl = pageUri.str();
                    if (pageUrl.size() > 8192) pageUrl.clear();
                    add(L"単語帳のカードにする", "vocabCard", pageUrl, vocabText);
                }

                // 画像の上（依頼① I1）：「🖼 画像を撮影に送る」。url は画像の URL（http / https・8,192 字までのときだけ。data:・blob:・file: は空で、右は照合を飛ばす）
                {
                    COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND targetKind = COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_PAGE;
                    if (SUCCEEDED(target->get_Kind(&targetKind)) && targetKind == COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_IMAGE) {
                        std::wstring imageUrl;
                        BOOL hasSource = FALSE;
                        if (SUCCEEDED(target->get_HasSourceUri(&hasSource)) && hasSource) {
                            CoString source;
                            if (SUCCEEDED(target->get_SourceUri(source.put())) && IsOpenableUrl(source.str())) imageUrl = source.str();
                        }
                        add(L"🖼 画像を撮影に送る", "captureImage", imageUrl, L"");
                    }
                }

                // いつでも（C2・C5）。選んだ文が無くても、リンクの上でも出す。url は http / https のときだけ（カードに残すのは中央だけ）
                {
                    CoString pageUri;
                    target->get_PageUri(pageUri.put());
                    const std::wstring shownUrl = IsOpenableUrl(pageUri.str()) ? pageUri.str() : std::wstring();
                    add(L"中央の見えている所", "captureCenter", shownUrl, L"");
                    if (record::Available()) add(L"中央を録画", "captureRecord", shownUrl, L"");
                    add(L"ブラウザの窓全体", "captureWindow", shownUrl, L"");
                    add(L"この画面のデスクトップ", "captureDesktop", shownUrl, L"");
                    add(L"範囲を指定…", "captureRegion", shownUrl, L"");
                }

                // リンク（http / https）の上：今までの2つ
                BOOL hasLink = FALSE;
                target->get_HasLinkUri(&hasLink);
                if (hasLink) {
                    CoString link;
                    target->get_LinkUri(link.put());
                    const std::wstring url = link.str();
                    const bool http = _wcsnicmp(url.c_str(), L"http://", 7) == 0 || _wcsnicmp(url.c_str(), L"https://", 8) == 0;
                    if (http && url.size() <= 8192) {
                        std::wstring text;
                        BOOL hasText = FALSE;
                        target->get_HasLinkText(&hasText);
                        if (hasText) {
                            CoString linkText;
                            target->get_LinkText(linkText.put());
                            text = linkText.str().substr(0, 300);
                        }
                        add(L"セルに追加（ページはこのまま）", "background", url, text);
                        add(L"六角スクショを表紙にして、セルに追加", "shotCover", url, text);
                    }
                }
                ComPtr<ICoreWebView2ContextMenuItem> separator;
                if (index > 0 && SUCCEEDED(env9->CreateContextMenuItem(L"", nullptr, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR, &separator))) {
                    items->InsertValueAtIndex(index, separator.Get());
                }
                return S_OK;
            })
            .Get(),
        nullptr);
}

void Browser::ActivateTab(int id) {
    Tab* next = FindTab(id);
    if (!next) return;
    if (IsPopped(id)) DockPopout(id);  // 小窓のタブを選んだら、大きい窓に戻す
    if (Tab* current = FindTab(activeId_); current && current != next && current->controller && !IsPopped(current->id)) {
        current->controller->put_IsVisible(FALSE);  // 小窓に出しているタブは隠さない
    }
    activeId_ = id;
    if (next->controller) {
        ResumeTab(*next);
        next->controller->put_IsVisible(TRUE);
        Layout();
    } else {
        WakeTab(id);  // 眠っていたら起こす。起き終わったところで表示される
    }
    UpdateWindowTitle();
    Broadcast({{"type", "tabActivated"}, {"id", id}});
}

void Browser::CloseTab(int id) {
    if (IsPopped(id)) DockPopout(id);
    popoutAfterWake_.erase(id);
    auto it = tabs_.find(id);
    if (it == tabs_.end()) return;
    if (it->second.controller) it->second.controller->Close();
    tabs_.erase(it);
    if (activeId_ == id) activeId_ = 0;  // 次にどのタブを出すかは UI が決めて activateTab を送ってくる
    UpdateWindowTitle();
    Broadcast({{"type", "tabClosed"}, {"id", id}});
}

// 表示中のタブの見た目を JPEG で撮って、UI に渡す（拡大表示のサムネイル用）
void Browser::CaptureTab(int id) {
    Tab* tab = FindTab(id);
    if (!tab || !tab->webview || id != activeId_) return;  // 画面に出ているタブだけ撮れる
    ComPtr<IStream> stream;
    if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream))) return;
    tab->webview->CapturePreview(
        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG, stream.Get(),
        Callback<ICoreWebView2CapturePreviewCompletedHandler>([this, id, stream](HRESULT result) -> HRESULT {
            if (FAILED(result)) return S_OK;
            STATSTG stat{};
            if (FAILED(stream->Stat(&stat, STATFLAG_NONAME))) return S_OK;
            std::vector<BYTE> bytes(static_cast<size_t>(stat.cbSize.QuadPart));
            LARGE_INTEGER start{};
            stream->Seek(start, STREAM_SEEK_SET, nullptr);
            ULONG read = 0;
            stream->Read(bytes.data(), static_cast<ULONG>(bytes.size()), &read);
            bytes.resize(read);
            Broadcast({{"type", "tabThumbnail"}, {"id", id}, {"image", "data:image/jpeg;base64," + Base64(bytes)}});
            return S_OK;
        }).Get());
}

// 六角形スクショ用：表示中のページを、そのままの大きさで撮って、頼んだ面へ返す
//   maxEdge が 0 より大きいときは、下のメモの区画からの「見えている所」。CapturePreview は使わない
//   （下の区画に入力先があると CapturePreview が失敗しやすい。ページ全体の JPEG は大きすぎて、面へ届かないことがある）
void Browser::CaptureFull(int id, const std::string& surface, const json& requestId, int maxEdge, const json& rect) {
    if (maxEdge > 0) {
        CaptureViewport(id, surface, requestId, maxEdge, rect);
        return;
    }
    // 矩形は、見えている範囲を DevTools で撮る道（maxEdge > 0）でだけ使える
    if (!rect.is_null()) {
        SendToSurface(surface, {{"type", "capture"}, {"requestId", requestId}, {"ok", false}, {"error", "rect"}});
        return;
    }
    Tab* tab = FindTab(id);
    auto fail = [this, surface, requestId]() { SendToSurface(surface, {{"type", "capture"}, {"requestId", requestId}, {"ok", false}}); };
    ComPtr<IStream> stream;
    if (!tab || !tab->webview || id != activeId_ || FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream))) {
        fail();
        return;
    }
    const HRESULT hr = tab->webview->CapturePreview(
        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG, stream.Get(),
        Callback<ICoreWebView2CapturePreviewCompletedHandler>([this, surface, requestId, stream](HRESULT result) -> HRESULT {
            STATSTG stat{};
            if (FAILED(result) || FAILED(stream->Stat(&stat, STATFLAG_NONAME))) {
                SendToSurface(surface, {{"type", "capture"}, {"requestId", requestId}, {"ok", false}});
                return S_OK;
            }
            std::vector<BYTE> bytes(static_cast<size_t>(stat.cbSize.QuadPart));
            LARGE_INTEGER start{};
            stream->Seek(start, STREAM_SEEK_SET, nullptr);
            ULONG read = 0;
            stream->Read(bytes.data(), static_cast<ULONG>(bytes.size()), &read);
            bytes.resize(read);
            SendToSurface(surface, {{"type", "capture"}, {"requestId", requestId}, {"ok", true}, {"image", "data:image/jpeg;base64," + Base64(bytes)}});
            return S_OK;
        }).Get());
    if (FAILED(hr)) fail();
}

// 下のメモの区画から、および右の「撮影」の静止画：上に見えている範囲だけを JPEG で返す
//   DevTools の Page.captureScreenshot。入力先がページに無くても撮れる
//   captureBeyondViewport は false。true だと撮影の瞬間にスクロールバーが消え、中央寄せのページが左右にずれる
//   （録画で、フレームごとに出たり消えたりした。静止画も、見えている通りに残す）
//   clip は DIP（CSS ピクセル × ページの拡大率）で、文書の左上から数える（2026-10-14、依頼① I0 で Windows の WebView2 を確かめた）。
//   見えている所を撮るには、cssVisualViewport の pageX・pageY と zoom を使う
//   （0,0 から CSS の大きさで撮ると、スクロールしたページでは文書の上の描かれていない所を、拡大したページでは左上の一部だけを撮っていた）
//   長い辺は maxEdge 以下（DIP の長い辺で数える）。Base64 がまだ大きいときは、もう一度小さくしてから渡す（大きすぎると面へ届かず、カードができない）
//   倍率は 1 まで（I0：1 より大きくすると画面がちらつく。1 でも表示の拡大率のぶん細かく撮れる）
//   rect（依頼① I1。省いてよい）：見えている所の左上からの CSS ピクセルの矩形（ページの画像の要素）。見えている範囲との交わりだけを撮り、
//   交わりが 8 CSS ピクセルより小さければ 'rect' で断る。成功の返事に、撮った矩形（CSS）・切り詰めたか・倍率・小さくし直したかを添える
void Browser::CaptureViewport(int id, const std::string& surface, const json& requestId, int maxEdge, const json& rect) {
    auto fail = [this, surface, requestId](const char* error) {
        SendToSurface(surface, {{"type", "capture"}, {"requestId", requestId}, {"ok", false}, {"error", error}});
    };
    if (IsPopped(id)) {
        fail("popout");
        return;
    }
    Tab* tab = FindTab(id);
    if (!tab || !tab->webview) {
        fail("noPage");
        return;
    }
    if (id != activeId_) {
        fail("notActive");
        return;
    }
    ResumeTab(*tab);  // 一時停止中だと撮れない
    const HRESULT hr = tab->webview->CallDevToolsProtocolMethod(
        L"Page.getLayoutMetrics", L"{}",
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [this, surface, requestId, id, maxEdge, rect](HRESULT result, LPCWSTR resultJson) -> HRESULT {
                auto failInner = [this, surface, requestId](const char* error) {
                    SendToSurface(surface, {{"type", "capture"}, {"requestId", requestId}, {"ok", false}, {"error", error}});
                };
                Tab* current = FindTab(id);
                if (!current || !current->webview) {
                    failInner("noPage");
                    return S_OK;
                }
                if (id != activeId_) {
                    failInner("notActive");
                    return S_OK;
                }
                const json metrics = SUCCEEDED(result) && resultJson ? json::parse(ToUtf8(resultJson), nullptr, false) : json();
                auto num = [](const json& obj, const char* key) -> double {
                    if (!obj.is_object() || !obj.contains(key) || !obj[key].is_number()) return -1;
                    return obj[key].get<double>();
                };
                // 無い・数でない・有限でないときは fallback（pageX は右から左の文書で負になることがあるので、num の -1 は使わない）
                auto numOr = [](const json& obj, const char* key, double fallback) -> double {
                    if (!obj.is_object() || !obj.contains(key) || !obj[key].is_number()) return fallback;
                    const double value = obj[key].get<double>();
                    return std::isfinite(value) ? value : fallback;
                };
                const json vp = metrics.is_object() && metrics.contains("cssVisualViewport") && metrics["cssVisualViewport"].is_object()
                                    ? metrics["cssVisualViewport"]
                                    : json::object();
                const json layout = metrics.is_object() && metrics.contains("cssLayoutViewport") && metrics["cssLayoutViewport"].is_object()
                                        ? metrics["cssLayoutViewport"]
                                        : json::object();
                // 見えている大きさと、その左上の文書の座標（CSS ピクセル）。cssVisualViewport に無ければ cssLayoutViewport
                const json& view = num(vp, "clientWidth") >= 1 && num(vp, "clientHeight") >= 1 ? vp : layout;
                const double w = num(view, "clientWidth");
                const double h = num(view, "clientHeight");
                if (w < 1 || h < 1 || w > 8000 || h > 8000) {
                    failInner(metrics.is_object() ? "viewport" : "metrics");
                    return S_OK;
                }
                // ページの拡大率（CSS → DIP）。cssVisualViewport にだけある。無い・変な値なら 1
                double zoom = numOr(vp, "zoom", 1.0);
                if (zoom < 0.05 || zoom > 20) zoom = 1.0;
                // 撮る範囲（CSS ピクセル。見えている所の左上から）。rect があれば、見えている範囲（0,0,w,h）との交わり
                double cssX = 0;
                double cssY = 0;
                double cssW = w;
                double cssH = h;
                json rectInfo;  // rect のときだけ、返事に添える（撮った矩形と、切り詰めたか）
                if (rect.is_object()) {
                    const double rx = rect.value("x", 0.0);
                    const double ry = rect.value("y", 0.0);
                    const double rw = rect.value("width", 0.0);
                    const double rh = rect.value("height", 0.0);
                    const double left = rx > 0 ? rx : 0.0;
                    const double top = ry > 0 ? ry : 0.0;
                    const double rightEdge = rx + rw < w ? rx + rw : w;
                    const double bottomEdge = ry + rh < h ? ry + rh : h;
                    if (rightEdge - left < 8 || bottomEdge - top < 8) {
                        failInner("rect");
                        return S_OK;
                    }
                    cssX = left;
                    cssY = top;
                    cssW = rightEdge - left;
                    cssH = bottomEdge - top;
                    const bool cropped = left > rx + 0.5 || top > ry + 0.5 || rightEdge < rx + rw - 0.5 || bottomEdge < ry + rh - 0.5;
                    rectInfo = {{"rect", {{"x", cssX}, {"y", cssY}, {"width", cssW}, {"height", cssH}}}, {"cropped", cropped}};
                }
                const double clipX = (numOr(view, "pageX", 0.0) + cssX) * zoom;
                const double clipY = (numOr(view, "pageY", 0.0) + cssY) * zoom;
                const double clipW = cssW * zoom;
                const double clipH = cssH * zoom;
                const double longEdge = clipW > clipH ? clipW : clipH;
                double scale = longEdge > static_cast<double>(maxEdge) ? static_cast<double>(maxEdge) / longEdge : 1.0;
                if (scale < 0.05) scale = 0.05;

                // 非同期の返事の中から、大きすぎたときにもう一度呼ぶ。関数自身は弱い参照だけ持つ（残り続けないように）
                const auto shoot = std::make_shared<std::function<void(double, bool)>>();
                const std::weak_ptr<std::function<void(double, bool)>> weak = shoot;
                *shoot = [this, surface, requestId, id, clipX, clipY, clipW, clipH, rectInfo, weak](double shotScale, bool allowRetry) {
                    const auto self = weak.lock();
                    if (!self) return;
                    Tab* tab = FindTab(id);
                    if (!tab || !tab->webview || id != activeId_) {
                        const char* error = !tab || !tab->webview ? "noPage" : "notActive";
                        SendToSurface(surface, {{"type", "capture"}, {"requestId", requestId}, {"ok", false}, {"error", error}});
                        return;
                    }
                    // 見えている所だけ（文書の座標 × 拡大率＝DIP）。scale は書き出す画像の縮小で、画面の上書きではない（1 より大きくすると画面がちらつく）
                    const json params = {{"format", "jpeg"},
                                         {"quality", 85},
                                         {"fromSurface", true},
                                         {"captureBeyondViewport", false},
                                         {"clip", {{"x", clipX}, {"y", clipY}, {"width", clipW}, {"height", clipH}, {"scale", shotScale}}}};
                    const HRESULT call = tab->webview->CallDevToolsProtocolMethod(
                        L"Page.captureScreenshot", ToWide(params.dump()).c_str(),
                        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
                            [this, surface, requestId, shotScale, allowRetry, rectInfo, self](HRESULT shotResult, LPCWSTR shotJson) -> HRESULT {
                                const json shot = SUCCEEDED(shotResult) && shotJson ? json::parse(ToUtf8(shotJson), nullptr, false) : json();
                                const std::string data = shot.is_object() && shot.contains("data") && shot["data"].is_string() ? shot["data"].get<std::string>() : std::string();
                                // これより大きい Base64 は、面への受け渡しで落ちることがある（カードができない）
                                constexpr size_t kMaxChars = 900000;
                                if (data.size() > kMaxChars && allowRetry && shotScale > 0.12) {
                                    (*self)(shotScale * 0.5, false);
                                    return S_OK;
                                }
                                if (data.empty() || data.size() > kMaxChars) {
                                    const char* error = data.empty() ? "shot" : "tooBig";
                                    SendToSurface(surface, {{"type", "capture"}, {"requestId", requestId}, {"ok", false}, {"error", error}});
                                    return S_OK;
                                }
                                json reply = {{"type", "capture"}, {"requestId", requestId}, {"ok", true}, {"image", "data:image/jpeg;base64," + data}};
                                // rect のとき：撮った矩形（CSS）・切り詰めたか・倍率・大きすぎて小さくし直したか（UI の知らせに使う）
                                if (rectInfo.is_object()) {
                                    reply["rect"] = rectInfo.at("rect");
                                    reply["cropped"] = rectInfo.at("cropped");
                                    reply["scale"] = shotScale;
                                    reply["reduced"] = !allowRetry;
                                }
                                SendToSurface(surface, reply);
                                return S_OK;
                            })
                            .Get());
                    if (FAILED(call)) {
                        SendToSurface(surface, {{"type", "capture"}, {"requestId", requestId}, {"ok", false}, {"error", "shot"}});
                    }
                };
                (*shoot)(scale, true);
                return S_OK;
            })
            .Get());
    if (FAILED(hr)) fail("metrics");
}

// ---------- 休眠 ----------
// 「いつ眠らせるか」は UI（TypeScript）が決めて頼んでくる。ここでは実際に止める・閉じるだけ

// 一時停止：裏にあるタブのページの動き（タイマーなど）を止めて、メモリも減らす。すぐに戻せる
void Browser::SuspendTab(int id) {
    Tab* tab = FindTab(id);
    if (!tab || !tab->webview || tab->suspended || id == activeId_ || IsPopped(id)) return;  // 表示中・小窓のタブは止められない
    ComPtr<ICoreWebView2_3> webview3;
    if (FAILED(tab->webview.As(&webview3))) return;
    webview3->TrySuspend(Callback<ICoreWebView2TrySuspendCompletedHandler>(
                             [this, id](HRESULT result, BOOL isSuccessful) -> HRESULT {
                                 Tab* tab = FindTab(id);
                                 if (!tab || !tab->webview) return S_OK;
                                 tab->suspended = SUCCEEDED(result) && isSuccessful;
                                 if (tab->suspended && id == activeId_) {  // 止めている間に表示された
                                     ResumeTab(*tab);
                                     return S_OK;
                                 }
                                 if (tab->suspended) {
                                     ComPtr<ICoreWebView2_19> webview19;
                                     if (SUCCEEDED(tab->webview.As(&webview19))) {
                                         webview19->put_MemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
                                     }
                                 }
                                 SendTabUpdate(id, {{"suspended", tab->suspended}});
                                 return S_OK;
                             })
                             .Get());
}

void Browser::ResumeTab(Tab& tab) {
    if (!tab.suspended || !tab.webview) return;
    ComPtr<ICoreWebView2_3> webview3;
    if (SUCCEEDED(tab.webview.As(&webview3))) webview3->Resume();
    ComPtr<ICoreWebView2_19> webview19;
    if (SUCCEEDED(tab.webview.As(&webview19))) {
        webview19->put_MemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
    }
    tab.suspended = false;
    SendTabUpdate(tab.id, {{"suspended", false}});
}

// 休眠前にページで確かめること：入力途中の文字があるか、どこまでスクロールしていたか
constexpr wchar_t kBeforeDiscardScript[] = LR"JS((() => {
  const changed = [...document.querySelectorAll('input, textarea, select')].some((el) => {
    if (el.disabled || el.type === 'hidden') return false;
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
    if (el.tagName === 'SELECT') return [...el.options].some((o) => o.selected !== o.defaultSelected);
    return el.value !== el.defaultValue;
  });
  const editing = document.activeElement !== null && document.activeElement.isContentEditable;
  return { unsaved: changed || editing, scrollY: Math.round(window.scrollY) };
})())JS";

// 休眠：WebView2 を閉じてメモリを空ける。URL とスクロール位置だけ覚えておき、開いたときに読み込み直す
//   入力途中の文字があるページは、消えてしまうので休眠させず、一時停止のままにする
void Browser::DiscardTab(int id) {
    Tab* tab = FindTab(id);
    if (!tab || !tab->webview || id == activeId_ || IsPopped(id)) return;
    ResumeTab(*tab);  // 止まったままだとページを調べられないので、一度だけ動かす
    tab->webview->ExecuteScript(
        kBeforeDiscardScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>([this, id](HRESULT result, LPCWSTR resultJson) -> HRESULT {
            Tab* tab = FindTab(id);
            if (!tab || !tab->controller || id == activeId_ || IsPopped(id)) return S_OK;  // 調べている間に表示された・小窓に出た
            json page = SUCCEEDED(result) && resultJson ? json::parse(ToUtf8(resultJson), nullptr, false) : json();
            if (page.is_object() && page.value("unsaved", false)) {
                SendTabUpdate(id, {{"sleepBlocked", "input"}});
                SuspendTab(id);
                return S_OK;
            }
            tab->restoreScrollY = page.is_object() ? page.value("scrollY", 0.0) : 0.0;
            tab->controller->Close();
            tab->controller = nullptr;
            tab->webview = nullptr;
            tab->suspended = false;
            SendTabUpdate(id, {{"asleep", true},
                               {"suspended", false},
                               {"audible", false},
                               {"loading", false},
                               {"canGoBack", false},
                               {"canGoForward", false},
                               {"sleepBlocked", nullptr}});
            return S_OK;
        }).Get());
}

// ---------- AI 用：ページの文章 ----------

// ページの本文（記事や main があればそこだけ）・タイトル・URL・選んでいる文字を取り出す。長すぎる本文は切る
constexpr wchar_t kPageTextScript[] = LR"JS((() => {
  const pick = () => {
    for (const selector of ['article', 'main', '[role="main"]']) {
      const el = document.querySelector(selector);
      if (el && el.innerText.trim().length > 400) return el;
    }
    return document.body;
  };
  const root = pick();
  const text = (root ? root.innerText : '').replace(/\n{3,}/g, '\n\n').trim();
  const limit = 40000;
  return {
    title: document.title,
    url: location.href,
    text: text.slice(0, limit),
    truncated: text.length > limit,
    length: text.length,
    selection: String(window.getSelection() || '').trim().slice(0, 2000),
    lang: document.documentElement.lang || '',
  };
})())JS";

void Browser::SendPageText(const std::string& surface, int id, const json& requestId) {
    Tab* tab = FindTab(id ? id : activeId_);
    if (!tab || !tab->webview) {
        SendToSurface(surface, {{"type", "pageText"}, {"requestId", requestId}, {"error", "noPage"}});
        return;
    }
    ResumeTab(*tab);  // 一時停止中だと文章を取り出せない
    const int tabId = tab->id;
    tab->webview->ExecuteScript(
        kPageTextScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, surface, tabId, requestId](HRESULT result, LPCWSTR resultJson) -> HRESULT {
                json page = SUCCEEDED(result) && resultJson ? json::parse(ToUtf8(resultJson), nullptr, false) : json();
                if (!page.is_object()) {
                    SendToSurface(surface, {{"type", "pageText"}, {"requestId", requestId}, {"error", "script"}});
                    return S_OK;
                }
                page["type"] = "pageText";
                page["requestId"] = requestId;
                page["tabId"] = tabId;
                SendToSurface(surface, page);
                return S_OK;
            })
            .Get());
}

// どこまで読んだか：スクロール位置・ページの高さ・見えている高さ
void Browser::SendScroll(const std::string& surface, int id, const json& requestId) {
    Tab* tab = FindTab(id);
    if (!tab || !tab->webview || tab->suspended) {
        SendToSurface(surface, {{"type", "scroll"}, {"requestId", requestId}, {"error", "noPage"}});
        return;
    }
    tab->webview->ExecuteScript(
        L"({ y: Math.round(scrollY), h: document.documentElement.scrollHeight, vh: innerHeight })",
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, surface, requestId](HRESULT result, LPCWSTR resultJson) -> HRESULT {
                json value = SUCCEEDED(result) && resultJson ? json::parse(ToUtf8(resultJson), nullptr, false) : json();
                if (!value.is_object()) value = {{"error", "script"}};
                value["type"] = "scroll";
                value["requestId"] = requestId;
                SendToSurface(surface, value);
                return S_OK;
            })
            .Get());
}

// タブの中で UI のスクリプトを動かして、結果を返す（音楽の再生・一時停止など。AI の道具用）
//   DevTools の Runtime.evaluate を使う：Promise を待てて、「人が操作した」扱いになる（再生がブラウザに止められない）
void Browser::EvalInTab(const std::string& surface, int id, const std::string& script, const json& requestId) {
    Tab* tab = FindTab(id);
    if (!tab || !tab->webview || script.empty()) {
        SendToSurface(surface, {{"type", "evalResult"}, {"requestId", requestId}, {"ok", false}, {"error", "noPage"}});
        return;
    }
    ResumeTab(*tab);  // 一時停止中だとスクリプトが動かない
    const json params = {{"expression", script}, {"awaitPromise", true}, {"returnByValue", true}, {"userGesture", true}};
    const HRESULT hr = tab->webview->CallDevToolsProtocolMethod(
        L"Runtime.evaluate", ToWide(params.dump()).c_str(),
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>(
            [this, surface, requestId](HRESULT result, LPCWSTR resultJson) -> HRESULT {
                json reply = {{"type", "evalResult"}, {"requestId", requestId}, {"ok", false}};
                const json value = SUCCEEDED(result) && resultJson ? json::parse(ToUtf8(resultJson), nullptr, false) : json();
                if (!value.is_object()) {
                    reply["error"] = "failed";  // ページの移動中など
                } else if (value.contains("exceptionDetails")) {
                    reply["error"] = "exception";
                } else {
                    reply["ok"] = true;
                    reply["value"] = value.contains("result") ? value["result"].value("value", json()) : json();
                }
                SendToSurface(surface, reply);
                return S_OK;
            })
            .Get());
    if (FAILED(hr)) SendToSurface(surface, {{"type", "evalResult"}, {"requestId", requestId}, {"ok", false}, {"error", "failed"}});
}

void Browser::SetMuted(int id, bool muted) {
    Tab* tab = FindTab(id);
    if (!tab || !tab->webview) return;
    ComPtr<ICoreWebView2_8> webview8;
    if (FAILED(tab->webview.As(&webview8))) return;
    webview8->put_IsMuted(muted);
    SendTabUpdate(id, {{"muted", muted}});
}

Browser::Tab* Browser::FindTab(int id) {
    auto it = tabs_.find(id);
    return it == tabs_.end() ? nullptr : &it->second;
}

json Browser::DescribeTab(const Tab& tab) {
    json info = {{"id", tab.id}, {"url", ToUtf8(tab.url)}, {"asleep", tab.asleep()}, {"suspended", tab.suspended}};
    if (!tab.webview) return info;
    ComPtr<ICoreWebView2_8> webview8;
    if (SUCCEEDED(tab.webview.As(&webview8))) {
        BOOL playing = FALSE, muted = FALSE;
        webview8->get_IsDocumentPlayingAudio(&playing);
        webview8->get_IsMuted(&muted);
        info["audible"] = playing != FALSE;
        info["muted"] = muted != FALSE;
    }
    CoString title, favicon;
    BOOL canGoBack = FALSE, canGoForward = FALSE;
    tab.webview->get_DocumentTitle(title.put());
    tab.webview->get_CanGoBack(&canGoBack);
    tab.webview->get_CanGoForward(&canGoForward);
    ComPtr<ICoreWebView2_15> webview15;
    if (SUCCEEDED(tab.webview.As(&webview15))) webview15->get_FaviconUri(favicon.put());
    info["title"] = ToUtf8(title.str());
    info["favicon"] = ToUtf8(favicon.str());
    info["canGoBack"] = canGoBack != FALSE;
    info["canGoForward"] = canGoForward != FALSE;
    return info;
}
