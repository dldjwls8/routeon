# 루트온(RouteOn) DB 스키마

> DB: PostgreSQL 16 + TimescaleDB  
> ORM: SQLAlchemy 2.x (비동기, AsyncSession)  
> 좌표 필드명: `lat`(위도), `lon`(경도) — `lng` 사용 금지  
> 최종 검토: 2026-06-06 (v1.0.100 기준, 프로필 이미지·운행 상태 변경 방어)

---

## ENUM 타입

| ENUM | 값 |
|------|----|
| `userrole` | `superadmin`, `admin`, `driver`, `pending` (`pending`은 레거시 호환 값이며 신규 가입에는 사용하지 않음) |
| `accountstatus` | `pending`, `approved`, `rejected` |
| `orgstatus` | `pending_review`, `approved`, `rejected` |
| `tripstatus` | `scheduled`, `in_progress`, `completed`, `cancelled` |
| `deliverystatus` | `pending`, `in_progress`, `done`, `done_manual`, `cancelled` |
| `reststoptype` | `highway_rest`, `drowsy_shelter`, `depot`, `custom`, `truck_yard`, `logistics_park` |

---

## 테이블 구조

> v1.0.100은 `users.profile_image`를 추가한다. 기존 `organizations.auto_approve_admins`, `users.account_status`와 레거시 `role=pending` 보정은 그대로 유지한다.

### `organizations`

기업 단위. 슈퍼 관리자 심사 후 승인 시 서비스 이용 가능.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `name` | VARCHAR(100) | NOT NULL | 기업명 |
| `org_code` | VARCHAR(20) | UNIQUE NOT NULL | `RT-XXXXXX` 형식 자동 발급 |
| `status` | orgstatus | NOT NULL DEFAULT 'pending_review' | 심사 상태 |
| `doc_filename` | VARCHAR(255) | | 첨부 서류 원본 파일명 |
| `doc_path` | VARCHAR(512) | | 서버 저장 경로 (`backend/uploads/{id}/`) |
| `reject_reason` | TEXT | | 반려 사유 |
| `reviewed_at` | DATETIME | | 심사 완료 시각 |
| `auto_approve_drivers` | BOOLEAN | NOT NULL DEFAULT FALSE | 기사 가입 자동승인 여부 |
| `auto_approve_admins` | BOOLEAN | NOT NULL DEFAULT FALSE | 일반 관리자 가입 자동승인 여부. 최상위 기업관리자만 변경 가능 |
| `created_at` | DATETIME | NOT NULL | |

---

### `app_settings`

루트온 전역 운영 설정. 현재 슈퍼관리자 콘솔의 기업 가입 신청 자동 수락 토글을 저장한다.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `key` | VARCHAR(80) | PK | 설정 키. 현재 `organization_auto_approve` 사용 |
| `value` | JSONB | NOT NULL DEFAULT `{}` | 설정 값. 예: `{"enabled": true}` |
| `updated_at` | DATETIME | NOT NULL | 마지막 갱신 시각 |

`organization_auto_approve.enabled=true`이면 `POST /organizations`가 신규 기업을 `pending_review`가 아닌 `approved`로 즉시 생성하고 `reviewed_at`을 기록한다.

---

### `users`

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | UUID | PK | |
| `username` | VARCHAR(50) | UNIQUE NOT NULL | 로그인 ID |
| `password_hash` | VARCHAR(255) | NOT NULL | bcrypt 해시 |
| `name` | VARCHAR(50) | | 실명 (기사 앱 가입 시 입력, 기존 계정은 NULL) |
| `role` | userrole | NOT NULL DEFAULT 'driver' | `admin` / `driver` |
| `email` | VARCHAR(255) | | 승인/반려 이메일 알림용 |
| `phone` | VARCHAR(20) | | 연락처 |
| `profile_image` | VARCHAR(512) | | 프로필 이미지 정적 제공 경로. 이미지 바이너리는 DB에 저장하지 않음 |
| `license_number` | VARCHAR(50) | | 운전면허번호 |
| `organization_id` | INTEGER | FK → organizations.id | 소속 기업 |
| `vehicle_id` | INTEGER | FK → vehicles.id NULLABLE | 배정 차량 ID (기사 상세에서 수동 배정) |
| `driver_status` | VARCHAR(20) | NULLABLE | 기사 운행 상태. 관리자 수동 변경은 `운행가능` / `휴무`만 허용하고 `운행중`은 Trip 상태에서 관리 |
| `is_org_owner` | BOOLEAN | NOT NULL DEFAULT FALSE | 기업 최상위 관리자 여부. 조직별 최초 `admin`을 자동 보정 |
| `permissions` | JSONB | NOT NULL DEFAULT `{}` | 일반 관리자 메인 화면 접근 권한. 키: `dashboard`, `control`, `dispatch`, `customers`, `schedule`, `basic` |
| `account_status` | accountstatus | NOT NULL DEFAULT 'approved' | 가입 승인 상태. 역할과 독립적으로 `pending` / `approved` / `rejected` 관리 |
| `created_at` | DATETIME | NOT NULL | |

권한 규칙:
- 기업 등록과 함께 생성되는 첫 관리자 계정은 `is_org_owner=true`이며 전체 화면 권한을 가진다.
- 기존 조직은 `init_db()` 실행 시 `created_at`, `id` 순으로 가장 이른 관리자 한 명을 최상위 관리자로 보정한다.
- 일반 관리자는 공개 `POST /auth/register`에 `role=admin`과 승인된 기업의 조직코드를 전달해 신청한다. `auto_approve_admins=true`이면 즉시 `approved`, 아니면 `pending`으로 생성된다.
- 승인 대기 관리자 신청은 같은 기업의 최상위 기업관리자만 승인·반려할 수 있다. 자동 또는 수동 승인 시 기본 전체 화면 권한을 적용한다.
- 기사는 `role=driver`로 생성되며 `auto_approve_drivers=true`일 때만 즉시 `account_status=approved`, 그 외에는 `pending`이다.
- `account_status=pending/rejected` 계정은 로그인과 인증된 API 이용이 차단된다.
- `permissions`의 빈 JSON은 기존 계정 호환을 위해 프론트에서 전체 허용으로 해석하며, 명시적인 `false` 키만 접근을 차단한다.
- 최상위 관리자만 다른 일반 관리자의 `permissions`를 수정하거나 계정을 삭제할 수 있고, 최상위 관리자 계정은 삭제할 수 없다.
- 진행 중 Trip이 있는 기사는 상태·배정 차량 변경과 삭제가 거부된다. 본인 탈퇴는 `scheduled` 또는 `in_progress` Trip이 없어야 한다.
- 일반 계정은 현재 비밀번호 확인 후 탈퇴할 수 있다. 최상위 기업관리자는 먼저 권한을 이전해야 하며 직접 탈퇴할 수 없다.
- `profile_image`는 `/auth/me/profile-image` 업로드·삭제 API로 관리하고 채팅 파트너 응답에 포함된다.

---

### `vehicles`

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `organization_id` | INTEGER | FK → organizations.id | 소속 기업. 관리자 조회/수정/삭제는 이 값으로 격리 |
| `plate_number` | VARCHAR(20) | UNIQUE NOT NULL | 차량 번호판 |
| `vehicle_type` | VARCHAR(50) | NOT NULL | 예: 5톤카고, 15톤탑차 |
| `height_m` | FLOAT | NOT NULL | 차량 높이 (m) |
| `weight_kg` | FLOAT | NOT NULL | 총중량 (kg) |
| `length_cm` | FLOAT | | 차량 길이 (cm) |
| `width_cm` | FLOAT | | 차량 폭 (cm) |
| `status` | VARCHAR(20) | NOT NULL DEFAULT '가용' | 차량 운행 상태. 관리자 수동 변경은 `가용` / `정비`만 허용하고 `운행중`은 Trip 상태에서 관리 |
| `last_lat` | FLOAT | | 차량 마지막 위치 위도. 진행 중 운행 차량만 기사 GPS 수신 시 갱신 |
| `last_lon` | FLOAT | | 차량 마지막 위치 경도 |
| `last_gps_at` | DATETIME | | 차량 마지막 위치 확정/갱신 시각 |
| `is_active` | BOOLEAN | NOT NULL DEFAULT TRUE | |
| `created_at` | DATETIME | NOT NULL | |

진행 중 Trip이 연결된 차량은 제원·상태·배정 기사 변경과 비활성화를 거부한다.

---

### `rest_stops`

경로 최적화 시 휴게소 후보 POI. 현재 총 409건 적재.

> **주의:** 이 테이블만 좌표 컬럼명이 `latitude` / `longitude`

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `name` | VARCHAR(100) | NOT NULL | POI 이름 |
| `type` | reststoptype | NOT NULL | `highway_rest`(고속도로 휴게소) / `drowsy_shelter`(졸음쉼터) / `truck_yard`(공영차고지) / `logistics_park`(물류단지) / `depot`(거점) / `custom`(수동 등록) |
| `latitude` | FLOAT | NOT NULL | 위도 |
| `longitude` | FLOAT | NOT NULL | 경도 |
| `is_active` | BOOLEAN | NOT NULL DEFAULT TRUE | 경로 최적화 후보 포함 여부 |
| `direction` | VARCHAR(10) | | 상행 / 하행 / NULL |
| `note` | TEXT | | 메모 |
| `created_at` | DATETIME | NOT NULL | |

---

### `trips`

운행 단위. 관리자가 생성, 기사가 `/optimize` 호출 시 경로 계산.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | UUID | PK | |
| `driver_id` | UUID | FK → users.id | |
| `vehicle_id` | INTEGER | FK → vehicles.id | |
| `origin_name` | VARCHAR(200) | | 출발지 이름 (기사가 출발 시 전달) |
| `origin_lat` | FLOAT | | 출발지 위도 |
| `origin_lon` | FLOAT | | 출발지 경도 |
| `dest_name` | VARCHAR(200) | | 도착지 이름 (nullable — 기사가 /optimize 시 자동 결정 가능) |
| `dest_lat` | FLOAT | | 도착지 위도 |
| `dest_lon` | FLOAT | | 도착지 경도 |
| `waypoints` | JSONB | | 경유지 배열 `[{"name","lat","lon","type":"loading"\|"unloading","task_group":int\|null,"recipient_name":str\|null,"cargo_type":str\|null,"cargo_size":str\|null,"cargo_weight_ton":float\|null,"shipper_name":str\|null,"contact_name":str\|null,"contact_phone":str\|null,"shipper_phone":str\|null,"delivery_id":uuid\|null,"order_no":str\|null,"arrived_at":"ISO-8601"\|null,"departed_at":"ISO-8601"\|null}, ...]`. `dest_*` 목적지가 별도 입력된 수동 Trip은 신규 생성 시 동일 좌표 중복 없이 `type="unloading"` waypoint로 보강되며, 기존 Trip 조회 응답도 같은 방식으로 보강됨 |
| `vehicle_height_m` | FLOAT | | 차량 높이 오버라이드 |
| `vehicle_weight_kg` | FLOAT | | 총중량 오버라이드 |
| `vehicle_length_cm` | FLOAT | | 차량 길이 오버라이드 |
| `vehicle_width_cm` | FLOAT | | 차량 폭 오버라이드 |
| `departure_time` | VARCHAR(50) | | 출발 예정 시각 ISO-8601 |
| `optimized_route` | JSONB | | 최적화 결과 (아래 구조 참고) |
| `status` | tripstatus | NOT NULL DEFAULT 'scheduled' | 운행 상태 |
| `current_phase` | VARCHAR(40) | NOT NULL DEFAULT 'waiting' | 세부 운행 단계 — `waiting`, `en_route_to_loading`, `loading_arrived`, `loading_completed`, `en_route_to_unloading`, `unloading_arrived`, `unloading_completed`, `completed`, `cancelled` |
| `phase_updated_at` | DATETIME | | 세부 운행 단계 갱신 시각 |
| `is_emergency` | BOOLEAN | DEFAULT FALSE | 긴급 예외 적용 여부 |
| `safety_issue` | BOOLEAN | NOT NULL DEFAULT FALSE | 안전 이슈 플래그 (앱에서 `PATCH /trips/{id}/safety`로 기록) |
| `started_at` | DATETIME | | |
| `completed_at` | DATETIME | | |
| `created_at` | DATETIME | NOT NULL | |
| `cancel_requested` | BOOLEAN | NOT NULL DEFAULT FALSE | 기사가 배차 취소 요청 중 여부 |
| `cancel_request_reason` | TEXT | | 기사가 입력한 취소 사유 |

**optimized_route JSONB 구조:**
```json
{
  "route": [
    {"type": "origin",      "node_type": "loading",   "name": "서울",      "lat": 37.5, "lon": 127.0},
    {"type": "waypoint",    "node_type": "loading",   "name": "대전 창고", "lat": 36.3, "lon": 127.3},
    {"type": "waypoint",    "node_type": "unloading", "name": "천안 물류", "lat": 36.8, "lon": 127.1},
    {"type": "rest_stop",   "name": "금강휴게소","lat": 35.9, "lon": 127.5,
     "min_rest_minutes": 15},
    {"type": "destination", "node_type": "unloading", "name": "부산",      "lat": 35.1, "lon": 129.0}
  ],
  "total_distance_km": 420.5,
  "estimated_duration_min": 327.0
}
```

**status 값:**
| 값 | 의미 | 변경 시점 |
|----|------|----------|
| `scheduled` | 배차 완료, 출발 전 | POST /trips 생성 시 기본값 |
| `in_progress` | 운행 중 | POST /optimize 호출 시 자동 |
| `completed` | 운행 완료 | 수동 변경 |
| `cancelled` | 취소 | 수동 변경 |

---

### `deliveries`

배송지 단위. trip 하위에 속함.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | UUID | PK | |
| `organization_id` | INTEGER | FK → organizations.id | 소속 기업. 관리자 조회/수정/삭제는 이 값으로 격리 |
| `assigned_to` | UUID | FK → users.id | 담당 기사 |
| `trip_id` | UUID | FK → trips.id | 소속 운행 |
| `address` | VARCHAR(255) | NOT NULL | 하차 주소 |
| `lat` | FLOAT | NULLABLE | 하차 위도 (접수 시 좌표 미확인 가능) |
| `lon` | FLOAT | NULLABLE | 하차 경도 |
| `pickup_address` | VARCHAR(255) | NULLABLE | 상차 주소 |
| `pickup_lat` | FLOAT | NULLABLE | 상차 위도 |
| `pickup_lon` | FLOAT | NULLABLE | 상차 경도 |
| `shipper_name` | VARCHAR(100) | NULLABLE | 화주명 |
| `contact_name` | VARCHAR(100) | NULLABLE | 담당자명 |
| `contact_phone` | VARCHAR(20) | NULLABLE | 담당자 연락처 |
| `shipper_phone` | VARCHAR(20) | NULLABLE | 화주 연락처. 미입력 시 API 응답은 `contact_phone`으로 폴백 |
| `mixed_load` | BOOLEAN | NOT NULL DEFAULT FALSE | 혼적 여부 |
| `recipient_name` | VARCHAR(100) | NULLABLE | 수신자(고객사명) |
| `cargo_type` | VARCHAR(100) | NULLABLE | 화물 종류. 관리자 웹 신규 입력은 `식품`, `원자재/에너지`, `화학/소재`, `잡화`, `기계/전자`, `기타` 선택지 기준 |
| `cargo_size` | VARCHAR(100) | NULLABLE | 화물 규격. 예: `5톤`, `3파레트` |
| `cargo_weight_ton` | FLOAT | NULLABLE | 과거 화물 톤수 값. 신규 프론트 입력은 `cargo_size` 사용, 이 컬럼은 호환용 |
| `status` | deliverystatus | NOT NULL DEFAULT 'pending' | |
| `sequence` | INTEGER | | 최적화 후 배송 순서 |
| `deadline` | DATETIME | | 희망 도착 시각 |
| `completed_at` | DATETIME | | GPS 50m 자동 완료 또는 수동 완료 시각 |
| `created_at` | DATETIME | NOT NULL | |

> 프론트 오더 목록/상세의 `접수시간`은 이 `created_at` 값을 표시한다.
> 표시용 오더번호 `order_no`는 DB 컬럼이 아니다. `/deliveries`와 배송 연결 `/trips` waypoint 응답에서 `created_at` + Delivery UUID 기반 `RO-YYMMDD-XXXXXX` 형식으로 계산해 내려준다.
> 대시보드 첫 화면의 오더 요약 카드는 상태 필터별 최대 5건만 표시하고, 전체 오더는 오더 목록 페이지에서 조회한다.
> 오더 목록의 체크박스 선택은 프론트 UI 상태이며 별도 DB 컬럼을 만들지 않는다. 선택한 접수 상태 오더는 `오더관리 > 배차관리`로 전달되어 기존 `deliveries.id` 기준으로 `/trips/auto-dispatch` 요청을 구성한다.
> 오더 목록 UI 기본 표시 순서는 `상태`, `접수 시간`, `혼적`, `상차지/하차지`, `화물`, `화주`, `기사`, `시간창`, `오더번호`다.
> `cargo_size` 또는 `cargo_weight_ton`에서 톤 단위를 읽을 수 있으면 배차 생성 API가 `vehicles.weight_kg`와 비교한다. `3파레트`처럼 중량 환산이 불가능한 규격은 표시값으로만 저장된다.

---

### `order_events`

오더·운행 처리 기록. 오더 접수/수정/취소와 기사 앱 운행 이벤트를 운영자가 추적하기 위한 감사성 로그다.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | UUID | PK | |
| `organization_id` | INTEGER | FK → organizations.id, INDEX | 소속 기업 |
| `delivery_id` | UUID | FK → deliveries.id ON DELETE SET NULL, INDEX | 연결 오더. 삭제된 오더 기록 보존을 위해 NULL 허용 |
| `trip_id` | UUID | FK → trips.id ON DELETE SET NULL, INDEX | 연결 운행 |
| `actor_id` | UUID | FK → users.id ON DELETE SET NULL, INDEX | 처리자 |
| `actor_role` | VARCHAR(20) | | 처리 당시 역할 (`admin`, `driver` 등) |
| `actor_name` | VARCHAR(100) | | 처리 당시 표시명 |
| `event_type` | VARCHAR(50) | NOT NULL, INDEX | 예: `order.created`, `order.updated`, `trip.waypoint_arrived` |
| `summary` | VARCHAR(255) | NOT NULL | 화면 표시용 요약 |
| `details` | JSONB | NOT NULL DEFAULT `{}` | 변경 필드, 취소 사유, waypoint 정보 등 |
| `created_at` | DATETIME | NOT NULL, INDEX | 이벤트 발생 시각 |

인덱스:
- INDEX (`delivery_id`, `created_at`)
- INDEX (`trip_id`, `created_at`)

대표 이벤트:
- `order.created`, `order.updated`, `order.cancelled`, `order.deleted`, `order.assigned`, `order.completed_manual`
- `trip.assigned`, `trip.started`, `trip.cancel_requested`, `trip.cancel_rejected`, `trip.cancelled`, `trip.completed`
- `trip.waypoint_arrived`, `trip.waypoint_departed`, `trip.waypoint_completed`, `trip.waypoint_dwell`

---

### `entity_events`

고객·기사·차량·담당자·기업 정보의 생성·수정·삭제를 추적하는 공통 감사 로그다. 오더·운행 처리 흐름은 계속 `order_events`를 사용한다.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | UUID | PK | |
| `organization_id` | INTEGER | FK → organizations.id, NOT NULL, INDEX | 소속 기업 |
| `entity_type` | VARCHAR(30) | NOT NULL, INDEX | `customer`, `driver`, `vehicle`, `staff`, `organization` |
| `entity_id` | VARCHAR(80) | NOT NULL, INDEX | 대상 PK 문자열. UUID/INTEGER 공통 저장 |
| `actor_id` | UUID | FK → users.id ON DELETE SET NULL | 수정 처리자 |
| `actor_name` | VARCHAR(100) | | 처리 당시 표시명 |
| `action` | VARCHAR(30) | NOT NULL | `created`, `updated`, `deleted` |
| `summary` | VARCHAR(255) | NOT NULL | 화면 표시용 요약 |
| `changes` | JSONB | NOT NULL DEFAULT `{}` | `{필드: {before, after}}` 형식의 변경 전후 값 |
| `created_at` | DATETIME | NOT NULL, INDEX | 이벤트 발생 시각 |

복합 인덱스:
- INDEX (`organization_id`, `entity_type`, `entity_id`, `created_at`)

조회 규칙:
- `GET /entity-events?entity_type=&entity_id=`는 로그인 관리자의 `organization_id`를 항상 조건에 포함하고 최신순 최대 100건을 반환한다.
- 고객·차량 등록/수정, 기사·담당자 수정, 담당자 추가/삭제, 기업명·기사/관리자 자동승인 변경, 조직코드 재발급, 관리자 본인 연락처·비밀번호 변경을 기록한다.
- 비밀번호 원문·해시는 저장하지 않고 `password: {before: null, after: "changed"}`만 남긴다.

---

### `customers`

거래처 마스터. 조직 단위로 격리, 임시 화주(당일 의뢰용) 포함.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `organization_id` | INTEGER | FK → organizations.id | 소속 조직 |
| `name` | VARCHAR(100) | NOT NULL | 거래처명 |
| `contact` | VARCHAR(100) | NULLABLE | 담당자명 |
| `phone` | VARCHAR(20) | NULLABLE | 연락처 |
| `address` | VARCHAR(255) | NULLABLE | 주소 |
| `lat` | FLOAT | NULLABLE | 고객 주소 위도. 고객관리 주소 자동완성 선택 시 저장 |
| `lon` | FLOAT | NULLABLE | 고객 주소 경도. 고객관리 주소 자동완성 선택 시 저장 |
| `memo` | TEXT | NULLABLE | 메모 |
| `temporary` | BOOLEAN | NOT NULL DEFAULT FALSE | 임시 화주 여부 (당일 의뢰용) |
| `valid_date` | DATE | NULLABLE | 임시 화주 유효일 (YYYY-MM-DD) |
| `created_at` | DATETIME | NOT NULL | |

---

### `locations`

GPS 이동 이력. TimescaleDB hypertable (7일 retention).

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users.id, INDEX | |
| `lat` | FLOAT | NOT NULL | 위도 |
| `lon` | FLOAT | NOT NULL | 경도 |
| `speed` | FLOAT | | 속도 (m/s) |
| `recorded_at` | DATETIME | NOT NULL PK | hypertable 파티션 키 |

---

### `conversations`

같은 기업의 승인된 사용자 간 1:1 대화방. 관리자-기사와 관리자-관리자를 지원하며 운행과 독립적으로 저장한다.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | UUID | PK | |
| `organization_id` | INTEGER | FK → organizations.id, NOT NULL | 대화방 소속 조직 |
| `admin_id` | UUID | FK → users.id, NOT NULL | 참여자 A. 관리자-기사 대화에서는 관리자 |
| `driver_id` | UUID | FK → users.id, NOT NULL | 참여자 B. 관리자-기사 대화에서는 기사, 관리자 간 대화에서는 두 번째 관리자 |
| `admin_last_read_at` | DATETIME | | 참여자 A 읽음 워터마크 |
| `driver_last_read_at` | DATETIME | | 참여자 B 읽음 워터마크 |
| `created_at` | DATETIME | NOT NULL | |
| `updated_at` | DATETIME | NOT NULL | 최근 메시지 시각 |

제약/인덱스:
- UNIQUE (`organization_id`, `admin_id`, `driver_id`)
- INDEX `admin_id`, `driver_id`
- INDEX (`organization_id`, `updated_at`)

대화 규칙:
- 관리자 간 대화는 UUID 문자열 정렬 결과로 참여자 A/B를 고정해 중복 방지 UNIQUE 제약을 재사용한다.
- 기사는 기존 대화가 있으면 최근 연결 관리자, 없으면 최상위 관리자 우선·가입일 순으로 관리자 한 명과 자동 매칭된다.
- 일반 관리자 파트너 목록에는 다른 승인 관리자와 자신에게 지정된 기사만 포함된다.
- 레거시 컬럼명은 마이그레이션 없이 호환 유지하며 API 응답의 `partner.role`은 실제 `users.role`에서 계산한다.

---

### `messages`

대화방에 저장되는 텍스트 메시지. MVP에서는 첨부/삭제/수정 없이 본문만 저장한다.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | UUID | PK | |
| `conversation_id` | UUID | FK → conversations.id, NOT NULL | |
| `sender_id` | UUID | FK → users.id, NOT NULL | 발신자 |
| `content` | TEXT | NOT NULL | 최대 2,000자 |
| `created_at` | DATETIME | NOT NULL | |

제약/인덱스:
- INDEX (`conversation_id`, `created_at`) — 시간순 메시지 조회
- INDEX (`conversation_id`, `id`) — 커서 검증
- INDEX `sender_id`

읽음 수는 `messages.created_at > conversations.{role}_last_read_at`이고 발신자가 본인이 아닌 메시지 수로 계산한다.

---

## 관계 다이어그램

```
organizations ──── users ──────── trips ──────── deliveries
     (1:N)          (1:N)          (1:N)
                                   │
                                vehicles (N:1)

users ──────── locations (1:N, GPS 이력)
users ──────── conversations ──────── messages
              participant A/B (1:1)
organizations ──────── entity_events (1:N, 관리 마스터 감사 기록)

rest_stops (독립 — trips.optimized_route JSONB에서 참조)
```

---

## 시드 데이터

| 테이블 | 종류 | 건수 | 출처 |
|--------|------|------|------|
| `rest_stops` | 졸음쉼터 (`drowsy_shelter`) | 253건 | 한국도로공사 공공데이터 CSV |
| `rest_stops` | 고속도로 휴게소 (`highway_rest`) | 75건 | 국토교통부 공공데이터 XLS |
| `rest_stops` | 공영차고지 (`truck_yard`) | 55건 | 국토교통부 공공데이터 XLS |
| `rest_stops` | 물류단지 (`logistics_park`) | 26건 | 국토교통부 공공데이터 XLS |

```bash
# 졸음쉼터 (CSV)
sudo docker exec routeon-api python seeds/seed_rest_stops.py

# 휴게소 · 공영차고지 · 물류단지 (XLS, 카카오 geocoding 사용)
sudo docker exec routeon-api python seeds/seed_rest_stops_xls.py
```

---

## Delivery status 변경 흐름

```
pending → cancelled       : PATCH /deliveries/{id} (관리자 취소 버튼)
pending → in_progress     : PATCH /deliveries/{id}/assign 또는 배차 생성 시 자동
in_progress → done        : GPS 50m 자동 완료
in_progress → done_manual : PATCH /deliveries/{id}/complete (수동 완료)
in_progress → cancelled   : PATCH /deliveries/{id} 또는 연결 Trip 취소
```

수정 가능 조건:
- `pending` 상태일 때만 **주소·화물 필드** 수정 가능 (`PATCH /deliveries/{id}`)
- `pending` 상태의 상태 변경은 `pending`, `in_progress`, `cancelled`만 허용
- `in_progress` 상태의 상태 변경은 `in_progress`, `done`, `done_manual`, `cancelled`만 허용. `in_progress → pending` 역행은 API에서 거부
- 연결된 Trip의 마지막 진행 배송을 `cancelled`로 변경하면 Trip도 `cancelled` 처리되고 기사 앱 WS에 `trip.cancelled` 이벤트가 전송됨
- `done` / `done_manual` 상태는 수정·취소·삭제 불가
- `cancelled` 상태는 수정 API에서 거부되며 삭제만 가능 (`DELETE /deliveries/{id}`)

---

## Trip status 변경 흐름

```
scheduled → in_progress          : POST /optimize 호출 시 자동
in_progress → completed          : PATCH /trips/{id}/status?status=completed
scheduled/in_progress → cancelled: PATCH /trips/{id}/status?status=cancelled
```

completed 처리 시:
- trips.completed_at 자동 기록
- 소속 deliveries 중 in_progress 건 → done_manual 일괄 처리
- 연결 차량이 있으면 기사 최신 GPS를 `vehicles.last_lat/last_lon/last_gps_at`에 저장해 차량 마지막 위치로 고정

cancelled 처리 시:
- trips.current_phase → `cancelled`
- 소속 deliveries 중 pending/in_progress 건 → cancelled
- 기사 앱 WS에 `trip.cancelled` 이벤트 전송
- 연결 차량이 있으면 기사 최신 GPS를 `vehicles.last_lat/last_lon/last_gps_at`에 저장해 차량 마지막 위치로 고정

세부 진행 기록:
- `PATCH /trips/{id}/progress` body `{waypoint_index, event}` 또는 `{phase}`.
- `event=arrived`는 해당 waypoint `arrived_at`, `event=departed|completed`는 `departed_at`을 기록.
- loading waypoint는 `loading_arrived`/`loading_completed`, unloading waypoint는 `unloading_arrived`/`unloading_completed`로 `current_phase` 자동 계산.
- `delivery_id`가 연결된 waypoint 진행 이벤트는 `order_events`에도 함께 저장되어 오더 상세 `처리 기록` 탭에 표시된다.

---

## 프론트엔드 연동 주의사항

### vehicles — API vs 프론트 필드명
| DB 컬럼 | API 응답 | 프론트 `DATA.vehicles` | 비고 |
|---------|---------|----------------------|------|
| `weight_kg` | `weight_kg` | `weight_kg`, `tonnage` | 프론트가 `weight_kg / 1000`으로 톤수 문자열 계산 |
| `vehicle_type` | `vehicle_type` | `type` | 정상 매핑 |
| `plate_number` | `plate_number` | `plate` | 정상 매핑 |
| 배정 기사 | `driver_id`, `driver_name` | `driverId`, `driver` | 같은 조직의 `users.vehicle_id == vehicles.id` 기사만 매핑 |
| 최근 차량 위치 | `last_gps` | `last_gps` | `vehicles.last_lat/last_lon/last_gps_at` 스냅샷 기준 |

> `vehicles` API는 `weight_kg`를 원본 필드로 반환하고, 프론트에서 `tonnage` 표시값을 파생한다. 배차 생성 시 톤 단위 화물 규격은 이 `weight_kg / 1000` 값과 비교된다. 과거 `max_load_kg` 접근으로 톤수가 `0.0톤`으로 보이던 문제는 v1.0.75에서 수정됨.
> 기사 마지막 위치는 `/location-logs/{user_id}`가 Redis 실시간값 또는 `locations` 최신 행으로 반환한다. 차량 마지막 위치는 `/vehicles` 응답의 `last_gps`이며, 진행 중 운행 차량만 기사 GPS로 갱신되고 운행 완료/취소 후에는 차량 스냅샷으로 고정된다.

### deliveries status 매핑
| DB `status` | 프론트 표시 | 배차 탭 노출 조건 |
|-------------|------------|----------------|
| `pending` | `'접수'` | 미배차 건 목록 표시 (`unassignedForDispatch()`) |
| `in_progress` | `'운행중'` | 미표시 |
| `done` / `done_manual` | `'완료'` | 미표시 |
| `cancelled` | `'취소'` | 미표시 (삭제 버튼으로 제거 가능) |

> v1.0.97 기준 `오더관리 > 배차관리`의 오더·기사 선택과 기사별 배정 묶음은 모두 프론트 임시 상태다. 최종 실행 시 선택된 `deliveries.id`들이 `tasks[].unloadings[].delivery_id`로 변환되고, 기사별 `/trips/auto-dispatch` 성공 후 기존 Trip/Delivery 상태 전이 규칙을 따른다. 하단 결과 컨테이너는 API 결과를 표시하는 UI이며 별도 DB 컬럼을 만들지 않는다.

### 법적 안내 페이지와 DB
`terms.html`, `privacy.html`, `copyright.html`, `contact.html`은 정적 프론트 페이지다.
footer 링크와 안내 페이지 내용은 DB에 저장하지 않으며, 약관 동의 이력·문의 접수 테이블도 현재 스키마에 없다.

### 오더 접수 엑셀 양식과 DB
`오더관리 > 접수창`의 `양식 다운로드`는 프론트엔드에서 `.xlsx`/`.csv` 템플릿을 생성하는 기능이며 별도 테이블을 추가하지 않는다.
v1.0.93 기준 템플릿은 `상차지1~3/상차화물/상차규격`, `하차지1~3/하차수취인/하차화물/하차규격` 헤더를 사용한다. 기존 단일 `상차지`, `하차지`, `수취인`, `화물종류`, `규격` 헤더도 업로드 호환용으로 계속 읽는다.
엑셀 업로드 행은 접수 대기열에서 여러 접수건으로 전개된 뒤 기존 `deliveries` 생성 API로 저장된다. `deliveries` 테이블은 여전히 한 행에 대표 `pickup_address` 1개와 `address` 1개를 저장하는 단건 오더 모델이며, 다중 상·하차용 별도 테이블은 없다.
엑셀 좌표 변환은 저장 전 프론트에서 `/address/coord`와 Kakao 장소 검색을 사용해 `pickup_lat/pickup_lon`, `lat/lon`에 채운다. 좌표 변환에 실패해도 스키마상 좌표 컬럼은 nullable이므로 저장은 가능하나, 배차 화면은 기존처럼 좌표가 있는 오더만 운행 생성에 사용할 수 있다.
상차 블록의 화물 종류/규격은 하차 화물/규격이 비어 있을 때 `deliveries.cargo_type`/`deliveries.cargo_size`의 fallback으로 사용한다. Trip 생성 시 loading waypoint에도 같은 화물 메타데이터를 포함하지만 DB 컬럼 추가는 없다.
`+ 임시 화주 추가`는 기존 `customers.temporary`, `customers.valid_date` 컬럼을 사용하는 흐름이며 v1.0.93에서 스키마 변경은 없다.

### 고객관리 주소 자동완성과 DB
`고객관리 > 고객 관리`의 주소 자동완성은 선택 주소 문자열을 `customers.address`, 좌표를 `customers.lat`/`customers.lon`에 저장한다.
고객 상세의 `위치` 탭은 오더 하차지 좌표가 아니라 고객 마스터의 `lat`/`lon`을 기준으로 마커를 표시한다. 별도 `고객 위치` 하위 페이지는 사용하지 않는다.
고객 상세 수정은 우측 패널의 명시적 편집 모드에서만 가능하며 저장 시 `entity_events(entity_type='customer')`에도 변경 전후 값이 기록된다.

### users ID 타입
| 테이블 | PK 타입 | 프론트 비교 방식 |
|--------|---------|----------------|
| `users` | UUID (문자열) | 문자열 직접 비교 — `Number()` 변환 금지 |
| `vehicles` | INTEGER | `Number(id)` 변환 후 비교 (`vehicleById`) |
| `customers` | INTEGER | `Number(id)` 변환 후 비교 |
