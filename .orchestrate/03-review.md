# 상세 계획 검토

## 결정: APPROVED

## 요약
상세 계획은 `01-plan.md`의 목표·범위·제약을 충실히 따른다.
CSS 스코프 격리(`class="nav-btn"` + `.left-footer .nav-btn`) 전략이 올바르고, `.btn-delete`가 다른 곳(278줄 운행 취소 버튼)에서도 쓰인다는 점을 위험 요소에서 정확히 짚었다.
블로킹 이슈는 없으며 즉시 구현 단계로 진행 가능하다.

## 발견 사항

### 막는 이슈 (Blocker)
없음.

### 권고 사항 (Suggestion)

1. **`.left-footer .btn` CSS 규칙 명시적 제거**: `dashboard.html:44`의 `.left-footer .btn` 규칙은 현재 2컬럼 wrap 레이아웃을 담당한다. 신규 마크업에서 `.btn` 클래스를 제거하면 이 규칙은 무효화되지만, 코드가 남아 있으면 미래에 `.btn`을 다시 쓸 때 의도치 않은 스타일이 적용될 수 있다. 2단계에서 이 규칙을 함께 제거하거나 `.nav-btn` 규칙으로 대체하도록 명시하면 좋다.

2. **`로그아웃` 라벨 길이 대응**: 위험 요소에서 이미 지적됐다. `grid-template-columns: repeat(5, minmax(0, 1fr))`와 `overflow: hidden`, `text-overflow: ellipsis` 조합 또는 라벨 폰트 크기를 8~9px로 줄이는 방법을 구현 시 확인하면 된다. 별도 수정 전에 렌더링 결과를 확인하는 것으로 충분하다.

3. **`⚙️ variation selector` 정렬**: 위험 요소에서 언급됐다. `font-family: 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif` 처럼 이모지 폰트를 `.nav-icon`에 명시해 두면 Windows/Mac/Android에서 렌더링 차이를 줄일 수 있다. 필수는 아니지만 권장.

### 확인된 사항 (Verified)

- `logout()` 함수: `dashboard.html:981`에 정의되어 있음 — 안전하게 재사용 가능.
- `stats.html` 이동 경로: `location.href='/stats.html'` 패턴이 기존 코드와 동일 — 변경 불필요.
- `.btn-delete` 전역 CSS 영향 범위: `dashboard.html:278`의 `btn-trip-cancel`(`id="btn-trip-cancel"`)이 `.btn-delete`를 실제로 사용 중 — 전역 규칙 수정 금지 결정이 정확함.
- `.btn-approve`, `.btn-add`: `dashboard.html:320`, `:87`에서 사용 중 — 이번 변경 범위 밖이며 영향 없음.
- `.left-footer` 바깥의 `.btn` 사용처: 277줄(운행 완료), 278줄(운행 취소), 320줄(운행 생성) — 3곳 모두 `.left-footer` 밖에 있어 신규 `.left-footer .nav-btn` 스코프와 충돌 없음.
- 좌측 패널이 `flex-direction: column`으로 구성 (`dashboard.html:20~29`) — `#driver-list`가 `flex-grow: 1` 이므로 `.left-footer`가 패널 맨 아래에 고정됨. 탭바 높이를 줄여도 레이아웃 구조에 영향 없음.
- 1→2→3단계 순서 적절: 1단계(CSS/마크업 설계 확정) → 2단계(실제 구현) → 3단계(CHANGELOG + 최종 검증) 순서에 의존성 역전 없음.

## 다음 액션
- **APPROVED** → `/wf-implement` 으로 Codex 구현 단계로 진행
