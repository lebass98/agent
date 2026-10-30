"""동물원 이든 대화 엔진을 외형과 분리하여 픽셀용으로 재사용한다."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
s=(root/'web/life-zoo.js').read_text()
start=s.index('  const EDEN =')
end=s.index('  if (!kit) return;',start)
body=s[start:end]
body=body.replace('function chickEden(chick, tag, talk, me)', 'function chickEden(chick, tag, talk, me, parent)')
body=body.replace('m.rig?.group.userData.kind === "penguin"', '(parent ? m === parent() : m.rig?.group.userData.kind === "penguin")')
body=body.replace('const m = A("gpt");', 'const m = parent ? parent() : A("gpt");')
# 대사와 대답 순서·주제·업무 중 반응은 그대로, 동물 외형을 가리키는 낱말만 사람에게 맞춘다.
for a,b in [('펭귄','어린이'),('물고기','간식'),('날개','팔'),('코끼리 할아버지','본부장 할아버지'),('오리 아저씨','경리 아저씨'),('수달 삼촌','팀원 삼촌'),('동물원','사무실'),('꼬리 만져 봐도 돼?','손 잡아도 돼?')]:
    body=body.replace(a,b)
(root/'web/pixel/eden-dialogue.js').write_text("'use strict';\n/* scripts/pixel/sync-eden.py가 life-zoo.js의 대화 기능에서 생성. */\nwindow.PixelEdenDialogue=(()=>{\n"+body+'\nreturn chickEden;\n})();\n')
