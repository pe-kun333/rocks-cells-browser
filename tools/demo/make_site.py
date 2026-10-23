# デモ用のサイト（自作の短い記事）と、字幕つきの音声ファイル（無音・3分）を作る。site\ と media\ に置く（git には入れない）
import os
import wave

root = os.path.dirname(os.path.abspath(__file__))
site = os.path.join(root, 'site')
media = os.path.join(root, 'media')
os.makedirs(site, exist_ok=True)
os.makedirs(media, exist_ok=True)

STYLE = """
body { margin: 0; font-family: 'Yu Gothic UI', 'Meiryo', sans-serif; color: #2b2a26; background: #fbf8f1; line-height: 1.9; }
header { padding: 34px 48px 26px; color: #fff; background: var(--c); }
header small { opacity: .85; }
h1 { margin: 6px 0 0; font-size: 30px; }
main { max-width: 760px; margin: 0 auto; padding: 18px 40px 80px; font-size: 17px; }
h2 { margin-top: 34px; padding-left: 10px; border-left: 6px solid var(--c); font-size: 21px; }
a { color: var(--c); font-weight: 700; }
figure { margin: 22px 0; text-align: center; }
figcaption { color: #77746c; font-size: 13px; }
.note { padding: 12px 16px; border-radius: 10px; background: #fff; box-shadow: 0 1px 4px #0001; }
"""


def hexes(color):
    cells = []
    import math
    for row in range(3):
        for col in range(7):
            x = 40 + col * 52 + (26 if row % 2 else 0)
            y = 40 + row * 45
            pts = ' '.join(f'{x + 28 * math.cos(math.radians(60 * i - 30)):.1f},{y + 28 * math.sin(math.radians(60 * i - 30)):.1f}' for i in range(6))
            fill = color if (row * 7 + col) % 3 else '#f3c74d'
            cells.append(f'<polygon points="{pts}" fill="{fill}" opacity="{0.55 + 0.15 * ((row + col) % 3):.2f}" stroke="#fff" stroke-width="3"/>')
    return f'<svg viewBox="0 0 420 170" width="420" height="170">{"".join(cells)}</svg>'


def icon(name, color, letter):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><polygon points="32,3 58,18 58,46 32,61 6,46 6,18" fill="{color}"/><text x="32" y="43" font-size="30" text-anchor="middle" fill="#fff" font-family="Yu Gothic UI, Meiryo" font-weight="700">{letter}</text></svg>'
    open(os.path.join(site, f'{name}.svg'), 'w', encoding='utf-8').write(svg)


def page(name, title, kicker, color, letter, body):
    icon(name, color, letter)
    html = f"""<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>{title}</title>
<link rel="icon" href="{name}.svg" type="image/svg+xml">
<style>:root {{ --c: {color}; }} {STYLE}</style></head>
<body><header><small>{kicker}</small><h1>{title}</h1></header>
<main>{body}</main></body></html>"""
    open(os.path.join(site, f'{name}.html'), 'w', encoding='utf-8').write(html)


page('hachi', '蜂の巣はなぜ六角形なのか', 'しぜんのかたち 第3回', '#c9822b', '蜂', f"""
<figure>{hexes('#d99a3f')}<figcaption>ミツバチの巣のようす（イメージ）</figcaption></figure>
<p>ミツバチの巣をのぞくと、同じ大きさの六角形の部屋が、すきまなくびっしりと並んでいます。蜂はものさしも設計図も持っていないのに、なぜこんなにきれいな形を作れるのでしょうか。</p>
<h2>すきまなく並ぶ形</h2>
<p>同じ形の正多角形だけで平面をすきまなく埋められるのは、正三角形・正方形・正六角形の三つだけです。くわしくは「<a href="sugaku.html">六角形の数学</a>」で紹介しています。この三つのうち、どれが巣にいちばん向いているのでしょう。</p>
<h2>少ない材料で広い部屋</h2>
<p>巣の壁は、蜂が体から出す「みつろう」でできています。みつろうを作るには、たくさんのはちみつが必要です。同じ広さの部屋を作るとき、まわりの長さがいちばん短くてすむのが正六角形です。つまり六角形の巣は、少ない材料で広い部屋をたくさん作れる、とても経済的な形なのです。</p>
<h2>丸から六角形へ？</h2>
<p>近年の研究では、蜂ははじめから六角形を作っているのではなく、丸い部屋を作り、みつろうがやわらかいうちに押し合って六角形に近づく、という考えも出されています。シャボン玉を並べると境目がまっすぐになるのと、少し似ています。</p>
<h2>まとめ</h2>
<p class="note">六角形の巣は「すきまなく並ぶ」「材料が少なくてすむ」「じょうぶ」という良いところを合わせ持っています。とれたはちみつは、<a href="recipe.html">はちみつレモン</a>にしてもおいしくいただけます。</p>
""")

page('sugaku', '六角形の数学：すきまなく並べる', 'かたちの算数', '#3f7fbf', '数', f"""
<figure>{hexes('#5b95cf')}<figcaption>正六角形の敷きつめ</figcaption></figure>
<p>床のタイルのように、同じ形を並べて平面をすきまなく埋めることを「敷きつめ（タイリング）」といいます。</p>
<h2>敷きつめられる正多角形は三つだけ</h2>
<p>一つの頂点のまわりに集まる角の合計は360度です。正三角形（60度）は6枚、正方形（90度）は4枚、正六角形（120度）は3枚で、ちょうど360度になります。正五角形（108度）では、どう並べてもすきまができてしまいます。</p>
<h2>ハニカム予想</h2>
<p>「平面を同じ面積の部屋に分けるとき、境目の長さの合計がいちばん短いのは正六角形の並び」という考えは、古くから知られていました。これは「ハニカム予想」と呼ばれ、1999年に数学者トーマス・ヘイルズが証明しました。</p>
<h2>もっと知りたい人へ</h2>
<p>形のちがう何種類ものタイルを組み合わせると、もっと不思議な模様が作れます。「<a href="tile.html">敷きつめの不思議</a>」に続きます。</p>
""")

page('tile', '敷きつめの不思議', 'かたちの算数・つづき', '#6c5bb5', '敷', f"""
<figure>{hexes('#8a7bd0')}<figcaption>模様のイメージ</figcaption></figure>
<p>正多角形を組み合わせると、正三角形と正六角形を交互に並べるなど、いろいろな模様が作れます。</p>
<h2>くり返さない敷きつめ</h2>
<p>二種類のひし形を組み合わせると、どこまで行っても同じくり返しにならない模様が作れます。発見者の名前から「ペンローズ・タイル」と呼ばれています。</p>
<h2>絵で敷きつめる</h2>
<p>鳥や魚の形で平面を埋めつくす版画も知られています。形を少し変えても、すきまなく並ぶ性質は保てるのです。</p>
""")

page('hoshi', '冬の星座の見つけ方', '夜空さんぽ', '#2c4a7a', '星', f"""
<figure>{hexes('#4a6aa0')}<figcaption>冬の夜空（イメージ）</figcaption></figure>
<p>冬は空気がすんでいて、明るい星がたくさん見える季節です。まずは目印になる星座から探してみましょう。</p>
<h2>オリオン座</h2>
<p>南の空に、三つの星が斜めに並んでいるのが見つかったら、それがオリオン座の「三つ星」です。そのまわりを四つの明るい星が囲んでいます。左上の赤い星がベテルギウス、右下の青白い星がリゲルです。</p>
<h2>冬の大三角</h2>
<p>ベテルギウスと、おおいぬ座のシリウス、こいぬ座のプロキオンを結ぶと、大きな三角形ができます。これが「冬の大三角」です。シリウスは、夜空でいちばん明るい恒星です。</p>
""")

page('recipe', 'はちみつレモンの作り方', 'きょうのおやつ', '#d0a21e', '蜜', f"""
<figure>{hexes('#e0b83a')}<figcaption>はちみつレモン</figcaption></figure>
<h2>材料</h2>
<p>レモン2個、はちみつ200グラム、清潔なびん。</p>
<h2>作り方</h2>
<p>レモンをよく洗い、うすい輪切りにします。種はていねいに取り除きます。びんにレモンとはちみつを交互に入れ、ふたをして冷蔵庫で一晩おけばできあがりです。お湯や炭酸水でわるのがおすすめです。</p>
""")

open(os.path.join(site, 'radio.html'), 'w', encoding='utf-8').write("""<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>六角ラジオ（生放送）</title>
<link rel="icon" href="radio.svg" type="image/svg+xml">
<style>body { margin: 0; font-family: 'Yu Gothic UI', 'Meiryo', sans-serif; color: #fff; background: radial-gradient(circle at 30% 20%, #3b4f7c, #141a2b); min-height: 100vh; display: grid; place-items: center; text-align: center; }
.onair { display: inline-block; padding: 4px 14px; border-radius: 999px; background: #e0473b; font-weight: 700; letter-spacing: .1em; }
h1 { font-size: 34px; margin: 18px 0 6px; } p { opacity: .8; }</style></head>
<body><div><span class="onair">ON AIR</span><h1>六角ラジオ</h1><p>毎週日曜 20:00〜 ／ きょうのテーマ：冬の星空</p></div></body></html>""")
icon('radio', '#e0473b', '音')

# 字幕つきの音声（3分。音は無音：動画には音を入れない）
lines = [
    'こんばんは。六角ラジオの時間です。',
    '今週も、自然の中のかたちについてお話しします。',
    'きょうのテーマは、ミツバチの巣です。',
    'ミツバチの巣は、六角形の部屋がすきまなく並んでいます。',
    'なぜ六角形なのか、先週いただいたおたよりから紹介します。',
    '小学生のリスナーさんからの質問です。',
    '「三角や四角の巣ではだめなんですか？」',
    'とてもいい質問ですね。',
    'じつは、三角形や四角形でも、すきまなく並べることはできます。',
    'でも、同じ広さの部屋を作るとき、壁がいちばん短くてすむのが六角形なんです。',
    '壁のみつろうは、蜂にとってとても貴重な材料です。',
    'はちみつをたくさん食べて、やっと少し作れるものなんですね。',
    'だから、材料の少ない六角形は、とても理にかなっているわけです。',
    'ここで一曲おかけします。',
    '……',
    'お聞きいただいたのは、夜にぴったりの静かな曲でした。',
    'さて、六角形には、もう一つ良いところがあります。',
    'それは、じょうぶなことです。',
    '力がまわりの部屋に分かれて伝わるので、こわれにくいんですね。',
    '飛行機のつばさの中にも、ハニカム構造が使われています。',
    '軽くてじょうぶ、というわけです。',
    '最近の研究では、蜂は丸い部屋を作っているという説もあります。',
    'やわらかいみつろうが押し合って、自然に六角形になるそうです。',
    'シャボン玉を並べたときの境目に、少し似ていますね。',
    'ここまで、ミツバチの巣のお話でした。',
    '来週は、雪の結晶がなぜ六角形なのかをお話しします。',
    'おたよりもお待ちしています。',
    'それでは、また来週。',
]
step = 180 / len(lines)


def ts(sec):
    m, s = divmod(sec, 60)
    return f'00:{int(m):02d}:{int(s):02d},{int(round((s % 1) * 1000)) % 1000:03d}'


srt = []
for i, text in enumerate(lines):
    srt.append(f'{i + 1}\n{ts(i * step + 0.2)} --> {ts(i * step + step - 0.3)}\n{text}\n')
name = '六角ラジオ 第12回'
open(os.path.join(media, f'{name}.srt'), 'w', encoding='utf-8-sig', newline='\r\n').write('\n'.join(srt))
with wave.open(os.path.join(media, f'{name}.wav'), 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(8000)
    w.writeframes(b'\x00\x00' * 8000 * 180)
print('site', sorted(os.listdir(site)))
print('media', len(os.listdir(media)))
