# 상세 구현 계획: dashboard.html 하단 메뉴 아이콘 탭바 개편

## 1단계: 하단 메뉴 구조와 스타일 기준 확정

### 단계 목표
`dashboard.html` 좌측 하단 메뉴를 1행 5분할 아이콘 탭바로 바꾸기 위한 CSS/마크업 설계를 현재 전역 버튼 스타일과 충돌하지 않게 확정한다.

### 변경할 파일 목록과 각 파일에서 할 작업

- `frontend/dashboard.html`
  - 기존 `.left-footer`와 `.left-footer .btn` 규칙의 역할을 확인한다.
  - 전역 `.btn`, `.btn-setting`, `.btn-delete` 규칙은 유지하고, 좌측 하단 메뉴 전용 스타일은 `.left-footer` 하위 선택자로만 스코프를 제한한다.
  - 신규 메뉴 버튼 클래스명을 `nav-btn`으로 정한다.
  - 아이콘과 라벨을 분리하기 위한 내부 요소 구조를 정한다.
    - 아이콘: `<span class="nav-icon" aria-hidden="true">...</span>`
    - 라벨: `<span class="nav-label">...</span>`
  - 버튼 접근성 기준을 정한다.
    - 각 버튼에 `title` 속성을 둔다.
    - 이모지는 장식으로 처리하고, 실제 의미는 짧은 한글 라벨과 `title`이 담당하게 한다.
  - 로그아웃은 기존 `logout()` 호출을 유지하고, 다른 4개 버튼은 기존 `location.href` 이동을 유지한다.

- `CHANGELOG.md`
  - 최신 변경 이력을 추가할 위치를 정한다.
  - 기존 버전 순서나 과거 항목은 재정렬하지 않는다.

### 새로 만들 함수/클래스의 시그니처

새 JS 함수나 클래스는 만들지 않는다.

신규 CSS 클래스 후보:

```css
.left-footer .nav-btn
.left-footer .nav-btn:hover
.left-footer .nav-icon
.left-footer .nav-label
.left-footer .nav-btn.logout
.left-footer .nav-btn.logout:hover
```

적용할 HTML 구조 후보:

```html
<button class="nav-btn" type="button" title="기사 관리" onclick="location.href='/drivers.html'">
  <span class="nav-icon" aria-hidden="true">👥</span>
  <span class="nav-label">기사</span>
</button>
```

### 의존성
이 단계는 다른 단계에 의존하지 않는다. 다만 2단계에서 실제 CSS와 HTML을 작성할 때 이 단계에서 정한 클래스명과 구조를 그대로 사용한다.

### 단계 완료 검증 방법

- 수동 확인
  - `frontend/dashboard.html`에서 하단 메뉴 버튼 5개의 현재 이동 대상과 호출 함수가 확인되어야 한다.
  - `.btn`, `.btn-setting`, `.btn-delete`가 다른 UI에서도 쓰일 수 있으므로 전역 규칙을 직접 바꾸지 않는 방향이 확정되어야 한다.
- 정적 확인 명령어

```bash
grep -n "left-footer\|btn-setting\|btn-delete\|logout()" frontend/dashboard.html
```

## 2단계: dashboard.html 하단 메뉴 탭바 구현

### 단계 목표
`frontend/dashboard.html`의 좌측 하단 버튼 5개를 1행 균등 분할 아이콘+소형 라벨 탭바로 교체한다.

### 변경할 파일 목록과 각 파일에서 할 작업

- `frontend/dashboard.html`
  - `.left-footer` CSS를 2컬럼 wrap 버튼 격자에서 1행 탭바로 교체한다.
    - `display: grid`
    - `grid-template-columns: repeat(5, minmax(0, 1fr))`
    - `gap`은 4~6px 수준으로 축소
    - `padding`은 기존 16px보다 작게 조정
    - `flex-wrap` 기반 규칙은 제거
  - `.left-footer .btn`에 의존하던 2컬럼 폭 규칙을 제거하거나 `.left-footer .nav-btn` 규칙으로 대체한다.
  - `.left-footer .nav-btn` 스타일을 추가한다.
    - 세로 배치: 아이콘 위, 라벨 아래
    - 작은 높이와 패딩으로 수직 공간 절감
    - 배경은 흰색 또는 `#fafafa` 계열로 통일
    - 기본 텍스트 색상은 `#333` 계열
    - border, hover, focus-visible 상태를 추가해 버튼임을 유지
  - `.left-footer .nav-icon` 스타일을 추가한다.
    - 이모지 크기 약 18~20px
    - line-height를 고정해 버튼 높이 흔들림을 줄인다.
  - `.left-footer .nav-label` 스타일을 추가한다.
    - 9~10px 한글 라벨
    - `white-space: nowrap`
    - 버튼 폭이 좁아도 2글자 또는 3글자 라벨이 깨지지 않도록 정렬한다.
  - 로그아웃 버튼 전용 스타일을 `.left-footer .nav-btn.logout`으로 추가한다.
    - 전역 `.btn-delete`에 의존하지 않게 하되, 빨간 계열의 위험 액션 시각 신호는 유지한다.
  - `<div class="left-footer">` 내부 버튼 5개 마크업을 교체한다.
    - 기사 관리: `/drivers.html`, title `기사 관리`, 아이콘 `👥`, 라벨 `기사`
    - 차량 관리: `/vehicles.html`, title `차량 관리`, 아이콘 `🚗`, 라벨 `차량`
    - 통계: `/stats.html`, title `통계`, 아이콘 `📊`, 라벨 `통계`
    - 설정: `/settings.html`, title `설정`, 아이콘 `⚙️`, 라벨 `설정`
    - 로그아웃: `logout()`, title `로그아웃`, 아이콘은 `🚪` 또는 `⎋`, 라벨 `로그아웃`
  - 기존 인라인 배경색 스타일(`style="background:#2980b9;"`, `style="background:#8e44ad;"`)을 제거한다.
  - 버튼의 기존 이동 대상과 로그아웃 함수 호출은 변경하지 않는다.
  - 다른 좌측 패널, 지도, 기사 목록, 우측 패널 관련 JS/CSS는 건드리지 않는다.

### 새로 만들 함수/클래스의 시그니처

새 JS 함수나 클래스는 만들지 않는다.

신규 CSS 클래스:

```css
.left-footer .nav-btn { ... }
.left-footer .nav-btn:hover { ... }
.left-footer .nav-btn:focus-visible { ... }
.left-footer .nav-icon { ... }
.left-footer .nav-label { ... }
.left-footer .nav-btn.logout { ... }
.left-footer .nav-btn.logout:hover { ... }
```

교체할 버튼 마크업 형태:

```html
<button class="nav-btn" type="button" title="기사 관리" onclick="location.href='/drivers.html'">
  <span class="nav-icon" aria-hidden="true">👥</span>
  <span class="nav-label">기사</span>
</button>
<button class="nav-btn logout" type="button" title="로그아웃" onclick="logout()">
  <span class="nav-icon" aria-hidden="true">🚪</span>
  <span class="nav-label">로그아웃</span>
</button>
```

### 의존성
1단계에서 확정한 클래스명, 버튼 구조, 접근성 기준에 의존한다. 링크 대상과 `logout()` 함수는 기존 구현을 그대로 사용하므로 백엔드나 다른 프론트엔드 페이지 변경에는 의존하지 않는다.

### 단계 완료 검증 방법

- 수동 확인
  - `/dashboard.html`을 열었을 때 좌측 하단 메뉴가 1행 5개로 표시되는지 확인한다.
  - 각 버튼에 아이콘과 짧은 한글 라벨이 표시되는지 확인한다.
  - 각 버튼에 마우스를 올렸을 때 브라우저 기본 `title` 툴팁으로 기능을 확인할 수 있는지 확인한다.
  - 기사, 차량, 통계, 설정 버튼 클릭 시 기존과 같은 URL로 이동하는지 확인한다.
  - 로그아웃 버튼 클릭 시 기존 `logout()` 흐름이 동작하는지 확인한다.
  - 좌측 패널 하단 높이가 기존 2행 wrap 버튼보다 줄었는지 확인한다.
  - 브라우저 콘솔에 새 오류가 없는지 확인한다.
- 정적 확인 명령어

```bash
grep -n "nav-btn\|nav-icon\|nav-label" frontend/dashboard.html
grep -n "location.href='/drivers.html'\|location.href='/vehicles.html'\|location.href='/stats.html'\|location.href='/settings.html'\|logout()" frontend/dashboard.html
grep -n "left-footer .btn\|flex-wrap\|style=\"background:#2980b9\|style=\"background:#8e44ad" frontend/dashboard.html
```

마지막 명령은 기존 하단 메뉴용 2컬럼 규칙과 인라인 색상이 남아 있는지 확인하기 위한 것이다. 남아 있다면 다른 영역에 필요한 규칙인지 확인하고, 하단 메뉴 전용 잔재라면 제거한다.

## 3단계: 변경 이력 기록과 최종 검증

### 단계 목표
하단 메뉴 개편 내용을 `CHANGELOG.md`에 기록하고, 실제 화면과 정적 검색으로 범위 밖 변경이 없는지 확인한다.

### 변경할 파일 목록과 각 파일에서 할 작업

- `CHANGELOG.md`
  - 최신 변경 섹션을 파일 상단의 기존 버전 목록 흐름에 맞춰 추가한다.
  - 변경 내용은 프론트엔드 중심으로 한 줄 또는 짧은 목록으로 기록한다.
    - `dashboard.html` 좌측 하단 메뉴를 1행 아이콘 탭바로 변경
    - 아이콘 하단 짧은 라벨과 `title` 툴팁 추가
    - 기사/차량/통계/설정/로그아웃 동작은 기존과 동일하게 유지
  - 과거 버전 항목의 순서와 내용은 수정하지 않는다.

- `frontend/dashboard.html`
  - 2단계 구현 후 최종 점검만 수행한다.
  - 누락된 `title`, 잘못된 `onclick`, 남아 있는 하단 메뉴 인라인 스타일이 있으면 최소 수정한다.
  - 실제 코드 변경은 하단 메뉴 CSS/HTML 범위에 한정한다.

### 새로 만들 함수/클래스의 시그니처

새 JS 함수나 클래스는 만들지 않는다.

문서 변경만 수행하므로 추가 시그니처는 없다.

### 의존성
2단계 구현이 완료되어야 변경 이력을 정확히 기록할 수 있다. 3단계는 구현 내용 검증과 문서화 단계이므로 1단계와 2단계 결과에 의존한다.

### 단계 완료 검증 방법

- 수동 확인
  - `CHANGELOG.md` 최신 영역에 하단 메뉴 개편 내용이 추가되어 있는지 확인한다.
  - `/dashboard.html` 화면에서 좌측 하단 메뉴가 5개 탭으로 한 줄에 균등 배치되는지 확인한다.
  - 브라우저 폭을 줄여도 좌측 패널 내부에서 버튼 라벨이 겹치거나 줄바꿈으로 레이아웃이 깨지지 않는지 확인한다.
  - 키보드 Tab 이동 시 각 버튼에 focus-visible 상태가 보이는지 확인한다.
  - 변경 전후 5개 메뉴의 이동 대상과 로그아웃 동작이 동일한지 확인한다.
- 정적 확인 명령어

```bash
grep -n "하단 메뉴\|아이콘 탭바\|dashboard.html" CHANGELOG.md
grep -n "title=\"기사 관리\"\|title=\"차량 관리\"\|title=\"통계\"\|title=\"설정\"\|title=\"로그아웃\"" frontend/dashboard.html
grep -n "class=\"nav-btn" frontend/dashboard.html
git diff -- frontend/dashboard.html CHANGELOG.md .orchestrate/02-detailed-plan.md
```

## 위험 요소

- 전역 `.btn`, `.btn-setting`, `.btn-delete`를 직접 수정하면 대시보드의 다른 버튼과 다른 페이지 버튼까지 영향을 받을 수 있다. 하단 메뉴 전용 스타일은 `.left-footer` 하위로 제한해야 한다.
- 기존 하단 메뉴는 일부 버튼에 인라인 배경색을 사용한다. 이를 남겨 두면 통일된 탭바 디자인이 깨질 수 있으므로 2단계에서 제거 여부를 확인해야 한다.
- 이모지만 표시하면 기능이 불명확할 수 있다. 짧은 한글 라벨과 `title`을 함께 제공해 접근성과 사용성을 유지한다.
- `로그아웃`은 4글자라 다른 2글자 라벨보다 폭을 더 차지한다. `font-size`, `white-space`, `min-width: 0` 설정을 통해 5분할 폭 안에서 깨지지 않게 해야 한다.
- 이모지 렌더링 크기는 OS와 브라우저마다 다를 수 있다. `.nav-icon`의 `font-size`, `line-height`, 고정 정렬을 지정해 버튼 높이 흔들림을 줄인다.
- `⚙️` 같은 variation selector 포함 이모지는 브라우저에 따라 폭이 다르게 보일 수 있다. 라벨과 버튼 정렬이 중심이 되도록 스타일을 잡아야 한다.
- `button` 기본 스타일이나 기존 `.btn` 상속을 섞으면 패딩, 색상, 글자 굵기가 예상과 다르게 보일 수 있다. 새 마크업은 `class="nav-btn"` 중심으로 두고 기존 `.btn` 클래스는 제거하는 편이 충돌 위험이 낮다.
- `type="button"`을 누락하면 향후 좌측 패널 안에 form이 생겼을 때 의도치 않은 submit이 발생할 수 있다. 모든 메뉴 버튼에 명시한다.
- 이번 범위는 `dashboard.html` 하단 메뉴와 `CHANGELOG.md`만이다. `drivers.html`, `vehicles.html`, `stats.html`, `settings.html`의 하단 메뉴 또는 내비게이션을 함께 정리하면 변경 범위가 커진다.
- 현재 페이지 active 스타일은 이번 계획에서 생략한다. 나중에 추가할 경우 현재 URL 판별 JS나 서버 사이드 라우팅 없이 정적 HTML에서 일관되게 처리할 방식을 별도로 정해야 한다.
