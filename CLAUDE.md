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
│   ├── schemas.py          공용 Pydantic 입력 DTO — WaypointSchema
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── routers/            HTTP·WebSocket 엔드포인트
│   ├── serializers/
│   │   └── trip.py                 Trip/Delivery ORM → API 응답 변환
│   ├── uploads/            기업 등록 서류 업로드 저장소
│   ├── services/
│   │   ├── entity_events.py       고객·기사·차량·담당자·기업 감사 기록 helper
│   │   ├── trip_service.py         운행 생성·상태·재배정·진행 유스케이스
│   │   ├── location_service.py     GPS 저장·도착 판정·ETA·위치 알림
│   │   ├── kakao_mobility.py      카카오 모빌리티 API + 경로행렬 캐시 + find_best_rest_stop
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
    ├── register.html       기업 등록 또는 일반 관리자 가입 신청
    ├── dashboard.html      관리자 대시보드 HTML 껍데기 (65줄)
    ├── dashboard.css       대시보드 스타일 (dashboard.html에서 분리)
    ├── dashboard.js        대시보드 JS 로직 (dashboard.html에서 분리)
    ├── api-client.js       API/WS 주소·토큰·인증 헤더·공용 fetch
    ├── drivers.html        레거시 진입점 → dashboard.html?main=basic&page=drivers
    ├── vehicles.html       레거시 진입점 → dashboard.html?main=basic&page=vehicles
    ├── stats.html          레거시 진입점 → dashboard.html?main=schedule&page=trip-stats
    ├── settings.html       관리자 프로필·계정 보안·탈퇴·화면 테마 설정
    ├── superadmin.html     슈퍼 관리자 (기업 심사·전역 운영 설정)
    ├── terms.html          이용약관 안내
    ├── privacy.html        개인정보 처리방침 안내
    ├── copyright.html      저작권 안내
    └── contact.html        프로젝트 문의 안내
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
  "recipient_name": "수신자명", "cargo_type": "식품",
  "cargo_size": "5톤", "cargo_weight_ton": 2.0, "delivery_id": "uuid",
  "order_no": "RO-260605-A1B2C3"
}
```
- `type`: `"loading"` (상차지) | `"unloading"` (하차지)
- `task_group`: 같은 그룹의 loading-unloading 쌍을 OR-Tools pickup_deliveries 제약으로 묶음.
  `null`이면 자유 최적화 (긴급 배차 등). 운행 생성 패널과 자동 배차 모두 자동 부여.
- `shipper_name` / `contact_name` / `contact_phone` / `shipper_phone`: 화주·담당자 연락처. 기사 앱 Trip API 응답에 포함.
- `recipient_name`: 수신자. unloading 전용. 배차 시 Delivery 원본에서 복사.
- `cargo_type`: 화물 종류. 관리자 웹 입력은 `식품`, `원자재/에너지`, `화학/소재`, `잡화`, `기계/전자`, `기타` 드롭다운 기준.
- `cargo_size`: 화물 규격. `5톤`, `3파레트` 같은 자유 텍스트이며 신규 오더·배차·기사 앱 표시는 이 값을 기준으로 한다.
- 배차 생성 시 `cargo_size` 또는 `cargo_weight_ton`에서 톤 단위를 읽을 수 있으면 차량 `weight_kg`와 비교한다. `5톤`, `5t`, `5ton`은 검증 대상이고 `3파레트`처럼 중량 환산이 불가능한 규격은 표시값으로만 유지한다.
- `cargo_weight_ton`: 과거 톤수 값 호환용. 신규 프론트 입력은 숫자 파싱 없이 `cargo_size`로 전달한다.
- `delivery_id`: Delivery UUID — auto-dispatch 시 Trip·Delivery 연결용.
- `order_no`: 표시용 오더번호. DB 컬럼이 아니라 `/deliveries`/`/trips` 응답에서 `created_at`과 Delivery UUID 기반으로 계산되는 `RO-YYMMDD-XXXXXX` 형식.
- `WaypointSchema` 입력 DTO는 `backend/schemas.py`에 있다.
- `serialize_trip`, `trip_waypoints_for_response`와 waypoint 응답 보강 helper는 `backend/serializers/trip.py`에 있다. 라우터끼리 `from routers.trips import ...`처럼 서로 의존하지 않는다.

### 계층·결합도 원칙
- `backend/routers/`: 요청 DTO 수신, 인증·권한, 엔티티 조회, 서비스 호출, 응답 반환을 담당한다. 여러 테이블 상태 변경·Redis·이벤트·WebSocket 알림이 결합된 유스케이스는 `services/`에 둔다.
- `backend/services/trip_service.py`: 운행 생성, 완료·취소, 재배정, waypoint 진행 기록, 차량 마지막 위치 고정을 담당한다.
- `backend/services/location_service.py`: 기사 GPS 저장, 운행 차량 위치 갱신, 배송 도착 판정, ETA 계산, 관리자 위치 알림을 담당한다. 도착 자동 완료 판정은 **기사의 현재 활성 운행(`active_vehicle_trip`)에 속한 배송만** 대상으로 하며, 해당 배송의 상차 경유지가 출발(`departed_at`) 처리된 이후에만 하차지 도착으로 인정한다 — 그렇지 않으면 직전 운행을 마친 좌표와 새로 배차된 배송의 하차지 좌표가 겹칠 때, 운행 시작·상차 전부터 배송이 곧바로 '완료' 처리되는 오류가 발생한다.
- `backend/services/entity_events.py`: 관리 마스터의 생성·수정 변경 필드 계산과 `entity_events` 감사 기록 생성을 담당한다.
- `backend/serializers/`: ORM 엔티티의 API 응답 변환을 담당한다. `schemas.py` 입력 DTO에 ORM 모델 의존을 추가하지 않는다.
- `frontend/api-client.js`: 관리자 대시보드의 API/WS 주소, 토큰, 인증 헤더와 JSON 요청 기본값을 담당한다. `dashboard.js`에서 직접 `fetch()`나 API 호스트를 조립하지 않는다.
- 분리 작업 후에는 `python -m compileall -q /app`, `python -m pyflakes /app`, `node --check frontend/api-client.js`, `node --check frontend/dashboard.js`, `/openapi.json`, `/auth/login`, `/vehicles`, `/deliveries`, `/trips`, `/stats/summary` smoke를 확인한다.
- WebSocket 라우터는 HTTP smoke만으로 충분하지 않으므로 `/ws/location`, `/ws/chat` 연결 accepted 여부도 확인한다.
- WebSocket은 장기 연결이므로 `db: AsyncSession = Depends(get_db)`를 핸들러 인자로 두지 않는다. JWT·사용자 검증이 필요하면 `AsyncSessionLocal()` 컨텍스트를 연결 초기에만 열고 인증 직후 닫아 DB 풀을 점유하지 않도록 한다.
- `services/kakao_mobility.py`의 `_cache_future`, `_cache_realtime`, `_cache_multi`는 모듈 상단에서 초기화되는 프로세스 메모리 캐시다. 경로행렬 계산 함수에서 직접 참조하므로 삭제하지 않는다.

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
                                             → 진행 중 운행 차량이면 vehicles.last_lat/last_lon 갱신
                                             → 50m 도착 감지 → Delivery.done
                                             → WS broadcast → 관리자 웹 마커
관리자 웹  → WS /ws/location → 실시간 수신 → 지도 마커 업데이트
기사 앱   → WS /ws/location → replan_requested 수신 (관리자 연결 풀과 별도 관리)
관리자 웹  → GET /location-logs/{user_id} → Redis 실시간 위치 (is_realtime=true)
                                            → Redis miss 시 TimescaleDB 최근 기록 폴백 (is_realtime=false, recorded_at 포함)
관리자 웹  → GET /vehicles → 차량 마지막 위치 스냅샷(last_gps). 운행 완료/취소 후에는 기사 GPS와 분리되어 고정
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

### 관리자 배차관리 화면
- 진입점: `/dashboard.html?main=dispatch&page=dispatch-manage`
- 상단 좌측 `미배정 오더`, 상단 우측 `기사·차량 선택`, 하단 전체 너비 `배차 결과`의 3영역 구조다.
- 오더 1건/여러 건, 기사 1명/여러 명을 같은 화면에서 선택한다. 별도 일괄배차·수동배차 세부 탭을 만들지 않는다.
- `혼적 허용` OFF는 기사 한 명당 오더 1건, ON은 같은 기사·차량에 여러 오더 배정을 허용한다.
- 오더 검색은 오더번호·화주·상하차지·규격을 대상으로 하며 선택 상태를 유지한다.
- 페이지 자체는 스크롤하지 않고 오더·기사·결과 컨테이너 내부만 스크롤한다.
- 기존 `page=bulk-dispatch`, `page=dispatch-assign` 쿼리는 `dispatch-manage`로 호환 처리한다.

### 출발 시각(departure_time) 처리 규칙
- 관리자 `배차관리`는 `/trips/auto-dispatch` 요청 시 `new Date().toISOString()`을 사용해 실행 시점의 현재 시각을 자동 전달한다.
- 별도 출발 방식이나 센터 출발 시각 입력 UI는 현재 배차관리 화면에 없다.

### 태스크 데이터 구조
```javascript
[{ loadings: [{name, lat, lon}, ...], unloadings: [{name, lat, lon}, ...] }]
```
- `loadings[]`: 상차지 배열 (1개 이상), null 슬롯 허용 (미입력 상태)
- `unloadings[]`: 하차지 배열 (0개 이상), null 슬롯 허용
- 배차관리에서는 선택한 Delivery를 `dispatchTaskFromOrder()`로 위 구조에 변환한다.

### 일괄 배차 greedy 배정 규칙 (POST /trips/auto-dispatch)
- `AutoDispatchTask.loadings: list[WaypointSchema]` — 상차지 복수 지원
- `max_per_driver = ceil(태스크 수 / 가용 기사 수)` — 기사당 최대 배정 상한
- GPS 위치 있는 기사(`located`): `task.loadings[0]`(첫 번째 상차지) 기준 최근접 기사 greedy 배정, 상한 초과 시 후보 제외
- GPS 위치 없는 기사(`rr_pool`): 라운드 로빈, 위치 있는 기사가 모두 상한 도달 후 투입
- **주의**: 상한 없이 greedy만 쓰면 위치 있는 기사 1명에게 모든 태스크가 몰리는 버그 발생

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

### 계정(User) 승인 상태 값
`users.role`은 실제 역할(`admin`, `driver`)이고, 가입 승인 여부는 `users.account_status`로 별도 관리한다.

| 값 | 의미 |
|----|------|
| `pending` | 기사 또는 일반 관리자 가입 승인 대기 |
| `approved` | 로그인 및 역할별 서비스 이용 가능 |
| `rejected` | 가입 신청 반려, 로그인 불가 |

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
| `POST /auth/register` | 없음 | 승인된 기업의 조직코드로 기사 또는 일반 관리자 가입 신청. 역할별 기업 자동승인 설정에 따라 즉시 승인 또는 승인 대기 |
| `POST /auth/login` | 없음 | 로그인 → JWT |
| `GET /auth/me` | 로그인 | 내 정보 |
| `PATCH /auth/me` | 로그인 | 전화번호/비밀번호 변경 |
| `POST /auth/me/profile-image` | 로그인 | 프로필 이미지 업로드 (JPG/PNG/WEBP, 최대 5MB) |
| `DELETE /auth/me/profile-image` | 로그인 | 프로필 이미지 삭제 |
| `DELETE /auth/me` | 로그인 | 현재 비밀번호 확인 후 계정 탈퇴. 최상위 기업관리자와 대기/운행 중 배차가 있는 기사는 거부 |
| `GET /auth/check-username` | 없음 | 아이디 중복 확인 |
| `POST /auth/approve/{id}` | 관리자 | 같은 기업 가입 신청 승인. 관리자 신청은 최상위 기업관리자만 가능 |
| `POST /auth/reject/{id}` | 관리자 | 같은 기업 가입 신청 반려. 관리자 신청은 최상위 기업관리자만 가능 |

로그인 동작:
- `login.html`은 아이디 앞뒤 공백을 제거하고 로그인 요청 중 버튼을 비활성화해 중복 제출을 막는다.
- API의 JSON 오류 메시지를 화면에 표시하며, Nginx 5xx HTML 응답이나 네트워크 오류도 별도 안내 문구로 처리한다.
- 채팅·위치 WebSocket 인증은 독립적인 단기 DB 세션을 사용한다. 연결이 유지되는 동안 SQLAlchemy 세션이나 트랜잭션을 보유하면 안 된다.

### 유저/차량
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `GET /users?role=&account_status=` | 관리자 | 같은 기업 유저를 역할과 승인 상태로 조회 |
| `PATCH /users/{id}` | 관리자 | 기사 정보 수정. 수동 상태는 `운행가능/휴무`만 허용하고 운행 중 기사 변경은 거부. 담당자 `permissions` 수정은 최상위 관리자만 가능 |
| `DELETE /users/{id}` | 관리자 | 같은 조직 유저 삭제. 운행 중 기사, 본인, 최상위 관리자 삭제는 거부하며 담당자 삭제는 최상위 관리자만 가능 |
| `GET /vehicles` | 관리자 | 같은 조직 차량 목록. 연결 기사(`driver_id`, `driver_name`)와 차량 위치 스냅샷 `last_gps` 포함 |
| `POST /vehicles` | 관리자 | 같은 조직 차량 등록 (`organization_id` 자동 지정) |
| `PATCH /vehicles/{id}` | 관리자 | 차량 제원·상태·배정 기사 수정. 수동 상태는 `가용/정비`만 허용하고 운행 중 차량 변경은 거부 |
| `DELETE /vehicles/{id}` | 관리자 | 같은 조직 차량 비활성화. 운행 중 차량은 거부 |

### 기업(Organizations)
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `POST /organizations` | 없음 | 기업 등록 + 관리자 계정 생성 (사업자서류 첨부 필수). 슈퍼관리자 자동 수락 ON이면 즉시 approved |
| `GET /organizations/me` | 관리자 | 내 기업 정보 + 조직코드 + 기사/관리자 자동승인 설정 조회 |
| `POST /organizations/regen-code` | 최상위 기업관리자 | 조직코드 재발급 + 기업 수정 기록 저장 |
| `GET /organizations/lookup?org_code=` | 없음 | 조직코드로 기업명 조회 |
| `PATCH /organizations/me/settings` | 최상위 기업관리자 | 기업명·기사/관리자 자동승인 설정 변경 |

### 슈퍼 관리자 (superadmin)
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `GET /superadmin/organizations` | 슈퍼관리자 | 전체 기업 목록 (?status=pending_review\|approved\|rejected) |
| `GET /superadmin/organizations/{id}/doc` | 슈퍼관리자 | 기업 첨부 서류 다운로드 |
| `POST /superadmin/organizations/{id}/approve` | 슈퍼관리자 | 기업 승인 + 이메일 알림 |
| `POST /superadmin/organizations/{id}/reject` | 슈퍼관리자 | 기업 반려 + 사유 저장 + 이메일 알림 |
| `GET /superadmin/settings` | 슈퍼관리자 | 전역 운영 설정 조회 (`organization_auto_approve`) |
| `PATCH /superadmin/settings` | 슈퍼관리자 | 기업 가입 신청 자동 수락 토글 `{organization_auto_approve: bool}` |
| `POST /superadmin/create-account` | 슈퍼관리자 | 계정 직접 생성 |

### 운행/경로
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `GET /rest-stops` | 없음 | 휴게소 목록 |
| `POST /rest-stops` | 관리자 | 휴게소 등록 |
| `DELETE /rest-stops/{id}` | 관리자 | 휴게소 비활성화 |
| `GET /trips?driver_id=&status=` | 로그인 | 운행 목록 (기사: 본인만, 관리자: 같은 기업) |
| `POST /trips` | 관리자 | 운행 생성 — `vehicle_id` 지정 시 차량 제원(height/weight/length/width) 자동 복사, `departure_time` 미입력 시 생성 시각(UTC)으로 자동 설정. 톤 단위 화물 규격이 차량 `weight_kg`를 초과하면 거부 |
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
| `POST /trips/auto-dispatch` | 관리자 | 배송 태스크를 가용 기사에게 위치 기반 greedy 배정 후 일괄 운행 생성. 기사 위치 미확인 시 라운드 로빈 폴백. 톤 단위 화물 규격은 선택 차량 `weight_kg` 초과 시 거부. 요청에 포함된 `delivery_id`가 이미 `pending`이 아닌(배차/진행/완료/취소) 배송이면 409로 거부 — 동일 배송이 다른 기사에게 중복 배차되어 처리 기록이 섞이는 것을 방지 |

### 배송/위치
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `POST /deliveries` | 관리자 | 같은 조직 배송지 단건 등록 (`organization_id` 자동 지정) |
| `POST /deliveries/batch` | 관리자 | 같은 조직 배송지 일괄 등록 |
| `PATCH /deliveries/{id}/assign` | 관리자 | 같은 조직 기사 배정 |
| `PATCH /deliveries/{id}` | 관리자 | 배송지 수정·상태 변경. 상태 역행(`in_progress → pending`)은 거부하고, 마지막 진행 배송 취소 시 연결 Trip도 cancelled 처리 |
| `DELETE /deliveries/{id}` | 관리자 | 같은 조직 배송 취소 |
| `GET /deliveries` | 로그인 | 관리자: 같은 조직 배송 목록 / 기사: 본인 배정 배송 목록. 응답에 표시용 `order_no` 포함 |
| `GET /deliveries/{id}` | 로그인 | 배송 상세. 응답에 표시용 `order_no` 포함 |
| `GET /deliveries/{id}/events` | 로그인 | 오더 처리 기록 최신순 조회 (`order_events`) |
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
| `POST /customers` | 관리자 | 거래처 등록 `{name, contact?, phone?, address?, lat?, lon?, memo?, temporary, valid_date?}` |
| `PATCH /customers/{id}` | 관리자 | 거래처 수정. `lat`/`lon` 명시 전달 시 `null`도 반영 |
| `DELETE /customers/{id}` | 관리자 | 거래처 삭제 |
| `GET /entity-events?entity_type=&entity_id=` | 관리자 | 같은 조직의 고객·기사·차량·담당자·기업 수정 기록 최신순 조회 |
| `WS /ws/location` | 로그인 | 실시간 위치 + 재경로 알림 WebSocket. 관리자→GPS 수신, 기사→replan_requested 수신 |

### 사용자/차량
| 엔드포인트 | 권한 | 설명 |
|-----------|------|------|
| `GET /users?role=&account_status=` | 관리자 | 같은 조직 사용자 목록. 역할(`driver/admin`)과 승인 상태(`pending/approved/rejected`) 필터 지원 |
| `PATCH /users/{id}` | 관리자 | 기사 상태·배정 차량 변경. 수동 상태는 `운행가능/휴무`만 허용하고 운행 중 기사 변경은 거부. 담당자 화면 권한은 최상위 관리자만 수정 |
| `DELETE /users/{id}` | 관리자 | 같은 조직 사용자 삭제. 운행 중 기사·본인·최상위 관리자 삭제 불가, 담당자 삭제는 최상위 관리자만 가능 |
| `GET /vehicles` | 관리자 | 같은 조직 활성 차량 목록. 차량 위치 스냅샷 `last_gps`, `driver_id`, `driver_name` 포함 |
| `POST /vehicles` | 관리자 | 차량 등록 |
| `PATCH /vehicles/{id}` | 관리자 | 차량 제원·상태·배정 기사 수정. 수동 상태는 `가용/정비`만 허용하고 운행 중 차량 변경은 거부 |
| `DELETE /vehicles/{id}` | 관리자 | 차량 비활성화. 운행 중 차량은 거부 |

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
| `GET /chat/partners` | 관리자/기사 | 같은 조직의 채팅 가능 상대. 관리자는 다른 관리자와 자신에게 연결된 기사, 기사는 자동 매칭 관리자 1명만 반환 |
| `GET /chat/conversations` | 관리자/기사 | 본인이 참여한 대화방 목록 + unread_count |
| `POST /chat/conversations` | 관리자/기사 | `{partner_id}`로 같은 조직의 허용된 1:1 대화방 생성 또는 조회 |
| `GET /chat/conversations/{id}/messages?before_message_id=&limit=50` | 관리자/기사 | 메시지 히스토리. 응답은 항상 과거→현재 시간 오름차순 |
| `POST /chat/conversations/{id}/messages` | 관리자/기사 | `{content}` 텍스트 메시지 전송. 공백/2,000자 초과 거부 |
| `POST /chat/conversations/{id}/read` | 관리자/기사 | `{last_read_message_id?}` 기준 읽음 워터마크 갱신 |
| `WS /ws/chat?token={JWT}` | 관리자/기사 | 사용자 단위 채팅 WebSocket. `chat.ready`, `chat.message`, `chat.read` 이벤트 수신 |

채팅 권한 규칙:
- 같은 `organization_id`의 승인된 `admin` ↔ `admin`, `admin` ↔ `driver` 조합을 허용한다.
- 기사는 기존 대화가 있으면 가장 최근 연결 관리자, 없으면 `is_org_owner=true` 최상위 관리자 우선·가입일 순으로 관리자 한 명과 자동 매칭된다.
- 일반 관리자는 자신이 지정 관리자인 기사만 파트너 목록에서 볼 수 있으며, 다른 관리자에게 연결된 기사와 새 대화방을 만들 수 없다.
- `superadmin`, 승인 대기·반려 계정, 자기 자신, driver↔driver 조합은 거부한다.
- 실시간 전송 실패는 DB 저장을 롤백하지 않는다. 재접속 시 REST 히스토리로 복구한다.
- `/ws/chat`과 `/ws/location`은 연결 초기에만 DB에서 사용자를 검증하며, 연결 유지·heartbeat·메시지 수신 구간에서는 DB 세션을 점유하지 않는다.

프론트엔드 진입점:
- 관리자: 대시보드 상단 메시지 버튼 → `/chat.html`. 직접 상대를 열 때는 `?partner_id={user_id}`를 사용하며 기존 `?driver_id=`도 호환한다.
- 기사: `/driver.html` → 서버가 반환한 연결 관리자 한 명과 자동으로 대화방을 연다.
- 로그인 후 `role === "driver"`는 `/driver.html`, `role === "superadmin"`은 `/superadmin.html`, `role === "admin"`은 `/dashboard.html`로 이동한다.
- `superadmin`은 기업 소속 관리자 계정이 아니라 루트온 운영자 계정이므로 기업 대시보드와 기업-기사 채팅 화면 접근 대상에서 제외한다.

settings.html 구조:
- 인증 가드: 토큰 없음 → `/login.html`, `role !== 'admin'` → 리다이렉트
- 디자인: 대시보드 CSS 변수 시스템 공유 (다크/라이트 모드, FOUC 방지 스크립트)
- 섹션 ①: 프로필 이미지 — JPG/PNG/WEBP 최대 5MB 업로드·삭제. `users.profile_image` 경로를 채팅 상대 목록과 헤더에서 사용
- 섹션 ②: 계정 정보 — `GET /auth/me`로 초기값 채움, 전화번호·비밀번호 변경 `PATCH /auth/me`
- 섹션 ③: 화면 설정 — 자동/다크/라이트 세그먼트 선택, `localStorage('theme')` 저장, 즉시 반영
- 섹션 ④: 계정 탈퇴 — 현재 비밀번호 확인 필수. 최상위 기업관리자는 권한 이전 전 탈퇴할 수 없고 기사는 대기·운행 중 배차가 없어야 한다.
- 조직코드·기업명·기사/관리자 자동승인은 중복 배치를 피하기 위해 `기본정보 > 기업 정보`에서만 관리한다.
- 별도 설정 퀵 버튼은 두지 않고 관리자 드롭다운의 `계정 설정`만 `/settings.html`로 이동한다.

통합 대시보드 진입점:
- 메인 탭 순서: `대시보드` → `운행관제` → `오더관리` → `고객관리` → `일정·통계` → `기본정보`
- 상세 차량 위치 확인은 `운행관제 > 실시간 차량 관제`에서 담당한다. 대시보드는 요약 지도와 핵심 현황을 유지한다.
- `오더관리` 하위 탭은 4글자 기준의 `오더접수`, `오더목록`, `배차관리` 3개다. 기존 `main=orders` 쿼리는 `dispatch`로 호환 처리한다.
- 기사 관리: `/dashboard.html?main=basic&page=drivers`
- 차량 관리: `/dashboard.html?main=basic&page=vehicles`
- 운행 통계: `/dashboard.html?main=schedule&page=trip-stats`
- `drivers.html`, `vehicles.html`, `stats.html`은 북마크/기존 링크 호환용 리다이렉트 파일만 유지한다.
- 상단 메인 탭의 세부탭은 hover/focus 드롭다운 방식으로 표시한다. 메인 탭 클릭은 해당 그룹의 첫 세부 페이지로 이동한다.
- hover 세부 메뉴는 고정 폭을 사용해 오더관리 등 메뉴별 길이 차이가 나지 않도록 유지한다.
- `기본정보 > 기업 정보`는 기업명·조직코드 재발급·기사 자동승인·관리자 자동승인·기업 수정 기록을 제공한다. 조직코드 재발급과 관리자 자동승인은 최상위 기업관리자만 사용할 수 있다.
- 담당자는 조직별 `is_org_owner=true`인 최상위 관리자와 일반 관리자로 구분한다. 일반 관리자는 가입 페이지에서 조직코드로 신청하며, 최상위 기업관리자가 `기본정보 > 담당자`에서 승인·반려한다.
- 관리자 신청은 `auto_approve_admins=true`이면 즉시 승인되고, 아니면 최상위 기업관리자 승인 대기다. 승인된 일반 관리자는 `dashboard`, `control`, `dispatch`, `customers`, `schedule`, `basic` 권한이 기본 활성화된다.
- 기사·차량 목록 행에는 삭제 버튼을 두지 않고 선택 후 우측 상세 최하단에서 삭제/비활성화한다. 상세 닫기는 우측 상단, 저장은 우측 하단에 배치한다. 기사 계정은 관리자 화면에서 직접 추가하지 않고 공개 가입·승인 흐름으로만 생성한다.
- 기사 수동 상태는 `운행가능/휴무`, 차량 수동 상태는 `가용/정비`만 제공한다. 진행 중 Trip이 연결된 기사·차량은 삭제 작업을 잠그며, 차량은 상태·연결 기사 변경만 잠그고 톤급·차종 같은 기본 정보는 운행 중에도 수정할 수 있다. 서버도 같은 규칙을 검증한다.
- 차량 상세의 톤급·차종 `<select>`는 표준 옵션 목록(`tonOpts`/`typeOpts`)에 없는 기존 값(과거 자유 입력 데이터 등)도 `tonChoices`/`typeChoices`로 옵션에 포함해 그대로 표시한다 — 그렇지 않으면 일치하는 옵션이 없어 브라우저가 첫 옵션을 기본 선택하고, 좌측 목록과 우측 상세 표시값이 달라 보이며 저장 시 실제 값이 다른 값으로 조용히 덮어써진다(엔티티 이벤트 감사 로그에서 실제 발생 사례 확인·복구함). 톤급 저장 시 `tonMap`에 없는 표기는 숫자를 직접 파싱해 `weight_kg`로 환산한다.
- 차량 목록·상세의 "운행중" 상태 표시는 DB의 `Vehicle.status` 원본이 아니라 `vehicleEffectiveStatus()`(진행 중 Trip 존재 여부로 보정)를 사용한다. `Vehicle.status`는 운행 시작·종료 시 서버에서 자동 갱신되지 않으므로, 활성 운행이 있어도 DB값은 `가용`으로 남아있을 수 있다.
- 기사·차량·고객·오더·캘린더·배차관리 검색은 모두 `bindImeSearch` 헬퍼를 통해 바인딩한다. 한글은 음절마다 `compositionstart/compositionend`가 반복되므로 매번 즉시 재렌더링하면 IME 조합이 끊겨 자모가 분리되거나 음절이 누락된다. 이를 막기 위해 `compositionstart` 시 예약된 재렌더링을 취소하고, 입력이 220ms 이상 멈췄을 때만 한 번 재렌더링하면서 검색창 포커스와 커서 위치를 복원한다.
- 담당자 화면 권한과 기업 자동승인 설정은 공통 슬라이드 토글 UI를 사용한다. 최상위 관리자가 일반 관리자의 화면 접근 권한을 보는 화면에서, 수정 모드가 아닐 때는 기사·차량·고객 상세와 동일하게 토글을 비활성화하고 `detail-lock-hint` 안내 문구로 잠금 상태를 시각적으로 표시한다.
- 일정 캘린더는 7개 열을 고정 비율로 유지하고 긴 일정 텍스트는 셀 안에서 말줄임 처리한다.
- 일정 간트는 커스텀 달력 팝오버와 이전 날·다음 날·오늘 이동을 지원하고 선택 날짜의 운행만 06–21시 타임라인에 표시한다. 서버 UTC 시각은 `Asia/Seoul` 기준으로 변환한다.
- 일반 관리자는 `users.permissions`에서 명시적으로 `false`인 메인 탭을 볼 수 없으며 직접 URL 접근 시 첫 허용 탭으로 이동한다. 빈 권한 JSON은 기존 계정 호환을 위해 전체 허용으로 해석한다.

chat.html 구조:
- 좌측: 관리자·기사 채팅 가능 상대 목록 (GET /chat/partners) + 프로필 이미지·역할·unread 배지 + 이름 검색
- 우측: 메시지창 — 날짜 구분선, 위로 스크롤 시 이전 메시지 페이지네이션
- WS /ws/chat 연결 + 자동 재연결. 한글 IME 중복 전송 방지(e.isComposing), 줄바꿈 표시(white-space: pre-wrap)
- 대시보드는 알림용 경량 채팅 WS를 유지하고 실제 대화 송수신 UI는 chat.html에서 관리한다.
- 채팅 헤더에는 상대 프로필 이미지를 표시하며 별도 `대시보드에서 보기` 버튼은 제공하지 않는다.

dashboard.html 관제 지도:
- 대시보드 진입 시 `/vehicles` 응답의 `last_gps`가 있는 차량은 차량 위치 스냅샷 기준으로 지도 마커를 표시한다.
- `/ws/location` 수신은 기사 실시간 위치 이벤트다. 진행 중 운행 차량만 화면 좌표와 서버 `vehicles.last_lat/last_lon`을 갱신하며, 운행 완료/취소 후 차량 스냅샷은 더 이상 기사 GPS를 따라가지 않는다.
- 대시보드 요약 지도와 운행관제 지도는 사용자 줌/드래그를 막고 고정 배율로 표시한다. 대시보드는 Kakao level 13, 운행관제는 level 12 기준이며 마커 갱신 시 자동 `setBounds()`로 배율을 변경하지 않는다.
- `window resize` 이벤트(rAF 디바운스)를 전역에서 감지해 지도 페이지(`isMapPage()`)에서는 `kakao.maps.event.trigger(map, 'resize')`와 `applyLiveMapFixedView()`를 다시 호출한다.
- `.control-map-card`는 `width: 100%; height: 100%; flex: 1`로 부모 `.control-map-panel`을 그대로 채운다 — 과거에는 `width: min(100%, calc(100vh - 278px))` + `aspect-ratio: 1`로 정사각형 크기를 계산해, 창 가로/세로 비율에 따라 지도 크기가 들쭉날쭉해지는 문제가 있었다(`.dash-map-card`는 처음부터 `height: 300px` 고정이라 영향 없음). 컨테이너 크기를 그대로 따라가도록 바꿔 화면 비율과 무관하게 일정한 크기로 표시된다.
- 운행관제는 좌측 지도 패널, 우측 확대된 요약·차량 위치 패널을 한 viewport에 표시한다. 현재 `in_progress` Trip에 연결된 차량만 목록·지도에 표시하고, 위치 WS 수신 시 좌표 행과 마커를 즉시 갱신한다. 별도 새로고침 버튼은 두지 않는다.
- 차량 행 선택 시 선택 마커를 확대하고 나머지 마커를 반투명 처리하며 선택 좌표로 중심만 이동한다.
- 대시보드 오더 요약 카드는 상태 필터별 최대 5건만 표시하며, 전체 목록은 `오더관리 > 오더 목록` 페이지에서 페이지네이션으로 조회한다.
- 대시보드는 1440×900 기준 한 화면에 핵심 위젯·요약 지도·오더 목록이 들어오도록 구성하되, 창 비율이 달라져 내용이 넘칠 때는 좌/우 컬럼(`dash-left`/`dash-right`)이 각각 `overflow-y: auto`로 독립 스크롤된다(전체 페이지가 아닌 컬럼 단위 스크롤). 바로가기는 1~3개를 선택해 `localStorage('dashboardQuickLinks')`에 저장한다.

dashboard.html 오더·배차 UI:
- `오더관리 > 오더접수`는 `정보 입력 → 대기열 확인 → 일괄 저장` 3단계를 표시한다. 모든 오더 입력 폼의 제목은 `신규 오더 입력`으로 통일하며 첫 번째와 추가 오더 모두 상차·하차 경로 카드와 화주·희망 도착 영역을 동일하게 가진다. 최종 저장 버튼은 우측 접수 대기열 하단에 배치하며 1440×768 이상에서는 페이지와 입력 영역에 세로 스크롤 없이 전체 작업이 보여야 한다.
- 오더정보입력 카드 내부는 좌측(`.intake-main`)·우측(접수 대기열) 모두 `height:100%` 고정 컨테이너다. 좌측은 `.intake-main-scroll`(태스크 카드 + `오더 입력 폼 추가`)만 내부 스크롤되고, `대기열에 추가` 버튼이 담긴 하단 액션바는 스크롤 영역 밖에 고정돼 입력 폼 개수와 무관하게 항상 같은 위치·크기를 유지한다.
- `+ 오더 입력 폼 추가`는 전체를 다시 그리지 않고 새 카드만 DOM에 추가한 뒤 이벤트를 다시 바인딩한다. 클릭해도 이미 입력한 폼의 내용이 사라지지 않아야 한다.
- 오더 접수의 화주는 계약 고객을 뜻한다. 화주 담당 연락처와 하차 수신처는 별도 입력 필드를 두지 않으며, 연락처는 선택한 화주(고객 마스터)의 등록 정보에서 가져온다. 희망 도착 날짜·시간 입력은 숫자만 받아 자동으로 `YYYY-MM-DD`, `HH:MM` 형식의 `-`, `:` 구분자를 채워 넣는다. 혼적 여부는 접수하지 않으며 배차관리에서 결정한다.
- `상차지 추가`, `하차지 추가`로 만든 항목은 `상차 정보`, `하차 정보`로 표기하며(`추가 ~` 접두어 없음) 기본 상·하차 카드와 동일하게 컨테이너로 감싸 장소·화물 입력 구조와 UI를 통일한다.
- `오더관리 > 접수창`은 엑셀 업로드 버튼 옆 `양식 다운로드` 버튼을 같은 크기(`btn` 기본 패딩·폰트)로 제공해 두 버튼의 외형을 통일한다. 템플릿은 다중 상·하차 입력을 위해 `상차지1~3/상차화물/상차규격`, `하차지1~3/하차수취인/하차화물/하차규격`, `화주명`, `연락처`, `희망도착일시`, `혼재여부` 헤더를 사용한다. 기본 예시 행은 한 행에 상차·하차 한 쌍만 채워 그대로 업로드할 때 접수 대기열 1건이 생성된다. 기존 단일 `상차지`, `하차지`, `수취인`, `화물종류`, `규격` 헤더도 계속 읽는다.
- 엑셀 업로드 행은 한 행에 여러 상차/하차가 있어도 `deliveries` 단건 모델에 맞춰 접수 대기열에서 여러 접수건으로 전개된다. 상차/하차 개수가 다르면 마지막 입력값을 반복 적용한다.
- 엑셀 업로드 시 좌표는 `/address/coord` 주소 변환을 우선 사용하고, 실패하면 Kakao 장소 검색으로 보강한다. 좌표 변환 실패 건은 대기열에는 추가되지만 배차 시 기존 좌표 필요 검증을 따른다.
- 접수창 상차 블록에도 화물 종류/규격 입력을 제공한다. 하차 화물/규격이 있으면 하차 값이 우선이고, 없으면 상차 화물/규격을 오더의 `cargo_type`/`cargo_size`로 사용한다.
- 접수창 화주 선택은 고객 마스터가 비어 있어도 `등록된 화주 없음` placeholder를 표시하며, 임시 화주 추가는 select의 `+ 임시 화주 추가` 옵션 하나로만 제공한다(별도 버튼 없음). 임시 화주 생성 모달의 연락처 입력은 `bindPhoneAutoFormat`으로 입력 중 자동으로 `010-0000-0000` 형식의 `-`를 채워 넣는다.
- `오더관리 > 오더목록`은 오더번호·화주·상하차지·화물 통합 검색을 제공한다. 행 클릭을 상세 조회, 행 체크박스와 헤더 전체 체크박스를 다중 선택으로 사용하며 별도 `현재 페이지 선택/해제`, `선택 해제` 버튼은 두지 않는다. 선택한 `접수` 상태 오더만 `오더관리 > 배차관리`로 전달한다.
- 오더목록에는 `+ 접수 창` 버튼을 두지 않는다. 접수는 상단 하위 메뉴의 `오더접수`로 이동한다.
- 오더목록 행에는 별도 수정 버튼을 두지 않는다. 행을 선택한 뒤 우측 상세 하단 `수정` 버튼으로 인라인 편집을 시작한다.
- 오더 목록 컬럼 순서는 `상태`, `접수 시간`, `혼적`, `상차지/하차지`, `화물`, `화주`, `기사`, `시간창`, `오더번호` 순서를 기본으로 한다. 목록과 상세는 `RO-YYMMDD-XXXXXX` 표시 형식만 사용하고 긴 원본 UUID는 노출하지 않는다.
- 오더 상세의 `상·하차` 탭은 `cargo_id` 원본 필드명 대신 `화물 ID`를 사용하고 `RO-...-화물N` 형식으로 표시한다. `지도` 탭은 등록된 모든 상차·하차 좌표를 상차/하차 색상이 다른 핀(`order-stop-pin`, 라벨+드롭핀 모양)으로 표시하며, 탭 전환 직후 컨테이너 크기가 확정되기 전 흰 화면이 보이지 않도록 지도 생성 후 `relayout()`으로 강제 재렌더링한다.
- 오더 상세 지도(`.order-detail-map`)와 고객·기사·차량 상세의 위치 지도(`.entity-detail-map`)는 같은 반응형 높이 규칙(`height: min(58vh, 520px); min-height: 360px`)을 공유한다 — 고정 픽셀(예: 260~330px)로 두면 상세 컨테이너에 비해 상하 길이가 짧아 보이는 문제가 있어 뷰포트 비율 기반으로 통일했다.
- 진행 중인 Trip(`운행중`·`배차` 상태)에 연결된 오더 상세에는 탭 위에 `운행 중 교체` 바(`orderHandoverBarHtml`)를 표시해 `기사 교체`·`차량 교체(대차)`·`사고·지연 신고` 버튼을 제공한다(`bindHandoverActions`, `PATCH /trips/{id}/reassign` 사용). 오더-Trip 연결은 `/deliveries` 응답의 `trip_id`를 그대로 사용한다.
- 오더 상세의 기록 탭 명칭은 `처리 기록`이다. `GET /deliveries/{id}/events`로 서버의 `order_events`를 불러오며, 오더 접수/수정/취소와 기사 앱 운행 시작·상차·하차·취소 요청/처리 이벤트를 표시한다.
- 오더 상세는 우측 컨테이너에서 조회 전용으로 열리고 `수정`을 눌러야 입력이 활성화되며 버튼은 `저장`으로 바뀐다. 별도 수정 모달은 사용하지 않으며 `완료`·`취소` 상태만 조회 전용이고 그 외(`접수`·`배차`·`운행중`)는 모두 인라인 수정이 가능하다(`orderIsEditable`).
- 오더의 화주는 자유 텍스트 입력을 두지 않고 항상 고객 목록에서 선택한다. 오더 상세 수정의 화주 필드와 배차관리 `배송 건 추가` 모달의 화주 필드 모두 `DATA.customers` 기반 select를 사용한다.
- `오더관리 > 배차관리`는 미배정 오더와 가용 기사·연결 차량을 선택한 뒤 `배차 실행` 버튼 하나로 배정과 실행을 한 번에 처리한다. 오더 1건도 같은 흐름으로 처리하며 별도 단건·수동 화면은 없다.
- 배차관리 상단은 `오더 선택 → 기사 선택 → 배정 확인` 단계와 현재 선택·배정 건수를 표시한다. 기사·연결 차량은 오더 목록과 유사한 행 구조로 표시한다. `배정 및 실행`을 별도 카드로 분리하지 않고, 선택한 오더·기사 요약과 `배차 실행` 버튼(`bulk-assign-bar`)을 `기사·차량 선택` 카드 하단에 둔다. 클릭 시 선택 항목을 혼적 규칙에 따라 자동 배정한 뒤 곧바로 실행한다. 배정 묶음·결과 요약은 아래 `배차 결과` 패널에서 확인한다. 배정 오더 칩을 누르면 실행 전 개별 배정을 취소할 수 있다.
- 기사 카드 선택·해제 시 선택 ID, 기사 검색어, 기사 목록 내부 스크롤 위치를 보존한다. 기사 목록을 다시 렌더링하더라도 선택 표시와 검색 결과가 유지되고 목록이 위로 이동하지 않아야 한다.
- 혼적 OFF에서는 오더 수만큼 비어 있는 기사를 선택해야 하며 기사별 1건만 배정한다. 혼적 ON에서는 한 기사·차량에 여러 독립 오더를 배정할 수 있다. 하나의 오더에 상·하차지가 여러 개인 다중 경유는 혼적으로 계산하지 않는다.
- `배차 실행`은 선택 항목을 배정으로 접은 뒤 기사별 배정 묶음마다 `/trips/auto-dispatch`를 호출해 사용자가 지정한 기사·차량 연결을 보존한다. 좌표 없는 오더는 미배정 결과로 표시한다.
- 배차관리 화면은 좌측 `미배정 오더`, 우측 `기사·차량 선택`(하단에 `배차 실행` 버튼 포함), 하단 전체 `차량별 방문 순서·미배정 결과` 구조다. 데스크톱에서는 페이지 스크롤 없이 표시하고 목록이 많으면 각 컨테이너 내부만 스크롤한다.
- 배차 실행 전 프론트에서도 선택 차량보다 큰 톤수 규격 오더를 감지해 요청을 중단한다. 최종 방어는 서버 `/trips/auto-dispatch`의 차량 적재 검증이다.
- 전역 상단바는 `--header-h`(현재 76px)를 고정 높이로 사용하고 flex 축소를 허용하지 않는다. 오더목록·배차관리처럼 `100vh` 레이아웃을 쓰는 화면에서도 동일한 높이를 유지한다.

dashboard.html 관리 상세·일정 UI:
- 고객·기사·차량·담당자·기업·오더 상세는 최초 조회 전용이며 `수정 → 저장` 순서로 편집한다. 삭제 작업이 있으면 상세 footer의 수정/저장 버튼 왼쪽에 배치한다.
- 차량 상세의 삭제 명칭은 `차량 삭제`를 사용한다. 마지막 GPS 값과 안내 문구는 하나의 form-grid 값 컨테이너에 넣어 뒤의 상태·연결 기사 필드가 같은 열에 정렬되게 한다.
- 고객관리 메인 탭은 hover 세부 메뉴를 노출하지 않는다. 화면 내부의 고객 목록/상세 탭만 사용한다.
- 캘린더는 월 이동·연월 제목과 범례를 중앙 정렬하고 목록은 `datetime` 기준 최신순으로 표시한다. 날짜와 시간을 함께 출력하며 유형은 별도 컬럼에 두고 ID에는 `TR-YYMMDD-NNN` 운행번호 또는 표시용 오더번호만 사용한다. 하단 일정 목록은 ID·내용·유형(`오더`/`운행`) 통합 검색창과 `paginationHtml`/`bindPagination` 기반 페이지네이션을 제공하며, 월 이동·검색어 변경 시 페이지를 1로 초기화한다.
- 간트 날짜 이동은 `Date#getFullYear/getMonth/getDate` 기반 로컬 `YYYY-MM-DD`로 계산하고 `toISOString()`을 사용하지 않는다. 운행 날짜·막대 시간은 `Asia/Seoul` 기준이며 기본 날짜 입력 대신 커스텀 월간 달력을 사용한다.
- 오더·고객·기사·차량·담당자 목록은 데이터가 한 페이지 이하라도 `1 / 1 페이지`와 비활성 이전/다음 버튼을 표시한다.
- 목록 카드의 `card-bd`는 공통으로 `master-list-body` 클래스를 사용하며 `flex: 1`로 `card-fill` 높이를 그대로 채운다. 그 안의 `.table-scroll`이 `flex: 1`로 남는 공간을 가져가므로, 행 수가 적어 표가 짧아도 페이지네이션이 행 바로 아래가 아니라 항상 카드 하단에 고정된다.
- 사후통계는 SheetJS 기반 `.xlsx` 다운로드를 제공하고 라이브러리를 사용할 수 없으면 UTF-8 BOM CSV로 대체한다.
- 대시보드와 운행관제는 지도 DOM을 공유하지만 화면별 선택 상태는 공유하지 않는다. 관제 마커 클릭 시 전체 화면을 다시 렌더링하지 않고 마커/행 강조와 지도 중심만 갱신한다.
- 체크박스 형태의 운영 설정과 혼적 여부는 기본 브라우저 토글 대신 공통 커스텀 토글 UI를 사용한다.

dashboard.html 기업 정보 권한:
- 기업명·기사/관리자 가입 자동승인 설정은 `users.is_org_owner=true`인 최상위 기업관리자만 수정할 수 있다. 조직코드 재발급도 별도 최상위 관리자 전용 API를 사용한다.
- 프론트는 일반 관리자에게 기업 설정 입력과 수정 버튼을 잠그고, 백엔드 `PATCH /organizations/me/settings`도 `is_org_owner`가 아니면 HTTP 403을 반환한다.

dashboard.html 고객관리 UI:
- 고객 목록 행에는 별도 수정 버튼을 두지 않는다. 행 선택 시 우측 상세는 조회 전용으로 열리고 상단 `수정` 버튼을 누른 뒤에만 담당자·연락처·주소 편집과 `bindPlaceSearch()` 주소 자동완성이 활성화된다. 수정 모드가 아닐 때는 기사·차량 상세와 동일하게 `disabled` 입력란을 흐리게 표시(`.inline-detail-bd input:disabled`)하고 `detail-lock-hint` 안내 문구로 잠금 상태를 시각적으로 알린다. 정보/위치 등 어떤 상세 탭에 있어도 `수정` 버튼을 눌렀을 때 현재 탭이 유지된다(모든 탭에 동일한 클릭 리스너를 건다).
- 고객 주소칸은 `data-place-value="address"` 분기를 사용해 자동완성 선택 시 장소명 대신 도로명주소/지번주소를 우선 입력하고, `customers.lat`/`customers.lon`에 좌표를 함께 저장한다.
- 별도 `고객 위치` 하위 탭은 두지 않는다. 고객 행을 선택한 뒤 우측 상세의 `위치` 탭에서 고객 마스터 `lat`/`lon` 기준 지도 마커를 표시하며, 좌표가 없으면 주소 자동완성으로 먼저 등록하도록 안내한다.
- 고객·기사·차량 상세의 위치 지도는 캔버스 DOM 요소에 `_kakaoMap`/`_kakaoMarker` 인스턴스를 보관해 재사용한다(`initCustomerDetailMap`/`initDriverDetailMap`/`initVehicleDetailMap`). `위치` 탭을 다시 누를 때마다 같은 캔버스에 `new kakao.maps.Map`을 생성하면 지도 타일이 중첩 렌더링되므로, 이미 인스턴스가 있으면 중심·마커 좌표만 갱신하고 `resize` 이벤트만 트리거한다. 기사 상세는 기사 본인의 마지막 GPS(`DATA.drivers[].last_lat`/`last_lon`, `GET /users` 응답의 `last_gps` — `locations` 테이블에서 해당 기사의 최신 기록을 조회), 차량 상세는 차량 자체 `last_gps`(`vehicles.last_lat`/`last_lon`) 좌표를 표시하며 좌표가 없으면 안내 문구를 보여준다. 기사와 차량의 위치는 서로 다른 주체이므로 기사 위치 지도에 배정 차량의 GPS를 사용하지 않는다.
- 고객·기사·차량·담당자·기업 정보 상세는 `수정 기록` 탭에서 `GET /entity-events` 결과를 표시한다. 오더 상세의 운행 처리 기록은 목적이 다르므로 기존 `order_events` 기반 `처리 기록` 탭을 유지한다.

footer 및 법적 안내 페이지:
- `dashboard.html`, `index.html`, `intro.html` footer는 `terms.html`, `privacy.html`, `copyright.html`, `contact.html`로 이동하는 링크를 제공한다.
- 법적 안내 페이지 4종은 정적 HTML이며 인증 없이 열 수 있다. 졸업작품·시연 환경 기준의 이용약관, 개인정보 처리 기준, 저작권 안내, 문의 절차를 담는다.
- footer는 화면 위에 겹쳐 고정하지 않고 앱 레이아웃의 마지막 요소로 유지한다. 대시보드·오더목록처럼 한 화면 구성이 필요한 페이지에서는 앱 shell 내부 하단에 배치하고, 일반 페이지에서는 문서 콘텐츠 뒤에 표시한다.

dashboard.html 채팅 알림 WS:
- WS /ws/chat 경량 연결 (수신 전용, 전송 없음) — `connectChatWebSocket()`
- `chat.message` 수신 시: `message.sender_id ≠ currentUserId`면 해당 상대 unread 배지 +1
- `chat.read` 수신 시: `reader_id === currentUserId`면 해당 상대 배지 → 0
- 대화방은 `conversation_id → partner_id`로 매핑해 기사와 관리자 알림을 함께 처리한다.
- 초기 로드 시 `loadChatConversations()` 로 기존 unread 카운트 일괄 반영
- 대시보드 탑바의 메시지 버튼은 `/chat.html`로 이동한다. 미읽음 메시지가 있으면 기존 알림 점과 동일하게 메시지 버튼에도 배지를 표시한다.
- 관리자 웹 세션 가드는 `admin`만 대시보드 접근을 허용한다. `superadmin`은 `/superadmin.html` 전용이다.

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
