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

## v0.9.5 (2026-05-13)

### 경로 최적화 휴식지 타입 제한

**백엔드**
- `/optimize`, `/optimize/replan` 휴식지 후보 쿼리를 `highway_rest`(고속도로 휴게소) 전용으로 변경
  - 기존: `type != 'depot'` (졸음쉼터·공영차고지·물류단지 모두 포함)
  - 변경: `type == 'highway_rest'` (75건만 사용)
- candidates dict에 `type` 필드 추가 (선택 로직 우선순위 정상 동작)

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

## v1.0.1 (2026-05-13)

### 대시보드 하단 메뉴 아이콘 탭바 개편

**프론트엔드 (`frontend/dashboard.html`)**
- 좌측 하단 메뉴를 1행 5분할 아이콘 탭바로 변경
- 아이콘 하단 짧은 한글 라벨과 `title` 툴팁 추가
- 기사/차량/통계/설정/로그아웃 동작은 기존과 동일하게 유지

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

### 기능 개발 백로그
- [x] **관리자 프리셋 기능** — 자주 쓰는 상차지/하차지 조합 저장·불러오기·삭제
- [x] **폴리라인 개선** — 기사별 단일 색상 + 지나온 구간 실시간 투명화
- [ ] **UI/UX 리팩토링** — 관리자 웹 전반 일관성 개선, 컴포넌트 정리
- [ ] **카카오 소셜 로그인** — 회원가입·로그인 시 카카오 OAuth 연동
- [ ] **카카오톡 알림** — 운행 배차·경유지 추가·완료 등 주요 이벤트 카카오톡 메시지 발송

### 마무리
- [ ] 발표 준비
