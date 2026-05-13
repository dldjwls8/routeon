# 상세 계획 검토

## 결정: APPROVED

## 요약
상세 계획은 01-plan.md의 목표·범위·제약을 충실히 따르며, 실제 코드 구조와도 일치한다.
`kickDriver` 잔존 참조 문제, 공용 CSS 오염, Vehicle.id 타입 등 주요 위험 요소가 모두 올바르게 식별됐다.
블로킹 이슈는 없으며 즉시 구현 단계로 진행 가능하다.

## 발견 사항

### 막는 이슈 (Blocker)
없음.

### 권고 사항 (Suggestion)

1. **`kickDriver` 참조 위치 재확인**: 코드베이스를 직접 확인한 결과, `kickDriver(` 호출은 3곳 모두 모달 관련 JS(1430, 1444줄은 `openDriverModal()` 내 템플릿, 1581줄은 `approveDriver()` 내)에 있다. 즉, 모달 HTML + 해당 JS 함수를 전부 제거하면 `kickDriver` 호출이 남지 않는다. 계획대로 `grep`으로 한 번 더 확인만 하면 충분하다.

2. **`settings-modal-legacy` 주석 블록 정리**: dashboard.html의 344~346줄에 `<div class="modal-overlay" id="settings-modal-legacy">` 주석 블록이 남아 있다. 기능 영향은 없지만, 3단계 정리 시 함께 제거하면 코드가 더 깨끗해진다.

3. **모달 전용 CSS 전부 제거 가능**: `.modal-overlay`, `.modal-content`, `.modal-header`는 모달 HTML 외에 쓰이는 곳이 없어 전부 제거 가능하다. `.btn-sm`은 CSS 정의(113줄) 외 사용처가 모두 `openDriverModal()`과 `loadVehicles()` 내 JS 템플릿 문자열이므로, 해당 함수 제거 시 CSS도 함께 제거 가능하다. `.setting-group`과 `.btn-warn`은 활성 HTML에 사용처가 없다. 계획의 "미사용일 때만 제거" 표현이 너무 방어적이므로, 구현 시 위 항목들은 모두 제거하도록 안내한다.

4. **`UserRole(str, enum.Enum)` 직렬화**: `/auth/me` 응답의 `role` 필드는 `UserRole(str, enum.Enum)` enum을 반환한다. `str` 서브클래스이므로 FastAPI 직렬화 시 `"admin"`, `"driver"` 등 문자열로 내려온다. `role === 'admin'` 비교가 올바르게 동작하며, 위험 요소에서 언급한 우려는 실제 문제 없음.

5. **`Vehicle.id`는 `Integer`**: 모델에서 `id = Column(Integer, primary_key=True, autoincrement=True)` 확인. 현재 대시보드의 `deleteVehicle(${v.id})`(따옴표 없음)는 정수여서 안전하게 동작한다. 계획의 권고대로 신규 `vehicles.html`에서는 `deleteVehicle('${v.id}')`처럼 문자열로 전달하면 향후 UUID 전환 시 더 안전하다.

### 확인된 사항 (Verified)

- `kickDriver(` 호출이 모달 JS 외부에 존재하지 않음 (직접 grep 확인)
- `.btn-sm` 사용처가 모두 제거 대상 모달 함수 내 템플릿 문자열임 (직접 grep 확인)
- `UserRole`이 `str, enum.Enum` 서브클래스이므로 role 비교 패턴이 안전함 (models.py:21 확인)
- `Vehicle.id`가 `Integer` PK임 (models.py:169 확인)
- 1→2→3 단계 순서가 합리적: 1·2단계는 독립적이며 3단계(모달 제거)만 1·2 완료에 의존함
- 기존 `loadDrivers()`가 제거 대상 목록에 없으며 대시보드 실시간 렌더링 유지됨
- `settings.html`, `stats.html`과 동일한 Nginx 정적 파일 배포 방식이므로 신규 HTML 접근에 서버 설정 변경 불필요

## 다음 액션
- APPROVED → `/wf-implement` 으로 Codex 구현 단계로 진행
