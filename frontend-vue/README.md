# RouteOn Frontend (Vue 3 + Vite)

RouteOn 화물차 경로 최적화 서비스의 관리자 웹 프론트엔드입니다.

## Tech Stack

- [Vue 3](https://vuejs.org/) (Composition API + `<script setup>`)
- [Vue Router 4](https://router.vuejs.org/)
- [Vite 5](https://vitejs.dev/)
- [SheetJS (xlsx)](https://sheetjs.com/) — 엑셀 파싱

## Project Structure

```
frontend-vue/
├── public/                  # 정적 파일 (빌드 시 그대로 복사)
├── src/
│   ├── api/
│   │   └── client.js        # 공통 HTTP 클라이언트 (fetch 기반)
│   ├── assets/              # 이미지, 폰트, 전역 CSS
│   ├── bridge/              # 레거시 라우터 브리지
│   ├── components/          # 공통 Vue 컴포넌트
│   ├── composables/         # 공통 Composable 함수
│   ├── layouts/             # 레이아웃 컴포넌트
│   ├── router/
│   │   └── index.js         # Vue Router 설정
│   ├── services/            # 도메인별 API 호출 함수
│   ├── stores/              # 전역 상태 스토어 (Pinia 마이그레이션 준비)
│   ├── utils/               # 유틸리티 함수
│   ├── views/               # 페이지 단위 컴포넌트
│   ├── App.vue              # 루트 컴포넌트
│   ├── constants.js         # 상수 정의
│   └── main.js              # 엔트리 포인트
├── index.html               # HTML 템플릿
├── vite.config.js           # Vite 설정
├── jsconfig.json            # IDE 경로 alias 설정
├── .env.example             # 환경변수 샘플
└── package.json
```

## Getting Started

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

Vite dev server는 `http://localhost:5173`에서 실행됩니다.  
API 프록시: `/api` → `http://localhost:8000`

### Build

```bash
npm run build
```

빌드 결과물은 `dist/` 디렉토리에 생성됩니다.

### Preview

```bash
npm run preview
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_BASE_URL` | 백엔드 API 기본 주소 | `http://localhost:8000` |
| `VITE_ENABLE_MOCK` | Mock API 사용 여부 | `false` |

`.env` 파일을 생성하여 환경변수를 설정하세요. (`.env.example` 참고)

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | 개발 서버 시작 |
| `npm run build` | 프로덕션 빌드 |
| `npm run preview` | 빌드 결과 미리보기 |

## Notes

- `src/api/client.js`에서 `Bearer` 토큰 인증 및 JSON 직렬화를 자동 처리합니다.
- 엑셀 업로드는 클라이언트 사이드에서 SheetJS로 파싱한 후 좌표 변환 및 배치 접수를 진행합니다.
