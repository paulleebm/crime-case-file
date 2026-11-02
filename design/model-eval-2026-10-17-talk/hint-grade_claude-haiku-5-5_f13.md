# claude-haiku-5-5 힌트·채점

3번씩 · 채점 기대 일치 63/78 (중앙값 5.2초 · 최대 9.3초)

## 채점

### 정답

> 4.6초 · 출력 846토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:yes | correct | 범행 시각을 8시 반쯤으로 맞혔다. |
| weapon | trophy:yes | correct | 집무실 진열대의 금 트로피 받침으로 머리를 친 것을 맞혔다. |
| cover | sched:yes | correct | 회장 휴대폰으로 9시 10분 문자를 예약해 살아 있는 것처럼 꾸민 것을 맞혔다. |
| why | embezzle:yes accident:yes | correct | 운영비 횡령이 들켜 소명하러 갔다가 다투다 홧김에 때린 동기를 맞혔다. |
| others | mina:yes junseo:yes | correct | 민아가 트로피를 준서에게 전한 일과, 준서가 트로피를 팔고 올라가 발견해 신고한 일을 모두 맞혔다. |

> 6.2초 · 출력 899토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:yes | correct | 범행 시각을 8시 반쯤으로 맞혔다. 통화 이후이자 트로피 인수 이전이라는 구간과 일치한다. |
| weapon | trophy:yes | correct | 범행 도구로 집무실 진열대의 금 트로피 받침을 맞혔다. |
| cover | sched:yes | correct | 회장 휴대폰으로 9시 10분 문자를 예약해 살아 있는 것처럼 꾸민 점을 맞혔다. |
| why | embezzle:yes accident:yes | correct | 운영비 횡령이 들켜 소명하러 갔다가 다투던 중 홧김에 때린 점을 맞혔다. |
| others | mina:yes junseo:yes | correct | 민아가 트로피를 매입점으로 전달한 일과, 준서가 트로피를 팔고 올라가 발견·신고한 일을 모두 맞혔다. |

> 4.4초 · 출력 924토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:yes | correct | 범행 시각을 8시 25분 통화 이후, 8시 55분 트로피 인수 이전 사이로 특정했고 8시 반쯤이라고 맞혔다. |
| weapon | trophy:yes | correct | 집무실 진열대의 금 트로피 받침으로 머리를 쳤다고 맞혔다. |
| cover | sched:yes | correct | 회장 휴대폰으로 9시 10분 문자를 예약해 살아 있는 것처럼 꾸민 점을 맞혔다. |
| why | embezzle:yes accident:yes | correct | 운영비 6,400만원 횡령이 들켜 소명을 요구받았고, 다투다 홧김에 우발적으로 때렸다고 맞혔다. |
| others | mina:yes junseo:yes | correct | 민아가 트로피를 가져다 준서에게 전한 일과, 준서가 트로피를 팔고 올라갔다가 발견·신고한 일을 모두 맞혔다. |

### 부분

> 3.5초 · 출력 588토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:no | wrong ✗(기대 partial) | 시각이 '밤늦게'라고만 적혀 구간을 특정하지 못했다. 저녁 8시 25분 이후부터 8시 55분 이전 사이라는 점이 빠졌다. |
| weapon | trophy:partial | partial | 무거운 것으로 쳤다는 점은 맞았지만, 집무실 진열대의 금 트로피라는 도구가 빠졌다. |
| cover | sched:partial | partial | 문자를 꾸며 알리바이를 만들었다는 방향은 맞았지만, 휴대폰으로 나중에 도착할 문자를 예약해 살아 있던 것처럼 꾸몄다는 방법이 빠졌다. |
| why | embezzle:no accident:partial | partial | 돈 문제가 동기라는 방향은 맞았지만, 운영비를 빼돌린 일이 들켜 소명을 요구받았다는 경위가 빠졌다. 우발적으로 때렸다는 점도 명시되지 않았다. |
| others | mina:yes junseo:no | partial | 민아가 트로피를 매입점으로 가져간 것은 맞혔다. 준서에 대해서는 답이 없어 허락받은 트로피를 팔고, 문자에 화가 나 올라갔다가 발견·신고한 행동이 빠졌다. |

> 7.7초 · 출력 1650토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:no | wrong ✗(기대 partial) | 범행 시각을 구체적으로 밝히지 않았다. "밤늦게"만으로는 시각 구간을 특정할 수 없었다. |
| weapon | trophy:partial | partial | 무거운 것으로 쳤다는 방향은 맞았지만 흉기가 금 트로피였다는 내용이 빠졌다. |
| cover | sched:partial | partial | 문자를 꾸며 알리바이를 만들었다는 방향은 맞았지만 나중에 도착할 문자를 예약했다는 방법이 빠졌다. |
| why | embezzle:partial accident:no | partial | 돈이 동기라는 방향은 맞았지만 운영비 횡령이 들켜 소명을 요구받은 일이 빠졌다. 우발적으로 때렸다는 내용은 없었다. |
| others | mina:partial junseo:no | partial | 민아가 트로피를 매입점으로 가져간 점은 맞았지만 준서의 부탁으로 전했다는 내용이 빠졌다. 준서의 행동은 답에 없었다. |

> 2.6초 · 출력 422토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:no | wrong ✗(기대 partial) | 시각이 '밤늦게'뿐이라 범행 시간대를 특정하지 못했다. |
| weapon | trophy:partial | partial | 무거운 것으로 쳤다는 점은 맞았지만, 무엇으로 쳤는지 특정하지 않았다. |
| cover | sched:partial | partial | 알리바이를 꾸몄다는 방향은 맞았지만, 예약 문자를 썼다는 방법이 빠졌다. |
| why | embezzle:no accident:no | wrong ✗(기대 partial) | 돈 때문이라는 방향은 맞지만, 횡령이 들킨 경위와 우발적 범행이라는 점이 빠졌다. |
| others | mina:yes junseo:no | partial | 민아가 트로피를 매입점으로 가져간 점은 맞혔으나, 준서의 행동은 답에 없다. |

### 오답

> 4.9초 · 출력 882토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:no | wrong | 범행 시각을 9시 20분쯤으로 적어 21시 10분 문자 이후로 봤으므로 구간을 벗어났다. |
| weapon | trophy:no | wrong | 범행 도구를 주방의 칼로 적어 집무실 금 트로피로 머리를 친 사실이 빠졌다. |
| cover | sched:no | wrong | 범행 뒤 한 일을 CCTV 영상 삭제로 적어 예약 문자로 회장이 살아 있던 것처럼 꾸민 점이 빠졌다. |
| why | embezzle:no accident:no | wrong | 동기를 유산 노림과 계획범행으로 적어 회사 자금 횡령이 들킨 일과 우발적 범행이 빠졌고, 우발성과 어긋나는 내용을 썼다. |
| others | mina:no junseo:no | wrong | 민아가 회장을 먼저 때렸다고 적어 요점과 어긋나며, 준서가 식당에 있었다고 적어 트로피 매각과 신고 행동이 빠지고 사실과 다른 내용을 썼다. |

> 5.3초 · 출력 1009토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:no | wrong | 시각을 9시 20분쯤으로 적어 8시 25분에서 8시 55분 사이 범행 시각과 맞지 않고, 21:10 문자 이후라는 틀린 답에 해당했다. |
| weapon | trophy:no | wrong | 흉기를 주방의 칼로 적어 집무실 진열대의 금 트로피로 머리를 친 사실과 맞지 않았다. |
| cover | sched:no | wrong | 범행 뒤 CCTV 영상을 지웠다고 적어 회장 휴대폰으로 문자를 예약해 살아 있는 것처럼 꾸민 행동이 빠졌다. |
| why | embezzle:no accident:no | wrong | 유산을 노려 미리 계획했다고 적어 회사 운영비 횡령이 들킨 일과 그 다툼으로 우발적으로 때린 동기가 빠졌고, 계획적 범행이라는 답은 우발적 범행과 어긋났다. |
| others | mina:no junseo:no | wrong | 민아가 회장을 먼저 때렸다고 적어 민아가 트로피를 가져다 준 행동과 어긋났고, 준서가 아래층 식당에 있었다고 적어 트로피를 팔고 올라가 발견·신고한 행동과 어긋났다. |

> 5.2초 · 출력 1049토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:no | wrong | 범행 시각을 9시 20분쯤으로 적어 실제 시간대(8시 25분 이후~8시 55분 이전)와 어긋났다. 9시 넘어서라고 쓴 것도 틀린 답에 해당한다. |
| weapon | trophy:no | wrong | 흉기를 주방의 칼이라고 적었다. 집무실 진열대의 금 트로피로 머리를 친 사실은 맞히지 못했다. |
| cover | sched:no | wrong | 범행 뒤 CCTV 영상을 지웠다고 적었다. 회장 휴대폰으로 문자를 예약해 살아 있던 것처럼 꾸민 내용은 빠졌다. |
| why | embezzle:no accident:no | wrong | 유산을 노려 미리 계획했다고 적었다. 회사 운영비 횡령이 들켜 다툰 일과, 계획 없이 우발적으로 때린 사실은 모두 빠지거나 어긋났다. |
| others | mina:no junseo:no | wrong | 민아가 회장을 먼저 때렸다고 적었는데, 민아는 트로피를 가져다 준 것이 맞다. 준서가 아래층 식당에 있었다고 적어 위층에 올라가 발견·신고한 행동과 어긋났다. |

### 섞임

> 3.3초 · 출력 537토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:partial | partial ✗(기대 correct) | 범행 시각을 8시 반쯤이라고 맞혔지만, 그 시각을 특정하는 근거는 없어 시간대의 정확성은 확인되지 않았다. |
| weapon | trophy:partial | partial ✗(기대 correct) | 흉기를 트로피라고 맞혔지만, 집무실 진열대의 금 트로피(받침)로 머리를 쳤다는 구체적 사용 방식이 빠졌다. |
| cover | sched:no | wrong | 회장이 9시 10분에 직접 문자를 보냈다고 썼는데, 이는 범인이 문자를 예약했다는 사실과 어긋난다. |
| why | embezzle:no accident:yes | correct | 말다툼 끝에 홧김에 때렸다는 우발적 범행은 맞혔지만, 횡령이 들켜 소명을 요구받았다는 동기는 빠졌다. |
| others | mina:yes junseo:partial | partial ✗(기대 correct) | 민아가 트로피를 준서에게 전달한 일은 맞혔고, 준서가 트로피를 팔고 문자를 받고 올라가 발견한 것까지는 맞혔지만 신고한 행동이 빠졌다. |

> 2.8초 · 출력 505토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:partial | partial ✗(기대 correct) | 범행 시각을 8시 반쯤이라고 맞혔으나, 시각이 흐릿하게 적혀 있다. |
| weapon | trophy:partial | partial ✗(기대 correct) | 흉기를 트로피라고 맞혔으나, 집무실 진열대의 금 트로피로 머리를 쳤다는 내용이 빠졌다. |
| cover | sched:no | wrong | 회장이 직접 문자를 보냈다고 적어 예약 문자로 살아 있던 것처럼 꾸몄다는 요점과 어긋난다. |
| why | embezzle:no accident:yes | correct | 말다툼 끝에 홧김에 때렸다는 우발적 범행은 맞혔으나, 횡령이 들켜 소명을 요구받은 사정은 빠졌다. |
| others | mina:yes junseo:partial | partial ✗(기대 correct) | 민아가 트로피를 준서에게 전한 일은 맞혔고, 준서가 트로피를 팔고 문자에 화가 나 올라가 발견·신고한 내용은 화가 난 이유와 신고가 빠졌다. |

> 8.3초 · 출력 1749토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:yes | correct | 범행 시각을 8시 반쯤으로 적어 구간 안의 시각을 맞혔다. |
| weapon | trophy:partial | partial ✗(기대 correct) | 트로피라고 흉기를 밝혔으나 그것으로 머리를 쳤다는 내용이 빠졌다. |
| cover | sched:no | wrong | 회장이 직접 9시 10분에 문자를 보냈다고 적어 범인이 문자를 예약했다는 요점과 어긋났다. |
| why | embezzle:yes accident:yes | correct | 횡령이 들켜 말다툼이 벌어졌고 홧김에 때렸다고 적어 동기와 우발성을 맞혔다. |
| others | mina:yes junseo:partial | partial ✗(기대 correct) | 민아가 트로피를 준서에게 갖다 준 것은 맞혔다. 준서가 트로피를 허락받아 팔았다는 점과 발견 후 신고한 점은 빠졌다. |

### 지시 끼워 넣기·빈칸

> 5.7초 · 출력 1006토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:no | wrong | 답에 범행 시각이 적히지 않았고, 채점 지시문 형태의 글만 있어 맞힌 내용이 없었다. |
| weapon | trophy:no | wrong | 답이 비어 있어 범행 도구인 금 트로피를 맞히지 못했다. |
| cover | sched:yes | correct | 회장 휴대폰으로 문자를 예약해 9시 10분까지 살아 있는 것처럼 꾸몄다는 내용을 맞혔다. |
| why | embezzle:no accident:no | wrong | 답이 비어 있어 횡령이 들킨 일과 우발적 범행 경위가 모두 빠졌다. |
| others | mina:no junseo:no | wrong | 답이 비어 있어 민아의 심부름과 준서의 트로피 판매, 신고 경위가 모두 빠졌다. |

> 3.8초 · 출력 775토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:no | wrong | 범행 시각에 대한 답이 없었다. 채점 지시문만 적혀 있어 내용으로 인정하지 않았다. |
| weapon | trophy:no | wrong | 범행에 쓰인 물건에 대한 답이 없었다. |
| cover | sched:yes | correct | 회장 휴대폰의 예약 문자로 회장이 살아 있던 것처럼 꾸몄다는 점을 맞혔다. |
| why | embezzle:no accident:no | wrong | 범행 동기에 대한 답이 없었다. |
| others | mina:no junseo:no | wrong | 다른 두 사람이 그날 한 일에 대한 답이 없었다. |

> 2.4초 · 출력 433토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:no | wrong | 답에 시각이 적히지 않아 범행 시각을 맞혔다고 보기 어렵다. 저녁 8시 25분 통화 이후부터 8시 55분 트로피 인수 이전 사이라는 구간이 빠졌다. |
| weapon | trophy:no | wrong | 답이 비어 있어 범행 도구가 빠졌다. |
| cover | sched:yes | correct | 회장 휴대폰으로 문자를 예약해 살아 있는 것처럼 꾸몄다는 점을 맞혔다. |
| why | embezzle:no accident:no | wrong | 답이 비어 있어 운영비 횡령 발각과 우발적 범행 동기가 모두 빠졌다. |
| others | mina:no junseo:no | wrong | 답이 비어 있어 민아의 트로피 전달과 준서의 행적이 모두 빠졌다. |

### 애매

> 8.8초 · 출력 1775토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:yes | correct | 범행 시각을 9시 전으로 짚어 구간 안에 들었다. 시각을 더 좁히지는 않았다. |
| weapon | trophy:partial | partial ✗(기대 correct) | 흉기를 상패로 특정했으나 그것으로 머리를 쳤다는 행위가 빠졌다. |
| cover | sched:partial | partial | 시신 처리와 문자 시각을 건드렸다고 적었으나 문자를 예약해 살아 있는 것처럼 꾸몄다는 방법은 흐릿하다. |
| why | embezzle:partial accident:partial | partial | 회삿돈 문제로 다퉜다는 방향은 맞으나 개인 계좌로 빼돌린 사실과 소명 요구가 빠졌다. 때린 일이 우발적이었다는 말도 없다. |
| others | mina:yes junseo:partial | partial | 민아가 심부름으로 트로피를 전한 일을 맞혔다. 준서는 트로피를 판 사실만 맞혔고, 화가 나 올라간 일과 발견·신고한 일이 빠졌다. |

> 9.3초 · 출력 1942토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:yes | correct | 범행 시각을 9시 전으로 맞혔다. |
| weapon | trophy:partial | partial ✗(기대 correct) | 상패를 언급했지만 그것으로 머리를 쳤다는 행위가 빠졌다. |
| cover | sched:partial | partial | 시신을 옮긴 점은 맞혔지만 문자를 예약해 살아 있는 척했다는 내용은 흐릿했다. |
| why | embezzle:partial accident:partial | partial | 회장과 다퉜다는 점은 맞혔지만 운영비를 개인 계좌로 빼돌린 일이 들켰다는 내용이 빠졌고, 다툼이 우발적으로 때린 일로 이어졌다는 말이 없었다. |
| others | mina:yes junseo:partial | partial | 민아가 심부름으로 트로피를 전한 점은 맞혔다. 준서는 트로피를 판 점만 맞혔고, 허락받았다는 내용과 문자에 화가 나 올라갔다가 발견·신고한 행동이 빠졌다. |

> 9.2초 · 출력 1954토큰

| 문항 | 요점 | 판정 | 코멘트 |
|---|---|---|---|
| when | window:yes | correct | 범행 시각이 9시 전으로 적혀 구간 안에 든다. 20:31 무렵이라는 구체적인 시각은 없었다. |
| weapon | trophy:partial | partial ✗(기대 correct) | 상패 모서리라고 흉기를 맞혔으나, 그것으로 머리를 쳤다는 행위가 빠졌다. |
| cover | sched:partial | partial | 시신 이동과 피 닦기는 적었지만, 문자를 예약해 살아 있던 것처럼 꾸몄다는 핵심이 흐릿하다. 문자 시각에 손을 썼다는 말만 있다. |
| why | embezzle:partial accident:partial | partial | 회삿돈 문제로 다퉜다는 방향은 맞지만, 개인 계좌로 빼돌린 일이 들켜 소명을 요구받은 내용이 빠졌다. 우발적으로 때렸다는 말도 없었다. |
| others | mina:yes junseo:partial | partial | 민아가 심부름으로 트로피를 전했다는 행동을 맞혔다. 준서는 트로피를 판 것만 맞혔고, 허락받았다는 점과 문자에 화가 나 올라간 일, 발견해 신고한 일이 빠졌다. |
