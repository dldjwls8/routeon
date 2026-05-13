# 구현 결과: dashboard.html 하단 메뉴 아이콘 탭바 개편

## 변경된 파일 목록

- `frontend/dashboard.html` 수정
- `CHANGELOG.md` 수정
- `.orchestrate/04-implementation.md` 갱신

## 단계별 검증과 결과

### 1단계: 하단 메뉴 구조와 스타일 기준 확정

실행한 검증:

```bash
grep -n "left-footer\|btn-setting\|btn-delete\|logout()" frontend/dashboard.html
```

결과:

- 기존 하단 메뉴 5개 버튼의 이동 대상과 `logout()` 호출을 확인했다.
- `.btn-delete`가 하단 메뉴 밖의 운행 취소 버튼에서도 쓰이는 것을 확인했다.
- 전역 `.btn`, `.btn-setting`, `.btn-delete`는 수정하지 않고, 하단 메뉴 전용 `.left-footer .nav-btn` 구조로 구현하기로 확정했다.
- 정적 검증 통과.

### 2단계: dashboard.html 하단 메뉴 탭바 구현

실행한 검증:

```bash
grep -n "nav-btn\|nav-icon\|nav-label" frontend/dashboard.html
grep -n "location.href='/drivers.html'\|location.href='/vehicles.html'\|location.href='/stats.html'\|location.href='/settings.html'\|logout()" frontend/dashboard.html
grep -n "left-footer .btn\|flex-wrap\|style=\"background:#2980b9\|style=\"background:#8e44ad" frontend/dashboard.html
```

결과:

- `nav-btn`, `nav-icon`, `nav-label` CSS와 버튼 마크업 존재 확인.
- 기사, 차량, 통계, 설정 버튼의 기존 이동 대상과 로그아웃 `logout()` 호출 유지 확인.
- 하단 메뉴의 기존 `.left-footer .btn`, `flex-wrap`, 통계/차량 버튼 인라인 배경색 제거 확인.
- 마지막 grep에서 `style="background:#2980b9"`가 1건 출력됐지만, 하단 메뉴가 아니라 기존 하차지 UI의 인라인 스타일이므로 계획 범위 밖으로 유지했다.
- 정적 검증 통과.

### 3단계: 변경 이력 기록과 최종 검증

실행한 검증:

```bash
grep -n "하단 메뉴\|아이콘 탭바\|dashboard.html" CHANGELOG.md
grep -n "title=\"기사 관리\"\|title=\"차량 관리\"\|title=\"통계\"\|title=\"설정\"\|title=\"로그아웃\"" frontend/dashboard.html
grep -n "class=\"nav-btn" frontend/dashboard.html
git diff -- frontend/dashboard.html CHANGELOG.md .orchestrate/02-detailed-plan.md
```

결과:

- `CHANGELOG.md`에 `v1.0.1 (2026-05-13)` 하단 메뉴 아이콘 탭바 개편 항목 추가 확인.
- 5개 하단 메뉴 버튼의 `title` 속성 확인.
- 5개 하단 메뉴 버튼의 `class="nav-btn"` 적용 확인.
- `git diff`로 실제 변경 범위 확인. `.orchestrate/02-detailed-plan.md` diff는 작업 시작 전부터 존재하던 계획 문서 변경이며, 이번 구현에서 수정하지 않았다.
- 정적 검증 통과.

## 계획에서 벗어난 부분

- 브라우저 기반 수동 확인은 실행하지 않았다. 이번 구현에서는 계획에 명시된 정적 검증 명령을 단계별로 실행했다.
- 2단계 마지막 grep 결과에 하단 메뉴와 무관한 `background:#2980b9` 기존 스타일이 출력됐지만, 상차/하차 UI 범위라 수정하지 않았다.

## 후속 작업

- 브라우저에서 `/dashboard.html`을 열어 좌측 하단 메뉴가 1행 5분할로 표시되는지 확인.
- 좁은 브라우저 폭에서 `로그아웃` 라벨이 겹치지 않는지 확인.
- 키보드 Tab 이동 시 `focus-visible` outline 표시 확인.
- 기사/차량/통계/설정 버튼 이동과 로그아웃 흐름 수동 확인.
