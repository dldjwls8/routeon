# 메인 계획: drivers.html + vehicles.html 신규 생성 (기사·차량 관리 별도 페이지 분리)

## 목표

현재 dashboard.html 안에 모달 팝업으로 구현된 기사 관리(승인 대기·소속 기사)와 차량 관리(등록·목록·삭제)를
각각 독립 HTML 페이지로 분리한다.
dashboard.html 하단 메뉴 버튼을 클릭하면 해당 페이지로 이동하며, 작업 완료 후 다시 대시보드로 돌아올 수 있다.

## 범위

### 포함되는 것
- `frontend/drivers.html` 신규 생성
  - 관리자 인증 가드 (토큰 없음 → /login.html, role ≠ admin → 리다이렉트)
  - 승인 대기 섹션: `GET /users?role=pending` 목록, ✅ 승인(`POST /auth/approve/{id}`), 거절(`DELETE /users/{id}`)
  - 소속 기사 섹션: `GET /users?role=driver` 목록, 탈퇴(`DELETE /users/{id}`)
  - 상단 "← 대시보드로 돌아가기" 뒤로가기 버튼
- `frontend/vehicles.html` 신규 생성
  - 관리자 인증 가드 (동일)
  - 차량 등록 폼: 번호판·차종·총중량·높이(필수), 길이·폭(선택) → `POST /vehicles`
  - 등록된 차량 목록: `GET /vehicles`, 삭제(`DELETE /vehicles/{id}`)
  - 상단 "← 대시보드로 돌아가기" 버튼
- `frontend/dashboard.html` 수정
  - 하단 `👥 기사 관리` 버튼: `openDriverModal()` → `/drivers.html`으로 이동
  - 하단 `🚗 차량 관리` 버튼: `openVehicleModal()` → `/vehicles.html`으로 이동
  - 기존 `#driver-modal`, `#vehicle-modal` HTML 블록 제거
  - 기존 JS 함수 제거: `openDriverModal`, `closeDriverModal`, `approveDriver`, `openVehicleModal`, `closeVehicleModal`, `loadVehicles`, `registerVehicle`, `deleteVehicle`
  - `kickDriver()` 제거 — 단, 이 함수는 맵 상태 정리 로직(마커 제거, 우측 패널 닫기)을 포함하므로 **제거 후 남은 의존성이 없는지 확인** 필요

### 포함되지 않는 것
- 기사 정보 수정(전화번호 변경 등) — 현재 미구현이므로 이번 범위 밖
- 차량 수정 기능 — 현재 미구현이므로 이번 범위 밖
- 기사·차량 검색/필터 — 추후 과제
- 백엔드 API 변경 — 없음 (기존 API 재활용)

## 제약 조건

### 기술적 제약
- 바닐라 HTML/JS만 사용 (프레임워크 없음)
- API 베이스 URL: `http://168.138.45.63:8000` (하드코딩, settings.html·dashboard.html과 동일 방식)
- 인증 방식: `localStorage.getItem('token')` + `Authorization: Bearer` 헤더
- dashboard.html의 `loadDrivers()`는 대시보드 실시간 렌더링에 여전히 사용됨 — 이번 변경으로 건드리지 않음

### 비기술적 제약
- settings.html을 UI/UX 참고 레퍼런스로 활용 (카드형 레이아웃, 메시지 표시 방식)
- 모달 제거 후 dashboard.html이 정상 작동해야 함 (`kickDriver` 의존성 제거 검증 필수)

## 영향 받는 파일

- `frontend/drivers.html` — 신규 (약 300~400줄 예상)
- `frontend/vehicles.html` — 신규 (약 200~300줄 예상)
- `frontend/dashboard.html` — 수정 (약 −80줄 예상: modal HTML + JS 함수 제거)
- `CLAUDE.md` — 신규 파일 설명 추가
- `CHANGELOG.md` — 변경 이력 추가

## 성공 기준

- [ ] `drivers.html` 접근 시 관리자 외 계정은 리다이렉트된다
- [ ] 승인 대기 기사를 승인하면 목록이 즉시 갱신된다
- [ ] 소속 기사를 탈퇴 처리하면 목록에서 즉시 제거된다
- [ ] `vehicles.html` 접근 시 관리자 외 계정은 리다이렉트된다
- [ ] 필수 필드 누락 시 차량 등록이 차단된다
- [ ] 차량 등록 후 목록이 즉시 갱신된다
- [ ] 차량 삭제 후 목록에서 즉시 제거된다
- [ ] dashboard.html에서 모달이 완전히 제거되고 해당 버튼 클릭 시 새 페이지로 이동된다
- [ ] dashboard.html에서 `kickDriver`, `openDriverModal` 등 제거된 함수 참조가 남아있지 않다

## 열린 질문

1. **`kickDriver()` 처리**: 대시보드에서 기사를 탈퇴시킬 때 맵 마커 제거·패널 닫기 등의 부수 효과가 있었다.
   별도 페이지에서는 단순 `DELETE /users/{id}` API 호출만 하면 되지만,
   대시보드가 열린 상태에서 다른 탭의 drivers.html에서 탈퇴를 처리하면 대시보드는 다음 `loadDrivers()` 호출 전까지 오래된 상태를 유지한다.
   이를 허용할지, 아니면 대시보드에서도 WS 이벤트 등으로 즉시 처리할지 결정 필요.
   → **권장: 현재 수준(다음 loadDrivers 시 갱신)으로 허용** — 별도 WS 이벤트 추가는 과도한 복잡도

2. **페이지 UI 스타일 통일**: settings.html 스타일을 그대로 재사용할지,
   dashboard.html 스타일(카드·테이블 혼합)을 참고해 더 데이터 집약적으로 구성할지.
   → 기사/차량 관리는 테이블 형태가 적합하므로 settings.html 카드 레이아웃을 틀로 삼되 내용은 테이블 위주로 구성 권장

3. **페이지 이동 방식**: 버튼 클릭 시 현재 탭에서 이동 vs 새 탭 열기.
   → settings.html과 동일하게 **현재 탭에서 이동** 권장 (새 탭은 chat.html처럼 창이 계속 쌓이는 플로우에 적합)
