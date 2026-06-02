# RouteOn Changelog

버전 관리 규칙:
- `0.x` — 개발 중 (기능 추가/수정 활발)
- `1.0` — 첫 안정 릴리즈 (발표 버전)

---

## v1.0.42 (2026-06-02)

### 설정 변경 — 프론트엔드 포트 80 전환

**인프라**
- `docker-compose.yml` frontend 서비스 포트 바인딩 변경: `"3000:80"` → `"80:80"`
- 표준 HTTP 포트(80)로 서비스 — `http://168.138.45.63` 직접 접속 가능 (포트 번호 생략)
- Oracle Cloud VCN Security List에 TCP 포트 80 인바운드 규칙 추가 필요

---

## v1.0.41 (2026-06-02)

### 대시보드 실 API 연동 — 중간 우선순위 잔여 2종

**백엔드**
- **거래처 CRUD API 신규 구현**: `Customer` 모델 추가 (`customers` 테이블), `/customers` GET/POST/PATCH/DELETE (조직별 격리)
- `Date` 컬럼 추가 (임시 화주 유효일 `valid_date`)

**프론트엔드**
- **Trip 경로 폴리라인**: Trip 상세 패널에 경로 지도 추가 → `GET /trips/{id}/polyline` 호출 + `showTripRoutePolyline()` (독립 카카오맵 인스턴스, 노드 오버레이)
- **고객(거래처) 저장 실 API 연동**: `customerModal()` → `POST /customers` / `PATCH /customers/{id}`, `bindCustomerDetail()` 저장 → `PATCH /customers/{id}`, `openTempCustomerModal()` → `POST /customers` (임시 화주), `loadRealData()` → `GET /customers`
- 전역 변수 `_tripRouteMapInstance`, `_tripRoutePolyline` 추가

---

## v1.0.40 (2026-06-02)

### 대시보드 실 API 연동 — 중간 우선순위 5종

**프론트엔드**
- **Trip 상태 변경 UI**: `tripDetailBodyHtml`에 완료/취소 버튼 추가 → `PATCH /trips/{id}/status` 연동
- **기사 교체 실 API 연동**: `openDriverChangeModal()` 목업 배너 제거 → `PATCH /trips/{id}/reassign` 연동
- **차량 교체 실 API 연동**: `openVehicleChangeModal()` 목업 배너 제거 → `PATCH /trips/{id}/reassign` 연동
- **통계 일별 그래프**: `statsApply` 버튼 → `GET /stats/by-day` 호출 + SVG 막대 그래프(`renderByDayChart`) 렌더링
- **고객 위치 지도**: `map-placeholder` → 카카오맵 마커 (`initCustomerLocMap`), 배송지 좌표 자동 표시
- **Trip 궤적 지도**: 기사별 실적 행 클릭 → `GET /stats/route-history` + 카카오맵 폴리라인 (`showRouteOnTrajectoryMap`)
- `DATA.orders`에 `lat`/`lon`/`pickup_lat`/`pickup_lon` 필드 추가
- `statsSummary` 매핑 수정: `by_status.completed|in_progress|cancelled` 정확 연결
- `driverStats`/`vehicleStats` API 응답 필드명 불일치 수정

---

## v1.0.39 (2026-06-02)

### 대시보드 실 API 연동 — 높은 우선순위 5종

**백엔드**
- `Delivery` 모델에 필드 추가: `pickup_address`, `pickup_lat`, `pickup_lon`, `shipper_name`, `contact_name`, `mixed_load`
- `lat`·`lon` nullable 변경 (접수 시 좌표 없이 저장 가능)
- `DeliveryCreate` 스키마 + `_delivery_schema()` 응답 업데이트
- DB 마이그레이션: `deliveries` 테이블 `ALTER TABLE`

**프론트엔드 (dashboard.js)**
- **오더 목록 API 연동**: `DATA.orders` 인메모리 → `GET /deliveries` 실 API 로드
- **오더 접수 저장**: `commitPendingRowsToOrders()` → `POST /deliveries/batch` 실 DB 저장 (비동기)
- **배차 assign**: `#confirmDispatchAssign` → `PATCH /deliveries/{id}/assign` 실 API 연동 + 기사 선택 필수 검사
- **기사 등록**: `POST /auth/register` API 연동 (조직코드 자동 조회)
- **기사 삭제**: `DELETE /users/{id}` API 연동 (confirm 대화상자)
- **승인 대기 기사**: `GET /users?role=pending` 로드 + `POST /auth/approve/{id}` 승인 / `DELETE /users/{id}` 거절 UI
- **차량 등록**: `POST /vehicles` API 연동 (번호판·차종·총중량·높이 필수)
- **차량 삭제**: `DELETE /vehicles/{id}` API 연동
- **driver id 타입 버그 수정**: `driverById()`, `selectDriver()`, `dispatchManualDriverId`의 `Number()` 변환 제거 (UUID 문자열로 처리)
- `escapeHtml()` 유틸 함수 추가

---

## v1.0.38 (2026-06-02)

### 리팩토링 — dashboard.html CSS/JS 파일 분리

**프론트엔드 (dashboard)**
- `dashboard.html` 6,048줄 → 65줄 (HTML 껍데기만 유지)
- CSS 2,173줄 → `dashboard.css` 분리 (`<link rel="stylesheet">` 로드)
- JS 3,808줄 → `dashboard.js` 분리 (`<script src>` 로드)
- 코드 동작·기능 변경 없음 (파일 분리만)

---

## v1.0.37 (2026-06-02)

### 버그 수정 + 기능 개선 — register.html 테마 + 파일 선택 UI + 로그인 버그

**프론트엔드 (register.html)**
- 다크/라이트 테마 시스템 적용 — FOUC 방지 스크립트, OS 변경 리스너 추가
- 파일 선택 UI 커스텀 드롭존으로 교체 — 기본 브라우저 `input[type="file"]` 숨김
  - 미선택: 점선 테두리 + 📎 아이콘 + 안내 텍스트
  - 파일 선택 후: lime 실선 테두리 + 파일명 표시
- 등록 버튼 색상 lime(`#c6f135`)으로 통일, API URL 동적 감지로 변경

**백엔드 (auth.py)**
- `LoginRequest` 모델에 `password: str` 필드 누락 수정 → 로그인 500 오류 해결

---

## v1.0.36 (2026-06-02)

### 기능 개선 — login / index / chat 페이지 다크·라이트 테마 지원

**프론트엔드 (login.html)**
- CSS 변수 기반 테마 시스템 적용 (`--t-bg`, `--t-card`, `--t-border`, `--t-text-*`)
- `html[data-theme="light"]` 오버라이드 추가
- FOUC 방지 인라인 스크립트, OS 변경 리스너 추가
- 로그인 버튼 색상 Routeon lime(`#c6f135`)으로 통일
- API URL 동적 감지 방식으로 변경 (하드코딩 IP 제거)

**프론트엔드 (index.html)**
- `--t-*` 시맨틱 토큰 추가, `html[data-theme="dark"]` 오버라이드 추가
- body, nav, hero-card, feature-card, tech-chip, cta-section 등 테마 변수 적용
- FOUC 방지 인라인 스크립트, OS 변경 리스너 추가

**프론트엔드 (chat.html)**
- CSS 변수 기반 테마 시스템 전면 적용 (사이드바·메시지 영역·입력창)
- 내 메시지 버블 색상 lime(`#c6f135`)으로 통일
- FOUC 방지 인라인 스크립트, OS 변경 리스너 추가

---

## v1.0.35 (2026-06-02)

### 기능 개선 — 테마 설정 settings.html 이관 + UI 통일

**프론트엔드 (dashboard.html)**
- 탑바 🌙 테마 토글 버튼 제거 — settings.html로 이관
- `toggleTheme()` / `_applyThemeIcon()` 함수 제거 (dead code 정리)
- OS 테마 변경 감지 리스너는 유지 (자동 모드 실시간 반영)

**프론트엔드 (settings.html)**
- 전체 UI/UX를 대시보드 디자인 시스템에 맞춰 전면 개편
  - 배경: 다크(`var(--dark-bg)`) + CSS 변수 기반 라이트/다크 모드 지원
  - 카드, 버튼, 인풋, 토글 스위치 전부 대시보드 스타일로 통일
  - FOUC 방지 스크립트 추가 — 페이지 로드 시 깜빡임 없는 테마 적용
  - 상단 back 버튼 → 대시보드 스타일 sticky 탑바로 교체
- "화면 설정" 카드 신규 추가
  - 🖥 자동(시스템 설정) / 🌙 다크 / ☀️ 라이트 세그먼트 선택 UI
  - 선택 즉시 현재 페이지 및 전체 사이트에 테마 적용
  - 자동 선택 시 `localStorage` 항목 제거 → OS 설정 추종

---

## v1.0.34 (2026-06-02)

### 버그 수정 — 탑바 버튼 동작 없음

**프론트엔드 (dashboard.html)**
- 탑바 4개 버튼이 클릭해도 아무 반응 없던 문제 수정
  - 🔔 알림: `onclick` 없음 → 드롭다운 패널 (새 알림이 없습니다)
  - 🌙/☀️ 테마: `toggleTheme()`이 IIFE 내부에 있어 인라인 `onclick=`에서 접근 불가 → IIFE 내에서 이벤트 리스너로 직접 연결
  - ⚙ 설정: `onclick` 없음 → `/settings.html` 이동
  - 👤 관리자: `<span>` 태그라 클릭 불가 → `<button>`으로 교체 + 드롭다운 (내 프로필 / 계정 설정 / 로그아웃)
- 탑바 `topbar-user-btn` 스타일 및 `.topbar-dropdown` 드롭다운 컴포넌트 신규 추가
- 관리자 표시 셀렉터 `.topbar-user strong/small` → `#topbarUserName`, `#topbarUserRole` ID 기반으로 변경

---

## v1.0.33 (2026-06-02)

### 리팩토링 — 백엔드 라우터 도메인별 모듈 분리

**백엔드 (backend/)**
- `main.py` 3312줄 → 59줄로 축소 (앱 생성·lifespan·CORS·라우터 등록만 유지)
- `backend/core/` 신규: `config.py`(환경변수·상수), `managers.py`(ConnectionManager·redis·chat_manager 싱글턴), `utils.py`(_haversine, _haversine_km, _coord_to_address)
- `backend/routers/` 신규 11개 파일: `misc`, `vehicles`, `trips`, `optimize`, `dispatch`, `organizations`, `auth`, `chat`, `deliveries`, `location`, `stats`
- API 경로·응답 구조 변경 없음 — 프론트엔드 호환성 완전 유지
- 싱글턴 중복 생성 없음 (`manager`, `redis`, `chat_manager` 각 1곳), 순환 임포트 없음
- `feat/control-centric-ui` 브랜치에서 오케스트레이션 5단계 프로세스 적용

---

## v1.0.32 (2026-06-02)

### 기능 개선 — 목업 전면 이식 Phase 1 (dashboard.html SPA 구조 완성)

**프론트엔드 (dashboard.html)**
- 목업(`control_app_mockup.html`) 기반 관제 중심 SPA 구조로 전면 교체
- 7메인 NAV + 서브 플라이아웃: 대시보드 / 오더관리 / 배차·지정 / 일정·업무 / 고객관리 / 운행통계 / 기본정보
- `gotoPage(main, page)` / `renderPage()` SPA 패턴, 14개 서브 페이지 라우팅
- 목업 CSS 전체 이식 (다크 테마 변수, topbar, card, master-detail, table 등)
- **실제 API 연동 페이지 (6개)**: 관제 대시보드, 일괄 자동 배차, 단건·수동 배차, 운행통계, 기사관리, 차량관리
- **준비 중 페이지 (8개)**: 오더 접수·목록, 고객관리·위치, 캘린더·간트·마일스톤, 담당자·내 정보 (목업 레이아웃 + "준비 중" 배너)
- 일괄배차 모달 → `bulk-dispatch` 페이지 전환 (adTasks 로직 재사용)
- dispatch-assign 진입 시 카카오맵 전체화면, 이탈 시 `clearTbTaskPins()` 자동 호출
- `#map` DOM 고정 유지, CSS 클래스 토글로만 지도 위치 변경
- 기존 WebSocket / ETA / 채팅 알림 / 자동완성 / 엑셀 불러오기 전부 유지
- `feat/control-centric-ui` 브랜치에서 오케스트레이션 5단계 프로세스 적용

---

## v1.0.31 (2026-06-02)

### 기능 개선 — 관제 중심 UI 전환 (dashboard.html 전면 재설계)

**프론트엔드 (dashboard.html)**
- 다크 테마 적용 (`#0c0e12` 배경, `#c6f135` 라임 포인트, CSS 변수 시스템)
- 3컬럼 지도 중심 레이아웃 → 상단 topbar + SPA 섹션 전환 구조로 전면 개편
- 상단 pill 네비게이션 5개 섹션: 관제 대시보드 / 배차 / 기사관리 / 차량관리 / 운행통계
- 관제 대시보드 섹션: 요약 카드(운행중·배차대기·완료) + 기사 목록 카드 + 진행 중 운행 테이블 + 보조 지도
- 배차 섹션: 기존 태스크 빌더 + 일괄배차 버튼 (전체 지도 모드)
- 기사/차량/통계 섹션: 인라인 목록 + 기존 관리 페이지 이동 보조 액션
- 지도(#map) DOM 고정 유지 — CSS 클래스로 위치·크기만 전환 (분리/재생성 없음)
- right-panel → fixed dark drawer 전환 (`.open` 클래스 토글)
- 섹션 전환 시 `map.relayout()` 자동 호출, dispatch 이탈 시 태스크 핀 자동 정리
- 기존 API/WebSocket/ETA/채팅 알림 기능 전부 유지
- `feat/control-centric-ui` 브랜치에서 작업 (오케스트레이션 5단계 프로세스 적용)

---

## v1.0.30 (2026-06-01)

### 기능 개선 — 일괄배차 모달 화물 정보 + 엑셀 불러오기

**프론트엔드 (dashboard.html)**
- 일괄배차 모달 하차지 행에 수신자(고객사명)·화물종류·톤수 입력 필드 추가 (태스크 빌더와 동일)
- `adUpdateUnloadingMeta`: 화물 정보 변경을 `adTasks` 배열에 반영하는 함수 신규 추가
- `adSelectLoc`: 위치 재선택 시 기존 입력된 화물 정보 보존
- 모달 상단에 📂 엑셀로 불러오기 버튼 추가 (`#ad-excel-file-input`)
- `importExcelTasks(input, target)`: `target='ad'` 인자 지원 추가 → `adTasks`에 저장 후 `renderAdTasks()` 호출

---

## v1.0.29 (2026-06-01)

### 기능 개선 — ETA 실시간 추적

**백엔드 (main.py)**
- `POST /location-logs`: GPS 핑 수신마다 진행 중 trip의 남은 경유지(waypoint+destination 중 미완료)까지 haversine 거리 합산 → 평균 60km/h 기준으로 `eta_remaining_min` 재계산
- Redis에 `eta:{trip_id}` 저장 (TTL 600초)
- WS 브로드캐스트에 `eta_remaining_min`, `trip_id` 필드 추가
- `POST /location-logs` 응답에도 `eta_remaining_min` 포함

**프론트엔드 (dashboard.html)**
- `driverEtaCache` 전역 객체 추가 — GPS 핑마다 수신한 남은 분 캐싱
- WS 메시지에서 `eta_remaining_min` 수신 시 기사 카드 + 상세 패널 ETA 즉시 갱신
- `formatCardETA(trip, driverId)` — 실시간 캐시 우선, 없으면 `started_at + estimated_duration_min` 고정 방식 폴백
- 1분 주기 카드 ETA 갱신 루프: 실시간 캐시 있는 기사는 건드리지 않음

---

## v1.0.28 (2026-06-01)

### 기능 추가 — 배송지 화물·수신자 정보

**DB / 백엔드**
- `deliveries` 테이블에 `recipient_name`(수신자), `cargo_type`(화물종류), `cargo_weight_ton`(톤수) 컬럼 추가
- `WaypointSchema` / `DeliveryCreate` / `_delivery_schema` 동일 필드 반영

**프론트엔드 (dashboard.html)**
- 태스크 빌더 하차지 행에 수신자·화물종류·톤수 입력 필드 추가
- 경로 패널 하차지 노드에 👤수신자 / 📦화물종류 / ⚖️톤수 태그 표시
- Excel 양식에 `수신자`, `화물종류`, `톤수` 컬럼 추가 (7컬럼) 및 파싱 지원

---

## v1.0.27 (2026-06-01)

### 설정 — DuckDNS 도메인 연결

**nginx.conf**
- `server_name`에 `kdu.duckdns.org` 추가 (`http://kdu.duckdns.org:3000` 접속 지원)

---

## v1.0.26 (2026-06-01)

### 버그 수정 — 운행 생성 패널 상차지 검증 오작동

**프론트엔드 (dashboard.html)**
- `tbSearch`: 카카오 API 콜백(비동기, 280ms 후) 내 `drop` 변수가 클로저로 캡처되어 `renderTbTasks()` 호출 시 분리된(detached) DOM 요소를 참조하던 문제 수정 → 콜백 내에서 `document.getElementById(dropId)` 재호출로 항상 현재 요소 사용
- `tbSelectLoc`: `document.getElementById(inputId + '-drop')` 가 `null` 반환 시 TypeError 발생 → `tbTasks` 업데이트 코드 미실행 버그 수정 (null 체크 추가)
- 드롭다운 아이템: `onclick` → `onmousedown` + `event.preventDefault()` 변경으로 `blur` 이벤트로 인한 선택 누락 방지
- 에러 메시지 개선: input 필드에 텍스트가 있지만 좌표가 없는 경우 "검색 목록에서 선택해주세요." 안내 추가

---

## v1.0.25 (2026-06-01)

### 기능 개선 — 태스크 상차지 복수 지원

**백엔드 (main.py)**
- `AutoDispatchTask` 스키마: `loading: WaypointSchema` → `loadings: list[WaypointSchema]`
- greedy 거리 계산 기준점: `task.loadings[0]` (첫 번째 상차지)
- waypoints 생성: 상차지 배열을 순회하여 복수 상차지 모두 경유지로 등록

**프론트엔드 (dashboard.html)**
- `tbTasks` / `adTasks` 구조 변경: `loading` 단일 → `loadings[]` 배열
- 운행 생성 패널: 상차지 복수 입력 + "상차지 추가" 버튼 (`tbAddLoadingSlot`, `tbRemoveLoadingSlot`)
- 자동배차 모달: 상차지 복수 입력 + "상차지 추가" 버튼 (`addAdLoading`, `removeAdLoading`)
- `importExcelTasks`: 동일 태스크 번호에 상차지 행이 여러 개면 모두 배열로 처리
- 지도 핀: 복수 상차지 모두 🏗️ 핀으로 표시

---

## v1.0.24 (2026-06-01)

### 버그 수정 — 일괄 배차 태스크 쏠림 현상

**백엔드 (main.py)**
- `POST /trips/auto-dispatch` greedy 배정 버그 수정: GPS 위치가 확인된 기사가 1명이라도 있으면 모든 태스크가 그 기사에게 집중되는 문제
- 기사당 최대 `ceil(태스크 수 / 기사 수)` 개까지만 배정하도록 `max_per_driver` 상한선 도입
  - 태스크 10개 / 기사 10명 → 각 1명씩 10건 운행 생성
  - 태스크 3개 / 기사 10명 → 3명에게 1개씩 배정
  - 태스크 15개 / 기사 10명 → 5명은 2개, 5명은 1개로 균등 분산

---

## v1.0.23 (2026-06-01)

### 기능 변경 — 프리셋 제거 + 엑셀 태스크 불러오기 추가

**프론트엔드 (dashboard.html)**
- 운행 생성 패널의 "프리셋 불러오기" UI 및 관련 JS(`_presets`, `refreshPresetSelect`, `loadPreset`, `savePreset`, `deletePreset`) 완전 제거
- 엑셀(`.xlsx`/`.xls`) 파일로 배송 태스크를 일괄 등록하는 기능 추가
  - SheetJS(CDN) 로 클라이언트에서 파일 파싱
  - 컬럼 형식: `태스크 | 구분(상차지/하차지) | 장소명 | 주소`
  - 주소 → 좌표 자동 변환: `GET /address/coord` 지오코딩 (행 수만큼 순차 호출)
  - 파싱 결과를 `tbTasks`에 반영 → `renderTbTasks()` + `renderTbTaskPins()` 호출
  - 진행 상황 `(N/전체)` 실시간 표시, 지오코딩 실패 건수 경고
- "📋 양식" 버튼: 예시 데이터가 채워진 `routeon_태스크양식.xlsx` 자동 다운로드

---

## v1.0.22 (2026-05-28)

### 기능 개선 — 출발 시각 미입력 시 현재 시각 자동 사용

**프론트엔드 (dashboard.html)**
- 운행 생성 패널(`createTripFromMap`)과 자동배차 모달 전송 함수에서 출발 시각을 비워두면 전송 시점의 현재 시각(`new Date().toISOString()`)을 자동으로 `departure_time`에 사용

---

## v1.0.21 (2026-05-28)

### 기능 개선 — 운행 생성 패널 지도 핀 표시 + 태스크별 색상 구분

**프론트엔드 (dashboard.html)**
- 지도 클릭 또는 검색창으로 상차지/하차지를 `tbTasks`에 추가하면 해당 위치에 지도 핀이 즉시 표시됨
  - 상차지 핀: `T{n} 🏗️`, 하차지 핀: `T{n} 📦` (말풍선 꼬리 포함)
  - 태스크 제거·리셋 시 핀도 함께 제거
- 태스크별 색상 팔레트(`TB_TASK_COLORS`, 10가지 순환) 적용
  - 지도 핀 배경색과 패널 카드 UI(왼쪽 테두리, 헤더 배경, 컬러 도트, 입력 필드 border)가 태스크 색상으로 일치
- `renderTbTaskPins()` / `clearTbTaskPins()` 함수 추가; `renderTbTasks()` 및 `tbSelectLoc()` 호출 시 자동 갱신

---

## v1.0.20 (2026-05-28)

### 기능 개선 — 일괄배차 모달에 지도 클릭 태스크 자동 복사

**프론트엔드 (dashboard.html)**
- `openAutoDispatchModal()`: 모달 열기 전 `tbTasks`(운행 생성 패널에 지도 클릭으로 추가된 태스크) 유무를 확인
  - 태스크가 있으면 깊은 복사(`JSON.parse(JSON.stringify)`)해 `adTasks`에 그대로 불러옴
  - 태스크가 없으면 기존대로 빈 태스크 1개로 시작
  - `tbTasks` 자체는 변경하지 않아 모달 닫고 단일 운행 생성 패널도 그대로 유지

---
## v1.0.19 (2026-05-28)

### 기능 개선 — 일괄배차 버튼 지도 위로 이동

**프론트엔드 (dashboard.html)**
- 일괄배차 버튼을 오른쪽 패널(기사 선택 시에만 노출)에서 지도 위 플로팅 버튼으로 이동
- 지도 검색바 오른쪽(`left:315px`)에 `.map-dispatch-btn` 스타일 pill 형태로 배치, 항상 노출

---
## v1.0.18 (2026-05-28)

### 버그 수정 — 예상 완료 시간(ETA) 9시간 오차

**백엔드 (main.py)**
- `_trip_schema`: `created_at`, `started_at`, `completed_at` ISO 문자열에 `Z` 접미사 추가
- 원인: `datetime.utcnow().isoformat()`은 타임존 정보 없는 문자열을 반환 → JavaScript가 로컬 시각(KST)으로 파싱해 ETA가 실제보다 9시간 뒤로 계산됨

---
## v1.0.17 (2026-05-27)

### 버그 수정 — 배차 취소 후 폴리라인이 지도에 남아있는 문제

**프론트엔드 (dashboard.html)**
- `drawAllRunningPolylines()`: `in_progress`가 아닌 기사의 기존 폴리라인을 먼저 일괄 제거 후 재드로우하도록 수정
- `loadDrivers()`: `drawAllRunningPolylines()` 호출에 `await` 추가 — 타이밍 경쟁 조건 해소

---
## v1.0.16 (2026-05-27)

### 버그 수정 — 운행 생성 시 departure_time 미입력 시 null 저장

**백엔드 (main.py)**
- `POST /trips`: `departure_time` 미입력 시 운행 생성 시각(UTC)으로 자동 설정

---
## v1.0.15 (2026-05-27)

### 버그 수정 — 운행 생성 시 차량 제원 자동 미반영 및 마커 이름 오표시

**백엔드 (main.py)**
- `POST /trips`: `vehicle_id` 지정 시 차량 테이블의 `height_m`, `weight_kg`, `length_cm`, `width_cm`를 trip에 자동 복사 (앱에서 별도 전송 불필요)

**프론트엔드 (dashboard.html)**
- 지도 기사 마커: `driver.username` → `driver.name`(실명) 표시로 수정

---
## v1.0.14 (2026-05-27)

### 버그 수정 — 출발지 이름 미입력 시 좌표 문자열로 표시되는 문제

**백엔드 (main.py)**
- `_coord_to_address(lat, lon)` 헬퍼 추가 — 카카오 역지오코딩 API로 좌표 → 도로명/지번주소 변환 (실패 시 좌표 문자열 폴백)
- `POST /optimize`: `origin_name` 미입력 시 역지오코딩으로 주소 자동 조회 (기사가 이름 없이 좌표만 전송해도 정상 표시)
- `POST /optimize/replan`: `current_name` 필드를 `Optional[str]`로 변경, 미입력 시 역지오코딩으로 자동 조회

---
## v1.0.13 (2026-05-27)

### 버그 수정 — 이메일 발송 미작동

**인프라**
- `docker-compose.yml` backend 서비스 environment에 `SMTP_EMAIL` / `SMTP_PASSWORD` 누락으로 컨테이너에 환경변수 미전달 → 승인/반려 이메일 항상 건너뜀 버그 수정

---
## v1.0.12 (2026-05-26)

### 통계 강화 — 상태별 세분화, 차량별 실적, 과거 경로 지도, 안전 이슈·머문 시간 스키마

**DB 스키마**
- `trips.safety_issue` (BOOLEAN DEFAULT FALSE) 컬럼 추가
- waypoints JSONB 항목에 `arrived_at` / `departed_at` 타임스탬프 저장 가능 (앱 연동 준비)

**백엔드 (main.py)**
- `_period_cutoff()` 확장 — `today` / `week` / `month` 추가 (기존 7d · 30d · all 유지)
- `GET /stats/summary` — `driver_id` · `vehicle_id` 필터 추가, 안전 이슈 건수(`safety_issues`), 배정 완료·미배정 건수(`assigned_deliveries` · `unassigned_deliveries`) 신규 응답 필드
- `GET /stats/by-driver` — `driver_id` 필터 추가, 운행 시간 합(`total_duration_min`) · 운행 일수(`work_days`) 신규 필드
- `GET /stats/by-day` — `driver_id` · `vehicle_id` 필터 추가
- `GET /stats/by-driver-day` — `driver_id` 필터 추가
- `GET /stats/by-vehicle` (신규) — 차량별 완료 건수 · 총 거리 · 총 운행 시간 집계
- `GET /stats/route-history` (신규) — 기사·기간 기반 location_logs GPS 궤적 배열 반환
- `PATCH /trips/{id}/safety` (신규) — 안전 이슈 플래그 기록 `{safety_issue: bool}`
- `PATCH /trips/{id}/waypoint-dwell` (신규) — 경유지 도착·출발 시간 기록 `{index, arrived_at?, departed_at?}`

**프론트엔드 (stats.html)**
- 기간 필터: 버튼 → 드롭다운 (오늘 / 이번 주 / 이번 달 / 최근 30일 / 최근 7일 / 전체)
- 기사·차량 필터 드롭다운 추가 — 선택 시 모든 통계 자동 재조회
- 요약 카드 재구성: 완료·운행중·대기·취소 상태별 4개 카드 + 배정 완료·미배정·안전 이슈 3개 카드
- 기사별 실적 테이블 — 운행 일수 · 운행 시간 합 컬럼 추가, 시간 표기 `X시간 Y분` 형식
- 차량별 실적 테이블 신규 — 차량번호 · 차종 · 총 운행 · 완료 · 총 거리 · 총 운행 시간
- 과거 경로 지도 신규 — 기사 선택 드롭다운, 카카오맵에 GPS 궤적 폴리라인 + 시작·끝 마커
- CSV 내보내기 — 운행 일수 · 시간 합 컬럼 반영

---
## v1.0.11 (2026-05-20)

### 긴급 배차 태스크 단위 묶음

**프론트엔드 (dashboard.html)**
- 긴급 배차 흐름 개편: 상차지+하차지를 임시 저장 후 ✅ 전송 버튼으로 일괄 전송
  - ⚡ 긴급 상차지 클릭 → `_emergencyTask` 임시 저장, 패널 배지 표시
  - ⚡ 긴급 하차지 추가 클릭 → 임시 목록에만 추가 (즉시 전송 안 함)
  - ✅ 전송 버튼 클릭 → 상차지+하차지 같은 `task_group`으로 순차 `PATCH /trips/{id}/waypoints`
  - 전송 버튼은 하차지 1개 이상일 때만 활성화
- 팝업 버튼 상태 분기: 임시 태스크 없을 때 [⚡ 긴급 상차지][⚡ 긴급 하차지], 있을 때 [⚡ 긴급 하차지 추가][↺ 상차지 변경]
- 배지 UI: 상차지·하차지 목록 실시간 표시, ✕ 취소 버튼
- 기사 전환·패널 닫기 시 임시 태스크 자동 초기화
- 임시 태스크 없이 긴급 하차지만 추가 시 기존처럼 즉시 전송 유지 (task_group=null)

---
## v1.0.10 (2026-05-20)

### 버그 수정 — 채팅·지도 마커

**백엔드**
- 채팅 `partner.username/name null` 버그: `_get_accessible_conversation`에 `selectinload(Conversation.admin/driver)` 누락으로 읽음 처리·메시지 전송 응답에서 partner 정보가 null로 반환되던 문제 수정

**프론트엔드 (dashboard.html)**
- 기사 마커·노드 마커(상차지·하차지 등) 클릭 시 지도 클릭 이벤트 동시 발생 버그 수정: `mousedown` stopPropagation 누락이 원인 (카카오맵은 mousedown 기준으로 클릭 감지)
- 새로고침 후 기사 위치 마커 미표시 버그 수정: WS GPS 수신 시에만 마커 생성되던 문제 → 초기 `loadDrivers()` 완료 후 전체 기사 위치 일괄 조회하여 마커 생성

---
## v1.0.9 (2026-05-20)

### 경로 최적화 개선 + 위치 폴백 + 운행 생성 UX 개편

**백엔드**
- `GET /location-logs/{user_id}`: Redis miss 시 TimescaleDB 최근 기록 폴백. 응답에 `is_realtime`, `recorded_at` 추가
- `POST /trips/auto-dispatch`: 라운드 로빈 → 상차지 기준 최근접 기사 greedy 배정. 배정 후 기준 위치를 마지막 하차지로 갱신. 위치 미확인 기사는 라운드 로빈 폴백
- `WaypointSchema`: `task_group: Optional[int]` 필드 추가. 같은 그룹의 loading-unloading 쌍을 OR-Tools pickup_deliveries 제약으로 연결
- `/optimize` · `/optimize/replan`: `_apply_loading_precedence` 제거. task_group 기반 pickup_deliveries 추출 → OR-Tools에 전달. 상차-하차 쌍 순서만 보장하고 전체 순서는 자유 최적화
- `/optimize` `started_at` 버그 수정: in_progress 전환 시 `started_at` 미기록 문제 수정 → ETA 계산 정상화

**프론트엔드 (dashboard.html)**
- 기사 패널 상단: 🟢 실시간 위치 / 🔘 마지막 기록 N분 전 배지 표시
- 운행 생성 패널: 상차지/하차지 분리 목록 → 태스크 카드(상차지 1개 + 하차지 N개 묶음) 구조로 전환
  - 카카오 Places 자동완성 텍스트 검색 + 지도 클릭 병행 지원
  - 지도 클릭 "상차지" → 새 태스크 생성, "하차지" → 마지막 태스크에 추가
  - 프리셋 불러오기/저장도 태스크 단위 변환
  - `_tbTasksToWaypoints()`에서 태스크 인덱스를 task_group으로 자동 부여

---
## v1.0.8 (2026-05-20)

### 기사·차량 교체 — 운행 중 인원/장비 교체 및 잔여 경유지 이관

**백엔드**
- `ReassignRequest` 스키마: `new_driver_id?`, `new_vehicle_id?`, `transfer_remaining`
- `PATCH /trips/{id}/reassign` 신규 엔드포인트 (관리자 전용)
  - 기사/차량 단순 교체: `driver_id` 또는 `vehicle_id` 변경, 중복 배차 체크
  - 잔여 경유지 이관 (`transfer_remaining=true`): 현재 운행 cancelled 처리 + 동일 waypoints로 새 운행 생성
  - WS `trip.reassigned` 브로드캐스트 (`trip_id`, `driver_id`, `new_trip_id`)

**프론트엔드 (dashboard.html)**
- 운행 정보 패널에 "🔄 기사·차량 교체" 버튼 추가 (운행 활성 중일 때만 표시)
- 교체 모달 (`.rs-overlay` / `.rs-modal`):
  - 기사 드롭다운 — 가용/운행 중 상태 표시, 현재 기사 제외
  - 이관 체크박스 — 기사 선택 시에만 노출, 현재 운행 취소 + 잔여 경유지 이관 설명
  - 차량 드롭다운 — 전체 활성 차량, 현재 차량 기본 선택
- WS `trip.reassigned` 수신 시 `handleTripReassigned()` → 폴리라인 갱신 + 기사 카드 재로드

---
## v1.0.7 (2026-05-19)

### 운행 자동 배차 — 배송 태스크 일괄 배분

**백엔드**
- `GET /drivers/available` — 현재 운행(scheduled/in_progress)이 없는 가용 기사 목록 반환 (조직 내)
- `AutoDispatchTask` 스키마: `loading` (WaypointSchema) + `unloadings` (WaypointSchema 배열)
- `AutoDispatchRequest` 스키마: `tasks`, `driver_ids?`, `vehicle_id?`, `departure_time?`
- `POST /trips/auto-dispatch` — 태스크를 가용 기사에게 라운드 로빈으로 균등 분배, 기사별 경유지 합쳐 운행 일괄 생성, 가용 기사 없을 시 409 반환

**프론트엔드 (dashboard.html)**
- 운행 생성 패널 하단에 "🚛 자동 배차 (일괄)" 버튼 추가
- 자동 배차 모달:
  - 배송 태스크 카드 (상차지 1개 + 하차지 N개, + 태스크 추가/제거)
  - 각 위치 입력: 카카오 Places 장소 검색 자동완성
  - 차량 선택 (선택), 출발 시각 (선택)
  - 가용 기사 칩 목록: 클릭으로 배차 대상 선택/해제 (운행 중 기사는 비활성)
  - 분배 미리보기 ("태스크 N개 → 기사 M명, 기사당 최대 K개")
  - "배차 실행" 시 운행 생성 완료 후 알림 + 대시보드 자동 갱신

---
## v1.0.6 (2026-05-19)

### 기사 배차 취소 요청 — 기사 앱 요청 + 관리자 승인/거절

**DB**
- `trips` 테이블에 `cancel_requested BOOLEAN NOT NULL DEFAULT FALSE`, `cancel_request_reason TEXT` 컬럼 추가

**백엔드 (`backend/main.py`, `backend/models.py`)**
- `POST /trips/{id}/cancel-request` (기사 전용): 취소 요청 저장 + 관리자에게 WS `trip.cancel_requested` 브로드캐스트
- `POST /trips/{id}/cancel-request/respond?action=approve|reject` (관리자 전용): 승인 시 `status=cancelled`, 기사에게 WS `trip.cancel_responded` 전송
- `_trip_schema`에 `cancel_requested`, `cancel_request_reason` 필드 추가

**프론트엔드 (`frontend/dashboard.html`)**
- 기사 카드: 취소 요청 있으면 `⚠️ 배차 취소 요청` 배지 표시
- trip-info-box: 황색 notice 박스(사유 표시) + [✅ 취소 승인] / [❌ 거절] 버튼
- WS `trip.cancel_requested` 수신 시 카드·패널 즉시 갱신 (`handleCancelRequested`)
- WS `trip.cancel_responded` 수신 시 승인이면 폴리라인 제거 후 갱신 (`handleCancelResponded`)

---
## v1.0.5 (2026-05-19)

### 통계 강화 — 기사별 추이 그래프 + CSV 내보내기

**백엔드 (`backend/main.py`)**
- `GET /stats/by-driver-day` 신규 엔드포인트: 기사·날짜별 일별 운행 건수·거리 집계 반환

**프론트엔드 (`frontend/stats.html`)**
- 기사별 추이 라인 차트 추가 — 기사마다 고유 색상(10색 팔레트), 운행 건수/거리 탭 전환
- `interaction: { mode: 'index' }` 설정으로 같은 날짜 전 기사 툴팁 동시 표시
- 기사별 실적 테이블 `⬇ CSV 내보내기` 버튼 — BOM 포함 UTF-8, 파일명 `routeon_stats_{period}_{date}.csv` (엑셀 호환)
- 일별 바 차트 x축 레이블 `YYYY-MM-DD` → `MM-DD` 단축 표시
- 기간 변경 시 추이 차트도 함께 갱신, 기사명 표시 시 `name` 우선 (없으면 `username`)

---
## v1.0.4 (2026-05-19)

### 긴급 배차 상차지(loading) 타입 지원

**프론트엔드 (`frontend/dashboard.html`)**
- 지도 검색 핀 팝업의 `⚡ 긴급 경유지 추가` 버튼(1개) → `⚡ 긴급 상차지` / `⚡ 긴급 하차지` (2개)로 분리
- `addEmergencyWaypoint(type)` — `type` 파라미터 추가, `PATCH /trips/{id}/waypoints` 요청 body에 `type` 포함 전송
- CSS `.pin-btns-emergency` — 두 버튼 나란히 배치 (`flex`)
- 성공 알림 메시지에 "상차지" / "하차지" 구분 표시
- 백엔드 `WaypointSchema`는 이미 `type` 필드를 지원하므로 추가 수정 없음

---
## v1.0.3 (2026-05-18)

### 예상 운행 완료 시간(ETA) 표시

**백엔드**
- `_trip_schema`에 `started_at`, `completed_at` 필드 추가 (기존에 누락)

**프론트엔드 (`frontend/dashboard.html`)**
- `calcETADate(trip)` — `started_at` + `estimated_duration_min` → 완료 예상 `Date` 계산 (`in_progress` 아닌 경우 null)
- `formatCardETA(trip)` — 기사 카드용 한 줄 문자열 `⏰ 예상 완료 HH:MM (약 N분 남음 / 초과 N분)`
- 기사 카드: 운행 중일 때 ETA 한 줄 추가 표시
- 기사 패널 trip-info-box: 목적지 아래 ETA 전용 행, 시간 초과 시 빨간 글씨
- 1분 주기 `setInterval`로 패널·카드 남은 시간 자동 갱신

---

### 기사 현재 위치 경로 진행도 UI

**프론트엔드 (`frontend/dashboard.html`)**
- `haversineKm()` / `buildCumulativeDist()` — 폴리라인 좌표 배열 → 누적 거리(km) 계산
- `getNodeRatios(nodes, points)` — 각 노드의 폴리라인 상 비율(0~1) 산출, 폴리라인 없으면 균등 배치
- `getDriverRatio(driverId)` — `driverCurrentPositions`의 GPS 좌표 → 폴리라인 상 비율
- `renderRouteNodes` 전면 재구현: 수직 타임라인 형태
  - 구간 connector 높이를 실제 거리 비율에 비례 (44~140px 범위 제한)
  - 🚚 인디케이터를 해당 connector 내 정확한 비율 위치에 표시
  - 기사가 지나온 노드: 체크(✓) + dot 색상 채움 + 텍스트 dim (opacity 0.45)
  - 지나온 구간 connector 색상도 해당 노드 색상으로 변경
- `updateProgressIndicator(driverId)` — GPS 수신마다 패널 진행도만 재렌더링 (스크롤 위치 보존)
- `driverCurrentPositions` 전역 객체: WS GPS 수신 + 패널 열기 시 `/location-logs/{id}` API 위치로 초기화

---

## 예정 작업

### 진행 중 / 단기
- [ ] Android 앱: `/optimize` 호출 시 `dest_name/dest_lat/dest_lon` 파라미터 지원 (팀원 A)
- [x] 긴급 경유지 추가(`PATCH /trips/{id}/waypoints`) type=unloading 기본값 E2E 검증 — 정상 동작 확인
- [x] 상차지 인근 기사 확인 — `GET /nearby-drivers` 구현 완료
- [x] **ETA 실시간 추적** — GPS 핑 수신마다 남은 경유지 기준 예상 완료 시간 재계산 (출발 시각 고정 방식 → 현재 위치 기반 동적 갱신)
- [ ] **지도 클릭 비활성화** — 지도와 상호작용하는 모든 클릭 이벤트 제거 (`chore/disable-map-interaction` 브랜치)

### 기능 개발 백로그
- [x] **관리자 프리셋 기능** — 자주 쓰는 상차지/하차지 조합 저장·불러오기·삭제
- [x] **폴리라인 개선** — 기사별 단일 색상 + 지나온 구간 실시간 투명화
- [ ] **UI/UX 리팩토링** — 관리자 웹 전반 일관성 개선, 컴포넌트 정리
- [ ] **카카오 소셜 로그인** — 회원가입·로그인 시 카카오 OAuth 연동
- [ ] **카카오톡 알림** — 운행 배차·경유지 추가·완료 등 주요 이벤트 카카오톡 메시지 발송

### 마무리
- [ ] 발표 준비

---
## v1.0.2 (2026-05-14)

### 기사 이름 필드 추가

**백엔드**
- `users` 테이블에 `name VARCHAR(50)` 컬럼 추가 (nullable, 기존 계정 NULL 유지)
- `POST /auth/register` — `name` 필수 파라미터로 추가, User 생성 시 저장
- `GET /auth/me`, `GET /users`, 채팅 파트너, 인근 기사, 기사별 통계 응답에 `name` 포함

**프론트엔드**
- `drivers.html`, `dashboard.html`, `chat.html` — `name || username` 폴백 패턴으로 표시

---

### 기사 자동승인 기능 구현

**백엔드**
- `organizations` 테이블에 `auto_approve_drivers BOOLEAN NOT NULL DEFAULT FALSE` 컬럼 추가
- `POST /auth/register` — `org.auto_approve_drivers` ON 시 가입 즉시 `driver` 역할 부여 (기본: `pending`)
- `PATCH /organizations/me/settings` 신규 — `{auto_approve_drivers: bool}` 토글 API
- `GET /organizations/me` 응답에 `auto_approve_drivers` 포함

**프론트엔드 (`frontend/settings.html`)**
- 기사 자동승인 토글 정상 동작 — "준비 중" 뱃지 및 `disabled` 제거
- 토글 변경 시 `PATCH /organizations/me/settings` 호출, 성공/실패 피드백 메시지 표시
- CSS 수정: 토글 `cursor: pointer`, `input:checked` 상태 스타일 추가

---

### 기사 탈퇴 FK 오류 수정

**백엔드 (`DELETE /users/{user_id}`)**
- 사용자 삭제 전 관련 레코드 순차 정리: 메시지 → 대화방 → 배송 담당자 NULL → 운행 → GPS 이력 → 사용자
- PostgreSQL FK `NO ACTION` 제약으로 인한 삭제 오류 해소

---

### 운행 생성 입력 검증 강화

**백엔드 (`POST /trips`)**
- `driver_id` UUID 형식 검증
- 기사 존재 여부 및 `role=driver` 확인
- 다른 조직 기사 배차 차단 (403)
- 이미 `scheduled`/`in_progress` 운행이 있는 기사에 중복 배차 차단 (409)
- `vehicle_id` 입력 시 존재 여부 및 `is_active` 확인

---

### 채팅 헤더 기사 운행 상태 표시

**프론트엔드 (`frontend/chat.html`)**
- 기사 선택 시 `GET /trips?driver_id=` 호출 → 현재 운행 상태를 채팅 헤더 서브타이틀에 표시
- `🚛 운행 중 · {목적지}` / `📋 배차됨 · {목적지}` / `🕐 배차 없음` 3단계 표시

---
## v1.0.1 (2026-05-13)

### 대시보드 하단 메뉴 아이콘 탭바 개편

**프론트엔드 (`frontend/dashboard.html`)**
- 좌측 하단 메뉴를 1행 5분할 아이콘 탭바로 변경
- 아이콘 하단 짧은 한글 라벨과 `title` 툴팁 추가
- 기사/차량/통계/설정/로그아웃 동작은 기존과 동일하게 유지

---
## v1.0.0 (2026-05-13)

### 기사·차량 관리 페이지 분리

**프론트엔드**
- `drivers.html` 신규 — 승인 대기 기사 승인/거절, 소속 기사 탈퇴 처리
- `vehicles.html` 신규 — 차량 등록, 등록 차량 목록 조회, 차량 삭제
- `dashboard.html` 기사/차량 관리 모달 제거 → 좌측 하단 버튼을 별도 페이지 이동으로 변경

### 설정 페이지 신규 + 대시보드 UI 정리

**프론트엔드 (`frontend/settings.html` 신규)**
- 조직코드 관리 — 현재 코드 표시·복사·재발급 (HTTP 환경 clipboard fallback 포함)
- 계정 정보 — 전화번호 변경, 비밀번호 변경 (현재 비밀번호 확인 + 4자 최소 프론트 차단)
- 운영 설정 — 기사 자동승인 토글 (UI 전용, disabled + "준비 중" 뱃지)
- 관리자 전용 인증 가드 (토큰 없음 → `/login.html`, role≠admin → 리다이렉트)

**프론트엔드 (`frontend/dashboard.html`)**
- 좌측 패널 `#org-code-box` 제거 → 설정 페이지로 이전
- `loadOrgCode()` → `loadOrgName()`으로 축소 (기업명 헤더 표시 유지)
- 하단 `left-footer`에 ⚙️ 설정 버튼 추가 (`/settings.html` 이동)
- 버튼 5개 배치를 위한 CSS 조정 (`flex-wrap`, `font-size: 12px`)

---
## v0.9.9 (2026-05-13)

### 대시보드 실시간 반영 개선

**백엔드**
- `POST /optimize` 완료 시 관리자 WS에 `trip.started` 이벤트 브로드캐스트
- `POST /optimize/replan` 완료 시 관리자 WS에 `trip.replanned` 이벤트 브로드캐스트

**프론트엔드 (dashboard.html)**
- 기사가 경로 최적화 완료 시 대시보드 즉시 반영 — 상태 배지 `출발대기→운행중`, 폴리라인 자동 표시
- 기사가 재경로 완료 시 폴리라인 즉시 갱신 (`trip.replanned` 이벤트 처리)
- 운행 완료/취소 시 지도 폴리라인 즉시 제거 (`clearDriverRoute()` 추가)
- 기사 강퇴 후 기사 목록 즉시 갱신 (미구현 `openSettings()` 호출 버그 수정)
- 배송 삭제 후 기사 카드 카운트 즉시 갱신 (`loadDrivers()` 추가)
- GPS 수신 시 폴리라인 누락 방지 — `in_progress` 상태인데 폴리라인 없으면 자동 로드

---
## v0.9.8 (2026-05-13)

### 채팅 UI 분리 + 버그 수정

**채팅 페이지 분리 (`frontend/chat.html` 신규)**
- 대시보드 우측 패널의 채팅 박스 완전 제거
- 별도 `chat.html` 페이지 생성 — 좌측 대화 목록 + 우측 메시지창 (카카오톡 PC 스타일)
- 기사 카드에 💬 버튼 직접 추가 → 클릭 시 `chat.html?driver_id=xxx` 새 탭으로 바로 열기
- `stopPropagation()` 처리로 기사 패널 열기와 채팅 열기 독립 동작
- 대시보드에서 채팅 WS 연결 제거 (채팅 전용 페이지에서만 WS 유지)

**채팅 버그 수정**
- 한글 입력 시 메시지 중복 전송 수정 — `e.isComposing` 체크로 IME 조합 중 Enter 무시
- 줄바꿈(Shift+Enter) 전송 시 공백으로 표시되는 문제 수정 — `white-space: pre-wrap` 적용

---
## v0.9.7 (2026-05-13)

### 버그 수정 + 마커 레이어 순서 명시

**백엔드**
- `asyncio` import 누락으로 `/ws/chat` WebSocket 연결 시 `NameError: name 'asyncio' is not defined` 발생하던 버그 수정

**프론트엔드**
- 마커 zIndex 명시로 겹침 순서 확정
  - 노드 마커(경유지·출발·휴게소): `zIndex 5`
  - 기사 위치 마커: `zIndex 10`
  - 검색 핀 팝업: `zIndex 20` (기존 유지)

---
## v0.9.6 (2026-05-13)

### 경유지 노드 마커 UI 개선

**프론트엔드**
- 기사 카드 클릭 시 지도에 표시되는 노드 마커(출발·경유지·휴게소·도착) UI 변경
  - 이름 텍스트 제거 → 이모지 아이콘만 표시 (hover 시 `title` 속성으로 이름 확인)
  - 원형 → **드롭핀(물방울) 형태** 변경 (`border-radius: 50% 50% 50% 0` + `rotate(-45deg)`)
  - 내부 아이콘은 반대 방향(`rotate(45deg)`)으로 보정해 정방향 유지
  - `yAnchor` 1.5 → 1.2 조정으로 핀 끝이 좌표에 정확히 위치

---
## v0.9.5 (2026-05-13)

### 경로 최적화 휴식지 타입 제한

**백엔드**
- `/optimize`, `/optimize/replan` 휴식지 후보 쿼리를 `highway_rest`(고속도로 휴게소) 전용으로 변경
  - 기존: `type != 'depot'` (졸음쉼터·공영차고지·물류단지 모두 포함)
  - 변경: `type == 'highway_rest'` (75건만 사용)
- candidates dict에 `type` 필드 추가 (선택 로직 우선순위 정상 동작)

---
## v0.9.4 (2026-05-13)

### 지도 UX 개선

**프론트엔드**
- 폴리라인 클릭 시 해당 기사 카드 자동 선택 + 우측 상세 패널 표시
  - passed/remaining 두 Polyline 모두 `kakao.maps.event.addListener` click 등록
  - `_polylineClicked` 플래그로 폴리라인 클릭 시 `onMapClick` 이벤트 중복 차단
- 지도 클릭 팝업(검색 핀) 닫기 방법 추가
  - 팝업 우상단 **X 버튼** 추가 (`hideSearchPin()` 호출)
  - **ESC 키**로 팝업 닫기 (`keydown` 이벤트 전역 등록)

---
## v0.9.3 (2026-05-13)

### 폴리라인 개선 — 기사별 색상 + 지나온 구간 투명화

**프론트엔드**
- 폴리라인을 노드 타입별 구간 분리 → **기사별 단일 색상** 방식으로 전환
- 기사 현재 위치 기준으로 경로를 **지나온 구간**(opacity 0.25, 가는 선)과 **남은 구간**(opacity 0.85, 굵은 선) 두 개로 분리
- `driverPolylinePoints[id]`에 전체 폴리라인 좌표 저장 → GPS 수신마다 `setPath`로 재분할 (카카오맵 객체 재생성 없음)
- `_findNearestIdx()` — 현재 위치에서 가장 가까운 폴리라인 포인트 인덱스 탐색
- `splitPolylineAtPosition()` — passed/remaining `setPath` 갱신
- `updateDriverMarker()` — GPS 수신 시 `splitPolylineAtPosition()` 호출하여 실시간 반영

**버그 수정**
- 기사 카드 클릭 시 운행 정보가 표시되지 않는 버그 수정
  - `driverPolylines[id]`가 배열로 변경됐는데 `showDriverDetail`에서 단일 `Polyline.getPath()`를 호출해 `TypeError` 발생 → async 함수 중단으로 `trip-info-box` 미표시
  - 배열 전체를 순회하여 `LatLngBounds` 계산하도록 수정

---
## v0.9.2 (2026-05-11)

### 휴게소 시드 데이터 확충

**백엔드**
- `RestStopType` enum에 `truck_yard`(공영차고지), `logistics_park`(물류단지) 추가 (DB + models.py)
- `seed_rest_stops_xls.py` 추가 — XLS 3개 파일 → 카카오 주소 geocoding → DB 삽입
  - 휴게소정보(highway_rest) 75건, 공영차고지(truck_yard) 55건, 물류단지(logistics_park) 26건
  - `운영중` 상태 필터링, 좌표 없는 파일은 카카오 로컬 API geocoding으로 변환
- `requirements.txt`에 `aiohttp` 추가 (시드 스크립트 의존성 — DB 초기화 후 재시드 시 필요)
- rest_stops 총 **409건** (기존 졸음쉼터 253건 + 신규 156건)

---
## v0.9.1 (2026-05-11)

### WebSocket 버그 수정

**버그 수정**
- `driver` 토큰으로 `/ws/location` 연결 시 HTTP 403 반환되던 문제 수정
  - `ws.accept()` 없이 `ws.close()` 호출하면 HTTP 403이 반환되는 FastAPI 동작 수정 → `_reject()` 헬퍼로 `accept()` → `close(1008)` 순서 통일
  - `driver` role도 `/ws/location` 연결 허용 (기사 앱이 `replan_requested` 수신하기 위해 필요)
  - `ConnectionManager`에 driver 연결 풀 분리: `connect_driver()` + `broadcast_replan_to_org()` 추가
  - `PATCH /trips/{id}/waypoints`: `broadcast_replan_to_org()`로 기사 앱에도 `replan_requested` 전송
- WebSocket 20초 주기 연결 끊김 수정
  - Nginx `/ws/` 블록에 `proxy_send_timeout 3600s` 추가 (기본값 60s로 유휴 종료되던 문제)
  - uvicorn `--ws-ping-interval 20 --ws-ping-timeout 30` 추가 (프레임 레벨 Ping/Pong 자동 처리)
  - `/ws/location`, `/ws/chat` 서버 측 heartbeat 추가 — 20초마다 `{"type":"ping"}` 전송
  - `/ws/chat` `ws.accept()` 없이 `ws.close()` 호출하던 버그도 함께 수정

---
## v0.9 (2026-05-10)

### 통계/애널리틱스 대시보드

**백엔드**
- `GET /stats/summary?period=7d|30d|all` — 총 운행 건수, 거리, 평균 시간, 완료율, 상태 분포
- `GET /stats/by-driver?period=` — 기사별 집계 (총 운행, 완료, 총 거리, 평균 시간)
- `GET /stats/by-day?period=` — 일별 운행 건수 시계열
- 관리자 전용 권한(`require_admin`), 조직 격리 적용

**프론트엔드**
- `stats.html` 신규: Chart.js 4.x 기반 막대 차트(일별 추이) + 도넛 차트(상태 분포)
- 요약 카드 4종: 총 운행 / 총 거리 / 평균 시간 / 완료율
- 기간 필터 버튼(7일/30일/전체), 기사별 실적 테이블
- `dashboard.html` 좌측 하단 `📊 통계` 버튼 추가

---
## v0.8 (2026-05-10)

### 전체 기사 폴리라인 동시 표시 + 실시간 관제

**관리자 웹**
- `currentPolyline`(단일) → `driverPolylines{}`(기사별 Map)으로 구조 변경
- 대시보드 로드 시 운행 중 기사 전원의 경로선 자동 그리기
- 기사별 8색 고정 팔레트 — 폴리라인·위치 마커 색상 통일
- 기사 카드 클릭 시 해당 기사 폴리라인 강조(opacity 0.95), 나머지 dim(opacity 0.25)
- 노드 마커(🏗️📦☕🏴)는 선택된 기사만 표시

**버그 수정**
- `rest_stop` 노드의 `node_type` 기본값이 `"unloading"`으로 잘못 설정되던 문제 수정 → `"rest_stop"` 명시
- 기사 지정 도착지 좌표가 하차지 경유지와 일치 시 중복 노드 발생 버그 수정 (`_resolve_dest` 좌표 비교 후 pop)

---
## v0.7 (2026-05-09)

### 운행 생성 플로우 재설계 — 상차지/하차지 분리

**역할 재정의**
- 관리자: 상차지(loading) + 하차지(unloading) 경유지만 입력, 도착지 선택 사항
- 기사: `/optimize` 호출 시 출발지 직접 입력 or 미입력 시 Redis GPS 현재위치 자동 사용

**백엔드**
- `WaypointSchema.type` 추가: `"loading"` | `"unloading"` (기본 `"unloading"`)
- `trips.dest_name/dest_lat/dest_lon` → nullable=True (DDL + models.py)
- `OptimizeRequest.origin_*` → Optional (미입력 시 Redis `location:{user_id}` 폴백, 없으면 HTTP 400)
- `_resolve_dest()`: req.dest → t.dest → 마지막 unloading → 마지막 loading → HTTP 400, auto_idx 반환으로 중복 제거(B2 fix)
- `_apply_loading_precedence()`: 상차지 → 하차지 순서 강제 + 거리/시간 행렬 동기 재배열(B1 fix)
- `RouteNode.node_type` 추가: `"loading"` | `"unloading"` (RouteNode.type과 별개)
- `_trip_schema`에 `loading_count` / `unloading_count` 필드 추가
- `add_waypoint`: `req.model_dump()` 로 type 필드 포함(S1 fix)

**관리자 웹**
- 운행 생성 패널: 출발지·목적지 섹션 제거 → 상차지/하차지 섹션으로 교체
- 지도 노드 마커: 상차지 🏗️ 주황, 하차지 📦 파란색
- 기사 카드: `dest_name` 없을 때 `🏗️ 상차 N건 / 📦 하차 N건` 표시

---
## v0.6 (2026-05-06)

### 지도 POI 팝업 개선 + UX 최적화

**관리자 웹**
- 지도 클릭 팝업: 장소명·주소·전화번호·카테고리·카카오맵 링크 표시
- POI 조회: Places keywordSearch 2단계 폴백 추가
- Places API `place_name` 우선 사용 (`building_name` 덮어씌우기 제거)
- 지도 POI 호버 시 포인터 커서 전환 + 이중 캐시로 응답속도 최적화

---
## v0.5 (2026-05-05)

### 대시보드 UX 전면 개편 + GraphHopper 전환

**관리자 웹**
- 운행 생성 방식: 모달 폼 → 지도 직접 클릭(팝업 방식)으로 포인트 선택
- 운행 생성 패널 위치: 별도 모달 → 우측 기사 패널 내 인라인으로 이전
- 장소 검색 자동완성 + 드래그 정렬 + 노드 팝업 추가
- 지도 클릭 시 말풍선 팝업: 장소명 우선 표시, 없으면 주소

**백엔드**
- 라우팅 엔진 전환: 카카오 모빌리티 → GraphHopper (자체 호스팅)
- WS 조직 격리 버그 수정: 타 조직 기사 위치가 관리자에게 노출되던 문제 해결
- 원격 배차 패널 제거 → 지도 클릭 팝업에 긴급 경유지 추가 기능 통합
- `broadcast` → `broadcast_to_org` 누락 수정 (`PATCH /trips/{id}/waypoints`)

---
## v0.4 (2026-04-29)

### 관리자/기사 1:1 채팅

**백엔드**
- `conversations`, `messages` 테이블 추가
- 같은 조직의 `admin` ↔ `driver` 조합만 허용하는 채팅 권한 가드
- 대화방 목록/생성/조회, 메시지 히스토리, 메시지 전송, 읽음 처리 REST API
- `/ws/chat?token=` 사용자 단위 채팅 WebSocket

**프론트엔드**
- `dashboard.html` 기사 상세 패널에 채팅 UI 추가
- 기사 전용 `driver.html` 채팅 화면 추가
- 로그인 성공 후 `role === "driver"`는 `driver.html`로 이동

---
## v0.3 (2026-04-23)

### Oracle Cloud 서버 마이그레이션

**인프라**
- 서버 이전: Synology NAS (`swc.ddns.net`) → Oracle Cloud (`168.138.45.63`)
- 프로젝트 경로: `/volume1/docker/routeon/` → `/opt/routeon/`
- DB 포트: `5433` → `5432` (Oracle Cloud는 5432 미점유)
- GitHub 저장소 신규 생성: `github.com/dldjwls8/routeon`
- `.gitignore` / `.env.example` 추가

---
## v0.2.1 (2026-04-13)

### 신규 API 추가

- `GET /organizations/lookup?org_code=` — 조직코드로 기업명 조회 (v0.2에 통합)
- `GET /auth/check-username?username=` — 아이디 중복 확인 (v0.2에 통합)

---
## v0.2 (2026-04-13)

### 다중 기업(organizations) 구조 구현

**DB 변경**
- `organizations` 테이블 추가
  - id, name, org_code(unique), status(pending_review/approved/rejected)
  - doc_filename, doc_path — 사업자등록증 등 첨부파일
  - reject_reason, reviewed_at
- `users` 테이블 변경
  - `organization_id` 컬럼 추가 (FK → organizations)
  - `email` 컬럼 추가 (승인/반려 이메일 알림용)

**백엔드 신규 API**
- `POST /organizations` — 기업 등록 + 관리자 계정 동시 생성 (사업자서류 첨부 필수)
- `GET /organizations/me` — 내 기업 정보 + 조직코드 조회
- `POST /organizations/regen-code` — 조직코드 재발급
- `GET /organizations/lookup?org_code=` — 조직코드로 기업명 조회 (인증 불필요)
- `GET /auth/check-username` — 아이디 중복 확인 (인증 불필요)

**슈퍼 관리자 신규 API**
- `GET /superadmin/organizations` — 전체 기업 목록 + 상태 필터
- `GET /superadmin/organizations/{id}/doc` — 첨부 서류 다운로드
- `POST /superadmin/organizations/{id}/approve` — 기업 승인 + 이메일 알림
- `POST /superadmin/organizations/{id}/reject` — 기업 반려 + 사유 + 이메일 알림
- `POST /superadmin/create-account` — 계정 직접 생성

**백엔드 수정 API**
- `POST /auth/register` — 조직코드로 기업 확인 후 가입 (기사: pending, 관리자: admin)
- `POST /auth/approve/{id}` — 같은 기업 기사만 승인 가능
- `GET /users` — 같은 기업 유저만 조회
- `GET /trips` — 같은 기업 기사의 운행만 조회

**프론트엔드**
- `register.html` 전면 수정 — 기업명 + 사업자서류 업로드 포함
- `dashboard.html` 수정 — 조직코드 조회/복사/재발급 → 새 API 연동, 헤더에 기업명 표시
- `superadmin.html` 추가 — 슈퍼 관리자 기업 심사 화면

**버전 관리 시작**
- `CHANGELOG.md` 생성

---
## v0.1 (2026-04-08)

### 초기 구축

**인프라**
- Docker Compose 5컨테이너 구성 (backend, db, redis, frontend, code-server)
- Synology NAS 배포 (`swc.ddns.net`)
- Nginx 리버스 프록시 + WebSocket 프록시 설정

**백엔드 (FastAPI)**
- Python 3.12 + FastAPI 비동기 전환 (AsyncSession, asyncpg)
- JWT 인증 (회원가입/로그인)
- 좌표 필드명 `lon` 통일 (`lng` 제거)
- TMAP 코드 완전 제거 → 카카오 모빌리티 API 전환

**DB 스키마**
- `users` — UUID PK, role(admin/driver/pending), phone, license_number
- `vehicles` — 차량 마스터
- `rest_stops` — 휴게소/졸음쉼터 POI (253건 시드 완료)
- `trips` — 운행 단위 (waypoints, optimized_route JSONB)
- `deliveries` — 배송지 (trip_id 연결)
- `locations` — GPS 이력 (TimescaleDB hypertable)

**경로 최적화**
- OR-Tools TSP 경유지 순서 최적화
- 카카오 모빌리티 N×N 시간·거리 행렬 (TTL 캐시 1시간)
- `auto_detect_route_mode()` — 50km 기준 local/long_distance 자동 결정
- `insert_rest_stops()` — 6,000초 임계값 + `find_best_rest_stop()` picker
- `extra_stops` / `route_mode` / `dist_matrix` 지원

**구현된 API**
- `POST /auth/register` — 기사 가입 시 pending 처리
- `POST /auth/login`
- `GET/PATCH /auth/me`
- `POST /auth/approve/{id}` — 기사 승인
- `GET/POST /vehicles`
- `GET/POST /rest-stops`
- `GET/POST /trips`
- `GET /trips/{id}/polyline` — 실제 도로 경로선
- `PATCH /trips/{id}/waypoints` — 원격 배차
- `PATCH /trips/{id}/status` — 운행 완료/취소
- `POST /optimize` — 경로 최적화
- `POST /optimize/replan` — 재경로
- `POST/GET /location-logs` — GPS 수신 + 50m 자동 완료
- `WS /ws/location` — 실시간 위치 + replan_requested 브로드캐스트

**관리자 웹**
- `index.html` — 랜딩 페이지 (서비스 소개)
- `login.html` — 로그인
- `register.html` — 관리자 회원가입
- `dashboard.html` — 관리자 대시보드
  - 카카오맵 SDK autoload=false (URL에 키 노출 제거)
  - WebSocket 실시간 기사 위치 마커
  - 기사 카드: 운행 중/출발 대기/대기 중 상태 표시
  - 기사 클릭 시 실제 도로 경로선 + 노드 마커
  - 원격 배차 (경유지 추가 → 앱 replan 알림)
  - 운행 생성 모달
  - 기사 관리 모달 (승인 대기 / 승인된 기사)
  - 운행 완료/취소 버튼

**앱 연동 완료**
- `POST /location-logs` GPS 전송 (5초 주기)
- WS `replan_requested` 수신 → 자동 replan

---

## 예정 작업

### 진행 중 / 단기
- [ ] Android 앱: `/optimize` 호출 시 `dest_name/dest_lat/dest_lon` 파라미터 지원 (팀원 A)
- [x] 긴급 경유지 추가(`PATCH /trips/{id}/waypoints`) type=unloading 기본값 E2E 검증 — 정상 동작 확인
- [x] 상차지 인근 기사 확인 — `GET /nearby-drivers` 구현 완료
- [x] **ETA 실시간 추적** — GPS 핑 수신마다 남은 경유지 기준 예상 완료 시간 재계산 (출발 시각 고정 방식 → 현재 위치 기반 동적 갱신)
- [ ] **지도 클릭 비활성화** — 지도와 상호작용하는 모든 클릭 이벤트 제거 (`chore/disable-map-interaction` 브랜치)

### 기능 개발 백로그
- [x] **관리자 프리셋 기능** — 자주 쓰는 상차지/하차지 조합 저장·불러오기·삭제
- [x] **폴리라인 개선** — 기사별 단일 색상 + 지나온 구간 실시간 투명화
- [ ] **UI/UX 리팩토링** — 관리자 웹 전반 일관성 개선, 컴포넌트 정리
- [ ] **카카오 소셜 로그인** — 회원가입·로그인 시 카카오 OAuth 연동
- [ ] **카카오톡 알림** — 운행 배차·경유지 추가·완료 등 주요 이벤트 카카오톡 메시지 발송

### 마무리
- [ ] 발표 준비

