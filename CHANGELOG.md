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

## 예정 작업

- [ ] 앱 WS replan_requested 수신 → 자동 replan (팀원 A)
- [ ] 관리자 웹 운행 생성 UI
- [ ] 발표 준비
