# 마우스 커서(연필 스케치) SVG를 만든다.
# 실행하면 지금 폴더에 커서별 .svg와 vars.css(CSS 변수 --cur-*)를 쓴다. vars.css 내용을 src/styles.css의 :root에 붙여 넣는다.
# 사용: python scripts/cursors.py  (빈 폴더에서 실행하길 권한다)
import io
INK='#1f1f1f'; PAPER='#f3f2ee'; HALO='#ffffff'
def svg(body):
    return f"<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>{body}</svg>"
def both(d, fill='none', w=1.5):
    # 흰 테두리(어두운 사진 위에서도 보이게) + 연필 선
    return (f"<path d='{d}' fill='none' stroke='{HALO}' stroke-width='{w+2.2}' stroke-linecap='round' stroke-linejoin='round' opacity='.9'/>"
            f"<path d='{d}' fill='{fill}' stroke='{INK}' stroke-width='{w}' stroke-linecap='round' stroke-linejoin='round'/>")
# 연필: 끝이 왼쪽 위(3,3)를 가리킨다
pencil_body = 'M3 3 L10.9 6.4 L23.7 19.1 L19.1 23.7 L6.4 10.9 Z'
pencil = both(pencil_body, PAPER) + \
  f"<path d='M10.9 6.4 L6.4 10.9' fill='none' stroke='{INK}' stroke-width='1.1'/>" + \
  f"<path d='M20.8 16.3 L16.3 20.8' fill='none' stroke='{INK}' stroke-width='1.1'/>" + \
  f"<path d='M3 3 L6.4 4.5 L4.5 6.4 Z' fill='{INK}'/>" + \
  f"<path d='M8.5 8.2 L20.6 20.3' fill='none' stroke='{INK}' stroke-width='.6' opacity='.45'/>"
C = {}
C['default'] = (svg(pencil), 3, 3, 'auto')
# 누를 수 있는 곳: 연필 끝 둘레에 짧은 연필 자국 세 개
taps = "".join(both(d, w=1.3) for d in ['M10 1.6 L13.6 1', 'M1.6 10 L1 13.6', 'M12.6 5 L15.4 3.6'])
C['pointer'] = (svg(pencil + taps), 3, 3, 'pointer')
# 복사(끌어 놓으면 첨부): 연필 + 작은 더하기
C['copy'] = (svg(pencil + both('M25 3.5 V11.5 M21 7.5 H29', w=1.6)), 3, 3, 'copy')
# 손: 펼친 손(끌 수 있음), 쥔 손(끄는 중)
def hand(curl):
    top = 11 if curl else 5.5
    fingers = ''.join(both(f'M{x} 17 V{top + dy} Q{x} {top-1.6+dy} {x+1.8} {top-1.6+dy} Q{x+3.6} {top-1.6+dy} {x+3.6} {top+dy} V17', PAPER, 1.3) for x, dy in [(9.2, 2), (12.8, 0), (16.4, .6), (20, 2.6)])
    thumb = both('M9.2 19 L6.2 16.2 Q4.6 15 5.6 13.8 Q6.8 12.8 8.2 14 L9.2 15', PAPER, 1.3)
    palm = both('M9.2 15.5 V22 Q9.2 28.5 16 28.5 Q23.6 28.5 23.6 21.5 V15.5 Z', PAPER, 1.4)
    return svg(palm + thumb + fingers)
C['grab'] = (hand(False), 16, 16, 'grab')
C['grabbing'] = (hand(True), 16, 18, 'grabbing')
C['text'] = (svg(both('M12 5 Q16 6.2 20 5 M16 5.6 V26.4 M12 27 Q16 25.8 20 27', w=1.6)), 16, 16, 'text')
C['ew-resize'] = (svg(both('M4 16.2 Q16 15.4 28 16 M8.4 11.8 L4 16.2 L8.6 20.6 M23.6 11.6 L28 16 L23.4 20.4', w=1.6)), 16, 16, 'ew-resize')
C['not-allowed'] = (svg(both('M16 6.5 Q25.6 6.6 25.5 16 Q25.4 25.6 16 25.5 Q6.4 25.4 6.5 16 Q6.6 6.4 16 6.5 Z M9.4 9.6 L22.6 22.4', w=1.7)), 16, 16, 'not-allowed')
C['crosshair'] = (svg(both('M16 3.5 V12.5 M16 19.5 V28.5 M3.5 16 H12.5 M19.5 16 H28.5', w=1.5) + both('M16 13.6 Q18.4 13.7 18.4 16 Q18.3 18.4 16 18.4 Q13.6 18.3 13.6 16 Q13.7 13.6 16 13.6 Z', w=1)), 16, 16, 'crosshair')
lines=[]
for k,(s,x,y,fb) in C.items():
    io.open(f'{k}.svg','w',encoding='utf-8').write(s)
    enc = s.replace('#','%23').replace('"',"'")
    lines.append(f'  --cur-{k}: url("data:image/svg+xml;utf8,{enc}") {x} {y}, {fb};')
io.open('vars.css','w',encoding='utf-8').write('\n'.join(lines)+'\n')
# 미리보기 판
cells=''.join(f"<div style='display:inline-block;margin:10px;text-align:center;font:12px sans-serif'><div style='width:96px;height:96px;background:#f3f2ee;border:1px solid #ccc'><img src='{k}.svg' width='96' height='96'></div>{k}</div>" for k in C)
io.open('preview.html','w',encoding='utf-8').write(f"<html><body style='background:#ddd'>{cells}</body></html>")
print(len(lines))
