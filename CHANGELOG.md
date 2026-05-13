# RouteOn Changelog

버전 관리 규칙:
- `0.x` — 개발 중 (기능 추가/수정 활발)
- `1.0` — 첫 안정 릴리즈 (발표 버전)

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

## v0.2.1 (2026-04-13)

### 신규 API 추가

- `GET /organizations/lookup?org_code=` — 조직코드로 기업명 조회 (v0.2에 통합)
- `GET /auth/check-username?username=` — 아이디 중복 확인 (v0.2에 통합)

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

## v0.6 (2026-05-06)

### 지도 POI 팝업 개선 + UX 최적화

**관리자 웹**
- 지도 클릭 팝업: 장소명·주소·전화번호·카테고리·카카오맵 링크 표시
- POI 조회: Places keywordSearch 2단계 폴백 추가
- Places API `place_name` 우선 사용 (`building_name` 덮어씌우기 제거)
- 지도 POI 호버 시 포인터 커서 전환 + 이중 캐시로 응답속도 최적화

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

## 예정 작업

### 진행 중 / 단기
- [ ] Android 앱: `/optimize` 호출 시 `dest_name/dest_lat/dest_lon` 파라미터 지원 (팀원 A)
- [x] 긴급 경유지 추가(`PATCH /trips/{id}/waypoints`) type=unloading 기본값 E2E 검증 — 정상 동작 확인
- [x] 상차지 인근 기사 확인 — `GET /nearby-drivers` 구현 완료

### 기능 개발 백로그
- [x] **관리자 프리셋 기능** — 자주 쓰는 상차지/하차지 조합 저장·불러오기·삭제
- [x] **폴리라인 개선** — 기사별 단일 색상 + 지나온 구간 실시간 투명화
- [ ] **UI/UX 리팩토링** — 관리자 웹 전반 일관성 개선, 컴포넌트 정리
- [ ] **카카오 소셜 로그인** — 회원가입·로그인 시 카카오 OAuth 연동
- [ ] **카카오톡 알림** — 운행 배차·경유지 추가·완료 등 주요 이벤트 카카오톡 메시지 발송

### 마무리
- [ ] 발표 준비
