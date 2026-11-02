# 증거 영상 AI 프롬프트 (호텔 벨루아 사건)

만든 파일은 `src/assets/evidence/`에 아래 **파일 이름**으로 넣으면 게임에 바로 나옵니다.
- 영상은 `.mp4`, 사진은 `.jpg`나 `.png`로 넣습니다.
- 날짜·시각, 속도, GPS, 녹화 표시, 번호판 숫자, 노이즈는 게임이 위에 입히므로 **영상에는 글자를 넣지 않습니다.**

## 만드는 순서 (얼굴과 장소를 맞추려면)
1. **인물 기준 사진 먼저**: 아래 「인물 설정」으로 권태석·박준호의 정면 사진을 한 장씩 만듭니다. 영상을 만들 때 참조 이미지(캐릭터 레퍼런스)로 넣습니다.
2. **D04 장면은 한 번에**: `bb-park`(정지 화면)를 먼저 만들고, 그 마지막 프레임을 시작 이미지로 써서 `bb-man`을 만듭니다(image-to-video). 같은 구도가 유지됩니다.
3. 화면 비율 16:9, 길이 5~8초, 해상도 720p면 충분합니다. 파일 하나는 5MB 이하로 줄여 주세요.

## 공통 스타일 (모든 블랙박스 프롬프트 끝에 붙이기)
> Authentic dashcam footage from a front camera mounted behind the windshield of a black full-size sedan. 140-degree wide-angle lens with visible barrel distortion, the car's dark hood visible along the bottom edge of the frame. Night, low-light sensor noise, slight compression artifacts, realistic and unedited. No on-screen text, no timestamp, no logos, no watermark. Seoul, South Korea.

**피하라고 덧붙일 말 (네거티브)**: text, subtitles, timestamp overlay, watermark, cartoon, CGI, 3D render, illustration, oversaturated colors, cinematic color grading

## 인물 설정
- **권태석**: Korean man, 49 years old, slim build, neatly side-parted black hair with graying temples, thin metal-rimmed glasses, calm composed face, long dark navy wool overcoat over a charcoal suit, white shirt, dark burgundy tie, black leather shoes.
- **박준호**: Korean man, 27 years old, short neat hair with shaved sides, youthful nervous face, hotel valet uniform: white shirt, black vest, black bow tie, small name badge on the vest.

---

## 1. `bb-exit` · 23:00 지하 출구를 빠져나감 (영상 5초)
> Driving slowly up the exit ramp of an underground hotel parking garage at night. Low concrete ceiling with fluorescent tube lights reflecting on a glossy green epoxy floor with anti-slip grooves, yellow-and-black hazard stripes along the walls, a green exit sign hanging from the ceiling. At the top of the ramp the barrier arm is already raised, and the dark city street with orange sodium streetlights comes into view.

## 2. `bb-river` · 23:18 강변북로 (영상 6초)
> Driving fast, about 110 km/h, on an elevated riverside expressway along the Han River in Seoul at night. Orange sodium streetlights rush past overhead with soft lens flare, high-rise apartments with lit windows across the river reflect on the dark water to the right, white lane markings stream toward the camera, distant red tail lights ahead. An overhead steel gantry with traffic enforcement cameras passes above the road.

## 3. `bb-return` · 23:40 C12 앞에 멈춤 (영상 6초)
> Re-entering an underground hotel parking garage at night. The car rolls slowly along the parking aisle and stops facing a parking space that is already occupied: a silver sedan parked with its rear toward the camera, lit by our headlights. Concrete pillars with painted stall numbers, fluorescent ceiling lights, green epoxy floor with white stall lines. After a pause the car starts to reverse and turn away.

## 4. `bb-park` · 23:41 화물 엘리베이터 앞 D04에 주차 (영상 5초, 움직임 없음)
> Static parked-car dashcam view, engine off, nothing moves. Directly ahead, about four meters away, the closed brushed stainless-steel double doors of a freight elevator in an underground hotel service corridor. A lit white sign box above the doors, a call button with a small orange light beside them, yellow-and-black hazard stripes painted on the concrete floor in front of the doors. A concrete pillar on the left edge with stenciled stall markings, a dark open doorway leading to a loading dock on the right. A single fluorescent light on the ceiling.

## 5. `bb-man` · 23:52 엘리베이터에서 내린 남자 (영상 8초, 가장 중요한 장면)
`bb-park`의 마지막 프레임을 시작 이미지로, 권태석 기준 사진을 인물 참조로 넣습니다.
> Static parked-car dashcam view, same framing: freight elevator doors straight ahead in an underground hotel service corridor at night. The stainless-steel doors slide open and bright light spills out. A man steps out and walks briskly to the right, passing about two meters in front of the car's hood toward the dark doorway on the right. As he passes under the ceiling light his face is clearly visible for a moment; he glances once toward the parked car, then keeps walking and leaves the frame on the right. The elevator doors close behind him. The man: Korean, about 50, slim, neatly side-parted black hair with graying temples, thin metal-rimmed glasses, long dark navy wool overcoat over a charcoal suit, white shirt, dark tie, black leather shoes.

## 6. `bb-face` · 23:52 얼굴 확대 화면 (사진 1장, 또는 영상 3초)
> Digitally zoomed and enhanced crop from night dashcam security footage: head and shoulders of a Korean man about 50 with neatly side-parted black hair, graying temples and thin metal-rimmed glasses, wearing a dark navy overcoat, white shirt and dark tie, lit by harsh overhead fluorescent light, face turned slightly toward the camera. Low resolution upscaled, visible pixelation and compression blocks, grain, soft focus. Blurred bright open elevator interior on the left, dark garage on the right.

## 7. `speedcam` · 23:18 과속 단속 카메라 사진 (사진 1장)
박준호 기준 사진을 인물 참조로 넣습니다.
> Infrared black-and-white traffic enforcement camera photograph taken at night from an overhead gantry, looking down at the front of a black full-size sedan speeding in an expressway lane. Headlights blown out to pure white with glare, the license plate area overexposed and unreadable. Through the windshield the driver is clearly visible: a young Korean man about 27 with short neat hair, wearing a white shirt, black vest and black bow tie, both hands on the steering wheel. The front passenger seat is clearly empty. High-contrast infrared, heavy grain, no text overlay.

---

### 장면마다 꼭 지켜야 할 것 (추리에 쓰이는 부분)
| 파일 | 꼭 보여야 하는 것 |
| --- | --- |
| bb-return | C12 칸에 **다른 차가 이미 서 있다** |
| bb-park | 차 앞머리가 **화물 엘리베이터 문을 정면으로** 향한다. 사람은 없다 |
| bb-man | 엘리베이터에서 **내린** 남자가 **차 앞을 지나** 오른쪽(하역장 쪽)으로 간다. 얼굴이 한 번은 또렷하다 |
| speedcam | 운전자는 **발레 유니폼**, **조수석은 비어 있다** |
