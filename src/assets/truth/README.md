# 진상 해설 장면 그림

최신 적용: `design/evidence-production/originals/ui-refresh/`의 13장. 매끈한 판 색 배경으로 편집했고, 게임이 가장자리에 CSS 알파 마스크를 적용한다. 원본은 자르거나 색을 보정하지 않는다. 재출력은 `python scripts/prepare-ui-art.py`, 제작 기록은 `design/evidence-production/ui-refresh-generation-log.json`을 사용한다. 이전 `truth-trim.py`는 이전 원본을 읽으므로 이 버전의 재출력에 사용하지 않는다.

design/evidence-production/truth-slideshow-prompts.md의 프롬프트로 만든 그림을 여기에 넣는다.
파일 이름은 `truth-01-call.png`처럼 표의 이름 그대로, 확장자는 jpg·png·webp.
2026-10-16: 내장 image_gen으로 13장 모두 제작해 `<파일 이름>.webp`로 저장했다.
모든 장면은 1600×900(16:9), WebP 품질 90이다. `src/ui/TruthSlides.tsx`가 자동으로 불러온다.
그림이 없는 장은 게임이 그 시각의 집무실 평면도와 사람 위치로 대신 보여 준다.

기준 초상 4장과 집무실 기준 그림은 `design/evidence-production/references/truth/`에 보관한다.
프롬프트 문서에서 각 장면의 완성 그림을 볼 수 있고, 실제 생성·수정 프롬프트는 `design/evidence-production/truth-generation-log.json`에 기록했다.
