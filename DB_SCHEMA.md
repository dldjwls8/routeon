# 루트온(RouteOn) DB 스키마

> DB: PostgreSQL 16 + TimescaleDB  
> ORM: SQLAlchemy 2.x (비동기, AsyncSession)  
> 좌표 필드명: `lat`(위도), `lon`(경도) — `lng` 사용 금지

---

## ENUM 타입

| ENUM | 값 |
|------|----|
| `userrole` | `superadmin`, `admin`, `driver`, `pending` |
| `orgstatus` | `pending_review`, `approved`, `rejected` |
| `tripstatus` | `scheduled`, `in_progress`, `completed`, `cancelled` |
| `deliverystatus` | `pending`, `in_progress`, `done`, `done_manual` |
| `reststoptype` | `highway_rest`, `drowsy_shelter`, `depot`, `custom` |

---

## 테이블 구조

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
| `created_at` | DATETIME | NOT NULL | |

---

### `users`

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | UUID | PK | |
| `username` | VARCHAR(50) | UNIQUE NOT NULL | 로그인 ID |
| `password_hash` | VARCHAR(255) | NOT NULL | bcrypt 해시 |
| `role` | userrole | NOT NULL DEFAULT 'driver' | `admin` / `driver` |
| `email` | VARCHAR(255) | | 승인/반려 이메일 알림용 |
| `phone` | VARCHAR(20) | | 연락처 |
| `license_number` | VARCHAR(50) | | 운전면허번호 |
| `organization_id` | INTEGER | FK → organizations.id | 소속 기업 |
| `created_at` | DATETIME | NOT NULL | |

---

### `vehicles`

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `plate_number` | VARCHAR(20) | UNIQUE NOT NULL | 차량 번호판 |
| `vehicle_type` | VARCHAR(50) | NOT NULL | 예: 5톤카고, 15톤탑차 |
| `height_m` | FLOAT | NOT NULL | 차량 높이 (m) |
| `weight_kg` | FLOAT | NOT NULL | 총중량 (kg) |
| `length_cm` | FLOAT | | 차량 길이 (cm) |
| `width_cm` | FLOAT | | 차량 폭 (cm) |
| `is_active` | BOOLEAN | NOT NULL DEFAULT TRUE | |
| `created_at` | DATETIME | NOT NULL | |

---

### `rest_stops`

경로 최적화 시 휴게소 후보 POI. 현재 졸음쉼터 253건 적재.

> **주의:** 이 테이블만 좌표 컬럼명이 `latitude` / `longitude`

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | |
| `name` | VARCHAR(100) | NOT NULL | POI 이름 |
| `type` | reststoptype | NOT NULL | `highway_rest` / `drowsy_shelter` / `depot` / `custom` |
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
| `dest_name` | VARCHAR(200) | NOT NULL | 목적지 이름 |
| `dest_lat` | FLOAT | NOT NULL | 목적지 위도 |
| `dest_lon` | FLOAT | NOT NULL | 목적지 경도 |
| `waypoints` | JSONB | | 경유지 배열 `[{"name","lat","lon"}, ...]` |
| `vehicle_height_m` | FLOAT | | 차량 높이 오버라이드 |
| `vehicle_weight_kg` | FLOAT | | 총중량 오버라이드 |
| `vehicle_length_cm` | FLOAT | | 차량 길이 오버라이드 |
| `vehicle_width_cm` | FLOAT | | 차량 폭 오버라이드 |
| `departure_time` | VARCHAR(50) | | 출발 예정 시각 ISO-8601 |
| `optimized_route` | JSONB | | 최적화 결과 (아래 구조 참고) |
| `status` | tripstatus | NOT NULL DEFAULT 'scheduled' | 운행 상태 |
| `is_emergency` | BOOLEAN | DEFAULT FALSE | 긴급 예외 적용 여부 |
| `started_at` | DATETIME | | |
| `completed_at` | DATETIME | | |
| `created_at` | DATETIME | NOT NULL | |

**optimized_route JSONB 구조:**
```json
{
  "route": [
    {"type": "origin",      "name": "서울",      "lat": 37.5, "lon": 127.0},
    {"type": "waypoint",    "name": "대전 창고", "lat": 36.3, "lon": 127.3},
    {"type": "rest_stop",   "name": "금강휴게소","lat": 35.9, "lon": 127.5,
     "min_rest_minutes": 15},
    {"type": "destination", "name": "부산",      "lat": 35.1, "lon": 129.0}
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
| `assigned_to` | UUID | FK → users.id | 담당 기사 |
| `trip_id` | UUID | FK → trips.id | 소속 운행 |
| `address` | VARCHAR(255) | NOT NULL | |
| `lat` | FLOAT | NOT NULL | 위도 |
| `lon` | FLOAT | NOT NULL | 경도 |
| `status` | deliverystatus | NOT NULL DEFAULT 'pending' | |
| `sequence` | INTEGER | | 최적화 후 배송 순서 |
| `deadline` | DATETIME | | 희망 도착 시각 |
| `completed_at` | DATETIME | | GPS 50m 자동 완료 또는 수동 완료 시각 |
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

## 관계 다이어그램

```
organizations ──── users ──────── trips ──────── deliveries
     (1:N)          (1:N)          (1:N)
                                   │
                                vehicles (N:1)

users ──────── locations (1:N, GPS 이력)

rest_stops (독립 — trips.optimized_route JSONB에서 참조)
```

---

## 시드 데이터

| 테이블 | 종류 | 건수 | 출처 |
|--------|------|------|------|
| `rest_stops` | 졸음쉼터 (drowsy_shelter) | 253건 | 한국도로공사 공공데이터 |

```bash
sudo docker exec routeon-api python seeds/seed_rest_stops.py
```

---

## Trip status 변경 흐름

```
scheduled → in_progress  : POST /optimize 호출 시 자동
in_progress → completed  : PATCH /trips/{id}/status?status=completed
in_progress → cancelled  : PATCH /trips/{id}/status?status=cancelled
```

completed 처리 시:
- trips.completed_at 자동 기록
- 소속 deliveries 중 in_progress 건 → done_manual 일괄 처리
