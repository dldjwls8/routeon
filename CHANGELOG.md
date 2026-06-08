# RouteOn Changelog

버전 관리 규칙:
- `0.x` — 개발 중 (기능 추가/수정 활발)
- `1.0` — 첫 안정 릴리즈 (발표 버전)

---

## v1.0.124 (2026-06-08)
### 오더목록 상태 변경·배차대기 제거·알림 분리·중복 연결 필터링·톤수 검증 보강
- **배경**: 오더목록에서 상태를 변경할 수 없어 별도 작업이 필요했고, DB에 실제 없는 가짜 "배차대기" 상태가 UI에 남아 있어 혼란을 야기. 배차 취소 요청이 채팅 메시지와 섞여 알림 구분이 어려웠으며, 차량·기사 상세에서 이미 연결된 상대가 목록에 남아 중복 배정 우려가 있었음. 단건 배차(`assign_delivery`)에서는 톤수 초과 검증이 누락되어 일괄 배차와 보호 수준이 달랐음
- **오더목록 상태 변경 UI 추가**: `OrderListView.vue` 우측 상세 패널에 `<select>` 상태 드롭다운 추가. 허용 전이는 `statusOptions(status)`로 관리 — `pending` → `pending/in_progress/cancelled`, `in_progress` → `in_progress/done/done_manual/cancelled`. 저장 시 `status`가 변경되었을 때만 서버에 전송
- **배차대기(fake status) 완전 제거**: `constants.js`의 `ORDER_STATUS_MAP`에서 `assigned: '배차'` 제거. 대신 `deliveryDisplayStatus(order)` 헬퍼 추가 — `pending`이면서 `driver_id`가 있으면 표시값을 "배차"로, 없으면 "접수"로 반환. 실제 DB `DeliveryStatus`는 `pending` 하나만 유지. `OrderListView.vue` 상태 칩 목록에서 "배차대기" 제거, 필터 로직도 `deliveryDisplayStatus(o)` 기준으로 단순화
- **배차 취소요청 알림 분리**: `DashboardLayout.vue`에 `/ws/location` 연결(`connectLocationSocket`)을 추가해 `trip.cancel_requested` 이벤트를 별도 `locationAlerts` 배열로 관리. 상단 메시지 버튼(💬) 뱃지는 채팅 unread만 카운트하고, 알림 버튼(🔔) 뱃지는 취소 요청 건수만 표시 — 기존에 채팅 메시지가 알림 드롭다운에 섞이던 문제 해결
- **차량 상세 — 이미 연결된 기사 목록에서 제외**: `VehiclesView.vue`에 `vehicleEditMode`, `editDriverId`, `drivers` 목록 추가. `availableDrivers` computed는 현재 차량의 `driver_id` 외에도 `assignedDriverIds(Set)`에 포함된 기사를 제외해 이미 다른 차량에 연결된 기사가 목록에 남지 않도록 필터링. 저장 시 `patchVehicle()`로 `driver_id` 업데이트
- **기사 상세 — 이미 배정된 차량 목록에서 제외**: `DriversView.vue`에 `driverEditMode`, `editVehicleId`, `vehicles` 목록 추가. `availableVehicles` computed는 현재 기사의 `vehicle_id` 외에도 `assignedVehicleIds(Set)`에 포함된 차량을 제외. 저장 시 `patchDriver()`로 `vehicle_id` 업데이트
- **기사·차량 API 응답 보강**: `auth.py` `get_users()`에서 기사 목록 응답에 `vehicle_name`을 포함하도록 Vehicle 이름을 별도 조회해 매핑. `driverService.js`는 `/users?role=driver`로 호출하고 `patchDriver`는 `/users/{id}`로 수정. `vehicleService.js`에 `patchVehicle(id, body)` 추가
- **단건 배차 톤수 검증 추가**: `deliveries.py` `assign_delivery()`에서 배정 대상 기사가 `vehicle_id`를 가지고 있으면, 해당 차량을 조회한 뒤 `cargo_weight_ton`/`cargo_size`를 담은 임시 waypoint로 `validate_vehicle_capacity_for_waypoints()`를 호출. 일괄 자동배차(`/trips/auto-dispatch`)와 동일한 보호 수준 적용
- **Vue 프로젝트 기본 구조 보강**: `frontend-vue/.env.example`, `.gitignore`, `jsconfig.json`, `README.md`, `stores/index.js` 등 누락된 SPA 기반 파일 추가. `OrderIntakeView.vue`에 전화번호 컴포넌트 적용
- **DB 변경 없음**: 테이블·컬럼·ENUM 추가 없음. `deliveries.status`는 기존 `pending`을 그대로 사용하며 표시값 분리만 프론트에서 처리
- **검증**: `npm run build`(Vue) 성공, 백엔드 AST 구문 검사 통과, `git status`로 변경 파일 16건 확인

---

## v1.0.123 (2026-06-08)
### deliveries 테이블 불필요 컬럼 제거 — 담당자·수신자·희망도착
- **배경**: `contact_name`(담당자), `recipient_name`(수신자/하차수취인), `deadline`(희망도착일시) 필드를 실제 업무 흐름에서 사용하지 않기로 결정. 고객관리의 담당자(`customers.contact`)는 v1.0.116에서 이미 제거되었으며, 배송 단위의 `contact_name`/`recipient_name`/`deadline`도 이번에 일괄 정리
- **DB — `deliveries` 테이블 3컬럼 제거**: `contact_name`(`VARCHAR(100)`), `recipient_name`(`VARCHAR(100)`), `deadline`(`DATETIME`). `backend/database.py` `init_db()`에 `ALTER TABLE ... DROP COLUMN IF EXISTS` 3건 추가해 기존 DB 자동 정리
- **백엔드 API**: `DeliveryCreate`·`DeliveryUpdate`에서 `contact_name`/`recipient_name`/`deadline` 필드 제거. `routers/deliveries.py`의 `_DELIVERY_EVENT_FIELDS` 및 `create_delivery`/`create_deliveries_batch`/`update_delivery`/`_delivery_schema` 전부 정리. `_delivery_schema` 응답에서도 동일 필드 제거
- **백엔드 연동**: `routers/dispatch.py` waypoint dict, `schemas.py` `WaypointSchema`, `serializers/trip.py` `destination_waypoint`/`apply_delivery_to_waypoint`에서 `contact_name`/`recipient_name` 제거
- **Vue 프론트엔드**: `OrderIntakeView.vue` 단건 폼에서 `recipient_name`/`deadline` 제거, 엑셀 미리보기 테이블에서 `담당자`/`하차수취인`/`희망도착` 컬럼 제거. `src/utils/deliveryBatch.js`에서 `contact_name`/`recipient_name`/`deadline` 제거. `src/utils/excelParser.js`에서 `contact_name`/`recipient`/`latestAt`(희망도착) 파싱 제거 및 `generateIntakeTemplate()` 양식에서 동일 컬럼 제거
- **레거시 프론트엔드**: `frontend/dashboard.js` 및 `frontend-vue/public/dashboard.js`에서 `contact_name`/`recipient_name`/`deadline` 관련 파싱·매핑·UI·양식 컬럼 전부 제거
- **문서 정리**: `DB_SCHEMA.md` deliveries 테이블 컬럼 목록 및 waypoints JSONB 설명에서 해당 필드 제거, 엑셀 양식 설명 갱신. `CLAUDE.md` `WaypointSchema` 예시 및 설명에서 해당 필드 제거
- **검증**: `npm run build`(Vue) 성공, `node --check frontend/dashboard.js` 성공, 백엔드 컨테이너 재시작 및 `/deliveries`·`/deliveries/batch` API smoke 통과

---

## v1.0.122 (2026-06-08)
### 상차·하차 화물 정보 분리 및 Vue 엑셀 일괄 접수 구현
- **배경**: 기존 `deliveries` 테이블은 상차지·하차지 주소는 분리되어 있었으나, 화물 정보(`cargo_type`, `cargo_size`, `cargo_weight_ton`)는 하차 화물 단일 컬럼만 존재해 엑셀 양식의 `상차화물`/`상차규격`/`상차중량(톤)`과 `하차화물`/`하차규격`/`하차중량(톤)`을 별도 저장할 수 없었음
- **DB — `deliveries` 테이블 상차 화물 컬럼 3개 추가**: `pickup_cargo_type`(`VARCHAR(100)`), `pickup_cargo_size`(`VARCHAR(100)`), `pickup_cargo_weight_ton`(`FLOAT`). 기존 `cargo_type`/`cargo_size`/`cargo_weight_ton`은 하차 화물 정보로 명확화. `backend/database.py` `init_db()`에 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 3건 추가해 기존 DB 자동 보강
- **백엔드 API**: `DeliveryCreate`·`DeliveryUpdate`에 `pickup_cargo_type`/`pickup_cargo_size`/`pickup_cargo_weight_ton` 필드 추가. `routers/deliveries.py`의 `_DELIVERY_EVENT_FIELDS` 및 `create_delivery`/`create_deliveries_batch`/`update_delivery`/`_delivery_schema` 전부 신규 필드 반영
- **Vue 프론트엔드 — 오더접수 엑셀 일괄 업로드 신규 구현**:
  - `frontend-vue/package.json`에 SheetJS(`xlsx@^0.18.5`) 의존성 추가
  - `src/utils/phone.js`: 연락처 정규화(`normalizePhone`) 레거시 포팅
  - `src/utils/excelParser.js`: 엑셀 날짜·불리언 파싱 + `rowsFromExcelOrder(rawRow)`(상차·하차 화물 분리 파싱) + `generateIntakeTemplate()`(양식 생성)
  - `src/utils/deliveryBatch.js`: `toDeliveryBatchPayload(rows)` — 파싱 결과를 `POST /deliveries/batch` 페이로드로 변환. `pickup_cargo_type`/`pickup_cargo_size`/`pickup_cargo_weight_ton` 포함
  - `src/services/deliveryService.js`: `createDeliveriesBatch(body)` 추가
  - `src/views/OrderIntakeView.vue`: 단건 접수 탭 + 엑셀 일괄 접수 탭 구성. 파일 `<input>`에서 SheetJS로 파싱 → `/address/coord` 좌표 변환 → 미리보기 테이블(상차화물/상차규격/상차중량, 하차화물/하차규격/하차중량 컬럼) → `양식 다운로드`·`일괄 저장` 버튼 제공
- **레거시 프론트엔드 — 엑셀 양식·파싱 개선**:
  - `downloadIntakeExcelTemplate()`: `담당자` 컬럼 추가, `중량(톤)` 제거하고 `상차중량(톤)N`/`하차중량(톤)N`으로 교체
  - `rowsFromExcelOrder()`: 상차 화물(`pickup_cargo_type`/`pickup_cargo_size`/`pickup_cargo_weight_ton`)과 하차 화물(`cargo_type`/`cargo_size`/`cargo_weight_ton`)을 별도 파싱. 다중 헤더 에일리어스(`상차중량(톤)1`, `상차중량1`, `pickupweightton1`, `pickupweight1` 등) 지원
  - `commitPendingRowsToOrders()`: `pickup_cargo_*` 필드를 `POST /deliveries/batch` 페이로드에 포함
  - `contact_name` 버그 수정: 기존 파싱에서 `contact_name`이 연락처 값을 잘못 매핑하던 문제를 `contact_name`/`contact_phone`을 각각 정확히 분리해 파싱하도록 수정
- **시연용 데모 데이터**: `backend/seeds/seed_demo.py`(기업 `DEMO001`, 부관리자·기사 10명·차량 10대·고객 10명) 및 `seed_demo_coords.py`(기사/차량 랜덤 GPS 좌표, TimescaleDB `locations` + `vehicles.last_lat/last_lon`) 추가. 모든 계정 비밀번호 `Pass1234!`
- **시연용 엑셀 파일**: `/tmp/routeon_demo_orders.xlsx` 생성 — 10건의 상차·하차 화물 정보를 각각 다르게 구성(예: 상차 식품/5톤/5.0, 하차 식품/2톤/2.0). `혼재여부` 컬럼 없음(시연 미대상)
- **검증**: `npm run build`(Vue) 성공, `node --check frontend/dashboard.js` 성공, 백엔드 컨테이너 재시작 및 `/deliveries`·`/deliveries/batch` API smoke 통과, 엑셀 업로드·미리보기·일괄 저장 E2E 확인

---

## v1.0.121 (2026-06-07)
### Vue 대시보드 실시간 메시지·알림 드롭다운 구현
- **`useChatSocket.js` composable 추가**: 채팅 WebSocket 연결 + 대화 목록 + unread 카운트를 전역 reactive 상태로 관리. `DashboardLayout`과 `ChatView`가 공유
- **`DashboardLayout.vue` 메시지/알림 UI reactive 전환**
  - 상단 메시지 버튼(💬)과 알림 버튼(🔔)에 `totalUnread` 기반 뱃지 dot 표시
  - 알림 버튼 클릭 시 미확인 메시지 목록 드롭다운 표시 — 파트너별 unread 수량 + 클릭 시 `/chat` 이동
  - legacy `dashboard.js` DOM ID 충돌 방지를 위해 Vue 관련 요소에서 `id` 속성 제거/변경
  - `onMounted` 시 WebSocket 연결 + 대화 목록 로드, `onUnmounted` 시 연결 종료
- **`ChatView.vue` 공유 상태 연동**: `useChatSocket`의 `setChatPageActive(true/false)` 플래그 설정. 채팅 페이지 활성 중에는 unread 뱃지가 증가하지 않도록 처리
- **백엔드 변경 없음**: 기존 `/ws/chat`, `/chat/conversations` API 및 `ChatConnectionManager` 그대로 활용
- **fix (4482fff)**: `DashboardLayout.vue` DOM ID 복원 — `messageBtn`, `notifBtn`, `messageBadge`, `notifBadge`, `notifDropdown` ID를 복원하여 legacy `dashboard.js`의 null 참조 에러 방지. Vue `watch`로 `chat.totalUnread`를 legacy DOM badge에 직접 동기화. 상단 탭/지Map/데이터 초기화 중단 문제 해결

---

## v1.0.120 (2026-06-07)
### 프론트엔드 결합도 낮추기 — bridge·services·composables 도입
- **`main.js` 레거시 브리지 분리**: `routeMap`, `window._onRouteOnGotoPage`, `router.beforeEach` 브리지 로직을 `src/bridge/legacy-router.js`로 추출. `main.js`는 순수 앱 초기화만 담당
- **도메인 서비스 레이어 도입** (`src/services/`): 8개 서비스 모듈 생성
  - `deliveryService.js`, `driverService.js`, `vehicleService.js`, `customerService.js`, `tripService.js`, `statisticsService.js`, `userService.js`, `staffService.js`
  - 각 뷰의 직접 `apiGet`/`apiPost`/`apiPatch`/`apiDelete` 호출을 서비스 함수로 대체
- **composables 분리** (`src/composables/`)
  - `useApi.js`: API 호출의 `loading`/`error` 상태를 관리하는 공통 composable
  - `useListPage.js`: 목록 화면의 페이지네이션/검색/필터 상태 관리
- **12개 뷰 리팩토링**: `DashboardView`, `ControlLiveView`, `OrderListView`, `OrderIntakeView`, `DispatchManageView`, `CustomerListView`, `DriversView`, `VehiclesView`, `ProfileView`, `ScheduleCalendarView`, `StaffView`, `TripStatsView`의 import와 API 호출을 서비스 레이어 기반으로 교체
- **DB 변경 없음**: 프론트엔드 아키텍처 리팩토링만 해당

## v1.0.119 (2026-06-07)
### CLAUDE.md 디렉터리 구조 정확화
- **`frontend/` 레거시 간략화**: 기존 15줄로 상세히 나열되던 `frontend/` 디렉터리 구조를 4줄로 축약하고 "레거시 관리자 웹 (Vue 마이그레이션 전 정적 HTML, 유지보수 모드)"임을 명시
- **`frontend-vue/` 실제 파일 목록 반영**: `...`로 축약되어 있던 `frontend-vue/src/` 하위를 실제 파일 목록으로 전면 교체
  - 누락되었던 `src/api/client.js`, `src/components/PageChrome.vue`, `src/constants.js`, `src/assets/dashboard.css` 추가
  - `src/views/` 하위 20개 뷰 전체 나열 — `ControlLiveView.vue`, `DashboardView.vue`, `DispatchManageView.vue`, `OrderIntakeView.vue`, `OrderListView.vue`, `CustomerListView.vue`, `DriversView.vue`, `VehiclesView.vue`, `StaffView.vue`, `ScheduleCalendarView.vue`, `ScheduleGanttView.vue`, `ScheduleMilestonesView.vue`, `TripStatsView.vue`, `ProfileView.vue` 등
  - `public/` 하위 레거시 HTML 파일들도 `*.html`로 묶어 표시
- **DB 변경 없음**: 문서 수정만 해당, 백엔드·DB·프론트엔드 코드 변경 없음

## v1.0.118 (2026-06-07)
### 운행관제 탭 실시간 폴리라인 기능 구현
- **배경**: 기존 지도중심 웹 관제에서 차량별 운행 경로를 폴리라인으로 표시하는 기능이 있었으나, Vue 3 마이그레이션 후 운행관제(`control-live`) 탭에서는 폴리라인이 구현되지 않아 차량 클릭 시 단순히 지도 중심만 이동했음. 실시간 GPS 수신에 따라 "지나간 길"과 "남은 길"을 구분해 시각적으로 표시할 필요가 있었음
- **`/trips/{tripId}/polyline` API 연동**: 기존 `showTripRoutePolyline` 함수를 재사용해 운행관제 전용 폴리라인(`loadAndShowControlPolyline`)을 구현. `/trips/{tripId}/polyline` 응답의 `polyline` 좌표 배열과 `nodes`(시작/도착/경유지)를 모두 활용
- **지나간 경로·남은 경로 투명도 구분**: 전체 경로는 `strokeOpacity: 0.25`로 흐릿하게 배경처럼 표시하고, 현재 차량 위치에서 가장 가까운 폴리라인 지점(`findClosestPolylineIndex`)부터 도착지까지의 남은 구간은 `strokeOpacity: 0.9`로 선명하게 표시. 이를 위해 `_controlRoutePolyline`(전체·흐림)과 `_controlActivePolyline`(남은 구간·선명) 두 개의 폴리라인 객체를 동시에 관리
- **실시간 GPS 반영**: WebSocket 위치 메시지(`connectLocationWebSocket`의 `ws.onmessage`) 수신 시, 선택된 차량(`selectedControlVehicleId`)이라면 `updateControlActivePolyline(lat, lon)`을 호출해 남은 경로를 실시간으로 재계산·재표시. 차량이 이동함에 따라 선명한 폴리라인이 점점 짧아지는 효과
- **시작·도착·경유지 핀 표시**: `nodes` 데이터의 `type`(origin, destination, waypoint, rest_stop)에 따라 이모지 아이콘(`🏁`, `🏴`, `📦`, `☕`)을 가진 `kakao.maps.CustomOverlay`를 지도에 표시
- **페이지 전환 시 cleanup**: `control-live` 탭에서 벗어나면(`gotoPage`) `clearControlPolyline()`으로 폴리라인과 노드 오버레이를 모두 제거. 다른 차량을 선택해도 이전 폴리라인은 자동 정리
- **DB 변경 없음**: 프론트엔드 `dashboard.js`의 지도·WebSocket 로직만 수정, 백엔드 API나 DB 스키마 변경 없음
- **검증**: `npm run build`로 Vue 프로젝트 빌드 성공, `node --check`로 레거시 `dashboard.js` 구문 검사 통과

## v1.0.117 (2026-06-07)
### 고객관리 담당자 필드 제거 후속 · 관리자 웹 Vue 3 마이그레이션 및 레이아웃 버그 수정
- **DATA.customers 매핑에서 남아 있던 `contact` 참조 제거 (v1.0.116 후속)**: `frontend/dashboard.js`의 `DATA.customers` 초기화(`customers.map`)와 임시 화주 등록 로컬 fallback에서 `contact` 필드를 남겨 두고 있어, `contact`가 `undefined`로 노출되거나 콘솔 경고가 발생했음. `contact: c.contact || ''`, `contact: saved.contact || name`, `contact: name` 할당 전부 제거해 v1.0.116의 고객관리 담당자 필드 제거를 완전하게 마무리
- **관리자 웹 Vue 3 + Vite SPA 마이그레이션 (`frontend-vue/` 신설)**: 기존 바닐라 JS/HTML 관리자 웹(`frontend/`)을 Vue 3 Composition API + Vue Router + Vite 기반 SPA로 마이그레이션. `frontend-vue/` 디렉토리에 Vue 컴포넌트, 라우터, 레이아웃, 뷰를 구성하고, 기존 6,989줄의 `dashboard.js`는 `public/dashboard.js`로 그대로 보존해 레거시 로직을 재사용
  - `DashboardLayout.vue`: 대시보드 쉘(탑바, 네비게이션, 메인 콘텐츠, 푸터, 모달/토스트/맵 컨테이너)을 Vue 컴포넌트로 구성. `onMounted`에서 `theme-dashboard` body 클래스를 추가하고 `window.RouteOnInit()`를 1회 호출해 레거시 초기화가 실행되도록 연결
  - `App.vue`: `route.meta.main`에 따라 `DashboardLayout`으로 `router-view`를 감싸 대시보드 탭과 비대시보드 페이지(랜딩, 로그인, 회원가입, 설정, 채팅)를 구분
  - `main.js`: Vue Router와 레거시 `gotoPage()`를 양방향 동기화. `window._onRouteOnGotoPage`가 Vue Router path로 `router.push`, `router.beforeEach`가 레거시 `window.RouteOnGotoPage(main, page)`를 호출해 URL 쿼리 파라미터(`?main=&page=`)와 Vue Router path를 동시에 유지
  - 페이지 뷰: `IndexView.vue`, `LoginView.vue`, `RegisterView.vue`, `SettingsView.vue`, `ChatView.vue`, `IntroView.vue` — 기존 HTML의 전역 `<style>` 규칙(`:root`, `html[data-theme]`, `body`)을 그대로 복제하기 위해 `<style>`(scoped 아님) 사용
- **대시보드 및 기본정보 탭 레이아웃 버그 수정 (Vue 마이그레이션 후속)**: Vue 마이그레이션 후 `#app`의 직계 자신이 `.app-shell`이 되어 기존 CSS `#app.app-shell` 선택자가 적용되지 않아 flex container가 무너지고 footer가 중간에 뜨는 문제 수정
  - `frontend-vue/src/assets/dashboard.css`: `#app.app-shell` → `.app-shell`로 변경해 Vue의 `DashboardLayout` 루트가 `display: flex; flex-direction: column; min-height: 100vh`를 상속받도록 수정
  - `body.theme-dashboard .dash-layout`에 `height: 100%; align-items: stretch` 추가, `.dash-right`를 flex column으로 만들고 `.dash-orders-card`에 `flex: 1`을 적용해 대시보드가 viewport를 채우고 내부 스크롤로 동작하도록 수정
  - 오더목록(`order-list-viewport`), 배차관리(`dispatch-viewport`), 오더접수(`order-intake-viewport`)는 기존 viewport 고정 유지. 추가로 사후통계(`trip-stats`), 캘린더(`schedule-calendar`), 마일스톤(`schedule-milestones`), 기업정보(`profile`) 페이지에 `page-scroll-body` 클래스를 부여해 이들만 body 전체 스크롤을 유지하도록 수정(오더목록·캘린더·마일스톤·사후통계·기업정보 제외 요청 반영)
  - `frontend-vue/public/dashboard.js`: `applyPageTheme()`에 `page-scroll-body` 추가/제거 로직 삽입. `renderDashboard()`를 `page-sticky-top` + `page-body-fill` 구조로 감싸 운행관제와 동일한 viewport fill 패턴 적용
- **DB 변경 없음**: `frontend/dashboard.js` 데이터 매핑 정리 및 `frontend-vue/` UI 마이그레이션·레이아웃 수정만 진행
- **검증**: `npm run build`로 Vue 프로젝트 빌드 성공, `node --check`로 레거시 `dashboard.js` 구문 검사 통과

## v1.0.116 (2026-06-07)
### 고객관리 담당자 필드 전면 제거
- **배경**: 고객(`customers`) 테이블의 `contact` 컬럼은 "담당자명"을 저장했으나, 실제 업무 흐름에서 고객 단위 담당자를 관리하지 않고 배송(delivery) 단위의 `contact_name`/`contact_phone`을 사용함. 고객관리 화면에서 담당자 입력란이 불필요하게 남아 있어 팀원 혼란을 야기
- **DB**: `backend/database.py` `init_db()`에 `ALTER TABLE customers DROP COLUMN IF EXISTS contact;` 추가. 기존 데이터는 삭제되며 `contact_name`/`contact_phone`은 배송 테이블에 그대로 유지
- **백엔드 API**: `backend/models.py` `Customer.contact` 제거. `backend/routers/customers.py`에서 `CustomerCreate`·`CustomerUpdate`·`_schema()`·`create_customer()`·`update_customer()`의 `contact` 필드·할당·응답 전부 제거
- **프론트엔드**: `frontend/dashboard.js`에서 고객 상세 "담당자" 입력란/안내 문구 제거, 고객 목록 테이블 "담당자" 컬럼 제거(colspan 5→4), 검색 placeholder "고객명·담당자" → "고객명·연락처·주소", 검색 필터에서 `c.contact` 제거, 고객 선택 시 자동 채우기 로직(`customerContactFromIntakeValue`, change 이벤트)에서 `c.contact` 참조 제거
- **검증**: `node --check` 구문 검사, 백엔드 AST 문법 검사 통과

## v1.0.115 (2026-06-07)
### 경로 최적화 휴게소 삽입 알고리즘 — 경로에서 먼 휴게소가 선택돼 우회·과다 삽입되는 버그 수정
- **원인**: `/optimize`·`/optimize/replan`이 `insert_rest_stops`에 넘기는 휴게소 후보를 DB의 활성 `highway_rest` 전체(전국 약 75곳)로 그대로 사용하고 있었음. 후보 선택(`_pick_by_type`)은 "마지막 지점→후보" GH 실측 이동 시간이 약 70~120분 범위인지, 그리고 후보가 속한 고속도로의 전체 진행 방향(`"OO기점+OO종점"` 파싱 또는 이름의 괄호 도시명)이 진행 방위각과 ±90° 이내인지만 검사해 — "후보가 실제 경로 선상에 있는지"는 전혀 검증하지 않았음. 그 결과 평행한 다른 고속도로 위의 휴게소도 시간·방향 조건을 우연히 만족하면 선택되어 차량이 본 경로에서 한참 벗어나는 우회가 발생했고("빙 돌아가서"), 우회 지점에서 다음 지점까지 다시 측정한 `remaining_after`가 기대만큼 줄지 않아 `while` 루프가 계속 반복 — 같은 전국 후보 풀에서 휴게소를 계속 추가로 삽입(수십 개)하는 문제로 이어졌음
- **수정**: GraphHopper 전환 시 추가됐지만 어디서도 호출되지 않던 `gh_svc.filter_rest_by_route(candidates, polyline, max_km=15.0)`(폴리라인 샘플 지점 기준 15km 이내 후보만 통과)를 `optimize`·`replan`에 연결. TSP 정렬 직후 `gh_svc.get_route_geometry(ordered_nodes)`로 실제 경로 폴리라인을 1회 조회해 DB 조회 휴게소 후보를 경로 주변으로 좁힌 뒤 `insert_rest_stops`에 전달(기사가 직접 지정한 `preferred_rest`는 필터 대상에서 제외). 폴리라인 조회 실패 시에는 기존처럼 전체 후보를 사용(예외 무시)해 기능 저하 없이 동작
- **DB 변경 없음**: 백엔드 `routers/optimize.py`만 수정 (기존에 작성돼 있던 `services/graphhopper.py`의 `filter_rest_by_route` 연결)
- **검증**: 컨테이너 내에서 서울→부산(약 4시간 38분) 경로로 수정 전/후 비교 — 수정 전엔 휴게소 5곳이 삽입되고 그중 "광양항 황금"(전남 광양)·"부안고려청자"(전북 부안)·"문의청남대"(영덕 방향) 등 경부선과 무관한 호남·영남 다른 방향 휴게소가 섞여 우회를 유발했으나, 수정 후엔 경부선 상의 "충주(창원)"·"칠곡(부산)" 2곳만 삽입돼 정상적인 경로로 동작함을 직접 확인. 전국 75곳 후보가 경로 15km 이내 18곳으로 정상적으로 좁혀짐을 `filter_rest_by_route` 단독 호출로도 확인

## v1.0.114 (2026-06-07)
### 차량·담당자·배차관리 UI/UX 통일 및 footer·대시보드 스크롤 버그 수정
- **차량 상세 "마지막 GPS" 필드 UI/UX 통일**: `vehicleLastGpsDetailHtml`이 배지·다단 레이아웃을 가진 별도 `<div>` 마크업을 사용해 톤급·차종 등 다른 필드와 모양이 달랐던 문제를 수정. `<label>마지막 GPS</label><span>좌표 · 갱신 시각</span>` 한 줄 구조로 바꿔 다른 `form-grid` 필드와 동일하게 표시
- **담당자 상세 비활성 필드 시각 표시 수정**: `staffDetailBodyHtml`의 이름·아이디·관리 등급·연락처·가입일 입력란이 `readonly`라 클릭 가능한 입력처럼 보였던 문제를 수정. `disabled`로 바꿔 고객·기사·차량 상세와 동일한 `.inline-detail-bd input:disabled` 흐림 스타일(`opacity:.55; cursor:not-allowed`)로 비활성 상태를 표시
- **차량·담당자·기업정보·고객관리·간트 등 탭의 footer 길이 불일치 버그 수정**: `theme-app` 페이지의 `.content`가 `min-height: calc(100vh - 76px - 92px)` 매직 넘버 기반 최소 높이를 사용해, 콘텐츠가 짧은 화면에서 실제 footer 높이(43px)와 맞지 않는 약 49px의 빈 공간이 footer 아래에 남는 문제가 있었음. `.content`를 표준 sticky-footer flex 패턴(`flex: 1 1 auto; min-height: 0`)으로 바꿔 모든 탭에서 footer가 화면 하단에 밀착하도록 통일
- **대시보드 화면 비율 변경 시 콘텐츠가 잘리는 버그 수정**: `body.theme-dashboard .dash-layout`이 `overflow: hidden`이라, 좁고 긴 화면 비율(예: 1100px 미만 → 1열 레이아웃)에서 좌/우 컬럼이 세로로 쌓여 영역 전체 높이를 넘으면 하단 내용(오더 표, footer 등)이 그대로 잘려 보이지 않는 문제가 있었음. `overflow-y: auto; overflow-x: hidden`으로 바꿔 컬럼이 쌓여 넘치는 화면 비율에서도 대시보드 영역 내부가 스크롤되도록 수정
- **배차관리 "기사·차량 선택" 카드 UI/UX 통일 및 배차 실행 바 위치 변경**: "기사·차량 선택" 카드(`bulkDriverCardsHtml`)가 카드형 그리드 레이아웃(굵은 패딩·다른 컬럼 비율)을 사용해 "미배정 오더" 카드의 `<table class="bulk-pool-table">` 구조와 크기·정렬이 달랐던 문제를 수정. `bulkDriverTableRows`로 다시 작성해 동일한 `<table class="bulk-pool-table">` 행 구조·헤더·하단 요약 문구로 통일하고, 선택한 오더·기사 건수와 `배차 실행` 버튼(`bulk-assign-bar`)을 "기사·차량 선택" 카드에서 "배차 결과"(`#bulkResultsCard`) 컨테이너 상단으로 이동
- **DB 변경 없음**: 프론트 `dashboard.js`/`dashboard.css`만 수정 (UI 레이아웃·렌더링 로직)
- **검증**: `node --check`로 구문 검사 통과, Playwright로 차량/담당자 상세 화면, 7개 탭 footer 위치(`getBoundingClientRect`), 대시보드 4가지 화면 비율(1600×900~900×1400) 스크롤 동작, 배차관리 표 통일·배차 실행 바 이동·배차 실행 흐름을 직접 캡처·측정해 확인

## v1.0.113 (2026-06-07)
### 기사 위치·차량 수정 저장 버그 수정
- **기사 위치가 차량 위치로 잘못 표시되는 문제 수정**: 기사 상세의 `위치` 탭(`initDriverDetailMap`)이 기사 본인의 GPS가 아니라 배정 차량의 마지막 GPS(`vehicleById(d.vehicleId)`)를 표시하고 있었음. `GET /users` 응답에 기사 본인의 최근 `locations` 기록(`last_gps: {lat, lon, recorded_at}`)을 추가하고(`auth.py`), 프론트에서 `DATA.drivers`에 `last_lat`/`last_lon`/`last_gps_at`을 매핑해 기사 상세 위치 지도가 차량이 아닌 기사 본인의 마지막 GPS 좌표를 표시하도록 수정
- **차량 상세 수정 후 저장이 되지 않는 문제 수정**: `bindVehicleDetail`의 저장 클릭 핸들러가 `vehicleDetailBodyHtml` 스코프에서만 선언된 `linked` 변수를 참조해 `ReferenceError`가 발생, PATCH 요청 자체가 실행되지 못하던 버그를 수정(`bindVehicleDetail` 내부에 `const linked = DATA.drivers.find(d => d.vehicleId === v.id)`를 추가)
- **잘못 입력된 차종 데이터 수정**: 차량 ID 12(`경기 가 1010`)의 `vehicle_type`이 `"1"`이라는 잘못된 값으로 들어가 있던 것을 `UPDATE vehicles SET vehicle_type = '카고' WHERE id = 12`로 직접 수정
- **DB 변경**: `vehicles.vehicle_type` 데이터값 1건 수정 (테이블/컬럼 구조 변경 없음)
- **검증**: `node --check`로 프론트 구문 검사 통과, 백엔드 컨테이너 재시작 후 정상 기동·`/users` 응답에 `last_gps` 포함 확인, DB 값 수정 결과 `psql` 조회로 확인

## v1.0.112 (2026-06-07)
### 목록 페이지네이션·상세 지도 UI 버그 수정
- **목록 페이지네이션 위치 버그 수정**: 차량·기사·담당자·고객·오더 목록 카드의 `card-bd`(`master-list-body`)에 `flex: 1`이 빠져 있어, 행 수가 적으면 카드 전체 높이를 채우지 못하고 페이지네이션이 마지막 행 바로 아래에 붙어 보이는 문제가 있었음. `master-list-body { flex: 1 }`을 추가하고, 동일 레이아웃을 인라인 스타일로 중복 작성하던 차량·담당자·고객·오더 카드도 `master-list-body` 클래스로 통일해 모든 탭에서 페이지네이션이 카드 하단에 고정되도록 수정
- **기사·차량 상세에 `위치` 탭 추가**: `driverDetailBodyHtml`/`vehicleDetailBodyHtml`에 고객 상세와 동일한 패턴의 `위치` 탭을 추가(`initDriverDetailMap`/`initVehicleDetailMap`). 기사는 배정 차량의 마지막 GPS, 차량은 자체 마지막 GPS 좌표를 카카오맵에 표시하고 좌표가 없으면 안내 문구를 보여줌
- **운행관제 지도 크기가 화면 비율에 따라 달라지는 버그 수정**: `.control-map-card`가 `width: min(100%, calc(100vh - 278px))` + `aspect-ratio: 1`로 정사각형 크기를 viewport 기준으로 계산해, 창 가로/세로 비율이 바뀌면 지도 크기가 들쭉날쭉해지는 문제가 있었음. 부모 `.control-map-panel`을 그대로 채우는 `width: 100%; height: 100%; flex: 1`로 변경해 화면 비율과 무관하게 컨테이너 고정 크기로 표시되도록 수정
- **오더 상세 지도 상하 길이가 짧은 문제 수정**: `.order-detail-map`의 고정 `height: 330px`를 `height: min(58vh, 520px); min-height: 360px`로 변경해 상세 컨테이너 대비 지도가 짧아 보이던 문제를 해소. 같은 규칙을 공용 클래스 `.entity-detail-map`으로 분리해 고객·기사·차량 상세의 위치 지도(기존 고정 `260px`)에도 동일하게 적용해 일관된 비율로 표시
- **고객 상세 위치 지도 중복 렌더링 버그 수정**: `initCustomerDetailMap`이 `위치` 탭을 다시 누를 때마다 같은 캔버스에 새 `kakao.maps.Map`을 생성해 지도 타일이 중첩 렌더링되는 문제가 있었음. 캔버스 DOM에 `_kakaoMap`/`_kakaoMarker` 인스턴스를 보관해 재사용하고, 이미 있으면 중심·마커 좌표만 갱신하도록 수정(같은 패턴을 신설한 기사·차량 위치 지도에도 적용)
- **DB 변경 없음**: 프론트 `dashboard.js`/`dashboard.css`만 수정 (UI 레이아웃·렌더링 로직)
- **검증**: `node --check`로 구문 검사 통과, CSS 중괄호 균형 검사 통과, nginx를 통해 변경사항 반영 확인

## v1.0.111 (2026-06-07)
### 차량 정보·중복 배차·도착 자동판정 버그 수정
- **차량 상세 톤급·차종 표시·저장 불일치 버그 수정**: `vehicleDetailBodyHtml`의 `<select>` 옵션 목록(`tonOpts`/`typeOpts`)이 과거 자유 입력으로 저장된 실제 값(예: "5톤 트럭", "5.0톤")과 일치하지 않아, 일치하는 옵션이 없으면 브라우저가 첫 옵션을 기본 선택 → 좌측 목록과 우측 상세 표시값이 달라 보이고, 저장 시 실제 값이 다른 값으로 조용히 덮어써지는 문제가 있었음(엔티티 이벤트 감사 로그에서 차량 7·10번이 "5톤 트럭"→"윙바디", `weight_kg` 5000→1000으로 잘못 변경된 실제 사례를 발견·복구). 현재 값이 표준 목록에 없으면 `tonChoices`/`typeChoices`로 옵션에 포함해 그대로 표시하도록 수정하고, 톤급 저장 시 `tonMap`에 없는 표기는 숫자를 직접 파싱해 `weight_kg`로 환산하도록 폴백 추가
- **차량 목록 상태 배지 "가용"/"운행중" 불일치 버그 수정**: `Vehicle.status` 컬럼이 운행 시작·종료 시 서버에서 자동 갱신되지 않아 활성 운행이 있어도 DB에는 `가용`으로 남는 경우가 있었음(차량 4·7번에서 실제 확인). 목록·검색이 원본 `v.status`를 그대로 쓰던 것을, 진행 중 Trip 유무로 보정하는 `vehicleEffectiveStatus()` 헬퍼를 통해 표시하도록 수정
- **`/trips/auto-dispatch` 중복 배차 검증 추가**: 이미 `pending`이 아닌(배차·진행·완료·취소) 배송의 `delivery_id`가 요청에 포함되면 409로 거부. 검증이 없어 동일 배송(`RO-260607-91E998`)이 약 40분 간격으로 서로 다른 두 기사(신우철→홍요아)에게 중복 배차되어, 두 기사의 처리 기록(`order_events`)이 한 주문에 뒤섞이고 `completed_at`이 초기화되지 않은 채 배송 상태가 `in_progress`로 리셋되는 문제가 있었음
- **GPS 도착 자동 완료 오판정 버그 수정**: `record_driver_location`의 도착 판정이 기사에게 배정된 모든 `in_progress` 배송을 트립 구분 없이 검사해, 직전 운행의 하차지에 머물러 있던 기사에게 같은 좌표(또는 인접)를 하차지로 갖는 새 배송이 배차되면 운행 시작·상차 전부터 배송이 곧바로 `done` 처리되는 문제가 있었음(`RO-260607-D49F35`, Trip `978b2bdd...`에서 실제 발생해 기사 앱 오류 로그로 보고됨). 도착 판정 대상을 기사의 **현재 활성 운행에 속한 배송**으로 한정하고, 해당 배송의 상차 경유지가 출발(`departed_at`) 처리된 이후에만 하차지 도착으로 인정하도록 수정. 영향받은 배송(`317e03de...`)은 `in_progress`/`completed_at NULL`로 데이터 복구
- **DB 데이터 보정 (스키마 변경 없음)**: 차량 7·10번 `vehicle_type`/`weight_kg` 복구, 배송 `317e03de...` 상태·완료시각 복구
- **검증**: `node --check`로 프론트 구문 검사, 백엔드 `ast.parse`로 구문 검사 통과, 백엔드 컨테이너 재시작 후 정상 기동 확인, nginx를 통해 변경된 `dashboard.js` 반영 확인

## v1.0.110 (2026-06-07)
### 임시 화주·고객·차량 등록 모달 필수 입력 항목 변경
- **임시 화주 추가 모달**: 연락처를 필수 입력(`required` + `*`)으로 변경
- **고객 추가/수정 모달**: 담당자 입력 필드 제거, 연락처·주소를 필수 입력으로 변경하고 누락 시 개별 안내 토스트(`연락처를 입력하세요`/`주소를 입력하세요`) 추가. 더 이상 사용하지 않는 `contact` 필드는 요청 본문에서도 제거
- **차량 등록 모달**: 길이(cm)·폭(cm)을 필수 입력으로 변경, 검증 가드와 전송 데이터 구성(`null` 허용 → `parseFloat` 필수값)도 함께 갱신
- **DB 변경 없음**: 프론트 `dashboard.js`만 수정 (`customers.contact` 컬럼 자체는 유지하되 더 이상 폼에서 입력받지 않음)
- **검증**: `node --check`로 구문 검사 통과, nginx를 통해 변경사항 반영 확인

## v1.0.109 (2026-06-07)
### 오더접수 화면 입력 UX·레이아웃 개선
- **임시 화주 연락처 자동 하이픈**: `bindPhoneAutoFormat` 헬퍼 추가, 임시 화주 추가 모달의 연락처 입력 시 `010-0000-0000` 형식으로 `-`를 자동 삽입 (모든 모달의 `[name="phone"]`/`#custPhone` 입력에 공통 적용)
- **화주 담당 연락처 입력 제거**: 오더 카드의 `연락처(화주 담당 연락처)` 필드를 삭제하고, 주문의 `contact`는 선택한 화주(고객 마스터)의 등록 연락처에서 자동으로 채우도록 변경 (`customerContactFromIntakeValue`)
- **양식 다운로드/엑셀 불러오기 버튼 크기 통일**: `#excelTemplate`을 `btn btn-sm`에서 `btn`으로 변경해 `btn-excel-sm`과 동일한 패딩·폰트 크기로 정렬
- **오더정보입력 좌측 컨테이너 고정 레이아웃**: `.intake-main`을 `.intake-main-scroll`(태스크 카드 영역, 내부 스크롤)과 하단 고정 액션바(`대기열에 추가`)로 분리해 우측 접수 대기열 컨테이너처럼 `height:100%` 고정 크기를 갖도록 수정. 입력 폼 개수와 무관하게 `대기열에 추가` 버튼이 항상 같은 위치(하단)에 고정됨
- **임시 화주추가 버튼 제거**: 화주 선택 드롭다운 옆 별도 `+ 임시 화주 추가` 버튼을 삭제 (드롭다운의 `+ 임시 화주 추가` 옵션으로 동일 기능 제공 중이라 중복이었음). 더 이상 쓰이지 않는 `openTempCustomerFromIntake` 제거
- **하차정보 수신처 입력 제거**: 메인 하차 정보·추가 하차지의 `수신처(하차 고객)` 텍스트 입력 제거, tabindex 재정렬
- **담당자 접수·배차 추적 검토**: `order_events.actor_id/actor_role/actor_name`이 오더 접수(`order.created`)·배차 배정(`order.assigned`/`trip.assigned`) 시 로그인한 관리자를 정상적으로 기록하고, 오더 상세 `처리 기록` 탭에서 표시됨을 확인 (코드 변경 없음)
- **DB 변경 없음**: 프론트 `dashboard.js`/`dashboard.css`만 수정
- **검증**: `node --check`로 구문 검사 통과, nginx를 통해 변경사항 반영 확인

## v1.0.108 (2026-06-07)
### 검색창 한글 입력 자모 분리·음절 누락 버그 수정
- **`bindImeSearch` 디바운스 방식으로 변경**: 한글은 음절마다 `compositionstart`/`compositionend`가 반복 발생하는데, 기존에는 매 `compositionend`마다 즉시 전체 `rerender()`로 검색창을 교체·재포커스해 IME 조합 상태가 끊기면서 자음/모음이 분리되거나 짝수 음절이 누락되는 문제가 있었음. `compositionstart` 시 예약된 재렌더링을 취소하고, 입력이 220ms 이상 멈췄을 때만 한 번 재렌더링·포커스 복원하도록 수정
- **배차관리 검색창도 `bindImeSearch`로 통일**: `bulkOrderSearch`/`bulkDriverSearch`/`dispatchOrderSearch`가 매 keystroke마다 직접 재렌더링하던 구조라 동일한 증상이 있었으므로 모두 `bindImeSearch`로 교체
- **DB 변경 없음**: 프론트 `dashboard.js`만 수정
- **검증**: `node --check`로 구문 검사 통과, nginx를 통해 변경사항 반영 확인

---

## v1.0.107 (2026-06-07)
### 오더목록·운행관제·배차관리·캘린더 UI 버그 수정 및 기능 보강
- **오더 상세 지도 흰 화면 버그 수정**: 탭 전환 직후 컨테이너 크기가 확정되기 전에 카카오맵이 생성되어 흰 화면으로 보이던 문제를, 지도 생성 후 `relayout()`을 호출해 강제 재렌더링하도록 수정
- **오더 상세 상·하차 핀 UI 변경 및 지도 채움 버그 수정**: 네모 박스 형태 마커(`order-stop-marker`)를 일반적인 지도 핀 모양(`order-stop-pin`, 라벨+드롭핀)으로 교체하고, `.order-detail-map`에 `position: relative`와 내부 div 100% 채움 규칙을 추가해 지도가 컨테이너 상하좌우를 꽉 채우도록 수정
- **오더목록 필터별 수정 가능하도록 변경**: `orderIsEditable`을 `상태 === 접수`에서 `완료·취소가 아닌 모든 상태`로 변경. 이제 배차·운행중 상태의 오더도 인라인 수정이 가능하며(서버 `PATCH /deliveries/{id}`의 허용 범위와 일치), 안내 문구·토스트 메시지도 갱신
- **오더 상세 차량/기사 교체 기능 복구**: 기존에 구현돼 있던 `운행 중 교체` 바(기사 교체·차량 교체·사고 신고 버튼)가 `tripForOrder`의 매칭 데이터 누락으로 항상 표시되지 않던 문제를, `DATA.orders` 매핑에 `tripId: d.trip_id`를 추가해 오더-Trip 연결을 복구하여 해결
- **운행관제 지도 컨테이너 고정 버그 수정**: 창 비율이 달라질 때 지도가 컨테이너 크기에 맞춰 재배치되지 않던 문제를, 전역 `window resize` 이벤트(rAF 디바운스)에서 `kakao.maps.event.trigger(map, 'resize')`와 `applyLiveMapFixedView()`를 호출하도록 추가해 수정
- **배차관리 "배정 및 실행" 컨테이너 통합**: 별도 카드였던 `배정 및 실행`을 제거하고 `배차 실행` 버튼과 선택 현황 바를 `기사·차량 선택` 카드 하단으로 이동·병합. 사용하지 않게 된 `.dispatch-action-card` 관련 CSS 정리
- **일정 캘린더 검색·페이지 기능 추가**: 하단 일정 목록에 ID·내용·유형 통합 검색창과 페이지네이션(`paginationHtml`/`bindPagination` 재사용)을 추가. 월 이동·검색어 변경 시 페이지를 1로 초기화
- **DB 변경 없음**: 프론트 UI(`dashboard.js`, `dashboard.css`)만 수정
- **검증**: `node --check`로 `dashboard.js` 구문 검사 통과, nginx를 통해 변경사항 반영 확인

---

## v1.0.106 (2026-06-07)
### 대시보드 스크롤·고객관리 탭 전환·잠금 상태 시각화 버그 수정
- **대시보드 비율 변경 시 스크롤 안 되는 문제 수정**: `body.theme-dashboard .dash-left`/`.dash-right`에 걸려있던 `overflow: hidden`을 `overflow-y: auto; overflow-x: hidden`으로 변경해, 창 비율이 달라져 위젯이 한 화면에 다 들어오지 않을 때도 각 컬럼이 독립적으로 스크롤되도록 수정
- **고객 상세에서 수정 버튼 클릭 시 위치 탭으로 전환되던 버그 수정**: `bindCustomerDetail`에서 위치 탭에만 걸려 있던 클릭 리스너를 모든 상세 탭에 동일하게 걸도록 변경(`orderDetailTab`과 동일한 패턴). 이제 정보/위치 등 어떤 탭에 있든 수정 버튼을 눌러도 현재 보던 탭이 유지됨
- **고객·담당자 상세의 잠금 상태 시각 표시 보강**: 기사·차량 상세처럼 수정 모드가 아닐 때 `disabled` 입력란이 흐리게 표시되도록 `.inline-detail-bd input:disabled`/`select:disabled`에 공통 스타일(`opacity:.55`, `cursor:not-allowed`, 배경색)을 추가하고, 고객 상세(담당자·연락처·주소)와 담당자 상세(화면 접근 권한)에 "수정 버튼을 눌러야 편집할 수 있습니다" 안내 문구(`detail-lock-hint`)를 추가
- **DB 변경 없음**: 프론트 UI(`dashboard.js`, `dashboard.css`)만 수정
- **검증**: `node --check`로 `dashboard.js` 구문 검사 통과

---

## v1.0.105 (2026-06-07)
### 운행 중 차량 정보 수정·오더 접수 폼 버그·배차관리 UI 간소화
- **운행 중 차량 기본 정보 수정 허용**: 차량 상세에서 운행 중에도 톤급·차종 같은 기본 정보는 수정할 수 있도록 변경하고, 상태·연결 기사만 계속 잠그도록 안내 문구를 수정. `PATCH /vehicles/{id}`도 진행 중 Trip의 변경 잠금 범위를 `status`/`driver_id`로만 좁혀 동일한 규칙을 서버에서도 검증
- **오더 접수 폼 추가 버그 수정**: `+ 오더 입력 폼 추가` 클릭 시 화면 전체를 다시 그려 이전에 입력한 내용이 사라지던 문제를 수정. 새 카드만 DOM에 추가하고 이벤트를 다시 바인딩하는 방식으로 변경
- **희망 도착 입력 자동 포맷**: 년월일·시간 입력에서 숫자만 받아 자동으로 `YYYY-MM-DD`, `HH:MM` 형식의 `-`, `:` 구분자를 채워 넣도록 수정
- **오더 입력 폼 명칭·UI 통일**: 추가 오더 폼의 제목을 `추가 오더 N`에서 `신규 오더 입력`으로 통일하고, `추가 상차 정보`/`추가 하차 정보`를 `상차 정보`/`하차 정보`로 변경. 기존 상·하차 정보도 추가 항목과 동일하게 컨테이너로 감싸 UI를 통일
- **배차관리 "배정 및 실행" 단순화**: `선택 항목 배정`과 `배차 실행` 두 버튼·KPI 텍스트를 `배차 실행` 버튼 하나로 통합. 클릭 시 선택한 오더·기사를 혼적 규칙에 따라 자동 배정한 뒤 곧바로 실행하며, 배차 결과 패널과 중복되던 "배정 검토" 요약 텍스트는 제거
- **오더 화주를 고객 목록 선택 방식으로 통일**: 오더 상세 수정과 배차관리 `배송 건 추가` 모달의 화주 입력을 자유 텍스트에서 등록된 고객 목록 select로 변경
- **DB 변경 없음**: `vehicles`·`deliveries`·`customers` 테이블·컬럼·ENUM 변경 없이 검증 로직과 프론트 UI만 수정
- **검증**: `node --check`, Python `ast.parse`로 `vehicles.py` 구문 검사 통과

---

## v1.0.104 (2026-06-07)
### WebSocket DB 연결 고갈로 인한 로그인 타임아웃 수정
- **로그인 504 원인 수정**: `/ws/chat`, `/ws/location`이 연결 종료까지 FastAPI 의존성의 `AsyncSession`을 유지해 DB 연결 풀을 점유하던 문제를 수정. WebSocket 연결 시 JWT·사용자 검증에만 독립 세션을 사용하고 인증 직후 반환하도록 변경
- **장기 연결과 HTTP 요청 분리**: 채팅·위치 WebSocket 접속 수가 늘어도 `/auth/login`을 포함한 일반 API가 DB 연결을 확보할 수 있도록 세션 수명 주기를 연결 전체가 아닌 인증 구간으로 제한
- **로그인 화면 오류 처리 보강**: 로그인 요청 중 버튼을 비활성화하고 `로그인 중...` 상태를 표시해 중복 제출을 방지. JSON이 아닌 504 응답과 네트워크 오류도 화면 내 안내 문구로 처리
- **아이디 입력 정규화**: 로그인 ID 앞뒤 공백을 제거한 뒤 요청해 복사·붙여넣기 시 불필요한 공백으로 인증이 실패하지 않도록 수정
- **DB 변경 없음**: 테이블·컬럼·ENUM·저장 데이터 변경 없이 SQLAlchemy 세션 수명과 프론트 오류 처리만 수정
- **검증**: Python `compileall`, 로그인 인라인 스크립트 문법 검사, `git diff --check`, 관리자 실제 로그인 성공, 채팅·위치 WebSocket 40개 동시 연결 중 로그인 `200` 응답 및 연결 종료 후 DB 세션 반환 확인

---

## v1.0.103 (2026-06-07)
### 일정 식별자·오더 상세·접수 및 배차관리 UI 개선
- **운행 식별자 가독성 개선**: 일정 캘린더·간트·마일스톤·사후통계에서 UUID 앞 8자리 대신 생성일과 날짜별 순번을 조합한 `TR-YYMMDD-NNN` 표시 번호를 사용하고, 유형 컬럼과 중복되던 `운행` 접두어를 제거
- **간트 날짜·시간 수정**: 서버 UTC 시각을 `Asia/Seoul` 기준 날짜와 시간으로 변환해 막대 위치·표시 시간이 어긋나던 문제를 수정하고, 기본 `input[type=date]`를 이전/다음 달 이동과 일자 선택을 지원하는 커스텀 캘린더 팝오버로 교체
- **오더 접수 폼 통일**: 추가 오더도 첫 번째 오더와 동일하게 화주·희망 도착·연락처 영역을 가지도록 변경하고 추가 상·하차지를 동일한 카드형 UI로 생성. 희망 도착은 `YYYY-MM-DD`, `HH:MM` 직접 입력 방식으로 변경
- **화주·수신처 역할 명확화**: 화주는 계약 고객, 수신처는 실제 하차 고객으로 구분해 라벨을 정리하고, 혼적 여부는 배차 단계에서 결정하도록 오더 접수 및 대기열 수정 폼에서 제거
- **오더 목록·상세 개선**: 체크박스와 중복되던 `현재 페이지 선택/해제`, `선택 해제` 버튼을 제거하고 오더번호 아래 원본 UUID가 노출되지 않도록 수정. `cargo_id`를 `화물 ID`로 바꾸고 `RO-...-화물N` 형식으로 표시
- **오더 경로 지도 추가**: 우측 오더 상세에 지도 탭을 추가해 등록된 모든 상차지·하차지 좌표를 역할별 핀으로 표시하고 좌표가 없을 때 안내 문구를 제공
- **공통 페이지네이션 보강**: 오더·고객·기사·차량·담당자 목록이 한 페이지뿐이어도 페이지 번호와 비활성 이전/다음 버튼을 표시하고 담당자 목록에도 페이지 처리를 적용
- **배차관리 레이아웃 분리**: 기사·연결 차량을 오더 목록과 유사한 행 구조로 표시하고 기사 선택 영역과 배정·배차 실행 영역을 별도 카드로 분리해 우측 컨테이너 과밀 문제를 수정
- **DB 변경 없음**: 운행 번호·화물 번호는 프론트 표시값이며 날짜 입력, 지도, 페이지네이션, 배차 레이아웃도 기존 API·컬럼을 사용
- **검증**: `node --check`, Python `compileall`, `git diff --check`, Playwright 모의 API 기반 간트 서울 시간·날짜 이동·커스텀 달력·접수 폼 일치·UUID 비노출·화물 ID·단일 페이지·배차 카드 분리 회귀 검증 통과

---

## v1.0.102 (2026-06-07)
### 배차 기사 선택 유지·오더 접수 엑셀 예제 정합성 수정
- **배차관리 기사 선택 유지**: 기사 카드를 선택할 때 화면 전체를 다시 그리더라도 선택 상태와 기사 검색어를 유지하고, 기사 목록의 내부 스크롤 위치를 복원해 목록이 위로 이동하지 않도록 수정
- **기사 검색 상태 보존**: 기사명·차량번호·톤수 검색 결과를 렌더링 상태로 관리해 검색 중 기사 선택이나 해제 후에도 검색어와 필터 결과가 유지되도록 수정
- **엑셀 예제 1행 1건 정리**: 오더 접수 기본 양식의 예시 행에 상차·하차 한 쌍만 입력해 양식을 그대로 불러오면 접수 대기열에 예제 1건만 생성되도록 수정
- **기존 다중 상·하차 호환 유지**: 사용자가 한 행에 복수 상·하차 쌍을 입력한 기존 엑셀 파일은 데이터 유실을 막기 위해 기존대로 여러 접수건으로 전개
- **DB 변경 없음**: 기사 선택·검색·스크롤은 프론트 임시 상태이며 엑셀 예제 데이터만 변경되어 신규 테이블·컬럼·ENUM 추가 없음
- **검증**: `node --check`, `git diff --check`, Playwright 기사 목록 500px 스크롤·선택·검색 상태 유지 및 다운로드한 엑셀 예제 재업로드 시 대기열 1건 생성 검증 통과

---

## v1.0.101 (2026-06-07)
### 관리자 화면 편집 흐름·오더/일정 UI·지도 상태 안정화
- **한글 검색 IME 재수정**: 조합 종료 직후 중복 `input` 이벤트로 마지막 음절이 다시 분해되던 문제를 차단해 `테스트`, `검색` 같은 한글 검색어가 그대로 유지되도록 수정
- **상세 편집 흐름 통일**: 기사·차량·담당자·기업·오더 상세를 최초 조회 전용으로 열고 `수정 → 저장` 순서로만 변경하도록 통일. 삭제 버튼은 상세 하단에서 수정 버튼 왼쪽에 배치
- **차량 상세 정리**: `차량 비활성화` 명칭을 `차량 삭제`로 변경하고 마지막 GPS 설명을 하나의 값 영역으로 묶어 상태·연결 기사 필드 정렬을 수정
- **오더 목록 인라인 수정**: 오더 수정 모달을 제거하고 고객·기본정보와 동일하게 우측 상세 컨테이너에서 수정·저장·삭제하도록 변경
- **오더 접수 한 화면 구성**: 오더 정보를 데스크톱 2행으로 압축하고 입력·대기열·저장 작업을 1440×768 이상에서 내부/페이지 스크롤 없이 한 화면에 표시
- **상단바 높이 고정**: flex 레이아웃에서 배차관리 상단바가 화면 높이에 따라 축소되던 문제를 수정해 오더목록·배차관리를 포함한 모든 화면에서 76px을 유지
- **일정 화면 개선**: 캘린더 월 이동·연월·범례와 간트 날짜 도구를 중앙 정렬하고, 캘린더 목록을 최신 날짜/시간순으로 표시. 날짜·시간과 사용자 친화적인 운행/오더 식별자를 함께 출력
- **간트 날짜 이동 수정**: UTC 날짜 변환을 로컬 날짜 계산으로 변경해 이전 날이 이틀 이동하고 다음 날이 동작하지 않던 문제를 수정
- **사후통계 엑셀 다운로드**: 운행 번호·기사·차량·일자·상태·안전 점검·체류시간·남은 정류를 `.xlsx`로 내려받고 SheetJS 미지원 시 CSV로 대체
- **지도 화면 상태 분리**: 운행관제 마커 선택 시 전체 화면을 다시 렌더링하지 않도록 변경해 지도가 사라지는 문제를 수정하고, 다른 화면으로 이동할 때 관제 차량 선택 상태를 초기화
- **고객 메뉴·토글 UI 정리**: 고객관리 메인 탭의 hover 세부 메뉴를 제거하고 혼적 여부를 포함한 관리자 화면 토글을 공통 커스텀 UI로 통일
- **기업 정보 권한 강화**: 프론트 편집 잠금과 `PATCH /organizations/me/settings` API 모두 기업 최상위 관리자만 기업 설정을 변경할 수 있도록 제한
- **DB 변경 없음**: 신규 테이블·컬럼·ENUM 추가 없음
- **검증**: `node --check`, Python `compileall`, `git diff --check`, Playwright 한글 IME·상세 편집 잠금·차량 정렬·오더 인라인 수정·캘린더/간트·엑셀 다운로드·지도 전환·오더접수 무스크롤·720/768/900px 상단바 높이 검증 통과

---

## v1.0.100 (2026-06-06)
### 관리 화면 UX·운행 상태 방어·프로필 계정 기능 보강
- **가입 연락처 입력 개선**: 기업·관리자 가입 페이지의 휴대전화 입력에서 숫자 길이에 맞춰 `010-1234-5678`, `010-123-4567` 형식의 하이픈을 자동 삽입
- **한글 검색 IME 수정**: 기사·차량·고객·오더 검색을 조합 이벤트 인식 공통 처리로 변경해 한글 입력 중 재렌더링으로 글자가 분리되거나 한 글자만 입력되던 문제를 수정
- **상세 패널 작업 배치 통일**: 기사·차량·담당자·고객·오더 상세의 닫기는 우측 상단, 저장/수정은 우측 하단, 삭제/비활성화는 상세 본문 최하단 위험 작업 영역에 배치
- **운행 상태 수동 변경 방어**: 기사 수동 상태는 `운행가능/휴무`, 차량은 `가용/정비`만 허용. 진행 중 Trip과 연결된 기사·차량은 프론트 입력을 잠그고 API에서도 수정·배정 변경·삭제/비활성화를 `409`로 거부
- **기업·고객·오더 관리 개선**: 기업 정보에 조직코드 복사 버튼을 추가하고, 고객 위치를 별도 세부탭에서 고객 상세의 `위치` 탭으로 통합. 오더 목록에 통합 검색을 추가하고 `+ 접수 창` 버튼과 원본 UUID 노출을 제거
- **오더 접수 UI 재구성**: 상차·하차를 좌우 경로 카드로 묶고 오더 정보를 별도 영역으로 분리. 입력 → 대기열 확인 → 일괄 저장 단계를 표시하고 대기열 패널에 최종 저장 작업을 고정 배치
- **배차 관리 UI 재구성**: 오더 선택 → 기사 선택 → 배정 확인 흐름과 단계별 선택 건수를 상단에 표시. 기사별 배정 오더를 칩으로 보여주고 개별 배정 취소와 최종 배차 실행 영역을 분리
- **운행관제 실시간화**: 수동 새로고침 버튼을 제거하고 위치 WebSocket 수신 시 지도와 차량 행 좌표를 즉시 갱신. 관제 목록·마커는 현재 `in_progress` 운행에 연결된 차량만 표시
- **대시보드 한 화면 구성**: 1440×900 기준 본문 스크롤 없이 요약 지도·오더·바로가기를 볼 수 있도록 높이를 조정하고, 사용자가 1~3개의 바로가기를 선택해 `localStorage`에 저장하는 편집 기능 추가
- **채팅·계정 설정 확장**: 채팅의 `대시보드에서 보기` 버튼을 제거하고 사용자 프로필 이미지를 상대 목록·헤더에 표시. 설정 페이지에서 JPG/PNG/WEBP 프로필 업로드·삭제와 계정 탈퇴를 제공
- **계정 탈퇴 방어**: 최상위 기업관리자는 권한 이전 전 탈퇴를 거부하고, 기사는 대기·운행 중 배차가 있으면 탈퇴를 거부. 일반 계정 탈퇴 시 본인 확인 후 대화·메시지·배정 참조를 정리
- **날짜별 간트 조회**: 일정·통계 간트에 날짜 선택, 이전 날, 다음 날, 오늘 이동을 추가하고 선택 날짜의 06–21시 운행을 표시
- **탑바 정리**: 관리자 메뉴에 계정 설정이 있으므로 별도 설정 퀵 버튼을 제거
- **DB 변경**: `users.profile_image VARCHAR(512)` 추가. 이미지 파일 자체가 아니라 정적 제공 경로만 저장
- **검증**: `node --check`, Python `compileall`, `git diff --check`, 백엔드 재빌드·DB 컬럼 확인, 프로필 업로드/조회/삭제·최상위 관리자 탈퇴 차단·운행 중 기사/차량 수정 차단 API smoke, Playwright 1440×900 무스크롤·한글 검색·버튼 배치·고객 위치·오더 검색·설정 화면 검증 통과

---

## v1.0.99 (2026-06-06)
### 기본정보 UI·관리자 채팅·가입 운영 설정 보강
- **기사·차량 검색 입력 수정**: 목록을 입력마다 다시 렌더링하더라도 새 검색창에 포커스와 커서 위치를 복원해 한 글자 이후 입력이 끊기던 문제를 수정
- **관리자 간 채팅 지원**: 같은 기업의 승인된 관리자끼리 1:1 대화방을 생성할 수 있도록 채팅 파트너·대화방 권한을 확장하고 상대 역할을 목록에 표시
- **기사-관리자 단일 자동 매칭**: 기사에게는 기존 대화가 있는 관리자 또는 최상위 기업관리자 우선 기준으로 한 명만 노출. 일반 관리자는 자신에게 연결된 기사만 채팅 상대에 포함
- **기사·차량 목록 작업 정리**: 행별 삭제 버튼을 제거하고 선택 후 우측 상세 패널에서 기사 삭제·차량 비활성화를 실행하도록 통일. 기사 직접 추가 버튼도 제거해 공개 가입·승인 흐름만 유지
- **기사 목록·권한 UI 통일**: 기사 목록 패널을 다른 기본정보 목록과 같은 카드·표 구조로 정리하고 담당자 화면 접근 권한의 체크박스를 텍스트 중앙선과 맞는 슬라이드 토글로 교체
- **기업 가입 정책 확장**: `organizations.auto_approve_admins`를 추가하고 최상위 기업관리자가 관리자 가입 자동승인을 설정할 수 있도록 구현. 활성화 시 관리자 신청을 즉시 승인하고 기본 화면 권한을 부여
- **조직코드 재발급 권한 강화**: 기업 정보 화면에 재발급 버튼을 추가하고 최상위 기업관리자만 사용할 수 있도록 API를 제한. 재발급 내역은 `entity_events`에 기록
- **계정 설정 동선 분리**: 기본정보 기업 화면에서 관리자 전화번호·비밀번호 폼을 제거하고 상단 설정 버튼과 계정 메뉴를 `settings.html`로 연결. `settings.html`은 계정 보안과 화면 테마만 담당
- **캘린더 레이아웃 수정**: 7열을 `minmax(0, 1fr)`로 고정하고 긴 일정 텍스트를 말줄임 처리해 열 폭 확장을 방지. 월 이동 버튼·연월 제목·오늘/건수 영역을 분리 정렬
- **토글 UI 통일**: 기업 정보의 기사·관리자 자동승인과 담당자 화면 권한을 좌우로 움직이는 공통 슬라이드 토글로 변경
- **검증**: `node --check`, Python `compileall`, `git diff --check`, 백엔드 재빌드·DB 컬럼 확인, 관리자 간 대화·기사 단일 관리자·자동승인·권한 API smoke, Playwright 데스크톱/모바일 검색·권한 정렬·캘린더 폭·설정 동선 검증 통과

---

## v1.0.98 (2026-06-06)
### 관리자 공개 가입 신청·최상위 기업관리자 승인 흐름
- **관리자 가입 경로 변경**: 대시보드에서 일반 관리자 계정을 직접 생성하던 `POST /users/admin`과 `+ 추가` UI를 제거하고, 공개 가입 페이지에서 조직코드로 관리자 가입을 신청하도록 변경
- **가입 페이지 유형 분리**: `register.html`에 `기업 등록`과 `관리자 가입` 유형을 추가. 기업 등록은 사업자 서류와 최상위 기업관리자를 함께 생성하고, 관리자 가입은 승인된 기업의 조직코드와 개인 계정 정보를 제출
- **역할·승인 상태 분리**: `users.account_status`와 `accountstatus(pending/approved/rejected)` ENUM을 추가해 `role=admin/driver`와 계정 승인 상태를 독립적으로 관리
- **관리자 승인 권한 제한**: 관리자 가입 신청은 항상 `account_status=pending`으로 저장하며, 같은 기업의 `is_org_owner=true` 최상위 기업관리자만 승인·반려 가능
- **담당자 신청 관리 UI**: `기본정보 > 담당자`에 관리자 가입 신청 목록과 승인·반려 버튼을 추가. 승인 시 일반 관리자 기본 화면 권한을 전체 허용하고 담당자 수정 기록에 승인 이벤트를 저장
- **로그인 방어**: 승인 대기 또는 반려 계정은 `/auth/login`과 인증 토큰 처리 단계에서 차단. 승인된 기업에만 조직코드 가입을 허용
- **레거시 데이터 보정**: 기존 `role=pending` 기사 계정은 서버 시작 시 `role=driver`, `account_status=pending`으로 자동 변환
- **검증**: JavaScript `node --check`, 백엔드 AST 문법 검사, `git diff --check`, OpenAPI 경로 확인, 관리자 신청·승인·반려·로그인 API smoke 및 Playwright 가입 유형·담당자 직접 추가 제거 검증 통과

---

## v1.0.97 (2026-06-06)
### 관리 화면 편집 UX·운행관제·담당자 권한·감사 기록 보강
- **목록 행 수정 버튼 제거**: 고객관리와 오더목록의 행별 `수정` 버튼을 제거하고, 행 선택 후 우측 상세 패널 상단의 `수정` 버튼에서만 편집을 시작하도록 통일
- **고객 상세 명시적 편집 모드**: 고객 상세는 최초 조회 전용으로 열리고 `수정` 클릭 후 담당자·연락처·주소 입력과 카카오 주소 자동완성이 활성화되며, 저장 시 주소 좌표도 함께 갱신
- **운행관제 한 화면 레이아웃**: 우측 요약·차량 위치 패널 폭을 확대하고 지도는 정사각형 비율로 축소해 데스크톱에서 footer를 포함해 페이지 스크롤 없이 두 패널이 모두 보이도록 조정
- **관제 차량 선택 강조**: 우측 차량 행을 선택하면 해당 행과 지도 마커를 확대·강조하고 다른 차량 마커는 반투명 처리. 선택 차량 좌표로 지도 중심을 이동하되 고정 배율은 유지
- **공통 수정 기록 추가**: 고객·기사·차량·담당자·기업 정보 생성/수정 내용을 신규 `entity_events` 테이블에 처리자·요약·변경 전후 JSON과 함께 저장하고 각 우측 상세의 `수정 기록` 탭에서 조회
- **기업 정보 화면 통합**: 기본정보의 `내 정보`를 `기업 정보`로 변경하고 기업명·조직코드·기사 자동승인, 관리자 연락처·비밀번호, 기업 수정 기록을 한 화면에 통합. 상단 계정 메뉴의 `내 프로필`은 제거
- **담당자 권한 모델 추가**: `users.is_org_owner`, `users.permissions`를 추가하고 조직별 최초 관리자를 최상위 관리자로 자동 보정. 최상위 관리자만 일반 담당자 추가·화면별 접근 권한 변경·삭제가 가능
- **관리자 가입 경로 방어**: 공개 `POST /auth/register`는 기사 가입만 허용하고, 담당자 추가는 최상위 관리자 전용 `POST /users/admin`으로 분리. 같은 조직 검증과 최상위 관리자 삭제 방어를 추가
- **하위 메뉴 폭 통일**: 오더관리 등 상단 hover 세부 메뉴 폭을 고정해 탭별 길이 차이를 제거
- **검증**: JavaScript `node --check`, 전체 백엔드 AST 문법 검사, `git diff --check`, `/openapi.json` 및 담당자 생성·권한 변경·감사 조회·삭제 API smoke, Playwright 고객 편집 잠금·행 버튼 제거·기업 정보·담당자·운행관제 무스크롤 검증 통과

---

## v1.0.96 (2026-06-06)
### 오더·배차 탭 통합 및 한 화면 배차 관리
- **메인 탭 명칭 정리**: 관리자 웹의 `배차지정`을 `오더관리`로 변경하고 하위 탭을 4글자 기준의 `오더접수`, `오더목록`, `배차관리` 3개로 통합
- **일괄·수동 배차 화면 통합**: 별도 `일괄 자동 배차`, `단건·수동 배차` 화면을 제거하고 `배차관리`에서 오더 1건/여러 건과 기사 1명/여러 명 배정을 모두 처리하도록 단일 흐름으로 변경
- **배차 화면 3영역 재구성**: 상단 좌측은 미배정 오더, 상단 우측은 기사·연결 차량, 하단은 차량별 방문 순서·미배정 결과로 구성하고 페이지 스크롤 없이 각 목록 내부만 스크롤하도록 조정
- **불필요한 출발 방식 UI 제거**: `분산 출발`/`단일 센터 출발` 선택과 센터 입력 영역을 제거하고 기존 기본 동작인 기사·차량 최근 위치 기준 배차를 유지
- **검색·실행 UX 보강**: 오더번호·화주·상하차지·규격 통합 검색을 추가하고 `혼적 허용`은 오더 헤더, `배차 실행`은 기사·차량 헤더로 이동
- **혼적 규칙 명확화**: 혼적 OFF에서는 기사 한 명당 오더 1건만 배정하고, ON에서만 같은 기사·차량에 여러 오더를 배정할 수 있도록 프론트 배정 규칙과 Trip 생성 요청을 기사별로 분리
- **오더 목록 연결 방어**: 오더목록에서 `접수` 상태인 선택 건만 배차관리로 전달하고, 취소·완료 등 배차 불가 건만 선택한 경우 배차관리 버튼을 비활성화
- **구 URL 호환**: 기존 `page=bulk-dispatch`, `page=dispatch-assign` 접근은 신규 `page=dispatch-manage` 화면으로 연결
- **검증**: JavaScript `node --check`, `git diff --check`, Playwright 메뉴·구 URL·오더 전달·혼적 ON/OFF·무스크롤 레이아웃 검증 통과
- **DB 변경 없음**: 신규 테이블·컬럼·ENUM 또는 데이터 마이그레이션 없음

---

## v1.0.95 (2026-06-06)
### 백엔드·프론트 결합도 개선
- **Trip 유스케이스 서비스 분리**: 운행 생성, 접근 권한 확인, 완료·취소 상태 변경, 기사·차량 재배정, waypoint 진행 기록, 운행 종료 시 차량 위치 고정을 `services/trip_service.py`로 이동
- **위치 수집 파이프라인 분리**: GPS 이력 저장, 운행 차량 위치 갱신, 도착 판정, ETA 계산, 관리자 WebSocket 알림을 `services/location_service.py`로 이동
- **DTO·ORM 응답 변환 분리**: `schemas.py`는 `WaypointSchema` 입력 DTO만 유지하고, Trip/Delivery ORM 기반 API 응답 조립은 `serializers/trip.py`로 분리
- **라우터 의존 축소**: `routers/trips.py`를 1,026줄에서 520줄로 줄이고 ORM 모델 import를 15개에서 4개로 정리. `routers/location.py`는 308줄에서 177줄로 축소
- **프론트 API 클라이언트 분리**: `api-client.js`에 API/WS 주소 결정, 토큰, 인증 헤더, JSON 요청 기본값을 통합하고 `dashboard.js`의 직접 `fetch` 59개를 공용 `apiFetch`로 전환
- **검증**: Python `compileall`·`pyflakes`, JavaScript `node --check`, 주요 API smoke, 위치 입력 방어, Playwright 오더 목록 렌더링 및 콘솔/API 오류 검사를 통과
- **DB 변경 없음**: 신규 테이블·컬럼·ENUM 또는 데이터 마이그레이션 없음

---

## v1.0.94 (2026-06-06)
### 백엔드 라우터 리팩터링 회귀 수정
- **라우터 import 누락 복구**: `schemas.py` 분리와 라우터 import 정리 이후 `/ws/location`, `/ws/chat`, 차량 연결 수정, Trip 생성/조회, 오더 처리 기록, 운행 통계 경로에서 런타임 `NameError`가 발생할 수 있던 누락 import를 복구
- **Trip waypoint helper 연결 안정화**: `trips.py`가 `schemas.py`로 이동된 `_same_unloading_point`, `_dest_waypoint`, `_apply_delivery_to_waypoint`, `_trip_waypoints_for_response`를 명시적으로 가져오도록 정리해 목적지 waypoint 보강과 Delivery 메타데이터 복사가 계속 동작하도록 수정
- **카카오 모빌리티 캐시 초기화 보강**: `kakao_mobility.py`의 future/realtime/multi-destination 캐시 딕셔너리가 정의되지 않아 경로 행렬 계산 시 `NameError`가 날 수 있던 기존 버그를 수정
- **검증 보강**: `compileall`, `/openapi.json`, `/auth/login`, `/vehicles`, `/deliveries`, `/trips`, `/stats/summary` smoke 확인 및 `/ws/location`, `/ws/chat` 연결 accepted 로그 확인
- **DB 변경 없음**: 이번 버전은 백엔드 런타임 안정화 작업으로 신규 테이블·컬럼 추가 없음

---

## v1.0.93 (2026-06-06)
### 오더 접수 엑셀 다중 상·하차·좌표 변환 보강
- **엑셀 접수 양식 다중 상·하차 확장**: `양식 다운로드` 템플릿을 `상차지1~3/상차화물/상차규격`, `하차지1~3/하차수취인/하차화물/하차규격` 구조로 확장. 기존 단일 `상차지`, `하차지`, `화물종류`, `규격` 헤더도 계속 읽도록 호환 유지
- **엑셀 업로드 다중 행 전개**: 한 엑셀 행에 여러 상차/하차가 입력되면 기존 `deliveries` 단건 오더 모델에 맞춰 접수 대기열에서 여러 접수건으로 전개. 상차/하차 개수가 다르면 마지막 입력값을 반복 적용해 누락 없이 저장
- **엑셀 좌표 자동 변환 추가**: 업로드 시 `/address/coord` 주소 변환을 우선 사용하고, 실패 시 Kakao 장소 검색으로 좌표를 보강해 배차 직후 상차지·하차지 좌표를 사용할 수 있도록 개선
- **추가 상·하차지 자동완성 버그 수정**: `+ 상차지 추가`, `+ 하차지 추가`로 동적 생성된 입력칸에도 장소 자동완성, Enter 이동, 지우기 버튼이 즉시 동작하도록 바인딩 보강
- **상차 화물 정보 입력·전달 추가**: 접수창 상차 블록에도 화물 종류/규격 입력을 추가하고, 배차/Trip 생성 시 loading waypoint에도 `cargo_type`, `cargo_size`, `delivery_id`, 연락처·화주 메타데이터를 포함
- **바로 저장 시 다중 상·하차 누락 수정**: `접수 저장`을 바로 누를 때 추가 상·하차지가 대표 1건만 저장되던 문제를 수정해 `접수 추가`와 동일한 다중 전개 흐름을 사용

---

## v1.0.92 (2026-06-06)
### 지도 고정 배율·오더 상태/적재 검증 보강
- **대시보드/운행관제 지도 고정**: 대시보드 요약 지도와 운행관제 지도의 드래그·휠 줌을 비활성화하고, 차량 마커 갱신 시 `setBounds()`로 배율이 바뀌지 않도록 고정. 대시보드는 Kakao level 13, 운행관제는 level 12 기준으로 표시
- **오더 상태 역행 방지**: `PATCH /deliveries/{id}`에서 `in_progress → pending`처럼 운행 상태를 접수 상태로 되돌리는 전이를 서버에서 거부하도록 방어. 프론트 오더 수정 모달도 현재 상태 기준 가능한 선택지만 표시
- **완료/취소 오더 수정 방어 강화**: 완료(`done`, `done_manual`)뿐 아니라 취소(`cancelled`) 오더도 수정 API에서 거부하도록 정리
- **차량 적재 가능 중량 검증 추가**: `cargo_size` 또는 `cargo_weight_ton`에서 톤 단위를 읽을 수 있는 경우, 단건 배차(`/trips`)와 일괄 자동배차(`/trips/auto-dispatch`)에서 차량 `weight_kg`를 초과하는 화물을 거부
- **자동배차 후보 필터 보강**: 일괄 자동배차 greedy 배정 시 선택 차량이 화물 톤수를 감당할 수 있는 기사/차량 후보만 배정 대상으로 사용하고, 적재 가능한 차량이 없으면 API가 명확한 오류를 반환
- **프론트 사전 검증 추가**: 단건·수동 배차와 일괄 자동배차 실행 전 선택 차량의 적재 가능 중량보다 큰 톤수 규격 오더를 감지해 서버 요청 전에 안내

---

## v1.0.91 (2026-06-05)
### 차량 위치·기사 위치 저장 기준 분리
- **차량 위치 스냅샷 컬럼 추가**: `vehicles.last_lat`, `vehicles.last_lon`, `vehicles.last_gps_at`을 추가해 차량의 마지막 위치를 기사 GPS 이력과 분리 저장
- **운행 중 차량 위치 갱신**: `/location-logs` 수신 시 기사의 마지막 위치는 항상 Redis/TimescaleDB에 저장하고, 진행 중 운행(`in_progress`)과 차량이 연결된 경우에만 차량 스냅샷을 갱신
- **운행 종료 시 차량 위치 고정**: 운행 완료/취소 시점에 기사 최신 GPS를 차량 마지막 위치로 저장하고, 이후 기사가 계속 GPS를 보내도 해당 차량은 더 이상 따라 움직이지 않도록 분리
- **차량 API 응답 기준 변경**: `/vehicles`의 `last_gps`는 연결 기사 최신 위치가 아니라 차량 스냅샷(`vehicle_snapshot`) 기준으로 반환
- **문서 위치 정책 최신화**: 기사 마지막 위치는 `/location-logs/{user_id}`, 차량 마지막 위치는 `/vehicles.last_gps`로 조회한다는 기준을 문서화

---

## v1.0.90 (2026-06-05)
### 오더 처리 기록 저장·표시 추가
- **오더 처리 기록 테이블 추가**: `order_events` 테이블을 추가해 오더/운행 처리자, 역할, 이벤트 타입, 요약, 상세 JSON, 발생 시각을 저장하도록 구성
- **오더 접수·수정 처리자 기록**: `POST /deliveries`, `POST /deliveries/batch`, `PATCH /deliveries/{id}`에서 누가 오더를 접수·수정·취소했는지 기록
- **기사 앱 운행 이벤트 기록**: 운행 시작, 취소 요청, 취소 승인/반려, 운행 취소, 운행 완료, 상차/하차 도착·완료, 경유지 도착·출발 시간 기록을 오더 처리 기록에 연결
- **처리 기록 조회 API 추가**: `GET /deliveries/{id}/events`를 추가해 오더별 처리 기록을 최신순으로 조회
- **프론트 명칭 정리**: 오더 상세의 `변경 이력` 탭을 `처리 기록`으로 변경하고 서버 처리 기록을 비동기로 표시하도록 수정

---

## v1.0.89 (2026-06-05)
### 슈퍼관리자·기업 관리자 역할 경계 정리
- **슈퍼관리자 대시보드 접근 분리**: `superadmin`은 루트온 운영자 계정이므로 기업 관리자 대시보드 세션 가드에서 제외하고, `admin` 역할만 `/dashboard.html`에 접근하도록 복구
- **공용 로그인 라우팅 보강**: `/login.html` 로그인 성공 후 `driver`는 `/driver.html`, `superadmin`은 `/superadmin.html`, `admin`은 `/dashboard.html`로 이동하도록 역할별 진입점을 분리
- **채팅 접근 권한 보강**: `/chat.html`은 기업 관리자와 기사 간 메시지 화면으로 한정하고, `superadmin` 접근 시 슈퍼관리자 콘솔로 돌려보내도록 처리
- **문서 역할 설명 수정**: 슈퍼관리자는 기업 계정이 아니라 루트온 운영자 계정이라는 기준에 맞춰 대시보드/채팅 진입점 설명을 정리

---

## v1.0.88 (2026-06-05)
### 운행관제 탭·대시보드 메시지 링크 추가
- **상단 탭 구조 재정리**: 관리자 웹 메인 탭을 `대시보드`, `운행관제`, `배차지정`, `고객관리`, `일정·통계`, `기본정보` 순서로 정리. 기존 `오더관리` 진입 흐름은 `배차지정` 하위의 `오더 접수`/`오더 목록`으로 통합
- **대시보드 지도 유지**: 대시보드는 요약 지도와 핵심 현황을 계속 표시하고, 상세 차량 위치 확인은 신규 `운행관제 > 실시간 차량 관제` 화면에서 담당하도록 역할을 분리
- **운행관제 지도 렌더링 버그 수정**: `renderControlLive()`가 존재하지 않는 `DATA.trips`를 참조해 화면 렌더링이 중단되던 문제를 `DATA.statsTrips` fallback으로 수정
- **지도 인스턴스 재사용 안정화**: 대시보드 지도와 운행관제 지도가 같은 `#map-container`를 공유할 때 페이지 전환마다 카카오맵 인스턴스와 기사 마커를 안전하게 재생성하도록 보강
- **대시보드 메시지 진입점 추가**: 상단 탑바에 메시지 버튼을 추가해 `/chat.html`로 바로 이동할 수 있도록 연결
- **미읽음 메시지 배지 보강**: 기존 채팅 WebSocket 미읽음 카운트를 알림 버튼뿐 아니라 메시지 버튼에도 표시

---

## v1.0.87 (2026-06-05)
### 화물 종류 드롭다운·규격 필드 전환
- **화물 종류 선택지 고정**: 오더 접수창, 대기 접수 수정, 오더 수정, 배차지정 배송 건 추가 화면의 화물 종류 입력을 `식품`, `원자재/에너지`, `화학/소재`, `잡화`, `기계/전자`, `기타` 드롭다운으로 변경
- **톤수 → 규격 전환**: 프론트의 `톤수` 라벨과 표 헤더를 `규격`으로 변경하고 `5톤`, `3파레트`처럼 자유 텍스트를 입력·표시하도록 수정
- **cargo_size API/DB 추가**: `deliveries.cargo_size` 컬럼과 `POST/PATCH/GET /deliveries`의 `cargo_size` 필드를 추가. 기존 `cargo_weight_ton`은 과거 톤수 데이터 호환용으로 유지
- **배차·기사 앱 waypoint 규격 전달**: `/trips/auto-dispatch`와 `/trips` 응답 waypoint에 `cargo_size`를 포함해 배차 결과와 기사 앱 Trip API에서도 규격 정보를 확인할 수 있도록 보강
- **엑셀 접수 양식 최신화**: 접수창 엑셀 템플릿 헤더를 `중량톤`에서 `규격`으로 변경하되, 업로드 파서는 기존 `중량톤` 헤더도 계속 읽도록 유지
- **대시보드 화물 요약 정리**: 규격 값은 수치 합산이 불가능하므로 대시보드 화물 요약을 톤 합산에서 화물 종류별 건수 표시로 변경

---

## v1.0.86 (2026-06-05)
### 배차지정 좌우 패널 UI 전환
- **일괄 자동 배차 2패널화**: `배차·지정 > 일괄 자동 배차`를 좌측 `오더·기사 배정`, 우측 `결과 — 차량별 방문 순서·미배정` 구조로 변경해 배정 작업과 결과 확인을 동시에 볼 수 있도록 개선
- **단건·수동 배차 2패널화**: `배차·지정 > 단건·수동 배차`를 좌측 `미배차 건·선택 건 배정·다건 설정`, 우측 `배차 결과` 구조로 변경
- **패널별 독립 스크롤 적용**: 좌우 패널 내부를 독립 스크롤로 처리하고, 좁은 화면에서는 세로 배치로 전환되도록 반응형 레이아웃 보강
- **배차 화면 스크롤 보존 보강**: 데이터 동기화/리렌더 시 신규 배차 패널 스크롤 위치도 보존 대상에 포함

---

## v1.0.85 (2026-06-05)
### 오더번호 표시·상단 세부탭 UX 정리
- **관리자용 오더번호 추가**: `/deliveries` 응답에 DB 저장 컬럼이 아닌 표시용 `order_no`를 추가해 `RO-YYMMDD-XXXXXX` 형식으로 오더 목록·상세·배차 화면에서 사용하도록 변경
- **기사 앱 waypoint 오더번호 포함**: `/trips` 응답의 배송 연결 waypoint에 동일한 `order_no`를 포함해 앱에서도 긴 UUID 대신 관리자와 맞출 수 있는 오더번호를 볼 수 있도록 보강
- **오더 목록 컬럼 순서 변경**: `오더관리 > 오더 목록` 표시 순서를 `상태 → 접수 시간 → 혼적 → 상차지/하차지 → 화물 → 화주 → 기사 → 시간창 → 오더번호` 기준으로 재배치
- **오더번호 가독성 보강**: 프론트에서 기존 UUID·숫자·로컬 `O-YYMMDD-N` 값을 `RO-YYMMDD-...` 표시 형식으로 정규화하고, 상세 화면에는 원본 ID도 함께 확인 가능하게 처리
- **상단 세부탭 hover 드롭다운 전환**: 메인 탭의 하위 탭을 항상 노출하는 방식에서 일반 웹사이트형 hover/focus 드롭다운으로 변경하고, 상시 서브탭용 본문 여백을 제거

---

## v1.0.84 (2026-06-05)
### 고객 위치 지도 고객 마스터 기준 전환
- **고객 좌표 저장 컬럼 추가**: `customers.lat`, `customers.lon` 컬럼을 추가하고 `init_db()`에서 기존 DB에도 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`로 보강되도록 처리
- **고객 API 좌표 입출력 추가**: `GET/POST/PATCH /customers`가 고객 주소 좌표를 응답·저장하도록 수정. PATCH에서는 `lat`/`lon`이 명시적으로 전달된 경우 `null`도 반영해 주소 좌표를 지울 수 있도록 처리
- **고객 위치 탭 기준 변경**: `고객관리 > 고객 위치`가 기존 오더 하차지 좌표 파생 목록이 아니라 고객 마스터의 `lat`/`lon` 기준 위치 목록과 지도 마커를 표시하도록 변경
- **주소 자동완성 좌표 저장 연결**: 고객 추가·수정 모달에서 주소 자동완성 선택 시 도로명/지번 주소와 함께 카카오 좌표를 고객 레코드에 저장하도록 연결. 직접 입력으로 주소를 변경하면 기존 좌표를 제거
- **미사용 위치 모달 제거**: 오더 하차지 파생 위치를 로컬 배열에 추가·편집하던 미사용 `locModal()` 코드를 제거

---

## v1.0.83 (2026-06-05)
### 고객관리 주소 자동완성 추가
- **고객 추가·수정 주소 자동완성 적용**: `고객관리 > 고객 관리`의 `+ 추가` 및 `수정` 모달 주소 입력칸에 기존 카카오 장소 자동완성 UI를 재사용하도록 적용
- **주소 저장값 정리**: 고객 주소칸에서 자동완성 항목을 선택하면 장소명보다 도로명주소/지번주소를 우선 입력하도록 분기해 고객 마스터 주소값이 실제 주소 형태로 저장되도록 보강

---

## v1.0.82 (2026-06-05)
### 오더 접수 엑셀 양식·임시 화주 흐름 보강
- **엑셀 접수 양식 다운로드 추가**: `오더관리 > 접수창`에 `양식 다운로드` 버튼을 추가해 `화주명`, `상차지`, `하차지`, `수취인`, `연락처`, `화물종류`, `중량톤`, `희망도착일시`, `혼재여부` 헤더를 가진 업로드 템플릿을 내려받을 수 있도록 구현. SheetJS 사용 가능 시 `.xlsx`, 실패 시 UTF-8 BOM 포함 `.csv`로 fallback
- **빈 화주 목록 임시 추가 UX 수정**: 화주 데이터가 0건일 때 select가 `+ 임시 화주 추가` 옵션 하나만 가진 상태로 시작해 change 이벤트가 발생하지 않던 흐름을 수정. `등록된 화주 없음` placeholder와 별도 `+ 임시 화주 추가` 버튼을 추가해 고객 마스터가 비어 있어도 임시 화주 등록 모달로 바로 진입 가능
- **임시 화주 등록 후 자동 반영**: 접수창에서 임시 화주를 생성하면 해당 화주가 즉시 select에 추가·선택되고 연락처 입력칸에도 생성 연락처가 반영되도록 정리

---

## v1.0.81 (2026-06-05)
### Footer 법적 안내 페이지 추가
- **대시보드 footer 안내 영역 추가**: 관리자 대시보드 하단에 저작권, 졸업작품 고지, 운영 데이터 안내 문구와 `이용약관`/`개인정보 처리방침`/`저작권 안내`/`문의` 링크를 추가
- **법적 안내 정적 페이지 추가**: `terms.html`, `privacy.html`, `copyright.html`, `contact.html`을 추가해 footer 버튼 클릭 시 별도 페이지로 이동하도록 구현. 각 페이지에는 졸업작품·시연 환경에 맞춘 이용 기준, 개인정보 처리 기준, 저작권 안내, 문의 절차를 작성
- **랜딩·소개 footer 링크 보강**: `index.html`, `intro.html` footer에 법적 안내 페이지 링크와 저작권 문구를 추가
- **footer 위치 수정**: 대시보드 앱 컨테이너의 `height: 100vh`/내부 스크롤 잠금 구조를 완화해 footer가 화면에 고정되지 않고 문서 흐름의 페이지 하단에 표시되도록 수정

---

## v1.0.80 (2026-06-05)
### 목업 기반 오더·배차 UI/UX 이식
- **오더 목록 다중 선택 UX 추가**: `오더관리 > 오더 목록`에 체크박스, 현재 페이지 선택/해제, 선택 해제, 선택 건 수 요약 바를 추가. 행 클릭은 상세 조회, 체크박스는 일괄 선택으로 역할을 분리
- **선택 오더 배차지정 이동 추가**: 오더 목록에서 선택한 접수 상태 오더를 `배차·지정 > 단건·수동 배차`의 선택 상태로 넘겨 바로 배정할 수 있도록 연결
- **일괄 자동 배차 UI 개편**: 기존 차량 체크리스트 중심 화면을 `미배정 오더 풀 + 가용 기사 카드 + 기사에게 배정 + 일괄 배차 실행` 구조로 변경. 기사 다중 선택, 오더 다중 선택, 기사별 배정 오더 수 표시를 추가하고 기존 `/trips/auto-dispatch` 호출과 연결
- **단건·수동 배차 다중 선택화**: 기존 단일 라디오 선택을 체크박스 기반 다중 선택으로 변경하고, 같은 차량·기사로 여러 접수 오더를 한 번에 확정할 수 있도록 요청 구성을 묶음 처리
- **선택 상태 시각화 보강**: 선택된 행과 배정 실행 바의 강조 스타일을 추가해 목업의 선택/실행 흐름을 현재 대시보드 다크 테마에 맞게 이식

---

## v1.0.79 (2026-06-04)
### 대시보드 차량 위치·오더 카드 보강
- **대시보드 차량 위치 초기 표시 수정**: `/vehicles` 응답의 `last_gps`, `driver_id`, `driver_name`을 `DATA.vehicles`에 보존하고, 대시보드 지도 진입 시 기존 GPS 기반 기사/차량 마커를 즉시 렌더링하도록 수정. 기존에는 위치 WS 수신 이후에만 마커가 표시될 수 있었음
- **실시간 위치 동기화 보강**: 위치 WS 수신 시 지도 마커뿐 아니라 차량의 `start_lat/start_lon`, `last_gps_label`, `last_gps_at`도 갱신해 재렌더 후에도 최신 위치가 유지되도록 수정
- **차량 API 조직 격리 보강**: `_vehicle_schema()`의 연결 기사 조회에 `User.organization_id == Vehicle.organization_id` 조건을 추가해 차량 응답의 `driver_id`/`driver_name`이 같은 조직 기사만 참조하도록 정리
- **대시보드 오더 카드 5건 제한**: 대시보드 첫 화면의 오더 요약 카드만 상태별 최대 5건 표시로 제한하고, 오더 관리 페이지 목록/페이지네이션은 기존 동작을 유지

---

## v1.0.78 (2026-06-04)
### 슈퍼관리자 설정·대시보드 UX 정리
- **기업 가입 신청 자동 수락 토글 추가**: `app_settings` 테이블과 `GET/PATCH /superadmin/settings` API를 추가하고, `superadmin.html` 운영 설정 탭에서 신규 기업 가입 신청 자동 승인 여부를 제어하도록 구현. ON 상태에서는 `POST /organizations`가 기업을 즉시 `approved`로 생성하고 승인 메일을 발송
- **RouteOn 로고 교체**: `/tmp/RouteOnLogo.png`를 `frontend/routeon_logo.png`로 반영하고, 로그인/가입/기사 화면뿐 아니라 관리자 대시보드·슈퍼관리자 탑바도 이미지 로고를 사용하도록 변경
- **일정·통계 탭 통합**: 기존 독립 메인 탭 `운행 통계`를 제거하고 `일정·업무`를 `일정·통계`로 변경. `사후 통계`를 일정·통계의 4번째 하위 탭으로 이동하고 기존 `main=stats` 쿼리는 `schedule`로 호환 처리
- **오더 등록 시간 표시**: `deliveries.created_at`은 기존 DB/API에 존재하므로 프론트 `DATA.orders.created_at`으로 보존하고 오더 목록·상세에 `접수시간`을 표시
- **리프레시 스크롤 보존**: `loadRealData()` 재렌더 전후 스크롤 위치를 저장·복구해 새로고침/동기화 후 화면이 상단으로 튀는 현상을 완화
- **연락처 양식 통일**: 백엔드 공통 `normalize_phone()`과 프론트 정규화 함수를 추가해 회원·고객·오더·기업·슈퍼관리자 연락처를 `010-0000-0000` 계열 형식으로 저장·표시

---

## v1.0.77 (2026-06-04)
### 문서 구조 정리 및 최신화
- **문서 역할 분리**: `CHANGELOG.md`는 완료된 버전별 변경 이력만 남기고 중복된 `예정 작업`/백로그 섹션 2건 제거
- **CLAUDE 로드맵 축약**: `CLAUDE.md`의 긴 완료 체크리스트를 삭제하고, 완료 이력은 `CHANGELOG.md`를 단일 출처로 참조하도록 변경. 남은 작업/장기 과제만 짧게 유지
- **API 문서 최신화**: `CLAUDE.md`에 최신 Waypoint 연락처 필드, `trip.cancelled`/`trip.progress_updated` WS 이벤트, 사용자·차량·배송 수정 API를 반영
- **DB 연동 주석 최신화**: `DB_SCHEMA.md`의 Trip 취소 흐름과 차량 `weight_kg` 프론트 매핑 설명을 현재 코드 기준으로 정리

---

## v1.0.76 (2026-06-04)
### 기사 앱 API 정합성 보강
- **웹 배차 취소 앱 동기화**: `PATCH /trips/{id}/status?status=cancelled` 처리 시 Trip뿐 아니라 연결된 진행 배송도 `cancelled`로 변경하고 기사 앱 WS에 `trip.cancelled` 이벤트를 전송하도록 수정. 오더 취소가 연결 Trip의 마지막 진행 배송을 취소하는 경우에도 같은 이벤트를 전송
- **세부 운행 단계 기록 추가**: `trips.current_phase`, `trips.phase_updated_at` 컬럼과 `PATCH /trips/{id}/progress` API 추가. 앱에서 상차/하차 waypoint 도착·출발 이벤트를 보내면 `waypoints[].arrived_at/departed_at`과 현재 단계(`loading_arrived`, `loading_completed`, `unloading_arrived`, `unloading_completed` 등)를 기록
- **화주 연락처 전달 보강**: `deliveries.contact_phone`, `deliveries.shipper_phone` 컬럼 및 API 필드 추가. `GET /trips`/`GET /trips/{id}`의 waypoint 응답에 화주명, 담당자명, 담당자 연락처, 화주 연락처를 포함하도록 수정
- **기사 취소 요청 사유 필수화**: `POST /trips/{id}/cancel-request`가 `{ "reason": "..." }`를 필수로 받아 저장·브로드캐스트하고, 관리자 승인 시 취소 처리와 앱 알림을 동일 경로로 수행

---

## v1.0.75 (2026-06-03)
### 프론트엔드 오류 발견점 수정
- **오더 상태 불일치 수정**: 오더 수정 모달에서 백엔드 `DeliveryStatus`에 없는 `scheduled` 값을 보내던 `배차` 옵션 제거. 배송 상태 변경은 `접수`/`운행중`/`완료`/`취소`만 전송하도록 정리
- **기사 앱 전달 목업 제거**: `기사 앱 전달` 버튼을 `앱 조회 상태`로 변경하고, 실제 푸시 알림 전송처럼 보이던 문구를 Trip 생성 후 앱 목록에서 조회 가능하다는 안내로 수정
- **차량 최근 GPS 고정 좌표 제거**: 차량 출발 좌표를 인천 고정값으로 세팅하던 프론트 로직 제거. `/vehicles` 응답의 연결 기사 최신 GPS를 사용하고, 미수신 시 `GPS 미수신`으로 표시
- **접수창 기존 오더 샘플 기본값 제거**: 새 접수 화면이 기존 접수 오더의 고객/희망도착 값을 기본 선택하지 않도록 변경

### 조직 데이터 정합성
- **차량/배송 조직 격리 추가**: `vehicles.organization_id`, `deliveries.organization_id` 컬럼을 추가하고, 차량·배송 조회/생성/수정/삭제/배정 API를 관리자 소속 조직 기준으로 제한
- **기사 배송 완료 권한 보강**: `/deliveries/{id}/complete`는 본인에게 배정된 배송만 완료 가능하도록 검증 추가

---

## v1.0.74 (2026-06-03)
### 프론트엔드 통합 진입점 정리
- **독립 관리 페이지 레거시화**: `stats.html`, `drivers.html`, `vehicles.html`의 중복 구현을 제거하고 각각 통합 대시보드의 운행 통계·기사 관리·차량 관리 탭으로 리다이렉트하도록 변경
- **대시보드 직접 탭 진입 지원**: `/dashboard.html?main=stats&page=trip-stats`, `/dashboard.html?main=basic&page=drivers`, `/dashboard.html?main=basic&page=vehicles` 쿼리 파라미터로 원하는 탭을 바로 열 수 있도록 `dashboard.js` 초기 라우팅 보강
- **문서 정합성 갱신**: `CLAUDE.md`의 프론트엔드 구조와 기사/차량/통계 진입점 설명을 통합 대시보드 기준으로 갱신

---

## v1.0.73 (2026-06-03)
### 정합성 정리
- **FastAPI 버전 표기 갱신**: `/docs` 메타 버전 `0.3.0` → `1.0.73`으로 변경해 CHANGELOG 기준 버전과 일치시킴
- **프론트 API/WS URL 하드코딩 제거**: 관리자/기사/설정/통계/차량/슈퍼관리자/로그인/가입/채팅 화면의 `168.138.45.63:8000` 고정값 제거. Nginx 경유 접속은 `/api`·`/ws`, 로컬/비표준 포트 접속은 `:8000` 직접 접근으로 자동 계산
- **승인 이메일 링크 정리**: `http://168.138.45.63:3000/login.html` 하드코딩 제거, `PUBLIC_BASE_URL` 환경변수 기반으로 `/login.html` 생성
- **문서 구조 정합성 수정**: `CLAUDE.md`의 `main.py 단일 파일` 설명을 라우터 분리 구조로 갱신
- **Git 추적 정책 정리**: GraphHopper cache/JAR/PBF 및 로컬 통합 테스트 스크립트를 `.gitignore`에 추가

---

## v1.0.72 (2026-06-03)
### 버그 수정
- **기사 앱 운행 목록 하차지 누락 수정**: 수동 `POST /trips` 생성 시 하차지가 `dest_name/dest_lat/dest_lon`에만 저장되고 `waypoints`에는 상차지만 남아 기사 앱에서 `unloading_count=0`으로 표시되던 문제 수정. 신규 Trip 생성 시 `dest_*` 목적지를 `type=unloading` waypoint로 자동 보강하고, 기존 Trip도 `/trips` 조회 응답에서 동일 좌표 중복 없이 하차 waypoint를 보강하도록 변경

---

## v1.0.71 (2026-06-03)
### 버그 수정
- **배차 waypoints cargo 필드 누락 수정**: `POST /trips/auto-dispatch` 호출 시 waypoints에 `cargo_type`, `cargo_weight_ton`, `recipient_name`이 null로 전달되던 문제 수정. 프론트엔드 일괄 배차(`renderBulkDispatch`)·수동 배차(`renderDispatchAssign`) tasks 구성 2곳 + 백엔드 `dispatch.py` waypoints dict 빌드 1곳, 총 3곳 누락 필드 추가

---

## v1.0.70 (2026-06-03)
### 자동완성 드롭다운 다크모드 대응
- **배경 다크모드 대응**: 드롭다운이 `background:#fff` 고정으로 다크모드에서도 흰 배경 표시되던 문제 수정. `var(--dark-card, #1c2029)`로 교체
- **테두리·그림자**: `var(--border, #e5e7eb)` 라이트값 → `var(--dark-border, rgba(255,255,255,.08))`, 그림자 불투명도 0.12 → 0.45
- **텍스트 색상 통일**: 장소명(`<strong>`) 미지정 색 상속(body의 밝은 `--t-text`) → `var(--t-text-muted, #8b93a7)`, 카테고리 `var(--primary)` → `var(--t-text-muted)`, 주소도 동일값으로 통일. 흰 배경에서 안 보이던 텍스트 해결
- **hover 배경**: `var(--bg-hover, #f9fafb)` → `var(--t-card-hover, #252a35)`
- **항목 구분선**: `var(--border, #f3f4f6)` → `var(--dark-border, ...)`

---

## v1.0.69 (2026-06-03)
### 오더 접수창 UX 개선
- **상차지·하차지 기본값 제거**: 접수창 진입 시 기존 오더 데이터를 샘플로 상차지·하차지가 자동 입력되던 문제 수정. 항상 빈 값으로 시작
- **자동완성 표시 개선**: 같은 주소의 여러 장소(예: `오패산로 46` → `하나은행 월곡동지점` / `서울축산농협하나로마트`)가 드롭다운에서 구분되도록 개선. 중복 `place_name` 제거 + 실제 장소명 우선 정렬 + `category_group_name` 뱃지(파란 소문자) 표시. 최대 표시 건수 6→7개로 확대
- **자동완성 키보드 화살표 이동 시각 피드백 추가**: ArrowDown/ArrowUp으로 이동 시 배경색 하이라이트가 없던 문제 수정. `setActive()` 헬퍼로 클래스·배경 동기화. 마우스 hover도 동일 함수 사용으로 통일

---

## v1.0.68 (2026-06-03)
### 버그 수정 / UX 개선
- **위치 목록 — 추가·편집 버튼 제거**: `locModal` 추가·편집이 로컬 메모리만 변경하고 새로고침 시 초기화되던 문제 수정. 위치 목록은 오더 하차지 주소에서 자동 파생되는 읽기 전용 뷰로 변경하고, 헤더에 "오더 하차지 주소 기준 자동 생성" 안내 추가
- **배차 에러 핸들러 — `console.error(err)` 제거**: 일괄 배차·단건 배차 오류 핸들러에서 콘솔 노출 코드 2건 제거
- **수동 재배정 버튼 UX 개선**: `#manualReassign` 클릭 시 toast 안내만 표시하던 동작을 `#sec-dispatch-pending` 섹션으로 스크롤 + toast로 개선

---

## v1.0.67 (2026-06-03)
### 버그 수정
- **오더 수정 저장 — 운행중 상태 변경 불가 버그 수정**: `orderIsEditable(o)`가 `접수` 상태에서만 `true`여서 운행중·배차 상태 오더는 저장 콜백이 "조회 완료"로 빠지던 문제 수정. `canSave = status !== '완료' && status !== '취소'`를 분리해 완료·취소 외 모든 상태에서 상태 변경 저장 가능. 주소·화물 필드 수정은 기존대로 접수 상태에서만 허용. 상태 드롭다운도 완료·취소 시 `disabled` 처리

---

## v1.0.66 (2026-06-03)
### 미구현 기능 2건 구현
- **경로 계산 버튼 실 API 연동** (`bindRouteCalc`): 단건 배차 화면 "경로 계산" 버튼이 300ms 딜레이 목업만 실행하던 문제 수정. `POST /route/preview` 엔드포인트(GraphHopper 실 도로 경로) 신규 추가, 차량 출발→상차→하차 좌표 전달 후 실제 도로 거리·소요 시간 목록에 표시. 지도 인스턴스(`_dispatchRouteMapInstance`)에 경로선 오버레이 추가
- **기사 앱 배차 알림 WS 브로드캐스트** (`btnAppHandoff`): `POST /trips/auto-dispatch` 완료 후 각 기사에게 `trip.assigned` 이벤트 WS 브로드캐스트 추가(`manager.broadcast_replan_to_org`). 기사 앱이 연결 중이면 즉시 수신. "기사 앱 전달" 버튼 모달 문구 "안내" → "완료"로 수정

---

## v1.0.65 (2026-06-03)
### 프론트엔드 점검 후 수정 (5건)
- **`intakeMixedLoadRadioHtml` 두 번째 라디오 class 누락 수정**: `value="1"` (혼적) 라디오에 `class="intake-field"` 및 `data-intake-field` 속성 없어 `getIntakeFields()` 수집에서 누락되던 문제 수정
- **`btnFinalCheck` 첫 번째 플랜 고정 수정**: "순서·노드 최종 확인" 모달이 항상 `plans[0]`만 표시 → 현재 선택 탭 `plans[tabIdx]` 기준으로 수정
- **`showTripRoutePolyline` 지도 중복 생성 수정**: 기존 `_tripRouteMapInstance` 미정리 상태에서 `new kakao.maps.Map()` 재호출 → `el.innerHTML = ''`로 DOM 초기화 후 재생성하여 인스턴스 중첩·메모리 누수 방지
- **오더 수정 저장 시 `status` 미전달 수정**: 상태 드롭다운 선택값이 `PATCH /deliveries/{id}` body에 포함되지 않던 문제 → 한글→영문 역매핑(`'접수'→pending` 등) 후 전달
- **오더 수정 저장 시 좌표 재조회 누락 수정**: 상·하차지 주소 변경 시 좌표가 이전 값 그대로 유지 → `GET /address/coord` 병렬 호출로 좌표 재조회 후 body 포함, API 응답(`lat/lon/pickup_lat/pickup_lon`)으로 `DATA.orders` 즉시 갱신

---

## v1.0.64 (2026-06-03)
### 논리·설계 오류 점검 후 수정 (6건)
- **`location.py` 도착 감지 500 수정**: `delivery.lat`이 null인 배송에서 `LatLng(lat=None)` Pydantic 오류 → null 체크 후 continue 처리
- **`auth.py` org_code 재발급 수정**: `User.license_number`에 저장하던 잘못된 로직 → `Organization.org_code` 필드 업데이트로 수정. `GET /auth/me`도 `Organization` 테이블에서 실제 org_code 반환하도록 수정
- **`dispatch.py` auto-dispatch 후 Delivery 미연결 수정**: Trip 생성 후 관련 Delivery의 `trip_id`/`assigned_to`/`status` 미업데이트 문제 → unloading에 `delivery_id` 전달 시 일괄 업데이트 로직 추가. `WaypointSchema`에 `delivery_id` 옵션 필드 추가
- **`_delivery_schema` trip_id 필드 누락 수정**: API 응답에 `trip_id`가 없어 클라이언트가 연결 확인 불가 → 필드 추가
- **`collectIntakeRows` 좌표 미수집 수정**: 대기열 추가 경로(`commitIntakeRow → collectIntakeRows`)에서 `dataset.lat/lon` 미수집 — `collectIntakeRow`(단수)만 고쳐진 v1.0.63의 누락 보완. 추가 상차지/하차지도 포함
- **`clearIntakeRow` dataset 잔존 수정**: `el.value = ''`만 하고 `dataset.lat/lon` 미초기화 → 이전 좌표 잔존 문제 수정
- **`commitPendingRowsToOrders` 좌표 미반영 수정**: 저장 직후 `DATA.orders`에 `lat/lon/pickup_lat/pickup_lon` 미포함 → 즉시 배차 시 좌표 없는 오더로 처리되던 문제 수정
- 일괄 배차/수동 배차 tasks에 `delivery_id` 포함하여 백엔드 연결 완성

---

## v1.0.63 (2026-06-03)
### 배차 불가 버그 수정
- **접수창 좌표 미수집 수정**: `collectIntakeRow()`에서 `input.dataset.lat/lon`을 읽지 않아 모든 접수 건의 좌표가 null로 저장되던 문제 수정 — 카카오 Places 자동완성 선택 시 `pickup_lat/lon`, `lat/lon` 정상 수집
- **`commitPendingRowsToOrders` null 하드코딩 제거**: `lat/lon/pickup_lat/pickup_lon`을 null로 고정하던 코드 → `r.lat ?? null` 패턴으로 실값 전달
- **`DeliveryUpdate` 좌표 필드 추가**: `PATCH /deliveries/{id}`에 `lat/lon/pickup_lat/pickup_lon` 필드 없어서 좌표 업데이트 불가하던 문제 수정
- **`/location-logs` 500 오류 수정**: 기사 앱이 null 좌표 전송 시 Pydantic `float` 타입 validation 실패 → `lat/lon` Optional 처리, null이면 저장 스킵
- **기존 pending 배송 좌표 복구**: 좌표 없던 6건을 카카오 geocoding API로 일괄 복구

---

## v1.0.62 (2026-06-03)
### 프론트엔드 미완성·개선 항목 전체 구현
- **WebSocket URL 하드코딩 제거**: `connectLocationWebSocket`/`connectChatWebSocket` 내 `ws://168.138.45.63:8000` 하드코딩 → `API.replace(/^http/, 'ws')` 패턴으로 통일
- **차량 상태·연결기사 DB 저장**: `vehicles.status` 컬럼 추가 (DEFAULT '가용'), `VehicleUpdate` 모델에 `status`/`driver_id` 필드 추가, PATCH 저장 시 `User.vehicle_id` 동기화
- **기사 상태·배정차량 DB 저장**: `users.vehicle_id`(FK→vehicles), `users.driver_status` 컬럼 추가, `PATCH /users/{id}` 엔드포인트 신설, 프론트 `bindDriverDetail` async PATCH 호출
- **기사/차량 데이터 로딩 개선**: `loadRealData`에서 `u.vehicle_id`, `u.driver_status`, `v.status` 반영 (기존 하드코딩 제거)
- **캘린더 이전/다음 달 이동**: `calendarYear`/`calendarMonth` 상태 변수 추가, `renderScheduleCalendar`에 `‹ ›` 버튼 + "오늘" 버튼 구현
- **통계 기사별 거리 평균**: `GET /stats/by-driver` 응답에 `avg_distance_km` 추가 (`func.avg(dist_col)`) — 프론트 `distAvg` 바인딩
- **통계 탭 자동 차트 로드**: 탭 진입 시 `setTimeout(() => statsApply.click(), 0)` 자동 호출
- **접수창 카카오 Places 자동완성**: `bindPlaceSearch` 함수 추가 — `keywordSearch` 결과 드롭다운 (키보드 ↑↓ 네비게이션, Enter 선택, Esc 닫기), 선택 시 `dataset.lat/lon/address` 저장
- **오더 목록 접수창 이동 버튼**: `renderOrderList` card-hd에 `+ 접수 창` 버튼 추가

---

## v1.0.61 (2026-06-03)
### 미완성 기능 구현
- **`bindRouteCalc` 경로 계산**: `DATA.routePreview` 빈 배열 표시 → 선택된 오더의 픽업지·하차지 + 차량 출발점을 실시간 경유지 목록으로 표시 (좌표 포함)
- **고객 위치 탭 `DATA.locations` 채우기**: 항상 비어있던 위치 목록 → `DATA.orders`의 고유 하차지 좌표(lat/lon)를 파생하여 표시 (고객 목록 로드 후 customerId 매핑)
- **`locModal` 저장 구현**: 위치 추가·편집 모달에 저장 콜백 추가 — `DATA.locations`에 메모리 저장 후 페이지 재렌더링
- **`btnTripCreate` Trip 생성**: 일괄 배차 후는 생성 완료 안내, 단건 배차 후는 `POST /trips` 호출로 실제 Trip 생성 (`driver_id`, `vehicle_id`, `waypoints` 전달)
- **`btnAppHandoff` 기사 앱 전달 안내**: 단순 토스트 → 배차 결과 기사·차량 목록을 모달로 표시
- **`bindDriverDetail` 토스트 개선**: "저장되었습니다" → "저장되었습니다 · Trip 생성 시 배정 차량이 반영됩니다" (메모리 전용 동작 명확화)
- **`_lastManualAssign` 변수 추가**: 단건 배차 확정 시 마지막 배정 정보(driverId, vehicleId, order) 저장 → Trip 생성 버튼에서 활용

---

## v1.0.60 (2026-06-03)
### 버그 수정 · 코드 정리
- **`toast` 에러 타입 지원**: `toast(msg, 'error')` 시 `.toast-error` 클래스 적용 → 에러 토스트 빨간색 구분 (CSS 추가)
- **`dispatchFleet` 기사 매핑 수정**: 차량 인덱스 기반 `DATA.drivers[i]` 매핑 → `DATA.drivers.find(d => d.vehicleId === v.id)` 실 배정 기반으로 수정
- **통계 차량 필터 적용**: `renderTripStats` 조회 시 `#statsVehicle` 선택값을 `vehicle_id` 파라미터로 `GET /stats/by-day` 전달 (기존에는 무시됨)
- **`fleet-driver-select` 타입 버그**: `Number(sel.value)` → `sel.value || null` — UUID 기사 ID가 NaN으로 변환되던 문제 수정
- **`(가짜 데이터)` 문구 제거**: `renderTripStats` 페이지 설명에서 잔존 표현 삭제
- **`normalizeDispatchListRow` 하드코딩 제거**: `{ T5: '인천', T6: '경남', T7: '경기' }` 가짜 데이터 매핑 삭제
- **`runAutoDispatch` 데드 코드 삭제**: `vehicle_ids` 오파라미터 + 미호출 함수 제거 (-13줄)
- **`pendingIntakes` 중복 제거**: 접수 저장 후 모듈 레벨 `pendingIntakes`에 중복 push하던 로직 제거 → `unassignedForDispatch`가 `DATA.orders`만 참조하도록 단순화

---

## v1.0.59 (2026-06-03)
### 코드 정리
- **목업 문구 제거**: 차량 GPS 패널 `앱 위치 로그 기준(목업)` → `앱 위치 로그 기준`, 임시화주 필터 설명 `숨김(목업)` → `숨김`
- **데드 코드 삭제**: `ROUTEON_GEN_TASKS` (4건 샘플 배열), `BULK_NODE_ROWS` (6건 샘플 배열 + `.map()` 블록) — 실 API 전환 후 미참조 상수
- **함수 리네임**: `mockNow` → `nowStr`, `mockToday` → `todayStr` — 실제 현재 시각/날짜 반환 함수에서 `mock` 접두사 제거 (6개소 전체 치환)

---

## v1.0.58 (2026-06-03)
### 배차 권역·거점 필터 연동
- **`dispatchRegionSel` / `dispatchSiteSel` 상태 변수 추가**: 필터 선택 값 유지 (페이지 재렌더 시에도 선택 유지)
- **`renderDispatchAssign` 필터 적용**: `_passRegion` / `_passSite` 함수로 `DATA.dispatchOrders` 및 미배차 건 테이블 실시간 필터링
  - **권역**: `addressToRegion(ord.pickup)` ↔ 선택 권역 일치 여부 (상차지 권역 기준), "전체" 시 필터 없음
  - **거점**: 선택 거점의 `region` ↔ 상차지 권역 일치 여부, "전체" 시 필터 없음
- **거점 select `전체` 옵션 추가**: 기존 하드코딩된 초기값 제거, "전체" 기본값으로 변경
- **선택값 HTML 동기화**: 재렌더 시 `dispatchRegionSel` / `dispatchSiteSel` 상태를 select에 반영
- **이벤트 리스너 바인딩**: 필터 변경 시 `renderDispatchAssign` 즉시 재호출
- **`runDispatch` 이중 필터**: 테이블 필터 외 실행 시에도 동일 조건 재적용 (안전망)

---

## v1.0.57 (2026-06-03)
### 접수창 복수 상·하차지 추가 기능 구현
- **`addIntakePickupStop`**: 태스크 카드 상차지 `stop-block`에 입력 행 동적 삽입, `data-extra-pickup` 속성으로 순번 추적, ✕ 제거 버튼 바인딩
- **`addIntakeDeliveryStop`**: 태스크 카드 하차지 `stop-block`에 입력 행 동적 삽입 (수신자·화물·톤수 필드 포함), `data-extra-delivery` 속성으로 순번 추적
- **`collectIntakeRows` 신규**: 기본 상/하차지 + extra row 전체 수집, `max(상차지수, 하차지수)`개 배송 건 pair-wise 생성 (초과분은 마지막 항목 재사용)
- **`commitIntakeRow` 수정**: 복수 row 배치 추가, 제출 후 extra row DOM 제거 + 순번 초기화
- **CSS `.extra-stop-row`**: 좌측 lime 바 구분선 + 제거 버튼 hover 빨간색

---

## v1.0.56 (2026-06-03)
### 오더관리 API 실 연동 완성 및 배차 일자 수정
- **오더 수정 저장 실 연동**: `openOrderEditModal` 저장 콜백 async 변환, `PATCH /deliveries/{id}` 실 호출 (address, pickup_address, cargo_type, cargo_weight_ton, recipient_name, contact_name, shipper_name, deadline 업데이트)
- **오더 취소 실 연동**: 취소 버튼 onclick async, `PATCH /deliveries/{id}` status=cancelled 실 호출
- **오더 삭제 실 연동**: 삭제 버튼 onclick async, `DELETE /deliveries/{id}` 실 호출
- **백엔드 `PATCH /deliveries/{delivery_id}` 신규 추가**: 상태(cancelled 포함) + 필드 부분 업데이트
- **PostgreSQL Enum 확장**: `deliverystatus` 타입에 `cancelled` 값 추가 (`ALTER TYPE`)
- **models.py `DeliveryStatus.cancelled`** 추가
- **deliveryStatusMap에 `cancelled: '취소'` 추가** — API 응답에서 취소 상태 오더 올바르게 표시
- **배차 일자 하드코딩 제거**: `value="2026-06-01"` → `new Date().toISOString().slice(0,10)` 오늘 날짜 동적 설정

---

## v1.0.55 (2026-06-03)
### 운행 중 교체·대차 Phase 2 — 목업 제거 및 실 API 연동
- `handoverMockDisclaimerHtml` / `mockNoticeHtml` 미사용 목업 함수 삭제
- 사고·지연 신고(`openAccidentReportModal`): `toast(목업)` → `PATCH /trips/{id}/safety` 실 호출 (safety_issue=true 저장)
  - 사유 필수 검증 추가, "인근 대차·환적 요청(목업)" → "(목업)" 제거
  - 성공 시 `loadRealData()` 후 카드 배지 즉시 갱신
- 차량 상세 저장(`bindVehicleDetail`): `toast(목업)` → `PATCH /vehicles/{id}` 실 호출
  - `vehicle_type`, `weight_kg` 업데이트 (톤급 → kg 변환 맵 적용)
- 백엔드 `PATCH /vehicles/{vehicle_id}` 엔드포인트 신규 추가 (`vehicle_type`, `weight_kg`, `height_m` 부분 업데이트)
- 기사 상세 저장 토스트에서 "(목업)" 문구 제거
- 기사·차량 상세 UI 레이블에서 "목업" 배지 제거

---

## v1.0.54 (2026-06-03)
### 대시보드 홈 화물 집계 실 데이터화
- `cargoChips` 하드코딩 배열 제거
- `DATA.orders`에서 화물 종류(`cargo`)별 그룹화, 중량(`tons`) 합산 → 상위 6종 칩으로 표시
- 데이터 없을 시 "접수된 화물 없음" 안내 텍스트 표시
- 대시보드 desc에서 "(목업 데이터)" 문구 제거

---

## v1.0.53 (2026-06-03)
### 접수창 엑셀 임포트 실 구현
- `renderOrderIntake` `#excelImport` 버튼: `toast(목업)` → SheetJS 기반 실 구현
- 헤더 행 자동 인식: 화주명/수취인/연락처/상차지/하차지/화물종류/중량/희망도착/혼재 컬럼 매핑
- 영문 헤더 지원: shipper, recipient, contact, pickup, delivery, cargo, tons, deadline, mixed_load
- 파싱 결과를 `addPendingIntake` 대기열에 일괄 추가 → 기존 `접수 저장` 버튼으로 DB 등록
- Date 객체·문자열·`YYYY-MM-DD` 형식 날짜 자동 변환 (YYYY-MM-DDTHH:mm)
- 혼재: y/yes/1/true/혼재/o → `true` 처리
- 하차지 또는 상차지 없는 행 자동 skip, 유효 행 0건 시 오류 toast

---

## v1.0.52 (2026-06-03)
### 내 정보 저장 실 API 연동 + admin 비밀번호 복구

#### `renderProfile` 재작성 (`frontend/dashboard.js`)
- **탭 구조 변경**: 기존 "화주 기본정보(목업)" → "내 정보" / "비밀번호 변경" 탭으로 분리
- **탭 1 "내 정보"**: `DATA.me`(`GET /auth/me`)로 아이디·이름·역할 읽기전용 표시, 전화번호 수정 → `PATCH /auth/me { phone }` 저장
- **탭 2 "비밀번호 변경"**: 현재·새·확인 비밀번호 입력 → 불일치·4자 미만 클라이언트 검증 후 `PATCH /auth/me { current_password, new_password }` 저장
- `DATA.me` 전역 저장: `loadRealData`에서 `GET /auth/me` 결과를 `DATA.me`에 보관 (탭 초기값·저장 후 즉시 반영)
- `DATA.shipper` 제거 (미사용 목업 필드)

#### 기타
- admin 계정 비밀번호 `admin123` 으로 재설정 (기존 해시 불일치 → `401` 로그인 실패 수정)

---

## v1.0.51 (2026-06-02)
### 배차 화면 실 API 연동

#### 일괄 자동 배차 (`renderBulkDispatch`)
- 목업 배너(`mockNoticeHtml`) 제거
- `stops` — `DATA.bulkDispatch.stops`를 `unassignedForDispatch()` 실 데이터로 갱신 (렌더링마다 동적 초기화)
- `vehicles` — `DATA.dispatchFleet` 기반으로 차량·기사 정보 매핑
- `#runBulkDispatch` 버튼: 체크된 기사의 `driver_ids` 수집 → `stops`를 `AutoDispatchTask[]`로 변환 (좌표 없는 건 자동 제외) → `POST /trips/auto-dispatch` 호출 → 결과 Trip을 `plans` 형태로 변환·표시
- `#bulkDepotMap` 버튼: 센터 이름/주소 입력 → `GET /address/coord` 좌표 변환 → depot 좌표 갱신
- `bulk-vehicle-select`·`bulk-driver-select` 변경 시 `DATA.dispatchFleet`도 동기화
- 배차 완료 후 카카오맵 렌더링: 센터 위치(`bulkDepotMapPreview`) 및 결과 경로(`bulkRouteMap`)
- `혼적 허용` 체크박스 목업 toast 제거
- 미배정 건 수동 재배정 버튼: 목업 toast → 단건·수동 배차 탭으로 이동

#### 단건·수동 배차 (`renderDispatchAssign`)
- 목업 배너(`mockNoticeHtml`) 제거
- `DATA.dispatchOrders` — 렌더링마다 `unassignedForDispatch()`로 동적 초기화
- `#runDispatch` 버튼: 체크된 `#fleetChecklist` 기사 + `.dispatch-chk:checked` 오더 수집 → `POST /trips/auto-dispatch` → `DATA.dispatchPlans`·`DATA.dispatchAssigned`·`DATA.dispatchUnassigned` 갱신
- `#addDispatchOrder` 버튼: 상차지·하차지 주소 입력 → `GET /address/coord` 좌표 변환 → `POST /deliveries` 단건 등록
- `#singleDispatch` 버튼: 배송 건 드롭다운 선택 + 기사 지정 → `PATCH /deliveries/{id}/assign`
- `#manualReassign`: 미배정 건 수 안내 toast
- `#btnTripCreate`: "배차 실행 시 Trip 자동 생성" 안내
- `#btnAppHandoff`: "기사 앱에서 /optimize 실행 시 운행 시작" 안내
- 배차 완료 후 카카오맵: 선택 건 출발-도착 마커(`dispatchRouteMap`), 배차 결과 경유지 마커

---

## v1.0.50 (2026-06-02)
### UI 레이아웃 버그 4건 수정
- **접수 버튼 벗어남**: `.intake-actions`에 `position:sticky;bottom:0` 적용, `.intake-viewport` 레이아웃을 `height:100%` 기반 → flex 기반으로 교체
- **좌우 패널 높이·위치 어긋남**: `.master-detail-split`에 `grid-template-rows:1fr` 추가, `.master-detail-list/.master-detail-pane`에 `height:100%` 추가, `inline-detail margin-top:0` 재정의
- **고객 위치 두 번째 로드 안뜸**: `renderCustomerLoc()` 진입 시 `_miniMapInstance = null` 초기화 → 매 렌더마다 새 카카오맵 인스턴스 생성
- **자기사·차량 좌측 패널 미채움**: 위 `grid-template-rows:1fr` 수정으로 동시 해결

---

## v1.0.49 (2026-06-02)
### 대시보드 필터 클릭 시 지도 사라짐 버그 수정
- **원인**: `renderDashboard(root)` 내 `root.innerHTML = ...` 실행 시 `.dash-map-card` 안에 있던 `#map-container`가 같이 파괴됨 → `showDashboardMap()`에서 `getElementById('map-container')` null 반환 → 지도 미복원
- `renderDashboard()` 시작에 `hideDashboardMap()` 호출 추가 → innerHTML 이전에 `#map-container`를 body로 이동 보장

### 다크모드 모달 흰 배경 버그 수정
- **원인**: `dashboard.css .modal { background: #fff }` 하드코딩, `.modal-hd/.modal-ft` 보더가 `var(--border)` 라이트값 고정
- `.modal` 배경을 `var(--dark-card)`, 텍스트를 `var(--t-text)`, 박스섀도 강화
- `.modal-hd`, `.modal-ft` 구분선을 `var(--dark-border)`로 변경
- `.modal input/select/textarea` 다크 스타일 추가
- 라이트모드(`html[data-theme="light"]`) 오버라이드로 흰 배경 유지

---

## v1.0.48 (2026-06-02)
### vehicles weight_kg 필드명 불일치 버그 수정
- **원인**: API 응답은 `weight_kg`인데 프론트가 `max_load_kg`로 접근 → 항상 `undefined` → 톤수 "0.0톤" 표시
- `loadRealData()` 차량 매핑: `v.max_load_kg` → `v.weight_kg`, 저장 키 `max_load_kg` → `weight_kg`
- `vehiclePreviewHtml()`: `max ${v.max_load_kg} kg` → `max ${v.weight_kg} kg`
- `applyVehicleMetaToRow()`: `max_load_kg` in row 체크 → `weight_kg`
- 일괄배차 차량 프리뷰: `max ${v.max_load_kg} kg` → `max ${v.weight_kg} kg`

---

## v1.0.47 (2026-06-02)
### 배차 탭 빈 페이지 버그 수정
- **원인**: `DATA.dispatchPlans = []`일 때 `plan = undefined` → template literal 내 `plan.visits.map()` / `plan.duration` / `plan.distance` 즉시 평가 → TypeError → `root.innerHTML` 미설정 → 단건·수동 배차·일괄 배차 탭 완전 공백
- `renderDispatchAssign`: `plan?.visits`, `plan?.duration`, `plan?.distance`, `plan?.mixed_load` optional chaining 적용
- `renderBulkDispatch`: 동일 패턴 수정 (`plan?.plate`, `plan?.driver` 포함)

---

## v1.0.46 (2026-06-02)
### 일정 캘린더/간트/마일스톤 실 API 연동
- **캘린더**: `GET /trips` + `GET /deliveries` → 현재 월 동적 표시, 이달 이벤트 수 뱃지, 날짜 셀 dot 표시
- **간트**: 오늘 날짜 운행(`started_at` 기준) + 진행중(`in_progress`) 운행 → 06–21시 타임라인 자동 배치, 빈 상태 안내
- **마일스톤**: 취소 제외 운행 이력 최근 30건, 완료·진행중·예정 상태 뱃지, 빈 상태 안내
- `renderJune2026CalendarHtml()` → `renderCalendarGridHtml(year, month)` 동적 함수로 교체

---

## v1.0.45 (2026-06-02)
### 담당자(staff) 실 API 연동

**프론트엔드**
- `GET /users?role=admin`: 담당자 탭 로드 시 같은 조직 관리자 계정 목록 실 조회 (`DATA.staff`)
- 테이블 컬럼 변경: 이름 / 아이디(username) / 연락처 / 가입일 (목업 역할 드롭다운 제거)
- 본인 행에 `나` 배지 표시
- 상세 패널: 읽기 전용 필드 (이름·아이디·연락처·가입일), "설정 페이지에서 직접 변경" 안내
- 삭제 버튼 → `DELETE /users/{id}` (본인은 삭제 불가 — 백엔드도 400 반환)
- 추가 모달 → `POST /auth/register` `role=admin`: 이름·아이디·비밀번호·연락처 입력, 조직코드 자동 조회(`GET /organizations/me`)
- `selectStaff()` UUID 문자열 비교로 수정 (`Number()` 변환 제거)

---

## v1.0.44 (2026-06-02)
### 페이지네이션 실 구현

**프론트엔드**
- `PAGE_SIZE = 20`, 리스트별 독립 페이지 상태: `orderPage` / `vehiclePage` / `customerPage` / `driverPage`
- `paginationHtml(totalItems, currentPage, listKey)`: 실제 필터된 건수 기반 페이지 계산, 1페이지이면 UI 미표시
- ‹ 이전 / 번호 / 다음 › 버튼, disabled 처리, `X / Y 페이지` 표시 — "(목업)" 문구 제거
- 필터(칩) 또는 검색어 변경 시 해당 리스트 페이지 1 자동 리셋
- 적용 범위: 오더 목록 · 차량 목록 · 고객(거래처) 목록 · 기사 목록

---

## v1.0.43 (2026-06-02)
### 채팅 알림 WS 연동

**프론트엔드**
- `connectChatWebSocket()`: WS `/ws/chat` 수신 전용 경량 연결, 5초 자동 재연결
- `loadChatConversations()`: 대시보드 초기 로드 시 `GET /chat/conversations`로 기존 unread_count 일괄 반영
- `updateChatNotifUI()`: 🔔 빨간 점 배지(unread > 0 시 표시) + 알림 드롭다운 미읽 기사 목록(클릭 시 chat.html 새 탭) + 기사 테이블 행 unread 배지 동시 갱신
- `_convDriverMap` (conversation_id → driver_id): WS 이벤트와 기사 카드 매핑
- `chat.message` 수신: `sender_id ≠ currentUserId`이면 해당 기사 unread +1
- `chat.read` 수신: `reader_id === currentUserId`이면 해당 기사 배지 0 초기화

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
