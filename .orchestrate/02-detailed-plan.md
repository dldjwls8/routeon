# 상세 구현 계획: drivers.html + vehicles.html 신규 생성 및 dashboard 모달 제거

## 1단계: 기사 관리 전용 페이지 생성

### 단계 목표
`frontend/drivers.html`을 새로 만들어 승인 대기 기사와 소속 기사 관리를 대시보드 모달 밖의 독립 페이지로 제공한다.

### 변경할 파일 목록과 작업

- `frontend/drivers.html` 신규 생성
  - `settings.html`의 독립 페이지 구조를 참고해 `<head>`, 인증 유틸, 카드형 섹션, 메시지 표시 영역을 포함한 HTML 문서를 작성한다.
  - 상단 헤더에 `← 대시보드로 돌아가기` 링크를 두고 `/dashboard.html`로 이동하게 한다.
  - `<script>` 상단에 `API = 'http://168.138.45.63:8000'`, `getToken()`, `authHeaders()`, `redirectToLogin()`을 둔다.
  - 토큰이 없으면 즉시 `/login.html`로 이동하는 1차 가드를 둔다.
  - 페이지 초기화 시 `GET /auth/me`를 호출해 `role === 'admin'`인지 확인하고, 관리자가 아니면 접근 차단 메시지를 표시한 뒤 `/dashboard.html` 또는 `/login.html`로 리다이렉트한다.
  - 승인 대기 섹션을 만든다.
    - `GET /users?role=pending`으로 목록을 조회한다.
    - 컬럼은 아이디, 전화번호, 조직코드, 관리 액션으로 구성한다.
    - 승인 버튼은 `POST /auth/approve/{id}` 호출 후 승인 대기 목록과 소속 기사 목록을 모두 갱신한다.
    - 거절 버튼은 `DELETE /users/{id}` 호출 후 승인 대기 목록을 갱신한다.
  - 소속 기사 섹션을 만든다.
    - `GET /users?role=driver`로 목록을 조회한다.
    - 컬럼은 아이디, 전화번호, 관리 액션으로 구성한다.
    - 탈퇴 버튼은 `DELETE /users/{id}` 호출 후 소속 기사 목록을 갱신한다.
  - 각 목록은 로딩, 비어 있음, 오류 상태를 테이블 행으로 표현한다.
  - 삭제/승인 같은 파괴적 또는 상태 변경 액션에는 `confirm()`을 사용한다.
  - `settings.html`과 유사한 카드형 레이아웃을 쓰되, 본문은 테이블 중심으로 구성한다.

### 새로 만들 함수/클래스의 시그니처

```js
function getToken()
function authHeaders()
function redirectToLogin()
async function initDriversPage()
async function loadCurrentUser()
function requireAdmin(user)
async function loadDriverManagementData()
async function loadPendingDrivers()
async function loadApprovedDrivers()
function renderPendingDrivers(users)
function renderApprovedDrivers(users)
async function approveDriver(userId)
async function rejectDriver(userId)
async function removeDriver(userId)
async function deleteUser(userId, successMessage)
function setTableLoading(tbodyId, colspan, message = '로딩 중...')
function setTableEmpty(tbodyId, colspan, message)
function showMessage(targetId, message, type = 'info')
async function parseErrorMessage(response, fallback)
function escapeHtml(value)
```

클래스는 새로 만들지 않는다.

### 의존성
이 단계는 다른 구현 단계에 의존하지 않는다. 다만 기존 백엔드 API `GET /auth/me`, `GET /users`, `POST /auth/approve/{id}`, `DELETE /users/{id}`가 현재 스펙대로 동작해야 한다.

### 단계 완료 검증 방법

- 수동 확인
  - 토큰 없이 `/drivers.html`에 접근하면 `/login.html`로 이동하는지 확인한다.
  - 관리자 토큰으로 접근하면 승인 대기와 소속 기사 섹션이 표시되고 콘솔 오류가 없는지 확인한다.
  - 기사 또는 권한 없는 계정 토큰으로 접근하면 관리자 전용 접근 차단 흐름이 동작하는지 확인한다.
  - 승인 대기 기사 승인 시 `POST /auth/approve/{id}`가 호출되고 승인 대기 목록에서 사라지며 소속 기사 목록에 반영되는지 확인한다.
  - 승인 대기 기사 거절 시 `DELETE /users/{id}`가 호출되고 목록에서 제거되는지 확인한다.
  - 소속 기사 탈퇴 시 `DELETE /users/{id}`가 호출되고 목록에서 제거되는지 확인한다.
- 테스트 명령어

```bash
grep -n "function initDriversPage\|async function approveDriver\|async function removeDriver" frontend/drivers.html
grep -n "users?role=pending\|users?role=driver\|auth/approve" frontend/drivers.html
```

## 2단계: 차량 관리 전용 페이지 생성

### 단계 목표
`frontend/vehicles.html`을 새로 만들어 차량 등록, 목록 조회, 삭제를 대시보드 모달 밖의 독립 페이지로 제공한다.

### 변경할 파일 목록과 작업

- `frontend/vehicles.html` 신규 생성
  - `settings.html`의 상단 헤더와 카드형 레이아웃을 참고해 독립 HTML 문서를 작성한다.
  - 상단 헤더에 `← 대시보드로 돌아가기` 링크를 두고 `/dashboard.html`로 이동하게 한다.
  - `drivers.html`과 동일한 관리자 인증 가드를 구현한다.
  - 차량 등록 폼을 만든다.
    - 필수 입력: 번호판 `plate_number`, 차종 `vehicle_type`, 총중량 `weight_kg`, 높이 `height_m`
    - 선택 입력: 길이 `length_cm`, 폭 `width_cm`
    - 필수 필드 누락, 숫자 필드가 숫자가 아닌 값, 0 이하 숫자는 프론트에서 먼저 차단한다.
    - 제출 시 `POST /vehicles`에 JSON 바디를 보낸다.
    - 성공 시 폼을 초기화하고 차량 목록을 즉시 갱신한다.
  - 등록된 차량 목록 섹션을 만든다.
    - `GET /vehicles`로 목록을 조회한다.
    - 컬럼은 번호판, 차종, 총중량, 높이, 길이, 폭, 관리 액션으로 구성한다.
    - 삭제 버튼은 `DELETE /vehicles/{id}` 호출 후 목록을 갱신한다.
  - 로딩, 비어 있음, 오류 상태를 테이블 행과 인라인 메시지로 표현한다.
  - 중복 제출 방지를 위해 등록/삭제 요청 중 관련 버튼을 비활성화한다.

### 새로 만들 함수/클래스의 시그니처

```js
function getToken()
function authHeaders()
function redirectToLogin()
async function initVehiclesPage()
async function loadCurrentUser()
function requireAdmin(user)
async function loadVehicles()
function renderVehicles(vehicles)
async function registerVehicle(event)
function buildVehiclePayload()
function validateVehiclePayload(payload)
async function deleteVehicle(vehicleId)
function resetVehicleForm()
function getInputValue(id)
function getOptionalNumber(id)
function setLoading(buttonOrId, isLoading)
function setTableLoading(tbodyId, colspan, message = '로딩 중...')
function setTableEmpty(tbodyId, colspan, message)
function showMessage(targetId, message, type = 'info')
async function parseErrorMessage(response, fallback)
function formatNumber(value, suffix = '')
function escapeHtml(value)
```

클래스는 새로 만들지 않는다.

### 의존성
이 단계는 1단계와 직접 의존하지 않지만, 인증 가드와 메시지/테이블 렌더링 방식은 1단계에서 확정한 패턴과 일관되게 맞춘다. 기존 백엔드 API `GET /vehicles`, `POST /vehicles`, `DELETE /vehicles/{id}`가 현재 스펙대로 동작해야 한다.

### 단계 완료 검증 방법

- 수동 확인
  - 토큰 없이 `/vehicles.html`에 접근하면 `/login.html`로 이동하는지 확인한다.
  - 관리자 토큰으로 접근하면 차량 등록 폼과 차량 목록이 표시되고 콘솔 오류가 없는지 확인한다.
  - 필수 필드 누락 시 `POST /vehicles` 호출 없이 오류 메시지가 표시되는지 확인한다.
  - 숫자 필드에 잘못된 값 또는 0 이하 값을 입력하면 제출이 차단되는지 확인한다.
  - 정상 등록 시 `POST /vehicles`가 호출되고 폼이 비워지며 목록이 갱신되는지 확인한다.
  - 차량 삭제 시 `DELETE /vehicles/{id}`가 호출되고 목록에서 제거되는지 확인한다.
- 테스트 명령어

```bash
grep -n "function initVehiclesPage\|async function registerVehicle\|async function deleteVehicle" frontend/vehicles.html
grep -n "GET /vehicles\|POST /vehicles" frontend/vehicles.html || true
grep -n "vehicles" frontend/vehicles.html
```

## 3단계: 대시보드 모달 제거, 페이지 이동 연결, 문서 갱신

### 단계 목표
`frontend/dashboard.html`의 기사·차량 관리 모달과 관련 JS를 제거하고 하단 버튼을 신규 페이지 이동으로 바꾼 뒤 문서에 새 페이지를 반영한다.

### 변경할 파일 목록과 작업

- `frontend/dashboard.html` 수정
  - 좌측 하단 버튼 클릭 동작을 변경한다.
    - `👥 기사 관리`: `openDriverModal()` 호출 제거 후 `location.href='/drivers.html'`로 이동
    - `🚗 차량 관리`: `openVehicleModal()` 호출 제거 후 `location.href='/vehicles.html'`로 이동
  - `#driver-modal` HTML 블록 전체를 제거한다.
  - `#vehicle-modal` HTML 블록 전체를 제거한다.
  - 모달 전용 CSS를 정리한다.
    - 제거 대상 후보: `.modal-overlay`, `.modal-content`, `.modal-header`, `.setting-group`
    - 테이블, `.btn-sm`, `.btn-warn` 등 다른 대시보드 UI에서 여전히 쓰는지 확인 후 미사용일 때만 제거한다.
  - 기사 관리 모달 함수들을 제거한다.
    - `openDriverModal()`
    - `approveDriver(userId)`
    - `closeDriverModal()`
  - 차량 관리 모달 함수들을 제거한다.
    - `openVehicleModal()`
    - `closeVehicleModal()`
    - `loadVehicles()`
    - `registerVehicle()`
    - `deleteVehicle(vehicleId)`
  - `kickDriver(id)`를 제거한다.
    - 이 함수 안의 마커 제거, 우측 패널 닫기, `loadDrivers()` 호출은 대시보드 모달 탈퇴 플로우에만 필요했던 부수 효과다.
    - 제거 후 `kickDriver(` 호출이 남아 있지 않은지 반드시 확인한다.
  - `loadDrivers()`는 대시보드 실시간 렌더링에 계속 필요하므로 건드리지 않는다.
  - `loadOrgName()`, `connectLocationWebSocket()`, `connectChatWebSocket()`, 지도/운행 관련 함수들은 이번 변경 범위 밖이므로 유지한다.

- `CLAUDE.md` 수정
  - `frontend/` 디렉터리 구조 설명에 다음 파일을 추가한다.
    - `drivers.html` 관리자 기사 관리 페이지
    - `vehicles.html` 관리자 차량 관리 페이지
  - `dashboard.html` 설명에서 기사/차량 관리 모달 표현이 남아 있으면 별도 페이지 이동 방식으로 갱신한다.

- `CHANGELOG.md` 수정
  - 최신 버전 섹션에 프론트엔드 변경 이력을 추가한다.
    - `drivers.html` 신규
    - `vehicles.html` 신규
    - `dashboard.html` 기사/차량 관리 모달 제거 및 하단 버튼 페이지 이동으로 변경
  - 기존 버전 순서가 날짜/버전 기준으로 혼재되어 있으므로 새 항목은 파일 상단의 최신 변경 영역에 추가하되, 기존 항목 재정렬은 하지 않는다.

### 새로 만들 함수/클래스의 시그니처

`frontend/dashboard.html`에는 새 함수나 클래스를 만들지 않는다. 버튼은 기존 하단 메뉴 패턴처럼 인라인 이동으로 처리한다.

```html
<button class="btn btn-setting" onclick="location.href='/drivers.html'">👥 기사 관리</button>
<button class="btn btn-setting" onclick="location.href='/vehicles.html'" style="background:#2980b9;">🚗 차량 관리</button>
```

문서 파일에는 함수나 클래스가 없다.

### 의존성
1단계와 2단계 완료에 의존한다. 대시보드에서 모달을 제거하기 전에 `/drivers.html`과 `/vehicles.html`이 관리자 인증, 목록 조회, 주요 액션을 수행할 수 있어야 한다.

### 단계 완료 검증 방법

- 수동 확인
  - `/dashboard.html` 하단 `👥 기사 관리` 버튼 클릭 시 `/drivers.html`로 이동하는지 확인한다.
  - `/dashboard.html` 하단 `🚗 차량 관리` 버튼 클릭 시 `/vehicles.html`로 이동하는지 확인한다.
  - 대시보드 최초 로드, 지도 표시, 기사 목록 렌더링, 기사 상세 패널, 실시간 위치 WS 연결에 콘솔 오류가 없는지 확인한다.
  - `drivers.html`과 `vehicles.html`의 상단 뒤로가기 링크로 `/dashboard.html`에 돌아올 수 있는지 확인한다.
- 정적 검증 명령어

```bash
grep -n "openDriverModal\|closeDriverModal\|approveDriver\|openVehicleModal\|closeVehicleModal\|loadVehicles\|registerVehicle\|deleteVehicle\|kickDriver" frontend/dashboard.html
grep -n "driver-modal\|vehicle-modal\|pending-list\|vehicle-list" frontend/dashboard.html
grep -n "drivers.html\|vehicles.html" frontend/dashboard.html CLAUDE.md CHANGELOG.md
```

첫 번째와 두 번째 명령은 결과가 없어야 한다. 세 번째 명령은 신규 페이지 링크와 문서 반영 위치를 보여야 한다.

## 위험 요소

- `dashboard.html`의 `kickDriver()`는 단순 삭제 API 래퍼가 아니라 선택 기사 패널 닫기와 마커 제거를 함께 수행한다. 함수 제거 후 참조가 남으면 즉시 런타임 오류가 나므로 `grep`으로 호출 잔존 여부를 확인해야 한다.
- 대시보드와 별도 페이지가 동시에 열린 경우, `drivers.html`에서 기사 탈퇴를 해도 열린 대시보드는 다음 `loadDrivers()` 또는 WS 이벤트 전까지 오래된 기사 상태를 잠시 보여줄 수 있다. 이번 범위에서는 이를 허용한다.
- `DELETE /users/{id}`는 pending 거절과 driver 탈퇴를 같은 API로 처리한다. 잘못된 목록의 id가 전달되지 않도록 버튼 렌더링 함수와 확인 문구를 분리해야 한다.
- `GET /auth/me`의 `role` 응답이 enum 문자열로 내려오는지 확인이 필요하다. 현재 코드상 `UserRole` enum이 직렬화되지만 기존 프론트 흐름은 문자열 비교를 가정한다.
- 차량 API는 현재 전체 활성 차량을 조회하며 조직별 필터가 없다. 기존 API 변경은 범위 밖이므로 페이지 분리 후에도 같은 동작을 유지한다.
- `Vehicle.id`가 숫자라고 가정해도 DOM 인라인 핸들러에서 따옴표 없이 전달하면 안전하지만, 향후 UUID로 바뀌면 깨질 수 있다. 신규 페이지에서는 문자열 전달 방식으로 작성하면 변화에 더 강하다.
- 모달 CSS 제거 시 `table`, `.btn-sm` 같은 공용 스타일을 함께 제거하면 대시보드의 다른 표 또는 버튼이 영향을 받을 수 있다. 실제 사용처를 확인한 뒤 모달 전용 스타일만 제거해야 한다.
- 신규 페이지가 정적 HTML이므로 프론트엔드 Nginx 설정에서 파일 직접 접근이 가능해야 한다. 기존 `settings.html`, `stats.html`와 같은 배포 방식이면 문제없다.
- 문서 갱신 단계에서 `CLAUDE.md`와 `CHANGELOG.md`의 기존 내용 순서를 과도하게 정리하면 불필요한 변경이 커진다. 새 페이지 설명과 변경 이력만 최소 범위로 추가해야 한다.
