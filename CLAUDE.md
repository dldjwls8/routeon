# CLAUDE.md — 루트온(RouteOn) Claude Prompting Guide

> 이 파일을 대화 시작 시 첨부하면 Claude가 프로젝트 맥락을 즉시 파악합니다.

---

## 프로젝트 기본 정보

- **프로젝트명:** 루트온 (RouteOn)
- **설명:** 화물차 법정 휴게 규정 자동 반영 + 다중 경유지 경로 최적화 + 휴식 포인트 추천 서비스

### 팀 역할
| 이름 | 담당 |
|------|------|
| 어진 | 백엔드 (FastAPI) + 관리자 웹 + Docker 인프라 |
| 팀원 A | 제약 알고리즘 + 앱 |
| 팀원 B | 앱 |

### 기술 스택
| 분류 | 기술 |
|------|------|
| 백엔드 | Python 3.12 + FastAPI (비동기) |
| DB | PostgreSQL 16 + TimescaleDB, Redis |
| 지도 | 카카오맵 SDK (관리자 웹), 카카오 모빌리티 API (경로 최적화) |
| 최적화 | Google OR-Tools (TSP) |
| 인프라 | Docker Compose, Nginx, Oracle Cloud |
| 앱 | Android Studio (Kotlin) |
| 관리자 웹 | HTML/JS (바닐라) |

---

## 서버 정보

| 항목 | 값 |
|------|-----|
| 서버 IP | `168.138.45.63` |
| FastAPI | `http://kdu.duckdns.org/api` (Nginx 프록시) / 직접 접근 `http://168.138.45.63:8000` |
| Swagger | `http://168.138.45.63:8000/docs` |
| 관리자 웹 | `http://kdu.duckdns.org` 또는 `http://168.138.45.63` (포트 80) |
| code-server | `http://168.138.45.63:8443` |
| 프로젝트 경로 | `/opt/routeon/` |

---

## 디렉터리 구조

```
routeon/
├── CLAUDE.md
├── DB_SCHEMA.md
├── CHANGELOG.md
├── docker-compose.yml
├── nginx.conf
├── .env
├── .env.example
├── docs/
│   └── Rest.txt
├── backend/
│   ├── main.py             FastAPI 앱 생성·lifespan·CORS·라우터 등록
│   ├── auth.py             JWT 인증 (비동기)
│   ├── database.py         DB 연결 — AsyncEngine, AsyncSession
│   ├── models.py           DB 테이블
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── routers/            도메인별 API 라우터
│   ├── uploads/            기업 등록 서류 업로드 저장소
│   ├── services/
│   │   ├── kakao_mobility.py      카카오 모빌리티 API + TTL 캐시 + find_best_rest_stop
│   │   ├── optimizer.py           OR-Tools TSP
│   │   ├── email_service.py       기업 승인/반려 이메일 알림
│   │   └── rest_stop_inserter.py  법정 휴게 규정 기반 휴게소 자동 삽입 (async)
│   └── seeds/
│       ├── seed_rest_stops.py     졸음쉼터 CSV → DB 삽입 (253건)
│       ├── seed_rest_stops_xls.py XLS 3개(휴게소·공영차고지·물류단지) → geocoding → DB 삽입 (156건)
│       ├── inspect_files.py       파일 컬럼 확인
│       ├── 한국도로공사_졸음쉼터_20260225.csv
│       ├── 휴게소정보_260325.xls
│       ├── 공영차고지정보_260325.xls
│       ├── 물류단지정보_260325.xls
│       └── 물류창고정보_260325.xls  (미사용 — 5,825건, 휴식지 부적합)
└── frontend/
    ├── index.html          랜딩 페이지
    ├── intro.html          서비스 소개
    ├── login.html
    ├── register.html       기업 등록 (사업자등록증 업로드 포함)
    ├── dashboard.html      관리자 대시보드 HTML 껍데기 (65줄)
    ├── dashboard.css       대시보드 스타일 (2,245줄, dashboard.html에서 분리)
    ├── dashboard.js        대시보드 JS 로직 (5,364줄, dashboard.html에서 분리)
    ├── drivers.html        레거시 진입점 → dashboard.html?main=basic&page=drivers
    ├── vehicles.html       레거시 진입점 → dashboard.html?main=basic&page=vehicles
    ├── stats.html          레거시 진입점 → dashboard.html?main=stats&page=trip-stats
    ├── settings.html       관리자 설정 (조직코드·계정정보·운영설정)
    └── superadmin.html     슈퍼 관리자 (기업 심사)
```

### 컨테이너
| 컨테이너 | 포트 | 설명 |
|---------|------|------|
| routeon-db | 5432 | PostgreSQL + TimescaleDB |
| routeon-api | 8000 | FastAPI 백엔드 |
| routeon-redis | 6379 | Redis (GPS TTL 5분) |
| routeon-frontend | 80 | Nginx + 관리자 웹 |
| routeon-code-server | 8443 | 브라우저 VS Code |

---

## 핵심 원칙

### 좌표 필드명
- **위도:** `lat`
- **경도:** `lon` (`lng` 절대 금지 — 팀원 A 코드와 통일)
- 예외: `rest_stops` 테이블만 `latitude` / `longitude` 사용

### WaypointSchema 구조
```json
{
  "name": "강남역", "lat": 37.4979, "lon": 127.0276,
  "type": "loading", "task_group": 0,
  "shipper_name": "화주명", "contact_name": "담당자명",
  "contact_phone": "010-0000-0000", "shipper_phone": "02-000-0000",
  "recipient_name": "수신자명", "cargo_type": "파렛트",
  "cargo_weight_ton": 2.0, "delivery_id": "uuid"
}
```
- `type`: `"loading"` (상차지) | `"unloading"` (하차지)
- `task_group`: 같은 그룹의 loading-unloading 쌍을 OR-Tools pickup_deliveries 제약으로 묶음.
  `null`이면 자유 최적화 (긴급 배차 등). 운행 생성 패널과 자동 배차 모두 자동 부여.
- `shipper_name` / `contact_name` / `contact_phone` / `shipper_phone`: 화주·담당자 연락처. 기사 앱 Trip API 응답에 포함.
- `recipient_name` / `cargo_type` / `cargo_weight_ton`: 수신자·화물 종류·톤수. unloading 전용. 배차 시 Delivery 원본에서 복사.
- `delivery_id`: Delivery UUID — auto-dispatch 시 Trip·Delivery 연결용.

### 비동기 패턴
```python
result = await db.execute(select(Model).where(Model.id == id))
obj    = result.scalar_one_or_none()
db.add(obj)
await db.commit()
await db.refresh(obj)
```

### 경로 최적화 파이프라인
```
1. 관리자: POST /trips → 상차지(type:loading) + 하차지(type:unloading) 경유지 등록
           (dest_* 미입력 가능 — 기사가 /optimize 시 마지막 하차지 자동 도착지 지정)
           └─ 앱 호환성: dest_*가 별도 목적지로 전달된 경우에도 신규 생성/조회 응답에서
              동일 좌표 중복 없이 type=unloading waypoint로 보강해 unloading_count가 유지됨
2. 기사:   POST /optimize → trip_id (출발지 선택 입력, 이름 미입력 가능)
           └─ origin 우선순위: req.origin_lat/lon → Redis location:{user_id} → HTTP 400
           └─ origin_name 미입력 시 카카오 역지오코딩으로 주소 자동 조회 (_coord_to_address)
           └─ dest 우선순위:   req.dest → t.dest → 마지막 unloading → 마지막 loading → HTTP 400
           └─ task_group 기반 pickup_deliveries 추출 → OR-Tools 제약으로 전달
              (같은 task_group의 loading → unloading 순서 보장, 나머지는 자유 최적화)
           └─ auto_detect_route_mode() — 50km 기준 local/long_distance
           └─ GraphHopper N×N (시간·거리 행렬) — TTL 캐시 1시간
           └─ OR-Tools TSP 경유지 순서 최적화 (pickup_deliveries 제약 적용)
           └─ insert_rest_stops() — 6,000초 임계값 + find_best_rest_stop() picker
           └─ 휴식지 후보: highway_rest 전용 (75건) — 졸음쉼터·공영차고지·물류단지 제외
           └─ total_distance_km + estimated_duration_min 포함 응답
           └─ trip.status → in_progress, current_phase → en_route_to_loading 변경
           └─ WS broadcast → 관리자에게 trip.started 이벤트 (대시보드 즉시 갱신)
3. 기사:   POST /optimize/replan → 운행 중 재경로 (current_name 선택 입력)
           └─ current_name 미입력 시 카카오 역지오코딩으로 주소 자동 조회
           └─ WS broadcast → 관리자에게 trip.replanned 이벤트 (폴리라인 즉시 재그리기)
```

### 원격 배차 (경유지 추가) 흐름
```
관리자 웹: 기사 카드 선택 → 이름 + 주소 입력 → 운행 목록에 추가 클릭
→ GET /address/coord         주소 → 좌표 변환
→ PATCH /trips/{id}/waypoints trips.waypoints에 경유지 추가 + DB 저장
→ WS broadcast               기사 앱에 replan_requested 알림 전송
→ 기사 앱: POST /optimize/replan 호출 → 새 경로 수신
```

### WS 메시지 형식 (replan_requested)
```json
{
  "type": "replan_requested",
  "trip_id": "uuid",
  "driver_id": "uuid",
  "new_waypoint": {"name": "추가경유지", "lat": 36.0, "lon": 127.8},
  "waypoints": [...],
  "message": "새 경유지가 추가됐습니다. 경로를 재계산하세요."
}
```

### WS 메시지 형식 (trip.started)
기사가 `POST /optimize` 완료 시 → 같은 조직 관리자 WS 전체에 브로드캐스트.
```json
{"type": "trip.started", "driver_id": "uuid", "trip_id": "uuid"}
```
대시보드: `handleTripStarted()` → `loadDrivers()` + `showDriverDetail()` 호출.

### WS 메시지 형식 (trip.replanned)
기사가 `POST /optimize/replan` 완료 시 → 같은 조직 관리자 WS 전체에 브로드캐스트.
```json
{"type": "trip.replanned", "driver_id": "uuid", "trip_id": "uuid"}
```
대시보드: `handleTripReplanned()` → `clearDriverRoute()` + `loadDrivers()` + `showDriverDetail()` 호출.

### WS 메시지 형식 (trip.assigned)
`POST /trips/auto-dispatch` 완료 시 → 같은 조직 기사 WS에 브로드캐스트 (`broadcast_replan_to_org`).
```json
{"type": "trip.assigned", "trip_id": "uuid", "driver_id": "uuid", "message": "새 배차가 배정되었습니다. 경로 최적화를 실행하세요."}
```
앱에서 `driver_id`로 본인 건 필터링 후 `/optimize` 호출 안내.

### WS 메시지 형식 (trip.cancelled)
웹에서 Trip 또는 연결된 마지막 Delivery가 취소되거나, 기사 취소 요청을 관리자가 승인하면 같은 조직 기사 WS에 브로드캐스트.
```json
{"type": "trip.cancelled", "trip_id": "uuid", "driver_id": "uuid", "message": "배차가 취소되었습니다."}
```
앱은 현재 운행 목록을 다시 조회하고 해당 Trip을 숨김 또는 취소 상태로 반영한다.

### WS 메시지 형식 (trip.progress_updated)
기사 앱이 `PATCH /trips/{id}/progress`로 상차/하차 도착·출발·완료를 기록하면 같은 조직 관리자 WS에 브로드캐스트.
```json
{"type": "trip.progress_updated", "trip_id": "uuid", "driver_id": "uuid", "phase": "loading_completed", "waypoint_index": 0, "event": "completed"}
```
대시보드는 Trip 목록/상세를 다시 조회해 `current_phase`와 waypoint `arrived_at`/`departed_at`을 반영한다.

### WS 메시지 형식 (heartbeat)
서버가 20초마다 클라이언트에 전송. 앱은 무시하거나 `{"type":"pong"}`으로 응답.
```json
{"type": "ping"}
```

### GPS 흐름
```
Android 앱 → POST /location-logs (5초 주기) → Redis(TTL 5분)
                                             → locations(TimescaleDB 7일)
                                             → 50m 도착 감지 → Delivery.done
                                             → WS broadcast → 관리자 웹 마커
관리자 웹  → WS /ws/location → 실시간 수신 → 지도 마커 업데이트
기사 앱   → WS /ws/location → replan_requested 수신 (관리자 연결 풀과 별도 관리)
관리자 웹  → GET /location-logs/{user_id} → Redis 실시간 위치 (is_realtime=true)
                                            → Redis miss 시 TimescaleDB 최근 기록 폴백 (is_realtime=false, recorded_at 포함)
관리자 웹  → 기사 패널 상단: 🟢 실시간 위치 / 🔘 마지막 기록 N분 전 배지 표시
```

### ConnectionManager 구조
```
manager.active   — org_id → [ws]  관리자 연결 (GPS 위치 업데이트 수신)
manager.drivers  — org_id → [ws]  기사 연결 (replan_requested 수신)

broadcast_to_org(org_id, data)       → admin에게만 전송
broadcast_replan_to_org(org_id, data) → driver에게만 전송
```

### 관리자 웹 경로선
```
기사 카드 클릭 또는 지도의 폴리라인 클릭
→ GET /trips?driver_id={id}&status=in_progress
→ GET /trips/{id}/polyline → 카카오 모빌리티 실제 도로 좌표
→ 카카오맵에 기사별 고유 색상 경로선 + 노드 마커(🏁📦☕🏴) 표시
   노드 마커: 드롭핀 형태, 이모지 아이콘만 표시, hover 시 이름, 클릭 시 showNodePopup()
   마커 zIndex: 노드(5) < 기사 위치(10) < 검색 핀(20)

경로선 분리 (기사 색상 유지, opacity로 구분):
  passed    — 기사가 지나온 구간, opacity 0.25 (흐림)
  remaining — 남은 구간, opacity 0.85 (선명)

GPS 수신(POST /location-logs → WS broadcast)마다 splitPolylineAtPosition()으로
setPath()를 사용해 기존 Polyline 객체 재활용 (재생성 없음)
driverPolylinePoints[driverId]에 전체 좌표 저장 (재분할용)

폴리라인 클릭 시 _polylineClicked 플래그로 onMapClick 이벤트 중복 차단

drawAllRunningPolylines(): loadDrivers() 호출마다 실행
  - in_progress가 아닌 기사의 기존 폴리라인 먼저 일괄 제거 (취소/완료 시 자동 정리)
  - 이후 in_progress 기사만 폴리라인 재드로우
```

### 지도 클릭 팝업 (검색 핀)
```
지도 클릭 → onMapClick → 카카오 Geocoder/Places API → showSearchPin()
팝업 닫기: X 버튼 클릭 또는 ESC 키 → hideSearchPin()
```

### 일괄배차(자동배차) 버튼 위치
- 지도 위 플로팅 버튼 (`.map-dispatch-btn`): `position:absolute; top:16px; left:315px`
- 지도 검색바(left:55~305px) 바로 오른쪽, 항상 노출 (기사 선택 여부 무관)

### 출발 시각(departure_time) 처리 규칙
- `rp-departure`(운행 생성 패널), `ad-departure`(자동배차 모달) 모두 동일한 규칙 적용
- 입력값이 있으면 `new Date(departure).toISOString()` 사용
- 입력값이 없으면(비워둠) `new Date().toISOString()` — 전송 시점의 현재 시각을 자동 사용

### 태스크 데이터 구조 (tbTasks / adTasks)
```javascript
// v1.0.25 이후 — 상차지 복수 지원
[{ loadings: [{name, lat, lon}, ...], unloadings: [{name, lat, lon}, ...] }]
```
- `loadings[]`: 상차지 배열 (1개 이상), null 슬롯 허용 (미입력 상태)
- `unloadings[]`: 하차지 배열 (0개 이상), null 슬롯 허용
- `tbAddLoadingSlot(taskIdx)` / `tbRemoveLoadingSlot(taskIdx, ldIdx)`: 상차지 슬롯 추가/삭제
- `addAdLoading(taskIdx)` / `removeAdLoading(taskIdx, ldIdx)`: 자동배차 모달 상차지 슬롯 추가/삭제

### 일괄 배차 greedy 배정 규칙 (POST /trips/auto-dispatch)
- `AutoDispatchTask.loadings: list[WaypointSchema]` — 상차지 복수 지원
- `max_per_driver = ceil(태스크 수 / 가용 기사 수)` — 기사당 최대 배정 상한
- GPS 위치 있는 기사(`located`): `task.loadings[0]`(첫 번째 상차지) 기준 최근접 기사 greedy 배정, 상한 초과 시 후보 제외
- GPS 위치 없는 기사(`rr_pool`): 라운드 로빈, 위치 있는 기사가 모두 상한 도달 후 투입
- **주의**: 상한 없이 greedy만 쓰면 위치 있는 기사 1명에게 모든 태스크가 몰리는 버그 발생

### 일괄배차 모달 태스크 초기화 규칙
- `openAutoDispatchModal()` 호출 시 `tbTasks`(운행 생성 패널에 지도 클릭으로 쌓인 태스크) 유무를 확인
  - `tbTasks.length > 0` → `JSON.parse(JSON.stringify(tbTasks))`로 깊은 복사해 `adTasks`에 그대로 불러옴
  - `tbTasks`가 비어있으면 빈 태스크 1개로 시작 (`{ loadings: [null], unloadings: [null] }`)
  - `tbTasks` 자체는 변경하지 않음 (모달 닫고 단일 운행 생성 계속 가능)

### 엑셀 태스크 불러오기 (운행 생성 패널)
- SheetJS CDN(`xlsx.full.min.js`)로 클라이언트에서 `.xlsx`/`.xls` 파싱
- 컬럼 순서: `태스크(1-based번호) | 구분(상차지/하차지) | 장소명 | 주소`
- 헤더 행 자동 감지: 첫 셀이 `"태스크"` 텍스트면 건너뜀
- 동일 태스크 번호에 상차지 행이 여러 개면 모두 `loadings[]` 배열에 누적
- 주소 → 좌표: `GET /address/coord?query=` 순차 호출 (행 수만큼)
- 결과 → `tbTasks` 교체 → `renderTbTasks()` + `renderTbTaskPins()`
- 좌표 미확인 행은 `{lat:null, lon:null}` 으로 저장, 경고 메시지 표시 (직접 수정 필요)
- `downloadExcelTemplate()`: 예시 포함 양식 파일(`routeon_태스크양식.xlsx`) 자동 다운로드
- 프리셋 기능(`_presets`, refreshPresetSelect, loadPreset, savePreset, deletePreset) 완전 제거됨

### 운행 생성 패널 태스크 핀 (tbTaskPins)
- `TB_TASK_COLORS`: 10가지 색상 팔레트, 태스크 인덱스 `% 10`으로 순환
- `renderTbTaskPins()`: `tbTasks` 전체를 순회해 지도 위 `kakao.maps.CustomOverlay` 핀 생성
  - 상차지: `task.loadings` 배열 전체 순회 → 각각 `T{n} 🏗️` 핀 (불투명 100%)
  - 하차지: `T{n} 📦` (불투명 88%)
  - `renderTbTasks()`, `tbSelectLoc()` 호출 때마다 핀 전체 재생성
- **드롭다운 선택**: `tbSearch` 콜백(비동기)은 항상 `document.getElementById(dropId)` 재호출로 현재 DOM 요소 사용 (클로저 stale reference 방지). `tbSelectLoc` 드롭다운 아이템은 `onmousedown + preventDefault`로 `blur` 이벤트 차단 후 선택 처리
- `clearTbTaskPins()`: `tbTaskPinOverlays` 배열의 오버레이 전부 `setMap(null)` 후 배열 초기화
- 패널 카드 UI: 태스크 색상 → `border-left`, 헤더 배경, 컬러 도트, 입력 필드 border, `+ 상차지 추가` / `+ 하차지 추가` 버튼 색상 연동

### Trip status 값
| 값 | 의미 | 변경 시점 |
|----|------|----------|
| `scheduled` | 배차 완료, 출발 전 | POST /trips 생성 시 기본값 |
| `in_progress` | 운행 중 | POST /optimize 호출 시 자동 변경 |
| `completed` | 운행 완료 | PATCH /trips/{id}/status?status=completed |
| `cancelled` | 취소 | PATCH /trips/{id}/status?status=cancelled |

### Trip current_phase 값
`Trip.status`는 앱 호환을 위해 4단계로 유지하고, 상차/하차 상세 진행은 `trips.current_phase`로 기록한다.

| 값 | 의미 |
|----|------|
| `waiting` | 배차 후 출발 전 |
| `en_route_to_loading` | 상차지 이동 중 |
| `loading_arrived` | 상차지 도착 |
| `loading_completed` | 상차 완료/상차지 출발 |
| `en_route_to_unloading` | 하차지 이동 중 |
| `unloading_arrived` | 하차지 도착 |
| `unloading_completed` | 하차 완료 |
| `completed` | 운행 완료 |
| `cancelled` | 운행 취소 |

### 기업(Organization) 상태 값
| 값 | 의미 |
|----|------|
| `pending_review` | 등록 후 슈퍼 관리자 심사 대기 |
| `approved` | 승인 완료 — 서비스 이용 가능 |
| `rejected` | 반려 (reject_reason 참고) |

---

## API 전체 목록

### 공통
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `GET /health` | 없음 | 서버 상태 |
| `GET /config` | 없음 | 카카오 JS 키 반환 |

### 인증
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `POST /auth/register` | 없음 | 기사 가입 (조직코드 필수, pending 처리) |
| `POST /auth/login` | 없음 | 로그인 → JWT |
| `GET /auth/me` | 로그인 | 내 정보 |
| `PATCH /auth/me` | 로그인 | 전화번호/비밀번호 변경 |
| `GET /auth/check-username` | 없음 | 아이디 중복 확인 |
| `POST /auth/approve/{id}` | 관리자 | 같은 기업 기사 승인 |

### 유저/차량
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `GET /users?role=driver` | 관리자 | 같은 기업 유저 목록 |
| `DELETE /users/{id}` | 관리자 | 유저 삭제 |
| `GET /vehicles` | 관리자 | 같은 조직 차량 목록. 연결 기사 최신 GPS를 `last_gps`로 포함 |
| `POST /vehicles` | 관리자 | 같은 조직 차량 등록 (`organization_id` 자동 지정) |
| `DELETE /vehicles/{id}` | 관리자 | 같은 조직 차량 비활성화 |

### 기업(Organizations)
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `POST /organizations` | 없음 | 기업 등록 + 관리자 계정 생성 (사업자서류 첨부 필수) |
| `GET /organizations/me` | 관리자 | 내 기업 정보 + 조직코드 + `auto_approve_drivers` 조회 |
| `POST /organizations/regen-code` | 관리자 | 조직코드 재발급 |
| `GET /organizations/lookup?org_code=` | 없음 | 조직코드로 기업명 조회 |
| `PATCH /organizations/me/settings` | 관리자 | 운영 설정 변경 `{auto_approve_drivers: bool}` |

### 슈퍼 관리자 (superadmin)
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `GET /superadmin/organizations` | 슈퍼관리자 | 전체 기업 목록 (?status=pending_review\|approved\|rejected) |
| `GET /superadmin/organizations/{id}/doc` | 슈퍼관리자 | 기업 첨부 서류 다운로드 |
| `POST /superadmin/organizations/{id}/approve` | 슈퍼관리자 | 기업 승인 + 이메일 알림 |
| `POST /superadmin/organizations/{id}/reject` | 슈퍼관리자 | 기업 반려 + 사유 저장 + 이메일 알림 |
| `POST /superadmin/create-account` | 슈퍼관리자 | 계정 직접 생성 |

### 운행/경로
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `GET /rest-stops` | 없음 | 휴게소 목록 |
| `POST /rest-stops` | 관리자 | 휴게소 등록 |
| `DELETE /rest-stops/{id}` | 관리자 | 휴게소 비활성화 |
| `GET /trips?driver_id=&status=` | 로그인 | 운행 목록 (기사: 본인만, 관리자: 같은 기업) |
| `POST /trips` | 관리자 | 운행 생성 — `vehicle_id` 지정 시 차량 제원(height/weight/length/width) 자동 복사, `departure_time` 미입력 시 생성 시각(UTC)으로 자동 설정 |
| `GET /trips/{id}` | 로그인 | 운행 상세 |
| `GET /trips/{id}/polyline` | 로그인 | 실제 도로 경로선 좌표 |
| `PATCH /trips/{id}/waypoints` | 관리자 | 경유지 추가 + 앱에 재경로 알림 |
| `PATCH /trips/{id}/status` | 로그인 | 운행 완료/취소 (?status=completed\|cancelled). 취소 시 연결 배송도 cancelled 처리하고 기사 앱 WS `trip.cancelled` 전송 |
| `PATCH /trips/{id}/progress` | 로그인 | 상차/하차 세부 진행 기록 `{waypoint_index, event: arrived\|departed\|completed}` 또는 `{phase}` |
| `POST /trips/{id}/cancel-request` | 기사 | 배차 취소 요청 `{reason}` — 사유 필수, WS `trip.cancel_requested` 브로드캐스트 |
| `POST /trips/{id}/cancel-request/respond` | 관리자 | 취소 요청 승인/거절 `?action=approve\|reject` — 승인 시 `trip.cancelled` + `trip.cancel_responded` 브로드캐스트 |
| `PATCH /trips/{id}/reassign` | 관리자 | 기사·차량 교체 `{new_driver_id?, new_vehicle_id?, transfer_remaining}` — `transfer_remaining=true` 시 현재 운행 취소 + 잔여 경유지 새 운행 이관, WS `trip.reassigned` 브로드캐스트 |
| `POST /optimize` | 로그인 | 경로 최적화. origin_lat/lon 미입력 시 Redis GPS 자동 사용. origin_name 미입력 시 역지오코딩 자동 조회. dest_* 미입력 시 마지막 하차지 자동 지정 |
| `POST /optimize/replan` | 로그인 | 운행 중 재경로. current_name 미입력 시 역지오코딩 자동 조회 |
| `GET /drivers/available` | 관리자 | 현재 운행이 없는 가용 기사 목록 (조직 내) |
| `POST /trips/auto-dispatch` | 관리자 | 배송 태스크를 가용 기사에게 위치 기반 greedy 배정 후 일괄 운행 생성. 기사 위치 미확인 시 라운드 로빈 폴백 |

### 배송/위치
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `POST /deliveries` | 관리자 | 같은 조직 배송지 단건 등록 (`organization_id` 자동 지정) |
| `POST /deliveries/batch` | 관리자 | 같은 조직 배송지 일괄 등록 |
| `PATCH /deliveries/{id}/assign` | 관리자 | 같은 조직 기사 배정 |
| `PATCH /deliveries/{id}` | 관리자 | 배송지 수정·상태 변경. 마지막 진행 배송 취소 시 연결 Trip도 cancelled 처리 |
| `DELETE /deliveries/{id}` | 관리자 | 같은 조직 배송 취소 |
| `GET /deliveries` | 로그인 | 관리자: 같은 조직 배송 목록 / 기사: 본인 배정 배송 목록 |
| `GET /deliveries/{id}` | 로그인 | 배송 상세 |
| `PATCH /deliveries/{id}/complete` | 기사 | 본인 배정 배송 수동 완료 |
| `GET /address/coord?query=` | 없음 | 주소 → 좌표 변환 |
| `POST /route/preview` | 관리자 | 경유지 순서대로 GraphHopper 실 도로 경로·거리·시간 반환. 좌표 없는 경유지 자동 스킵. 응답: `{distance_m, duration_sec, polyline: [[lat,lon],...]}` |
| `POST /rest-spots` | 없음 | 근처 휴식 장소 검색 (카카오 로컬) |
| `POST /location-logs` | 로그인 | GPS 수신 + 자동 완료 + WS broadcast (5초 주기) |
| `GET /location-logs/{user_id}` | 관리자 | 기사 현재 위치. Redis 실시간 우선, miss 시 TimescaleDB 최근 기록 폴백. `is_realtime`, `recorded_at` 응답 포함 |
| `GET /nearby-drivers?lat=&lon=&radius_km=` | 관리자 | 상차지 기준 반경 내 같은 조직 기사 목록 (Redis 위치 기준, 기본 10km) |
| `GET /presets` | 관리자 | 같은 조직의 경유지 프리셋 목록 (최신순) |
| `POST /presets` | 관리자 | 프리셋 저장 `{name, waypoints}` |
| `DELETE /presets/{id}` | 관리자 | 프리셋 삭제 (같은 조직만) |
| `GET /customers` | 관리자 | 같은 조직 거래처 목록 |
| `POST /customers` | 관리자 | 거래처 등록 `{name, contact?, phone?, address?, memo?, temporary, valid_date?}` |
| `PATCH /customers/{id}` | 관리자 | 거래처 수정 |
| `DELETE /customers/{id}` | 관리자 | 거래처 삭제 |
| `WS /ws/location` | 로그인 | 실시간 위치 + 재경로 알림 WebSocket. 관리자→GPS 수신, 기사→replan_requested 수신 |

### 사용자/차량
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `GET /users?role=` | 관리자 | 같은 조직 사용자 목록. `role=driver/admin/pending` 필터 지원 |
| `PATCH /users/{id}` | 관리자 | 기사/관리자 정보 수정. 기사 상태·배정 차량 변경 포함 |
| `DELETE /users/{id}` | 관리자 | 같은 조직 사용자 삭제. 본인 삭제 불가 |
| `GET /vehicles` | 관리자 | 같은 조직 활성 차량 목록. `last_gps`, `driver_id`, `driver_name` 포함 |
| `POST /vehicles` | 관리자 | 차량 등록 |
| `PATCH /vehicles/{id}` | 관리자 | 차량 제원·상태·배정 기사 수정 |
| `DELETE /vehicles/{id}` | 관리자 | 차량 비활성화 |

### 통계
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `GET /stats/summary?period=today\|week\|month\|7d\|30d\|all&driver_id=&vehicle_id=` | 관리자 | 총 운행 건수·거리·평균 시간·완료율·상태별 건수·안전이슈·배정완료/미배정 |
| `GET /stats/by-driver?period=&driver_id=` | 관리자 | 기사별 운행 집계 (총 건수, 완료, 거리, 시간 합·평균, 운행 일수) |
| `GET /stats/by-day?period=&driver_id=&vehicle_id=` | 관리자 | 일별 운행 건수 시계열 배열 |
| `GET /stats/by-driver-day?period=&driver_id=` | 관리자 | 기사·날짜별 운행 건수·거리 시계열 (추이 차트용) |
| `GET /stats/by-vehicle?period=&vehicle_id=` | 관리자 | 차량별 운행 집계 (총 건수, 완료, 거리, 운행 시간 합) |
| `GET /stats/route-history?driver_id=&period=` | 관리자 | 기사 GPS 궤적 배열 (location_logs 기반, 과거 경로 지도용) |
| `PATCH /trips/{id}/safety` | 로그인 | 안전 이슈 플래그 기록 `{safety_issue: bool}` |
| `PATCH /trips/{id}/waypoint-dwell` | 로그인 | 경유지 도착·출발 시간 기록 `{index, arrived_at?, departed_at?}` |

### 채팅
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `GET /chat/partners` | 관리자/기사 | 같은 조직의 채팅 가능 상대 목록. 관리자면 기사, 기사면 관리자만 반환 |
| `GET /chat/conversations` | 관리자/기사 | 본인이 참여한 대화방 목록 + unread_count |
| `POST /chat/conversations` | 관리자/기사 | `{partner_id}`로 같은 조직 admin-driver 대화방 생성 또는 조회 |
| `GET /chat/conversations/{id}/messages?before_message_id=&limit=50` | 관리자/기사 | 메시지 히스토리. 응답은 항상 과거→현재 시간 오름차순 |
| `POST /chat/conversations/{id}/messages` | 관리자/기사 | `{content}` 텍스트 메시지 전송. 공백/2,000자 초과 거부 |
| `POST /chat/conversations/{id}/read` | 관리자/기사 | `{last_read_message_id?}` 기준 읽음 워터마크 갱신 |
| `WS /ws/chat?token={JWT}` | 관리자/기사 | 사용자 단위 채팅 WebSocket. `chat.ready`, `chat.message`, `chat.read` 이벤트 수신 |

채팅 권한 규칙:
- 같은 `organization_id` 안의 `admin` ↔ `driver` 조합만 허용한다.
- `superadmin`, `pending`, admin↔admin, driver↔driver 조합은 거부한다.
- 실시간 전송 실패는 DB 저장을 롤백하지 않는다. 재접속 시 REST 히스토리로 복구한다.

프론트엔드 진입점:
- 관리자: `/dashboard.html` 기사 카드의 💬 버튼 클릭 → `/chat.html?driver_id=xxx` 새 탭으로 열기
- 기사: `/driver.html` → 같은 조직 관리자 목록에서 선택, 기본값은 첫 번째 관리자
- 로그인 후 `role === "driver"`는 `/driver.html`, 그 외 관리 계정은 `/dashboard.html`로 이동한다.

settings.html 구조 (관리자 전용):
- 인증 가드: 토큰 없음 → `/login.html`, `role !== 'admin'` → 리다이렉트
- 디자인: 대시보드 CSS 변수 시스템 공유 (다크/라이트 모드, FOUC 방지 스크립트)
- 섹션 ①: 조직코드 관리 — `GET /organizations/me` 조회, 복사(clipboard/fallback), `POST /organizations/regen-code` 재발급
- 섹션 ②: 계정 정보 — `GET /auth/me`로 초기값 채움, 전화번호·비밀번호 변경 `PATCH /auth/me`
- 섹션 ③: 화면 설정 — 🖥 자동 / 🌙 다크 / ☀️ 라이트 세그먼트 선택, `localStorage('theme')` 저장, 즉시 반영
- 섹션 ④: 운영 설정 — 기사 자동승인 토글 (`PATCH /organizations/me/settings` 호출, DB 반영, 초기값 OFF)
- 탑바 ⚙ 버튼 또는 관리자 드롭다운 → `/settings.html` 이동

통합 대시보드 진입점:
- 기사 관리: `/dashboard.html?main=basic&page=drivers`
- 차량 관리: `/dashboard.html?main=basic&page=vehicles`
- 운행 통계: `/dashboard.html?main=stats&page=trip-stats`
- `drivers.html`, `vehicles.html`, `stats.html`은 북마크/기존 링크 호환용 리다이렉트 파일만 유지한다.

chat.html 구조:
- 좌측: 채팅 가능 상대 목록 (GET /chat/partners) + unread 배지 + 이름 검색
- 우측: 메시지창 — 날짜 구분선, 위로 스크롤 시 이전 메시지 페이지네이션
- WS /ws/chat 연결 + 자동 재연결. 한글 IME 중복 전송 방지(e.isComposing), 줄바꿈 표시(white-space: pre-wrap)
- dashboard.html에서 채팅 WS 연결 제거 — chat.html에서만 관리

dashboard.html 채팅 알림 WS:
- WS /ws/chat 경량 연결 (수신 전용, 전송 없음) — `connectChatWebSocket()`
- `chat.message` 수신 시: `sender_id ≠ currentUserId`면 해당 기사 카드 unread 배지 +1
- `chat.read` 수신 시: `reader_id === currentUserId`면 해당 기사 카드 배지 → 0
- `convDriverMap` (conversation_id → driver_id) 으로 대화방과 기사 카드를 매핑
- 초기 로드 시 `loadChatConversations()` 로 기존 unread 카운트 일괄 반영

Android 앱 채팅 구현 필수 사항:
- `ws://168.138.45.63:8000/ws/chat?token={JWT}` 또는 Nginx 경유 `ws://kdu.duckdns.org/ws/chat?token={JWT}` 상시 연결 (채팅 화면 외에도 유지)
- 수신 이벤트: `chat.ready`(연결 확인), `chat.message`(새 메시지), `chat.read`(읽음), `ping`(heartbeat → 무시 또는 pong)
- 메시지 전송은 REST `POST /chat/conversations/{id}/messages`로 처리
- WS 미연결 시 상대방 메시지를 실시간으로 수신할 수 없음 (REST 폴링으로 대체 가능)

---

## 주의사항

```
- 좌표: lon 사용 (lng 금지). rest_stops만 latitude/longitude 예외
- bcrypt==4.0.1 고정 (4.2+는 passlib 1.7.4 호환 문제)
- SQLAlchemy 비동기: db.query() 금지 → await db.execute(select())
- build_time_matrix() → (time_matrix, dist_matrix) 튜플 반환
- insert_rest_stops() → async, 반드시 await
- main.py는 앱 초기화와 라우터 등록만 담당. 실제 엔드포인트는 `backend/routers/` 도메인별 모듈에 위치
- 카카오 API Key 프론트엔드 하드코딩 금지 → /config 엔드포인트 경유
- Nginx: /api/* → FastAPI, /ws/* → WebSocket 프록시 (proxy_read/send_timeout 3600s)
- GPS 전송 주기: 5초 (앱 설정)
- 기업 등록 서류: backend/uploads/{org_id}/ 에 저장
- 슈퍼관리자 계정은 superadmin/create-account로 직접 생성
- WS heartbeat: 서버가 20초마다 {"type":"ping"} 전송 — 앱은 무시하거나 {"type":"pong"} 응답
- WS /ws/location: admin→GPS위치 수신, driver→replan_requested 수신 (ConnectionManager 풀 분리)
- ws.close() 호출 전 반드시 ws.accept() 먼저 호출할 것 (순서 어기면 HTTP 403 반환)
```

---

## 남은 작업

완료된 상세 이력은 `CHANGELOG.md`를 단일 출처로 관리한다. 이 섹션에는 아직 남은 작업이나 장기 과제만 짧게 기록한다.

### 단기 확인
- [ ] Android 앱에서 `PATCH /trips/{id}/progress` 연동 후 상차/하차 단계 기록 확인
- [ ] 웹 취소 이벤트(`trip.cancelled`)가 기사 앱에서 즉시 반영되는지 E2E 확인

### 장기 과제
- [ ] UI/UX 리팩토링 — 관리자 웹 전반 일관성 개선, 컴포넌트 정리
- [ ] 카카오 소셜 로그인 — 회원가입·로그인 OAuth 연동
- [ ] 카카오톡 알림 — 배차·경유지 추가·완료 등 주요 이벤트 알림
- [ ] 발표 준비
