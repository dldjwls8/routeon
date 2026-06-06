(function () {
  'use strict';

  const apiClient = window.RouteOnApi;
  const apiFetch = apiClient.fetch;
  const WS_BASE = apiClient.wsBase;
  const CARGO_TYPE_OPTIONS = ['식품', '원자재/에너지', '화학/소재', '잡화', '기계/전자', '기타'];

  /* ── 탑바 드롭다운 ── */
  function _openDropdown(id) {
    document.querySelectorAll('.topbar-dropdown').forEach(d => d.classList.remove('open'));
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
  }
  function _closeAllDropdowns() {
    document.querySelectorAll('.topbar-dropdown').forEach(d => d.classList.remove('open'));
  }
  function logout() {
    localStorage.clear();
    location.href = '/login.html';
  }

  /* OS 테마 변경 시 '자동' 상태이면 즉시 반영 */
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('theme')) {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
  });

  let map = null;
  let _liveMapPage = null;
  let _liveMapCenteredPage = null;
  let _driverMarkers = {};
  let _locationWS = null;
  let _chatWS = null;
  let _currentUserId = null;
  const _convDriverMap = {};  // conversation_id → driver_id
  const _driverUnread = {};   // driver_id → unread count
  let _trajectoryPolyline = null;
  let _miniMapInstance = null;
  let _miniMapMarkers = [];
  let _tripRouteMapInstance = null;
  let _tripRoutePolyline = null;
  const LIVE_MAP_FIXED_VIEW = {
    dashboard: { level: 13, label: '64km' },
    'control-live': { level: 12, label: '32km' },
  };
  const LIVE_MAP_DEFAULT_CENTER = { lat: 36.5, lon: 127.8 };

  function getToken() { return apiClient.getToken(); }
  function requireAdminSession() {
    const role = localStorage.getItem('role');
    if (!getToken() || role !== 'admin') {
      location.href = '/login.html'; return false;
    }
    return true;
  }


  /* OD·가짜 데이터 생성기 정렬 (scripts/od_stats.py, generate_fake_logistics_data.py, fake_logistics_stops.csv seed 42) */
  const OD_REGION_PREFIXES = [
    ['서울', '서울'], ['부산', '부산'], ['대구', '대구'], ['인천', '인천'], ['광주', '광주'],
    ['대전', '대전'], ['울산', '울산'], ['세종', '세종'], ['경기', '경기'], ['강원', '강원'],
    ['충청북도', '충북'], ['충북', '충북'], ['충청남도', '충남'], ['충남', '충남'],
    ['전라북도', '전북'], ['전북특별자치도', '전북'], ['전북', '전북'],
    ['전라남도', '전남'], ['전남', '전남'], ['경상북도', '경북'], ['경북', '경북'],
    ['경상남도', '경남'], ['경남', '경남'], ['제주', '제주'],
  ];
  const OD_REGION_FILTER = [
    '전체', '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
    '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주', '전국',
  ];
  const REGION_CENTROIDS = {
    서울: [37.5665, 126.978], 부산: [35.1796, 129.0756], 대구: [35.8714, 128.6014],
    인천: [37.4563, 126.7052], 광주: [35.1595, 126.8526], 대전: [36.3504, 127.3845],
    울산: [35.5384, 129.3114], 세종: [36.48, 127.289], 경기: [37.4138, 127.5183],
    강원: [37.8228, 128.1555], 충북: [36.8, 127.7], 충남: [36.5184, 126.8],
    전북: [35.7175, 127.153], 전남: [34.8679, 126.991], 경북: [36.4919, 128.8889],
    경남: [35.4606, 128.2132], 제주: [33.489, 126.4983],
  };

  function addressToRegion(addr) {
    const text = (addr || '').trim();
    if (!text) return '전국';
    for (const [prefix, key] of OD_REGION_PREFIXES) {
      if (text.startsWith(prefix)) return key;
    }
    return '전국';
  }

  function hashU32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function addressToFakeLatLon(addr) {
    const region = addressToRegion(addr);
    const base = REGION_CENTROIDS[region] || [36.5, 127.5];
    const h1 = hashU32(addr);
    const h2 = hashU32(addr + '#lon');
    const dlat = (h1 / 0xffffffff - 0.5) * 0.45;
    const dlon = (h2 / 0xffffffff - 0.5) * 0.55;
    return { lat: +(base[0] + dlat).toFixed(4), lon: +(base[1] + dlon).toFixed(4), region };
  }

  /** 창고·단지 거점 (물류창고/단지 XLS → fake_logistics_stops.csv 상차지 샘플) */
  const ROUTEON_SITES = [
    { place_name: '상지빌딩', address: '서울특별시 성동구 마장로35길 66, 지하1층 (마장동)', cargo_hint: '일반화물' },
    { place_name: '경동물류(주)', address: '경상남도 양산시 물금읍 제방로 27-9, 1동', cargo_hint: '하역' },
    { place_name: '(주)에스피씨지에프에스', address: '경기도 용인시 처인구 백암면 한택로88번길 260', cargo_hint: '일반화물' },
    { place_name: '대전농업협동조합', address: '전라남도 담양군 대전면 추성1로 208', cargo_hint: '양곡, 영농자재' },
    { place_name: '곡성군 옥당골 광역친환경농업 영농조합법인', address: '전라남도 곡성군 오산면 오산로 907(유통센터)', cargo_hint: '일반화물' },
    { place_name: '엔와이국제물류주식회사', address: '인천광역시 서구 갑문로 20 (오류동)', cargo_hint: '일반화물' },
    { place_name: '(주)행안주택', address: '경기도 안성시 죽산면 송문주로 219', cargo_hint: '일반화물' },
    { place_name: '컬리창원센터', address: '경상남도 창원시 진해구 두동서로 33, 컬리물류센터 1,3,5층 (두동)', cargo_hint: '일반화물' },
    { place_name: '평택항 동부두 보세창고', address: '경기도 평택시 포승읍 평택항만길 145', cargo_hint: '일반화물' },
    { place_name: '(주)에스에스글로벌물류센터 보세창고', address: '경기도 용인시 처인구 죽양대로1650번길 2-14 (원삼면)', cargo_hint: '일반화물' },
    { place_name: '(주)서브원', address: '충청북도 청주시 청원구 오창읍 두릉유리로 688, 일산방직(주)', cargo_hint: '일반화물' },
    { place_name: '중앙물류 보세창고', address: '세종특별자치시  산단길 22-50 (전의면)', cargo_hint: '종합물류' },
  ].map((s) => ({ ...s, region: addressToRegion(s.address) }));

  function siteByName(name) {
    return ROUTEON_SITES.find((s) => s.place_name === name) || ROUTEON_SITES[0];
  }

  function odRegionSelectHtml(selected) {
    return OD_REGION_FILTER.map((r) =>
      `<option${r === selected ? ' selected' : ''}>${r}</option>`).join('');
  }

  function siteSelectHtml(selectedName) {
    return ROUTEON_SITES.map((s) =>
      `<option value="${s.place_name}"${s.place_name === selectedName ? ' selected' : ''}>${s.place_name} (${s.region})</option>`).join('');
  }

  function formatTwClose(tw) {
    if (!tw) return '—';
    const [d, t] = tw.split('T');
    return t ? `${d} ${t}` : tw;
  }

  function placeShortLabel(text) {
    if (text == null || text === '') return '—';
    const s = String(text).trim();
    if (s.length <= 12) return s;
    const region = addressToRegion(s);
    if (region && region !== '전국') return region;
    const parts = s.split(/\s+/);
    if (parts.length >= 2 && parts[0].length <= 5) {
      const short = `${parts[0]} ${parts[1]}`;
      return short.length > 12 ? short.slice(0, 11) + '…' : short;
    }
    return s.slice(0, 11) + '…';
  }

  function routeCellHtml(pickup, delivery) {
    return `<td class="route-cell"><strong>${pickup || '—'}</strong> ▶ ${delivery || '—'}</td>`;
  }

  function cargoTypeOptionsHtml(selected = '') {
    const cur = String(selected || '').trim();
    const custom = cur && !CARGO_TYPE_OPTIONS.includes(cur) ? [cur] : [];
    return [''].concat(custom, CARGO_TYPE_OPTIONS).map(v => {
      const label = v || '화물 종류 선택';
      return `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
    }).join('');
  }

  function cargoTypeSelectHtml(name, selected = '', attrs = '') {
    return `<select name="${name}"${attrs}>${cargoTypeOptionsHtml(selected)}</select>`;
  }

  function formatCargoSizeFromApi(d) {
    if (d?.cargo_size) return String(d.cargo_size);
    if (d?.cargo_weight_ton != null && d.cargo_weight_ton !== '') return `${d.cargo_weight_ton}톤`;
    return '';
  }

  function parseCargoTon(value) {
    const m = String(value || '').match(/(\d+(?:\.\d+)?)\s*(?:톤|t\b|ton(?:ne)?s?)/i);
    return m ? Number(m[1]) : null;
  }

  function vehicleCapacityTon(vehicle) {
    const kg = Number(vehicle?.weight_kg || 0);
    return kg > 0 ? kg / 1000 : null;
  }

  function formatTonValue(value) {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  }

  function capacityViolationForOrders(vehicle, orders) {
    const cap = vehicleCapacityTon(vehicle);
    if (!cap) return null;
    const bad = (orders || []).find(o => {
      const ton = parseCargoTon(o?.tons || o?.cargo_size);
      return ton != null && ton > cap;
    });
    if (!bad) return null;
    return {
      order: bad,
      cargoTon: parseCargoTon(bad.tons || bad.cargo_size),
      capacityTon: cap,
    };
  }

  function capacityViolationMessage(vehicle, orders) {
    const v = capacityViolationForOrders(vehicle, orders);
    if (!v) return '';
    return `${displayOrderNo(v.order)} 규격 ${formatTonValue(v.cargoTon)}톤은 ${vehicle?.plate || '선택 차량'} 적재 가능 중량 ${formatTonValue(v.capacityTon)}톤을 초과합니다.`;
  }

  function fleetCapacityViolationMessage(vehicles, orders) {
    const caps = (vehicles || []).map(v => ({ vehicle: v, capacity: vehicleCapacityTon(v) })).filter(v => v.capacity);
    if (!caps.length) return '';
    const maxCap = Math.max(...caps.map(v => v.capacity));
    const bad = (orders || []).find(o => {
      const ton = parseCargoTon(o?.tons || o?.cargo_size);
      return ton != null && ton > maxCap;
    });
    if (!bad) return '';
    const ton = parseCargoTon(bad.tons || bad.cargo_size);
    return `${displayOrderNo(bad)} 규격 ${formatTonValue(ton)}톤을 적재할 수 있는 선택 차량이 없습니다.`;
  }

  function dispatchStopTooltip(item) {
    const parts = [];
    if (item.name) parts.push(item.name);
    if (item.address) parts.push(item.address);
    if (item.cargo_id) parts.push(`cargo_id: ${item.cargo_id}`);
    if (item.cargo_size) parts.push(`규격 ${item.cargo_size}`);
    if (item.lat != null && item.lon != null) parts.push(`${item.lat}, ${item.lon}`);
    if (item.cargo_weight_kg != null) parts.push(`${item.cargo_weight_kg} kg`);
    if (item.tw) parts.push(`마감 ${formatTwClose(item.tw)}`);
    if (item.pickupAddr) parts.push(`상차 ${item.pickupAddr}`);
    if (item.deliveryAddr) parts.push(`하차 ${item.deliveryAddr}`);
    return parts.join(' · ').replace(/"/g, '&quot;');
  }

  function formatDispatchSize(item) {
    if (item.cargo_size) return String(item.cargo_size);
    if (item.tons != null && item.tons !== '') {
      if (typeof item.tons === 'number') return `${item.tons}톤`;
      return String(item.tons);
    }
    if (item.cargo_weight_kg != null) return `${(item.cargo_weight_kg / 1000).toFixed(1)}톤`;
    const cargo = item.cargo || '';
    const m = String(cargo).match(/([\d.]+)\s*t/i);
    if (m) return `${m[1]}톤`;
    return cargo ? cargo : '—';
  }

  function normalizeDispatchListRow(item, idx = 0) {
    const pickupRaw = typeof item.pickup === 'object' ? item.pickup?.place : item.pickup;
    const deliveryRaw = typeof item.delivery === 'object' ? item.delivery?.place : item.delivery;
    const pickup = pickupRaw
      ? placeShortLabel(pickupRaw)
      : (item.pickupShort || placeShortLabel(item.region) || '물류센터');
    const delivery = deliveryRaw
      ? placeShortLabel(deliveryRaw)
      : (item.deliveryShort || placeShortLabel(item.name) || placeShortLabel(item.address));
    return {
      orderId: displayOrderNo(item.order || item),
      shipper: item.shipper || item.customer || placeShortLabel(item.name) || '—',
      pickup,
      delivery,
      tons: formatDispatchSize(item),
      window: item.window || (item.tw && item.tw.includes('T') ? item.tw.split('T')[1]?.slice(0, 5) : null) || item.latestAt || '—',
      status: item.status || '배차대기',
      tooltip: dispatchStopTooltip(item),
    };
  }

  function orderDateStamp(value) {
    const d = value ? new Date(value) : null;
    const base = d && !Number.isNaN(d.getTime()) ? d : new Date();
    return `${String(base.getFullYear()).slice(2)}${String(base.getMonth() + 1).padStart(2, '0')}${String(base.getDate()).padStart(2, '0')}`;
  }

  function displayOrderNo(orderLike, idx = 0) {
    const raw = typeof orderLike === 'object'
      ? (orderLike.order_no ?? orderLike.orderNo ?? orderLike.order_id ?? orderLike.id ?? orderLike.delivery_id ?? '')
      : (orderLike ?? '');
    const id = String(raw || '').trim();
    const stamp = orderDateStamp(typeof orderLike === 'object' ? (orderLike.created_at || orderLike.createdAt) : null);
    if (/^RO-\d{6}-[A-Z0-9]+$/i.test(id)) return id.toUpperCase();
    const local = id.match(/^O-(\d{6})-(\d+)$/i);
    if (local) return `RO-${local[1]}-${String(Number(local[2])).padStart(4, '0')}`;
    if (/^\d+$/.test(id)) return `RO-${stamp}-${String(Number(id)).padStart(4, '0')}`;
    if (id) return `RO-${stamp}-${id.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}`;
    return `RO-${stamp}-${String(idx + 1).padStart(4, '0')}`;
  }

  function orderNoHtml(o, opts = {}) {
    const shown = displayOrderNo(o);
    const raw = String(o?.id ?? o?.order_id ?? '');
    const sub = opts.raw !== false && raw && raw !== shown
      ? `<small class="order-no-raw">ID ${raw.length > 12 ? `${raw.slice(0, 8)}…` : raw}</small>`
      : '';
    return `<span class="order-no" title="${raw || shown}"><strong>${shown}</strong>${sub}</span>`;
  }

  function dispatchListTableRows(rows, opts = {}) {
    return rows.map((item, i) => {
      const n = normalizeDispatchListRow(item, i);
      const dataId = item.id || item.order_id || n.orderId;
      const selected = opts.selectedId === dataId || (Array.isArray(opts.selectedIds) && opts.selectedIds.includes(dataId));
      const rowCls = [opts.rowClass || 'order-row-clickable', selected ? 'selected' : ''].filter(Boolean).join(' ');
      const lead = opts.radioName
        ? `<td><input type="radio" name="${opts.radioName}" value="${dataId}" ${selected ? 'checked' : ''} aria-label="선택"></td>`
        : (opts.checkbox
          ? `<td><input type="checkbox" class="${opts.checkboxClass || 'dispatch-chk'}" ${(Array.isArray(opts.selectedIds) ? selected : opts.checked !== false) ? 'checked' : ''} data-id="${dataId}" aria-label="선택"></td>`
          : '');
      return `<tr class="${rowCls}" ${opts.dataAttr ? `data-${opts.dataAttr}="${dataId}"` : ''} title="${n.tooltip}">
        ${lead}
        <td>${orderNoHtml(item, { raw: false })}</td>
        <td>${mixedLoadBadge(isMixedLoad(item))}</td>
        <td>${n.shipper}</td>
        ${routeCellHtml(n.pickup, n.delivery)}
        <td>${n.tons}</td>
        <td>${n.window}</td>
        <td>${statusBadge(n.status)}</td>
      </tr>`;
    }).join('');
  }

  function bulkStopsTableHtml(stops) {
    if (!stops?.length) {
      return '<p class="empty-hint">등록된 배송지가 없습니다.</p>';
    }
    return tableScrollWrap(`<table>
      <thead>
        <tr>
          <th>오더번호</th><th>혼적</th><th>화주</th><th>경로</th><th>규격</th><th>시간창</th><th>상태</th>
        </tr>
      </thead>
      <tbody>${dispatchListTableRows(stops, { rowClass: 'order-row-clickable' })}</tbody>
    </table>`);
  }

  const defaultDepotSite = siteByName('엔와이국제물류주식회사');
  const defaultDepotLl = addressToFakeLatLon(defaultDepotSite.address);

  // 실제 데이터 (API에서 동적 로드)
  const DATA = {
    vehicles: [],
    drivers: [],
    pendingDrivers: [],
    staff: [],
    customers: [],
    locations: [],
    orders: [],
    scheduleEvents: [],
    ganttRows: [],
    milestones: [],
    routePreview: [],
    dispatchOrders: [],
    dispatchFleet: [],
    dispatchPlans: [],
    dispatchAssigned: [],
    dispatchUnassigned: [],
    statsSummary: { completed: 0, inProgress: 0, cancelled: 0, incomplete: 0, assignedOk: 0, assignedPending: 0, safetyIssues: 0 },
    driverStats: [],
    vehicleStats: [],
    bulkDispatch: {
      depot: { name: '', lat: 37.4563, lon: 126.7052, address: '' },
      stops: [],
      vehicles: [],
      results: { summary: { vehicles: 0, stops: 0, unassigned: 0 }, plans: [], unassigned: [] },
    },
    statsTrips: [],
    me: null,
  };

  function captureScrollState() {
    const main = document.getElementById('mainContent');
    const inner = main?.querySelector('.page-scroll-main, .master-detail-list, .dispatch-work-pane, .dispatch-result-pane, .page-viewport-inner');
    return {
      windowY: window.scrollY || document.documentElement.scrollTop || 0,
      mainTop: main?.scrollTop || 0,
      innerTop: inner?.scrollTop || 0,
    };
  }

  function restoreScrollState(state) {
    if (!state) return;
    requestAnimationFrame(() => {
      const main = document.getElementById('mainContent');
      const inner = main?.querySelector('.page-scroll-main, .master-detail-list, .dispatch-work-pane, .dispatch-result-pane, .page-viewport-inner');
      if (main) main.scrollTop = state.mainTop || 0;
      if (inner) inner.scrollTop = state.innerTop || 0;
      window.scrollTo(0, state.windowY || 0);
    });
  }

  async function loadRealData(opts = {}) {
    const scrollState = opts.preserveScroll !== false ? captureScrollState() : null;
    try {
      // 기사 목록
      const dr = await apiFetch(`/users?role=driver`);
      if (dr.ok) {
        const users = await dr.json();
        DATA.drivers = users.map(u => ({
          id: u.id,
          name: u.name || u.username,
          vehicleId: u.vehicle_id || null,
          status: u.driver_status || '운행가능',
          phone: u.phone || '',
          history: [],
        }));
      }

      // 차량 목록
      const vr = await apiFetch(`/vehicles`);
      if (vr.ok) {
        const vehs = await vr.json();
        DATA.vehicles.splice(0);
        vehs.forEach(v => DATA.vehicles.push({
          id: v.id,
          plate: v.plate_number,
          tonnage: v.tonnage || `${((v.weight_kg || 0) / 1000).toFixed(1)}톤`,
          type: v.vehicle_type || '카고',
          weight_kg: v.weight_kg || 0,
          start_lat: v.last_gps?.lat ?? null,
          start_lon: v.last_gps?.lon ?? null,
          last_gps_label: v.last_gps ? `${Number(v.last_gps.lat).toFixed(2)}, ${Number(v.last_gps.lon).toFixed(2)}` : '',
          last_gps_at: v.last_gps?.recorded_at ? v.last_gps.recorded_at.replace('T', ' ').slice(0, 16) : '',
          status: v.status || '가용',
          driverId: v.driver_id || null,
          driver: v.driver_name || '',
        }));
      }

      // 운행 목록
      const tr = await apiFetch(`/trips`);
      if (tr.ok) {
        const trips = await tr.json();
        const statusMap = { in_progress: '운행중', completed: '완료', cancelled: '취소', scheduled: '배차' };
        DATA.statsTrips = trips.map(t => {
          const d = DATA.drivers.find(x => x.id === t.driver_id);
          const v = DATA.vehicles.find(x => x.id === t.vehicle_id);
          if (d && t.status === 'in_progress') d.status = '운행중';
          return {
            id: t.id,
            driver: d?.name || '',
            driverId: t.driver_id,
            vehicleId: t.vehicle_id,
            plate: v?.plate || '',
            date: (t.started_at || t.created_at || '').split('T')[0],
            status: statusMap[t.status] || t.status,
            safety: '적합',
            dwellPickup: '—',
            dwellDelivery: '—',
            remainingStops: 0,
            handoverHistory: [],
            flags: [],
          };
        });

        // 일정 데이터 구성 (trips 기반)
        DATA.scheduleEvents = [];
        DATA.ganttRows = [];
        DATA.milestones = [];
        const _today = new Date().toISOString().split('T')[0];
        const _GANTT_RANGE_MIN = (21 - 6) * 60; // 900분 (06:00–21:00)
        const _tripColor = { in_progress: '#3b82f6', completed: '#22c55e', cancelled: '#ef4444', scheduled: '#f59e0b' };
        const _tripLabel = { in_progress: '운행중', completed: '완료', cancelled: '취소', scheduled: '배차' };
        trips.forEach(t => {
          const d = DATA.drivers.find(x => x.id === t.driver_id);
          const v = DATA.vehicles.find(x => x.id === t.vehicle_id);
          const eventDate = (t.started_at || t.created_at || '').split('T')[0];
          if (eventDate) {
            DATA.scheduleEvents.push({
              date: eventDate, type: 'trip',
              label: `${d?.name || '기사'} · ${_tripLabel[t.status] || t.status}`,
              orderId: t.id.slice(0, 8),
            });
          }
          const tripDate = (t.started_at || t.created_at || '').split('T')[0];
          if (tripDate === _today || t.status === 'in_progress') {
            let startMin = 0;
            if (t.started_at) {
              const dt = new Date(t.started_at);
              startMin = dt.getHours() * 60 + dt.getMinutes() - 6 * 60;
            } else if (t.departure_time && t.departure_time.includes(':')) {
              const [hh, mm] = t.departure_time.split(':');
              startMin = parseInt(hh) * 60 + parseInt(mm || 0) - 6 * 60;
            }
            let endMin = startMin + 120;
            if (t.completed_at) {
              const dt = new Date(t.completed_at);
              endMin = dt.getHours() * 60 + dt.getMinutes() - 6 * 60;
            } else if (t.status === 'in_progress') {
              const now = new Date();
              endMin = now.getHours() * 60 + now.getMinutes() - 6 * 60;
            }
            startMin = Math.max(0, Math.min(startMin, _GANTT_RANGE_MIN - 30));
            endMin = Math.max(startMin + 30, Math.min(endMin, _GANTT_RANGE_MIN));
            DATA.ganttRows.push({
              label: d?.name || '—', sub: v?.plate || '—',
              orderId: t.id.slice(0, 8),
              startPct: (startMin / _GANTT_RANGE_MIN) * 100,
              widthPct: Math.max(3, ((endMin - startMin) / _GANTT_RANGE_MIN) * 100),
              color: _tripColor[t.status] || '#64748b',
              text: _tripLabel[t.status] || t.status,
            });
          }
          if (t.status !== 'cancelled') {
            DATA.milestones.push({
              date: (t.completed_at || t.started_at || t.created_at || '').split('T')[0],
              title: `${d?.name || '기사'} 운행`,
              note: t.dest_name || '—',
              orderId: t.id.slice(0, 8),
              status: { in_progress: '진행중', completed: '완료', scheduled: '예정' }[t.status] || '예정',
            });
          }
        });
        DATA.milestones.sort((a, b) => b.date.localeCompare(a.date));
        if (DATA.milestones.length > 30) DATA.milestones.length = 30;
      }

      // 통계 요약
      const sr = await apiFetch(`/stats/summary?period=all`);
      if (sr.ok) {
        const s = await sr.json();
        Object.assign(DATA.statsSummary, {
          completed: s.by_status?.completed || 0,
          inProgress: s.by_status?.in_progress || 0,
          cancelled: s.by_status?.cancelled || 0,
          incomplete: s.by_status?.scheduled || 0,
          assignedOk: s.assigned_deliveries || 0,
          assignedPending: s.unassigned_deliveries || 0,
          safetyIssues: s.safety_issues || 0,
        });
      }

      // 기사별 통계
      const dbdr = await apiFetch(`/stats/by-driver?period=all`);
      if (dbdr.ok) {
        const rows = await dbdr.json();
        DATA.driverStats = rows.map(r => ({
          name: r.name || r.username || '',
          driverId: r.driver_id,
          trips: r.total_trips || 0,
          hoursSum: r.total_duration_min != null ? `${Math.floor(r.total_duration_min/60)}h ${Math.round(r.total_duration_min%60)}m` : '—',
          hoursAvg: r.avg_duration_min != null ? `${Math.floor(r.avg_duration_min/60)}h ${Math.round(r.avg_duration_min%60)}m` : '—',
          distSum: r.total_distance_km != null ? `${Math.round(r.total_distance_km)} km` : '—',
          distAvg: r.avg_distance_km != null ? `${Math.round(r.avg_distance_km)} km` : '—',
          days: r.work_days || 0,
        }));
      }

      // 차량별 통계
      const dbv = await apiFetch(`/stats/by-vehicle?period=all`);
      if (dbv.ok) {
        const rows = await dbv.json();
        DATA.vehicleStats = rows.map(r => {
          const v = DATA.vehicles.find(x => x.plate === r.plate_number);
          const d = DATA.drivers.find(x => x.vehicleId === v?.id);
          return {
            plate: r.plate_number || '',
            driver: d?.name || '—',
            trips: r.total_trips || 0,
            hoursSum: r.total_duration_min != null ? `${Math.floor(r.total_duration_min/60)}h ${Math.round(r.total_duration_min%60)}m` : '—',
            distSum: r.total_distance_km != null ? `${Math.round(r.total_distance_km)} km` : '—',
          };
        });
      }

      // 조직명 + 로그인 사용자 이름
      const meRes = await apiFetch(`/auth/me`);
      if (meRes.ok) {
        const me = await meRes.json();
        DATA.me = me;
        _currentUserId = me.id;
        const userEl = document.getElementById('topbarUserName');
        if (userEl) userEl.textContent = me.name || me.username || '관리자';
        const roleEl = document.getElementById('topbarUserRole');
        if (roleEl) roleEl.textContent = me.role === 'admin' ? '관리자' : me.role;
      }
      const or2 = await apiFetch(`/organizations/me`);
      if (or2.ok) {
        const org = await or2.json();
        const bt = document.querySelector('.brand-text');
        if (bt && bt.childNodes[0]) bt.childNodes[0].nodeValue = org.name || 'RouteOn';
      }

      // 배송(오더) 목록
      const dvr = await apiFetch(`/deliveries`);
      if (dvr.ok) {
        const deliveries = await dvr.json();
        const deliveryStatusMap = { pending: '접수', in_progress: '운행중', done: '완료', done_manual: '완료', cancelled: '취소' };
        DATA.orders = deliveries.map(d => ({
          id: d.id,
          order_no: d.order_no || null,
          customer: d.shipper_name || '—',
          status: deliveryStatusMap[d.status] || d.status,
          pickup: d.pickup_address || '—',
          delivery: d.address,
          lat: d.lat,
          lon: d.lon,
          pickup_lat: d.pickup_lat,
          pickup_lon: d.pickup_lon,
          window: d.deadline ? d.deadline.slice(0, 16).replace('T', ' ') : '—',
          driver: DATA.drivers.find(dr => dr.id === d.assigned_to)?.name || null,
          recipient: d.recipient_name || '',
          cargo: d.cargo_type || '',
          tons: formatCargoSizeFromApi(d),
          contact: d.contact_phone || d.shipper_phone || d.contact_name || '',
          mixed_load: !!d.mixed_load,
          created_at: d.created_at || '',
        }));
        // 캘린더에 오더 이벤트 추가
        deliveries.forEach(d => {
          const eventDate = (d.deadline || d.created_at || '').split('T')[0];
          if (eventDate) {
            DATA.scheduleEvents.push({
              date: eventDate, type: 'order',
              label: d.address || '배송',
              orderId: displayOrderNo({ id: d.id, created_at: d.created_at }),
            });
          }
        });
      }

      // 승인 대기 기사 목록
      const pr = await apiFetch(`/users?role=pending`);
      if (pr.ok) {
        const pending = await pr.json();
        DATA.pendingDrivers = pending.map(u => ({
          id: u.id,
          name: u.name || u.username,
          phone: u.phone || '',
          created_at: u.created_at,
        }));
      }

      // 고객(거래처) 목록
      const cr = await apiFetch(`/customers`);
      if (cr.ok) {
        const customers = await cr.json();
        DATA.customers = customers.map(c => ({
          id:              c.id,
          name:            c.name,
          contact:         c.contact || '',
          phone:           c.phone || '',
          address:         c.address || '',
          lat:             c.lat ?? null,
          lon:             c.lon ?? null,
          memo:            c.memo || '',
          temporary:       !!c.temporary,
          valid_date:      c.valid_date || null,
          totalShipments:  0,
          lastOrderDate:   null,
          shipmentHistory: [],
        }));
      }

      // 담당자(관리자) 목록
      const admR = await apiFetch(`/users?role=admin`);
      if (admR.ok) {
        const admins = await admR.json();
        DATA.staff = admins.map(u => ({
          id: u.id,
          username: u.username,
          name: u.name || u.username,
          phone: u.phone || '',
          created_at: u.created_at,
        }));
      }

      // dispatchFleet 생성 (차량 + 기사 매핑)
      DATA.dispatchFleet = DATA.vehicles.map((v) => ({
        id: v.id,
        vehicleId: v.id,
        driverId: DATA.drivers.find(d => d.vehicleId === v.id)?.id || null,
        available: v.status === '가용',
      }));

      if (_pendingSelectDriverId) {
        const target = DATA.drivers.find(d => d.id === _pendingSelectDriverId);
        if (target) {
          selectedDriverId = target.id;
          currentMain = 'basic';
          currentPage = 'drivers';
          driverPage = Math.floor(DATA.drivers.findIndex(d => d.id === target.id) / PAGE_SIZE) + 1;
          _pendingSelectDriverId = null;
        }
      }

      // 페이지 재렌더링
      renderPage();
      restoreScrollState(scrollState);
      if (isMapPage()) showLiveMap();

    } catch (e) {
      console.error('데이터 로드 오류:', e);
    }
  }


  const MAIN_WITH_SUB = ['dispatch', 'schedule', 'basic', 'customers'];

  const NAV = [
    { id: 'dashboard', label: '대시보드', pages: [{ id: 'dashboard', label: '요약' }] },
    { id: 'control', label: '운행관제', pages: [{ id: 'control-live', label: '실시간 차량 관제' }] },
    { id: 'dispatch', label: '배차지정', pages: [
      { id: 'order-intake', label: '오더 접수' },
      { id: 'order-list', label: '오더 목록' },
      { id: 'bulk-dispatch', label: '일괄 자동 배차' },
      { id: 'dispatch-assign', label: '단건·수동 배차' },
    ]},
    { id: 'customers', label: '고객관리', pages: [
      { id: 'customer-list', label: '고객 관리' },
      { id: 'customer-loc', label: '고객 위치' },
    ]},
    { id: 'schedule', label: '일정·통계', pages: [
      { id: 'schedule-calendar', label: '캘린더' },
      { id: 'schedule-gantt', label: '간트' },
      { id: 'schedule-milestones', label: '마일스톤' },
      { id: 'trip-stats', label: '사후 통계' },
    ]},
    { id: 'basic', label: '기본정보', pages: [
      { id: 'drivers', label: '자기사' },
      { id: 'vehicles', label: '차량' },
      { id: 'staff', label: '담당자' },
      { id: 'profile', label: '내 정보' },
    ]},
  ];

  let currentPage = 'dashboard';
  let currentMain = 'dashboard';
  let selectedDriverId = null;
  let selectedVehicleId = null;
  let selectedCustomerId = null;
  let selectedTripId = null;
  let selectedOrderId = null;
  let selectedOrderIds = [];
  let orderDetailTab = 'info';
  let selectedStaffId = null;
  let customerDetailTab = 'info';
  let orderFilter = '전체';
  let customerListFilter = '전체';
  const PAGE_SIZE = 20;
  let orderPage = 1;
  let vehiclePage = 1;
  let customerPage = 1;
  let driverPage = 1;
  let statsPeriod = '주';
  let calendarYear  = new Date().getFullYear();
  let calendarMonth = new Date().getMonth() + 1;
  let dispatchPreviewTab = 0;
  let dispatchRan = false;
  let bulkDispatchRan = false;
  let bulkDispatchTab = 0;
  let bulkDepartureMode = 'distributed';
  let bulkAllowMixedLoad = true;
  let bulkSelectedOrderIds = [];
  let bulkSelectedDriverIds = [];
  let bulkOrderAssignments = {};
  let dispatchPendingMixedOnly = false;
  let dashOrderTab = '전체';
  let pendingIntakes = [];
  let pendingIntakeSeq = 0;
  let dispatchPendingSelectedId = null;
  let dispatchPendingSelectedIds = [];
  let dispatchManualVehicleId = null;
  let dispatchManualDriverId = null;
  let dispatchRegionSel = '전체';
  let dispatchSiteSel = '전체';
  let _bulkDispatchTrips = [];
  let _dispatchRunTrips = [];
  let _lastManualAssign = null;
  let _dispatchRouteMapInstance = null;
  let _dispatchRoutePolyline = null;
  let _kakaoReady = false;
  let _pendingSelectDriverId = null;

  function findNavPage(pageId) {
    for (const g of NAV) {
      const p = g.pages.find(x => x.id === pageId);
      if (p) return { main: g, page: p };
    }
    const mainOnly = NAV.find(g => g.id === pageId);
    if (mainOnly) return { main: mainOnly, page: mainOnly.pages[0] };
    return { main: NAV[0], page: NAV[0].pages[0] };
  }

  function pageChromeHtml(pageId, opts = {}) {
    const { main, page } = findNavPage(pageId);
    const title = opts.title || page.label;
    const desc = opts.desc != null ? opts.desc : '';
    return `<header class="page-chrome">
      <p class="page-breadcrumb">${main.label} &rsaquo; <strong>${page.label}</strong></p>
      <h1 class="page-heading">${title}</h1>
      ${desc ? `<p class="page-desc">${desc}</p>` : ''}
    </header>`;
  }

  function gotoPage(main, page) {
    if (isMapPage(currentPage) && !isMapPage(page)) hideLiveMap();
    currentMain = main;
    const group = NAV.find(g => g.id === main);
    currentPage = page || (group ? group.pages[0].id : NAV[0].pages[0].id);
    renderNav();
    renderPage();
    const targetPage = currentPage;
    if (isMapPage(targetPage)) setTimeout(() => showLiveMap(targetPage), 50);
  }

  function applyInitialQueryState() {
    const params = new URLSearchParams(location.search);
    let requestedMain = params.get('main');
    const requestedPage = params.get('page');
    if (requestedMain === 'stats') requestedMain = 'schedule';
    if (requestedMain === 'orders') requestedMain = 'dispatch';
    if (requestedMain) {
      const group = NAV.find(g => g.id === requestedMain);
      if (group) {
        const page = requestedPage && group.pages.some(p => p.id === requestedPage)
          ? requestedPage
          : group.pages[0].id;
        currentMain = group.id;
        currentPage = page;
      }
    }
    const driverId = params.get('select_driver');
    if (!driverId) return;
    _pendingSelectDriverId = driverId;
    currentMain = 'basic';
    currentPage = 'drivers';
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  function statusBadge(s) {
    const map = { '운행가능': 'badge-ok', '운행중': 'badge-run', '휴무': 'badge-muted', '접수': 'badge-muted', '배차': 'badge-info', '배차대기': 'badge-muted', '완료': 'badge-ok', '진행': 'badge-run', '취소': 'badge-muted', '가용': 'badge-ok', '정비': 'badge-muted', '운행중(차량)': 'badge-run' };
    return `<span class="badge ${map[s] || 'badge-muted'}">${s}</span>`;
  }

  function isMixedLoad(item) {
    return !!(item?.mixed_load ?? item?.isMixed);
  }

  function mixedLoadBadge(mixed) {
    if (mixed) return '<span class="badge badge-warn" title="동일 차량·운행에 복수 화주·화물">혼적</span>';
    return '<span class="badge badge-muted" title="단일 화주·화물">단독</span>';
  }

  function mixedLoadLabel(mixed) {
    return mixed ? '예' : '아니오';
  }

  function orderIsEditable(o) {
    return o.status === '접수';
  }

  function orderCanCancel(o) {
    return (o.status === '접수' || o.status === '배차') && o.status !== '취소';
  }

  function orderCanDelete(o) {
    return o.status === '접수' || o.status === '취소';
  }

  function orderMatchesFilter(o, filter) {
    if (filter === '전체') return true;
    if (filter === '배차대기') return o.status === '접수' && !o.driver;
    return o.status === filter;
  }

  function formatIntakeWindow(latestAt) {
    if (!latestAt) return '—';
    const d = new Date(latestAt);
    if (Number.isNaN(d.getTime())) return latestAt;
    return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatDateTimeShort(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).replace('T', ' ').slice(0, 16);
    return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const LOGISTICS_HOUR_START = 6;
  const LOGISTICS_HOUR_END = 22;

  function normalizeDesiredArrivalHour(h) {
    if (h == null || h === '') return '';
    const m = String(h).match(/^(\d{1,2})/);
    return m ? String(parseInt(m[1], 10)).padStart(2, '0') : '';
  }

  function hourOptionsHtml(selectedHour, opts = {}) {
    const start = opts.startHour ?? LOGISTICS_HOUR_START;
    const end = opts.endHour ?? LOGISTICS_HOUR_END;
    const sel = normalizeDesiredArrivalHour(selectedHour);
    let html = opts.allowEmpty !== false ? '<option value="">—</option>' : '';
    for (let h = start; h <= end; h++) {
      const val = String(h).padStart(2, '0');
      const picked = sel === val ? ' selected' : '';
      html += `<option value="${val}"${picked}>${val}:00</option>`;
    }
    return html;
  }

  function parseDesiredArrival(value) {
    if (!value || value === '—') return { date: '', hour: '' };
    const iso = String(value).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2})(?::(\d{2}))?/);
    if (iso) {
      let h = parseInt(iso[2], 10);
      const m = iso[3] != null ? parseInt(iso[3], 10) : 0;
      if (m >= 30) h = Math.min(h + 1, 23);
      return { date: iso[1], hour: String(h).padStart(2, '0') };
    }
    const times = [...String(value).matchAll(/\b(\d{1,2}):(\d{2})\b/g)];
    if (times.length) {
      let h = parseInt(times[0][1], 10);
      const m = parseInt(times[0][2], 10);
      if (m >= 30) h = Math.min(h + 1, 23);
      const today = new Date().toISOString().slice(0, 10);
      return { date: today, hour: String(h).padStart(2, '0') };
    }
    return { date: '', hour: '' };
  }

  function readDesiredArrival(form, dateName = 'latest_at_date', hourName = 'latest_at_hour') {
    const date = form.querySelector(`[name="${dateName}"]`)?.value?.trim() || '';
    const hour = form.querySelector(`[name="${hourName}"]`)?.value?.trim() || '';
    if (!date || !hour) return '';
    return `${date}T${hour}:00`;
  }

  function desiredArrivalFieldsHtml(opts = {}) {
    const {
      value = '',
      dateName = 'latest_at_date',
      hourName = 'latest_at_hour',
      tabindexDate,
      tabindexHour,
      intakeField = false,
      disabled = false,
      hint = false,
      allowEmpty = true,
      startHour,
      endHour,
    } = opts;
    const parsed = parseDesiredArrival(value);
    const ic = intakeField ? ' intake-field' : '';
    const dis = disabled ? ' disabled' : '';
    const tabD = tabindexDate != null ? ` tabindex="${tabindexDate}"` : '';
    const tabH = tabindexHour != null ? ` tabindex="${tabindexHour}"` : '';
    const df = intakeField ? ` data-intake-field="${dateName}"` : '';
    const hf = intakeField ? ` data-intake-field="${hourName}"` : '';
    const hourOpts = { allowEmpty, startHour, endHour };
    return `
      <div class="desired-arrival-row">
        <input type="date" class="${ic.trim() || 'input'}" name="${dateName}" value="${parsed.date}" aria-label="희망 도착 날짜"${tabD}${df}${dis}>
        <select class="${ic.trim() || 'input'}" name="${hourName}" aria-label="희망 도착 시각"${tabH}${hf}${dis}>
          ${hourOptionsHtml(parsed.hour, hourOpts)}
        </select>
      </div>
      ${hint ? '<span class="text-muted-hint desired-arrival-hint">1시간 단위</span>' : ''}`;
  }

  function nextOrderId() {
    const d = new Date();
    const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const prefix = `O-${stamp}-`;
    let max = 0;
    DATA.orders.forEach(o => {
      if (!o.id.startsWith(prefix)) return;
      const tail = parseInt(o.id.slice(prefix.length), 10);
      if (!Number.isNaN(tail)) max = Math.max(max, tail);
    });
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
  }

  async function commitPendingRowsToOrders(rows) {
    const batch = rows.map(r => ({
      address: r.delivery || '주소 미입력',
      lat: r.lat ?? null,
      lon: r.lon ?? null,
      deadline: r.latestAt ? r.latestAt.replace('T', ' ').slice(0, 16) : null,
      recipient_name: r.recipient || null,
      cargo_type: r.cargo || null,
      cargo_size: r.tons || null,
      pickup_address: r.pickup || null,
      pickup_lat: r.pickup_lat ?? null,
      pickup_lon: r.pickup_lon ?? null,
      shipper_name: r.customer || null,
      contact_name: r.contact || null,
      contact_phone: normalizePhone(r.contact) || null,
      shipper_phone: normalizePhone(r.contact) || null,
      mixed_load: !!r.mixed_load,
    }));
    const res = await apiFetch(`/deliveries/batch`, {
      method: 'POST',
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || '접수 저장 실패');
      return false;
    }
    const saved = await res.json();
    const statusMap = { pending: '접수', in_progress: '운행중', done: '완료', done_manual: '완료' };
    saved.forEach(d => {
      DATA.orders.unshift({
        id: d.id,
        order_no: d.order_no || null,
        customer: d.shipper_name || '—',
        status: statusMap[d.status] || '접수',
        pickup: d.pickup_address || '—',
        delivery: d.address,
        lat: d.lat,
        lon: d.lon,
        pickup_lat: d.pickup_lat,
        pickup_lon: d.pickup_lon,
        window: d.deadline ? d.deadline.slice(0, 16).replace('T', ' ') : '—',
        driver: null,
        recipient: d.recipient_name || '',
        cargo: d.cargo_type || '',
        tons: formatCargoSizeFromApi(d),
        contact: d.contact_phone || d.shipper_phone || d.contact_name || '',
        mixed_load: !!d.mixed_load,
        created_at: d.created_at || '',
      });
    });
    return true;
  }

  function vehicleById(id) {
    const nid = Number(id);
    return DATA.vehicles.find(v => v.id === nid) || null;
  }

  function vehicleLastGpsAt(v) {
    return v?.last_gps_at || '—';
  }

  function vehicleLastGpsLabel(v) {
    if (!v) return '—';
    if (v.last_gps_label) return v.last_gps_label;
    if (v.start_lat != null && v.start_lon != null) {
      return `${v.start_lat.toFixed(2)}, ${v.start_lon.toFixed(2)}`;
    }
    return '—';
  }

  function vehicleLastGpsTableCell(v) {
    const lbl = vehicleLastGpsLabel(v);
    const at = vehicleLastGpsAt(v);
    return at && at !== '—' ? `${lbl} (GPS ${at})` : lbl;
  }

  function vehicleGpsCoordText(v) {
    if (!v || v.start_lat == null) return '—';
    return `(${Number(v.start_lat).toFixed(2)}, ${Number(v.start_lon).toFixed(2)})`;
  }

  function vehicleLastGpsDetailHtml(v) {
    if (!v) return '<p class="empty-hint">차량 미선택</p>';
    const coord = v.start_lat != null && v.start_lon != null
      ? `${Number(v.start_lat).toFixed(6)}, ${Number(v.start_lon).toFixed(6)}`
      : 'GPS 미수신';
    return `
      <label>마지막 GPS <span class="badge badge-muted">읽기 전용</span></label>
      <p style="margin:0;font-size:13px">${coord} · 갱신 ${vehicleLastGpsAt(v)}</p>
      <p style="font-size:11px;color:var(--text-muted);margin:6px 0 0">관리자 입력 없음 · 앱 위치 로그 기준</p>`;
  }

  function driverById(id) {
    return DATA.drivers.find(d => d.id === id || d.id === Number(id)) || null;
  }

  function driverByName(name) {
    return DATA.drivers.find(d => d.name === name) || null;
  }

  function tripById(id) {
    return DATA.statsTrips.find(t => t.id === id) || null;
  }

  function tripForOrder(o) {
    if (!o) return null;
    if (o.tripId) return tripById(o.tripId);
    return DATA.statsTrips.find(t => t.orderId === o.id) || null;
  }

  function tripSupportsHandover(t) {
    return !!(t && (t.status === '운행중' || t.status === '배차'));
  }

  function tripExtraBadgesHtml(t) {
    if (!t) return '';
    const parts = [];
    if (t.flags?.includes('handover')) parts.push('<span class="badge badge-handover">인수인계</span>');
    if (t.relayPending) parts.push('<span class="badge badge-relay">대차 대기</span>');
    else if (t.flags?.includes('relay')) parts.push('<span class="badge badge-relay">대차</span>');
    return parts.length ? ` ${parts.join(' ')}` : '';
  }

  function pushHandoverHistory(trip, entry) {
    if (!trip.handoverHistory) trip.handoverHistory = [];
    trip.handoverHistory.push({ at: nowStr(), ...entry });
  }

  function openDriverChangeModal(trip) {
    const n = trip.remainingStops ?? 0;
    openModal('기사 교체', `
      <form id="handoverDriverForm">
        <div class="form-grid" style="max-width:100%">
          <label>Trip</label><span><code>${trip.id}</code> ${statusBadge(trip.status)}</span>
          <label>사유 *</label>
          <select name="reason" required>
            <option value="">— 선택 —</option>
            <option>휴무</option><option>연속운전</option><option>기타</option>
          </select>
          <label>새 기사 *</label>
          <select name="driverId" required>${driverSelectOptions(null, { allowEmpty: true })}</select>
        </div>
        ${n ? `<p style="font-size:12px;color:var(--text-muted);margin-top:12px">남은 <strong>${n}</strong>개 정류</p>` : ''}
      </form>`, async () => {
      const form = $('#handoverDriverForm');
      if (!form) return;
      const driverId = form.querySelector('[name="driverId"]').value;
      const reason = form.querySelector('[name="reason"]').value;
      if (!driverId || !reason) { toast('기사와 사유를 선택하세요'); return; }
      const d = driverById(driverId);
      const res = await apiFetch(`/trips/${trip.id}/reassign`, {
        method: 'PATCH',
        body: JSON.stringify({ new_driver_id: driverId, transfer_remaining: false }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '기사 교체 실패'); return; }
      const prev = trip.driver;
      trip.driver = d?.name || driverId;
      trip.driverId = driverId;
      if (!trip.flags) trip.flags = [];
      if (!trip.flags.includes('handover')) trip.flags.push('handover');
      pushHandoverHistory(trip, { type: 'driver', reason, from: prev, to: d?.name });
      toast('기사 교체 완료');
      await loadRealData();
    }, { saveLabel: '확인 반영' });
  }

  function openVehicleChangeModal(trip) {
    const curVid = trip.vehicleId;
    const avail = DATA.vehicles.filter(v => v.status === '가용' || v.id === curVid);
    const opts = avail.map(v => {
      const sel = v.id === curVid ? ' selected' : '';
      const dis = v.id === curVid ? ' disabled' : '';
      return `<option value="${v.id}"${sel}${dis}>${vehicleOptionLabel(v)}</option>`;
    }).join('');
    openModal('차량 교체(대차)', `
      <form id="handoverVehicleForm">
        <div class="form-grid" style="max-width:100%">
          <label>Trip</label><span><code>${trip.id}</code> · ${trip.plate || '—'}</span>
          <label>사유 *</label>
          <select name="reason" required>
            <option value="">— 선택 —</option>
            <option>고장</option><option>사고</option><option>톤급</option>
          </select>
          <label>새 차량 *</label>
          <select name="vehicleId" required>${opts || '<option value="">가용 차량 없음</option>'}</select>
        </div>
      </form>`, async () => {
      const form = $('#handoverVehicleForm');
      if (!form) return;
      const vehicleId = Number(form.querySelector('[name="vehicleId"]').value);
      const v = vehicleById(vehicleId);
      const reason = form.querySelector('[name="reason"]').value;
      if (!vehicleId || !reason) { toast('차량과 사유를 선택하세요'); return; }
      if (vehicleId === curVid) { toast('동일 차량입니다'); return; }
      const res = await apiFetch(`/trips/${trip.id}/reassign`, {
        method: 'PATCH',
        body: JSON.stringify({ new_vehicle_id: vehicleId, transfer_remaining: false }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '차량 교체 실패'); return; }
      const prev = trip.plate || vehicleById(curVid)?.plate || '—';
      trip.vehicleId = vehicleId;
      trip.plate = v?.plate || '—';
      if (!trip.flags) trip.flags = [];
      if (!trip.flags.includes('relay')) trip.flags.push('relay');
      if (!trip.flags.includes('handover')) trip.flags.push('handover');
      pushHandoverHistory(trip, { type: 'vehicle', reason, from: prev, to: v?.plate });
      toast('차량 교체 완료');
      await loadRealData();
    }, { saveLabel: '확인 반영' });
  }

  function openAccidentReportModal(trip) {
    openModal('사고·지연 신고', `
      <form id="handoverAccidentForm">
        <div class="form-grid" style="max-width:100%">
          <label>Trip</label><span><code>${trip.id}</code></span>
          <label>사유 *</label>
          <select name="reason" required>
            <option value="">— 선택 —</option>
            <option>교통사고</option><option>차량 고장</option><option>도로 통제</option><option>기타 지연</option>
          </select>
          <label>대차 필요</label>
          <span><label style="font-weight:400;display:inline-flex;align-items:center;gap:6px">
            <input type="checkbox" name="needsRelay"> 인근 대차·환적 요청
          </label></span>
        </div>
      </form>`, async () => {
      const form = $('#handoverAccidentForm');
      if (!form) return;
      const reason = form.querySelector('[name="reason"]').value;
      const needsRelay = form.querySelector('[name="needsRelay"]').checked;
      if (!reason) { toast('사유를 선택하세요', 'error'); return; }
      const res = await apiFetch(`/trips/${trip.id}/safety`, {
        method: 'PATCH',
        body: JSON.stringify({ safety_issue: true }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '신고 처리 실패', 'error'); return; }
      pushHandoverHistory(trip, { type: 'incident', reason, needsRelay });
      if (!trip.flags) trip.flags = [];
      trip.safety = '주의';
      if (!trip.flags.includes('incident')) trip.flags.push('incident');
      if (needsRelay) {
        trip.relayPending = true;
        if (!trip.flags.includes('relay')) trip.flags.push('relay');
      }
      toast(needsRelay ? '사고 신고 · 대차 대기 접수됨' : '사고·지연 신고 접수됨');
      await loadRealData();
    }, { saveLabel: '신고 접수' });
  }

  function bindHandoverActions(root, trip) {
    if (!trip || !tripSupportsHandover(trip)) return;
    $('#btnHandoverDriver', root)?.addEventListener('click', () => openDriverChangeModal(trip));
    $('#btnHandoverVehicle', root)?.addEventListener('click', () => openVehicleChangeModal(trip));
    $('#btnHandoverAccident', root)?.addEventListener('click', () => openAccidentReportModal(trip));
    $('#btnTripComplete', root)?.addEventListener('click', async () => {
      if (!confirm('운행을 완료 처리하시겠습니까?')) return;
      const res = await apiFetch(`/trips/${trip.id}/status?status=completed`, { method: 'PATCH' });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '처리 실패'); return; }
      toast('운행 완료 처리됨');
      await loadRealData();
      selectedTripId = null;
    });
    $('#btnTripCancel', root)?.addEventListener('click', async () => {
      if (!confirm('운행을 취소하시겠습니까?')) return;
      const res = await apiFetch(`/trips/${trip.id}/status?status=cancelled`, { method: 'PATCH' });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '처리 실패'); return; }
      toast('운행 취소됨');
      await loadRealData();
      selectedTripId = null;
    });
  }

  function orderHandoverBarHtml(o) {
    const trip = tripForOrder(o);
    if (!trip || !tripSupportsHandover(trip)) return '';
    return `
      <div class="handover-order-bar">
        <p style="font-size:11px;color:var(--text-muted);margin:0 0 8px">운행 중 교체 · Trip <code>${trip.id}</code> ${tripExtraBadgesHtml(trip)}</p>
        <div class="trip-handover-actions" style="margin:0">
          <button type="button" class="btn btn-sm" id="btnHandoverDriver">기사 교체</button>
          <button type="button" class="btn btn-sm" id="btnHandoverVehicle">차량 교체(대차)</button>
          <button type="button" class="btn btn-sm btn-danger-outline" id="btnHandoverAccident">사고·지연 신고</button>
        </div>
      </div>`;
  }

  function customerById(id) {
    return DATA.customers.find(c => c.id === Number(id)) || null;
  }

  function nowStr() {
    const d = new Date();
    return `${todayStr()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  function isTemporaryCustomer(c) {
    return !!c?.temporary;
  }

  function isTempCustomerActiveToday(c) {
    return isTemporaryCustomer(c) && (c.valid_date || todayStr()) === todayStr();
  }

  function customerTempBadgeHtml(c) {
    if (!isTemporaryCustomer(c)) return '';
    const label = isTempCustomerActiveToday(c) ? '임시·당일' : '임시';
    return `<span class="badge badge-temp">${label}</span>`;
  }

  function customerDisplayName(c) {
    if (!c) return '—';
    const badge = isTemporaryCustomer(c) ? ' (임시)' : '';
    return `${c.name}${badge}`;
  }

  function nextCustomerId() {
    let max = 0;
    DATA.customers.forEach(c => { if (c.id > max) max = c.id; });
    return max + 1;
  }

  function intakeCustomerSelectOptions(selectedId) {
    const sel = selectedId != null ? Number(selectedId) : null;
    const opts = DATA.customers.map(c => {
      const selected = sel === c.id ? ' selected' : '';
      const suffix = isTemporaryCustomer(c) ? ' · 임시' : '';
      return `<option value="${c.id}"${selected}>${c.name}${suffix}</option>`;
    }).join('');
    const placeholder = DATA.customers.length
      ? '<option value="" disabled>화주 선택</option>'
      : '<option value="" disabled selected>등록된 화주 없음</option>';
    return `${placeholder}${opts}<option value="__add_temp__">+ 임시 화주 추가</option>`;
  }

  function customerNameFromIntakeValue(value) {
    if (!value || value === '__add_temp__') return '';
    const c = customerById(value);
    return c ? c.name : String(value);
  }

  function openTempCustomerModal(onSaved) {
    openModal('임시 화주 추가', `
      <form id="tempCustForm">
        <p class="cust-temp-banner" style="margin-top:0">당일 의뢰용 · 고객 마스터 미등록 · 유효일 ${todayStr()}</p>
        <div class="form-grid" style="max-width:100%">
          <label>화주명 *</label><input name="name" required placeholder="업체명">
          <label>연락처</label><input name="phone" placeholder="010-0000-0000">
          <label>메모</label><input name="memo" value="당일 의뢰" placeholder="당일 의뢰">
        </div>
      </form>`, async () => {
      const form = $('#tempCustForm');
      if (!form) return;
      const name  = form.querySelector('[name="name"]').value.trim();
      const phone = normalizePhone(form.querySelector('[name="phone"]').value);
      const memo  = form.querySelector('[name="memo"]').value.trim() || '당일 의뢰';
      const today = todayStr();
      const res = await apiFetch(`/customers`, {
        method: 'POST',
        body: JSON.stringify({ name, phone: phone || null, memo, temporary: true, valid_date: today }),
      });
      let created;
      if (res.ok) {
        const saved = await res.json();
        created = { ...saved, contact: saved.contact || name, totalShipments: 0, lastOrderDate: today, shipmentHistory: [] };
        DATA.customers.push(created);
      } else {
        // API 실패 시 로컬 fallback
        created = { id: nextCustomerId(), name, contact: name, phone, address: '', temporary: true, valid_date: today, memo, totalShipments: 0, lastOrderDate: today, shipmentHistory: [] };
        DATA.customers.push(created);
      }
      toast(`임시 화주 «${name}» 등록 (당일)`);
      if (onSaved) onSaved(created);
    });
  }

  function bindIntakeCustomerSelect(container, selectEl) {
    if (!selectEl || selectEl.dataset.tempBound) return;
    selectEl.dataset.tempBound = '1';
    const isIntakePage = container._pendingIntakes != null;
    selectEl.addEventListener('change', () => {
      if (selectEl.value !== '__add_temp__') {
        const c = customerById(selectEl.value);
        const contactInp = container.querySelector('[name="contact"]');
        if (c && contactInp && !contactInp.value.trim()) {
          contactInp.value = c.phone || c.contact || '';
        }
        if (isIntakePage) container._intakeCustomerId = Number(selectEl.value) || null;
        return;
      }
      const prev = isIntakePage ? container._intakeCustomerId : selectEl.value;
      openTempCustomerModal((created) => {
        if (isIntakePage) container._intakeCustomerId = created.id;
        selectEl.innerHTML = intakeCustomerSelectOptions(created.id);
        selectEl.value = String(created.id);
        const contactInp = container.querySelector('[name="contact"]');
        if (contactInp) contactInp.value = created.phone || '';
        selectEl.focus();
      });
      if (prev != null && prev !== '__add_temp__') selectEl.value = String(prev);
      else if (selectEl.options.length > 1) selectEl.selectedIndex = 0;
      else selectEl.value = '';
    });
  }

  function openTempCustomerFromIntake(container, selectEl) {
    openTempCustomerModal((created) => {
      if (container?._pendingIntakes != null) container._intakeCustomerId = created.id;
      if (selectEl) {
        selectEl.innerHTML = intakeCustomerSelectOptions(created.id);
        selectEl.value = String(created.id);
        const contactInp = container.querySelector('[name="contact"]');
        if (contactInp) contactInp.value = created.phone || '';
        selectEl.focus();
      }
    });
  }

  function downloadBlob(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadIntakeExcelTemplate() {
    const headers = [
      '화주명',
      '상차지1', '상차화물1', '상차규격1',
      '상차지2', '상차화물2', '상차규격2',
      '상차지3', '상차화물3', '상차규격3',
      '하차지1', '하차수취인1', '하차화물1', '하차규격1',
      '하차지2', '하차수취인2', '하차화물2', '하차규격2',
      '하차지3', '하차수취인3', '하차화물3', '하차규격3',
      '연락처', '희망도착일시', '혼재여부',
    ];
    const rows = [
      [
        '예시화주',
        '부산광역시 해운대구 센텀중앙로 90', '식품', '5톤',
        '부산항 신항', '잡화', '3파레트',
        '', '', '',
        '부산광역시 사하구 감천로 203', '김수신', '식품', '2톤',
        '감천문화마을', '박수신', '잡화', '3파레트',
        '', '', '', '',
        '010-1234-5678', '2026-06-05 14:00', 'N',
      ],
    ];

    if (window.XLSX) {
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = headers.map(h => ({ wch: Math.max(14, h.length + 6) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '오더접수양식');
      XLSX.writeFile(wb, `routeon_order_intake_template_${todayStr()}.xlsx`);
      return;
    }

    const esc = v => `"${String(v).replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(esc).join(',')).join('\n');
    downloadBlob(`routeon_order_intake_template_${todayStr()}.csv`, 'text/csv;charset=utf-8', csv);
  }

  function excelDateTimeValue(value) {
    if (value instanceof Date) {
      return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}T${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')}`;
    }
    if (!value) return '';
    const s = String(value).trim();
    return s.length === 10 ? `${s}T00:00` : s.replace(' ', 'T').slice(0, 16);
  }

  function excelBoolValue(value) {
    const s = String(value || '').trim().toLowerCase();
    return ['y', 'yes', '1', 'true', '혼재', 'o'].includes(s);
  }

  function normalizedExcelRow(rawRow) {
    const norm = s => String(s).trim().toLowerCase().replace(/[\s_\-()]/g, '');
    const index = {};
    for (const [k, v] of Object.entries(rawRow)) index[norm(k)] = v;
    const pick = (...aliases) => {
      for (const a of aliases) {
        const key = norm(a);
        if (index[key] != null && String(index[key]).trim() !== '') return index[key];
      }
      return '';
    };
    return { pick };
  }

  function rowsFromExcelOrder(rawRow) {
    const { pick } = normalizedExcelRow(rawRow);
    const base = {
      customer: pick('화주명', '화주', 'shippername', 'shipper'),
      contact: pick('연락처', 'contact', 'contactname'),
      latestAt: excelDateTimeValue(pick('희망도착', '마감일', 'deadline', 'latestat', '희망도착일시')),
      mixed_load: excelBoolValue(pick('혼재', '혼재여부', 'mixedload', '혼재화물')),
    };
    const legacyPickup = pick('상차지', '출발지', 'pickup', 'pickupaddress');
    const legacyDelivery = pick('하차지', '도착지', '주소', 'delivery', 'address');
    const legacyCargo = pick('화물종류', '화물', 'cargo', 'cargotype');
    const legacySize = pick('규격', '화물규격', '중량', '톤', '중량톤', 'tons', 'cargosize', 'cargoweightton');
    const legacyRecipient = pick('수취인', '수령인', 'recipientname', 'recipient');
    const pickups = [];
    const deliveries = [];
    for (let i = 1; i <= 5; i++) {
      const address = pick(`상차지${i}`, `상차${i}`, `pickup${i}`, `pickupaddress${i}`);
      if (address) pickups.push({
        pickup: address,
        cargo: pick(`상차화물${i}`, `상차화물종류${i}`, `pickupcargo${i}`, `pickupcargotype${i}`),
        tons: pick(`상차규격${i}`, `상차중량${i}`, `pickupsize${i}`, `pickupcargosize${i}`),
      });
      const delivery = pick(`하차지${i}`, `하차${i}`, `delivery${i}`, `address${i}`, `deliveryaddress${i}`);
      if (delivery) deliveries.push({
        delivery,
        recipient: pick(`하차수취인${i}`, `수취인${i}`, `recipient${i}`, `recipientname${i}`),
        cargo: pick(`하차화물${i}`, `하차화물종류${i}`, `deliverycargo${i}`, `deliverycargotype${i}`),
        tons: pick(`하차규격${i}`, `하차중량${i}`, `deliverysize${i}`, `deliverycargosize${i}`),
      });
    }
    if (!pickups.length && legacyPickup) pickups.push({ pickup: legacyPickup, cargo: legacyCargo, tons: legacySize });
    if (!deliveries.length && legacyDelivery) deliveries.push({ delivery: legacyDelivery, recipient: legacyRecipient, cargo: legacyCargo, tons: legacySize });
    if (!pickups.length && !deliveries.length) return [];
    const count = Math.max(pickups.length, deliveries.length);
    return Array.from({ length: count }, (_, i) => {
      const pu = pickups[Math.min(i, Math.max(0, pickups.length - 1))] || {};
      const dl = deliveries[Math.min(i, Math.max(0, deliveries.length - 1))] || {};
      return {
        ...base,
        pickup: pu.pickup || '',
        delivery: dl.delivery || '',
        recipient: dl.recipient || '',
        cargo: dl.cargo || pu.cargo || legacyCargo || '',
        tons: dl.tons || pu.tons || legacySize || '',
      };
    });
  }

  async function geocodeIntakePlace(query) {
    const q = String(query || '').trim();
    if (!q) return null;
    const byAddress = await apiFetch(`/address/coord?query=${encodeURIComponent(q)}` )
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
    if (byAddress?.lat && byAddress?.lon) return { lat: Number(byAddress.lat), lon: Number(byAddress.lon) };
    if (!window.kakao?.maps?.services) return null;
    return await new Promise(resolve => {
      const ps = new kakao.maps.services.Places();
      ps.keywordSearch(q, (data, status) => {
        if (status !== kakao.maps.services.Status.OK || !data?.length) return resolve(null);
        resolve({ lat: Number(data[0].y), lon: Number(data[0].x) });
      }, { size: 1 });
    });
  }

  async function geocodeIntakeRow(row) {
    const [pickup, delivery] = await Promise.all([
      row.pickup ? geocodeIntakePlace(row.pickup) : Promise.resolve(null),
      row.delivery ? geocodeIntakePlace(row.delivery) : Promise.resolve(null),
    ]);
    if (pickup) { row.pickup_lat = pickup.lat; row.pickup_lon = pickup.lon; }
    if (delivery) { row.lat = delivery.lat; row.lon = delivery.lon; }
    return row;
  }

  function customerMatchesListFilter(c, filter) {
    if (filter === '정규') return !isTemporaryCustomer(c);
    if (filter === '임시(당일)') return isTempCustomerActiveToday(c);
    return true;
  }

  function customerHistoryTableHtml(history) {
    if (!history?.length) return '<p class="empty-hint">배송 이력 없음</p>';
    return `<div class="drawer-history-wrap">
      <table class="drawer-history-table">
        <thead><tr><th>날짜</th><th>오더번호</th><th>상·하차</th><th>규격</th><th>상태</th></tr></thead>
        <tbody>${history.map(h => `
          <tr>
            <td>${h.date}</td>
            <td><code style="font-size:11px">${h.orderId}</code></td>
            <td>${h.routeSummary}</td>
            <td>${h.tonnage}</td>
            <td>${statusBadge(h.status)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  function bindDetailTabs(container) {
    if (!container) return;
    container.querySelectorAll('.detail-tabs .tab').forEach(tab => {
      tab.onclick = () => {
        container.querySelectorAll('.detail-tabs .tab').forEach(t => t.classList.remove('active'));
        container.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        container.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
      };
    });
  }

  function inlineDetailCardHtml(title, bodyHtml, opts = {}) {
    const saveLabel = opts.saveLabel || '저장';
    return `
      <div class="card inline-detail" id="inlineDetail">
        <div class="card-hd inline-detail-hd">
          <div>
            <button type="button" class="btn btn-sm" id="inlineDetailBack">← 목록으로</button>
            <h2>${title}</h2>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="inlineDetailSave">${saveLabel}</button>
        </div>
        <div class="card-bd inline-detail-bd">${bodyHtml}</div>
      </div>`;
  }

  function customerDetailBodyHtml(c, startTab) {
    const hist = customerHistoryTableHtml(c.shipmentHistory);
    const tempBanner = isTemporaryCustomer(c)
      ? `<div class="cust-temp-banner">당일 의뢰용 · 고객 마스터 미등록${c.valid_date ? ` · 유효일 ${c.valid_date}` : ''}${c.memo ? ` · ${c.memo}` : ''}${!isTempCustomerActiveToday(c) ? ' · <span style="opacity:.85">(유효일 경과 — 목록에서 임시(당일) 필터 제외)</span>' : ''}</div>`
      : '';
    return `
      ${tempBanner}
      <div class="customer-detail-summary">
        <span>누적 배송 <strong>${c.totalShipments ?? c.shipmentHistory?.length ?? 0}</strong>건</span>
        <span>최근 배송 <strong>${c.lastOrderDate || '—'}</strong></span>
      </div>
      <div class="tabs detail-tabs">
        <button type="button" class="tab ${startTab === 'info' ? 'active' : ''}" data-tab="info">기본</button>
        <button type="button" class="tab ${startTab === 'history' ? 'active' : ''}" data-tab="history">배송 이력</button>
      </div>
      <div class="tab-panel ${startTab === 'info' ? 'active' : ''}" data-panel="info">
        <div class="form-grid" style="max-width:100%">
          <label>담당자</label><input id="custContact" value="${c.contact}">
          <label>연락처</label><input id="custPhone" value="${c.phone}">
          <label>주소</label><input id="custAddress" value="${c.address}">
        </div>
      </div>
      <div class="tab-panel ${startTab === 'history' ? 'active' : ''}" data-panel="history">${hist}</div>`;
  }

  function bindCustomerDetail(root, c) {
    const card = $('#inlineDetail', root);
    $('#inlineDetailBack', root).onclick = () => { selectedCustomerId = null; customerDetailTab = 'info'; renderPage(); };
    $('#inlineDetailSave', root).onclick = async () => {
      const contact = $('#custContact', root).value.trim();
      const phone   = normalizePhone($('#custPhone', root).value);
      const address = $('#custAddress', root).value.trim();
      const res = await apiFetch(`/customers/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ contact: contact || null, phone: phone || null, address: address || null }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '저장 실패'); return; }
      const saved = await res.json();
      const idx = DATA.customers.findIndex(x => x.id === c.id);
      if (idx >= 0) Object.assign(DATA.customers[idx], saved);
      Object.assign(c, saved);
      toast('고객 정보가 저장되었습니다');
      renderPage();
    };
    bindDetailTabs(card);
  }

  function selectCustomer(id, opts = {}) {
    selectedCustomerId = Number(id);
    customerDetailTab = opts.tab || 'info';
    renderPage();
  }

  function driverDetailBodyHtml(d) {
    const hist = d.history.length
      ? d.history.map(h => `<li>${h.at} — ${h.note}</li>`).join('')
      : '<li class="empty-hint">이력 없음</li>';
    return `
      <div class="tabs detail-tabs">
        <button type="button" class="tab active" data-tab="info">기본</button>
        <button type="button" class="tab" data-tab="hist">변경 이력</button>
      </div>
      <div class="tab-panel active" data-panel="info">
        <div class="form-grid" style="max-width:100%">
          <label>연락처</label><span>${d.phone}</span>
          <label>상태</label>
          <select id="driverStatus">
            <option ${d.status === '운행가능' ? 'selected' : ''}>운행가능</option>
            <option ${d.status === '운행중' ? 'selected' : ''}>운행중</option>
            <option ${d.status === '휴무' ? 'selected' : ''}>휴무</option>
          </select>
        </div>
        <div class="driver-vehicle-split">
          <div>
            <label style="font-size:12px;font-weight:600">배정 차량</label>
            <p style="font-size:11px;color:var(--text-muted);margin:4px 0 8px">기사 상태와 별도 — 배차 시 투입 차량 선택</p>
            <select id="driverVehicleAssign" style="width:100%;padding:6px 8px;font-size:12px">
              ${vehicleSelectOptions(d.vehicleId, { allowEmpty: true })}
            </select>
            <div class="vehicle-preview" id="driverVehiclePreview">${vehiclePreviewHtml(vehicleById(d.vehicleId))}</div>
          </div>
        </div>
      </div>
      <div class="tab-panel" data-panel="hist"><ul class="route-list">${hist}</ul></div>`;
  }

  function bindDriverDetail(root, d) {
    const card = $('#inlineDetail', root);
    $('#inlineDetailBack', root).onclick = () => { selectedDriverId = null; renderPage(); };
    $('#inlineDetailSave', root).onclick = async () => {
      const newStatus = $('#driverStatus', root).value;
      const vid = $('#driverVehicleAssign', root).value;
      const newVehicleId = vid ? Number(vid) : null;

      const res = await apiFetch(`/users/${d.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ driver_status: newStatus, vehicle_id: newVehicleId }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '기사 정보 저장 실패', 'error'); return; }

      d.status = newStatus;
      DATA.drivers.forEach(x => { if (x.vehicleId === d.vehicleId && x.id !== d.id) x.vehicleId = null; });
      d.vehicleId = newVehicleId;
      d.history.push({ at: new Date().toISOString().slice(0, 10), note: `배정 차량 → ${vid ? driverVehicleLabel(d) : '미배정'}` });
      toast('기사 정보가 저장되었습니다');
      renderPage();
    };
    bindDetailTabs(card);
    const vehSel = $('#driverVehicleAssign', root);
    if (vehSel) {
      vehSel.onchange = () => {
        const prev = $('#driverVehiclePreview', root);
        if (prev) prev.innerHTML = vehiclePreviewHtml(vehicleById(vehSel.value));
      };
    }
  }

  function selectDriver(id) {
    selectedDriverId = id;
    renderPage();
  }

  function vehicleDetailBodyHtml(v) {
    const linked = DATA.drivers.find(d => d.vehicleId === v.id);
    const tonOpts = ['1톤', '1.4톤', '2.5톤', '3.5톤', '5톤'];
    const typeOpts = ['윙바디', '탑차', '카고'];
    return `
      <div class="form-grid" style="max-width:100%">
        <label>톤급</label>
        <select id="vehTonnage">${tonOpts.map(t => `<option ${v.tonnage === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <label>차종</label>
        <select id="vehType">${typeOpts.map(t => `<option ${v.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        ${vehicleLastGpsDetailHtml(v)}
        <label>상태</label>
        <select id="vehStatus">
          <option ${v.status === '가용' ? 'selected' : ''}>가용</option>
          <option ${v.status === '운행중' ? 'selected' : ''}>운행중</option>
          <option ${v.status === '정비' ? 'selected' : ''}>정비</option>
        </select>
        <label>연결 기사</label>
        <select id="vehDriver">
          <option value="">— 미연결 —</option>
          ${DATA.drivers.map(d => `<option value="${d.id}" ${linked && linked.id === d.id ? 'selected' : ''}>${d.name}</option>`).join('')}
        </select>
      </div>
      <div class="vehicle-preview" id="vehCoordPreview" style="margin-top:16px">
        <p style="font-size:11px;color:var(--text-muted);margin:0 0 6px">배차 출발점 · 최근 GPS</p>
        ${vehiclePreviewHtml(v)}
      </div>`;
  }

  function bindVehicleDetail(root, v) {
    $('#inlineDetailBack', root).onclick = () => { selectedVehicleId = null; renderPage(); };
    $('#inlineDetailSave', root).onclick = async () => {
      const tonnageStr = $('#vehTonnage', root).value;
      const type = $('#vehType', root).value;
      const status = $('#vehStatus', root).value;
      const driverId = $('#vehDriver', root).value;

      const tonMap = { '1톤': 1000, '1.4톤': 1400, '2.5톤': 2500, '3.5톤': 3500, '5톤': 5000 };
      const weight_kg = tonMap[tonnageStr] ?? v.weight_kg;

      const res = await apiFetch(`/vehicles/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ vehicle_type: type, weight_kg, status, driver_id: driverId || null }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '차량 정보 저장 실패', 'error'); return; }

      v.tonnage = tonnageStr;
      v.type = type;
      v.status = status;
      v.weight_kg = weight_kg;
      DATA.drivers.forEach(d => { if (d.vehicleId === v.id) d.vehicleId = null; });
      if (driverId) { const d = driverById(driverId); if (d) d.vehicleId = v.id; }

      toast('차량 정보가 저장되었습니다');
      renderPage();
    };
  }

  function selectVehicle(id) {
    selectedVehicleId = Number(id);
    renderPage();
  }

  function tripDetailBodyHtml(t) {
    const safetyHtml = t.safety === '주의'
      ? '<span class="badge badge-warn">주의</span>'
      : t.safety === '적합'
        ? '<span class="badge badge-ok">적합</span>'
        : '<span class="badge badge-muted">—</span>';
    const plate = t.plate || (t.vehicleId ? vehicleById(t.vehicleId)?.plate : '—');
    const handoverBtns = tripSupportsHandover(t) ? `
      <div class="trip-handover-actions">
        <button type="button" class="btn btn-sm btn-primary" id="btnHandoverDriver">기사 교체</button>
        <button type="button" class="btn btn-sm" id="btnHandoverVehicle">차량 교체(대차)</button>
        <button type="button" class="btn btn-sm btn-danger-outline" id="btnHandoverAccident">사고·지연 신고</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="btn btn-sm btn-primary" id="btnTripComplete">운행 완료</button>
        <button type="button" class="btn btn-sm btn-danger-outline" id="btnTripCancel">운행 취소</button>
      </div>` : '';
    const hist = t.handoverHistory?.length
      ? `<ul style="font-size:12px;margin:8px 0 0;padding-left:18px;color:var(--text-muted)">
          ${t.handoverHistory.map(h => `<li>${h.at} · ${h.type}${h.reason ? ` · ${h.reason}` : ''}${h.from ? ` · ${h.from}→${h.to || ''}` : ''}${h.needsRelay ? ' · 대차요청' : ''}</li>`).join('')}
        </ul>`
      : '<p style="font-size:12px;color:var(--text-muted);margin:8px 0 0">인수인계 이력 없음</p>';
    return `
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
        ${t.date} · ${statusBadge(t.status)}${tripExtraBadgesHtml(t)}
        ${t.orderId ? ` · 오더 <code>${t.orderId}</code>` : ''}
      </p>
      <p style="font-size:13px;margin-bottom:12px">기사 <strong>${t.driver}</strong> · 차량 <strong>${plate}</strong>
        ${tripSupportsHandover(t) ? ` · 남은 정류 <strong>${t.remainingStops ?? '—'}</strong>개` : ''}</p>
      ${handoverBtns}
      <h4>안전 점검</h4>
      <p style="margin-bottom:16px">${safetyHtml}</p>
      <h4 style="color:var(--text-muted)">머문 시간 (경영용 · 선택)</h4>
      <p style="font-size:13px">상차 체류: <strong>${t.dwellPickup}</strong><br>하차 체류: <strong>${t.dwellDelivery}</strong></p>
      <h4 style="color:var(--text-muted);margin-top:16px">인수인계 이력</h4>
      ${hist}
      <p style="font-size:11px;color:var(--text-muted);margin-top:12px">계획 vs 실제·재경로·휴게소 상세는 관제 화면에 표시하지 않습니다.</p>
      <h4 style="margin-top:16px">경로 지도</h4>
      <div id="tripRouteMapCanvas" style="width:100%;height:260px;background:var(--bg-card);border-radius:8px;overflow:hidden;margin-top:8px"></div>`;
  }

  function selectTrip(id) {
    selectedTripId = id;
    renderPage();
  }

  function orderById(id) {
    return DATA.orders.find(o => o.id === id) || null;
  }

  function orderStopsTableHtml(o) {
    const stops = o.stops?.length ? o.stops : [
      { cargo_id: `${o.id}-C1`, cargo_role: 'pickup', place: o.pickup, address: '—', tw: o.window?.split('–')[0] || '—' },
      { cargo_id: `${o.id}-C1`, cargo_role: 'delivery', place: o.delivery, address: '—', tw: o.window?.split('–')[1] || '—' },
    ];
    const roleLabel = { pickup: '상차', delivery: '하차' };
    return `<div class="data-table order-stops-table">
      <table>
        <thead><tr><th>구분</th><th>cargo_id</th><th>지점</th><th>주소</th><th>시간</th></tr></thead>
        <tbody>${stops.map(s => `
          <tr>
            <td><span class="badge ${s.cargo_role === 'pickup' ? 'badge-info' : 'badge-ok'}">${roleLabel[s.cargo_role] || s.cargo_role}</span></td>
            <td><code style="font-size:11px">${s.cargo_id}</code></td>
            <td>${s.place}</td>
            <td>${s.address || '—'}</td>
            <td>${s.tw || '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  function formatOrderEventNote(event) {
    if (!event) return '—';
    const details = event.details || {};
    if (details.changes) {
      const labels = Object.values(details.changes).map(c => c.label).filter(Boolean);
      return labels.length ? `${event.summary}: ${labels.join(', ')}` : event.summary;
    }
    if (details.reason) return `${event.summary} · ${details.reason}`;
    return event.summary || event.event_type || '처리 기록';
  }

  function orderEventActorLabel(role) {
    return ({ admin: '관리자', driver: '기사', superadmin: '슈퍼관리자' })[role] || '';
  }

  async function loadOrderEvents(orderId) {
    const o = orderById(orderId);
    if (!o || o._eventsLoading || o._eventsLoaded) return;
    o._eventsLoading = true;
    try {
      const res = await apiFetch(`/deliveries/${orderId}/events`);
      if (res.ok) {
        const events = await res.json();
        o.changeHistory = events.map(ev => ({
          at: formatDateTimeShort(ev.created_at),
          user: ev.actor_name || orderEventActorLabel(ev.actor_role) || '시스템',
          note: formatOrderEventNote(ev),
        }));
        o._eventsLoaded = true;
      }
    } catch (err) {
      console.warn('오더 처리 기록 로드 실패', err);
    } finally {
      o._eventsLoading = false;
    }
    if (selectedOrderId === orderId) renderPage();
  }

  function orderHistoryTableHtml(o) {
    if (o._eventsLoading) {
      return '<p class="empty-hint">처리 기록을 불러오는 중입니다.</p>';
    }
    const hist = o.changeHistory?.length ? o.changeHistory : [
      { at: '—', user: '—', note: '처리 기록 없음' },
    ];
    return `<div class="data-table order-history-table">
      <table>
        <thead><tr><th>일시</th><th>담당</th><th>내용</th></tr></thead>
        <tbody>${hist.map(h => `
          <tr><td>${h.at}</td><td>${h.user}</td><td>${h.note}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  function orderDetailBodyHtml(o, startTab) {
    const tab = startTab || 'info';
    return `
      <div class="customer-detail-summary">
        <span>상태 ${statusBadge(o.status)}${(() => { const tr = tripForOrder(o); return tr ? tripExtraBadgesHtml(tr) : ''; })()}</span>
        <span>혼적 ${mixedLoadBadge(isMixedLoad(o))}</span>
        <span>기사 <strong>${o.driver || '미배정'}</strong></span>
        <span>화주 <strong>${o.customer}</strong></span>
      </div>
      ${orderHandoverBarHtml(o)}
      <div class="tabs detail-tabs">
        <button type="button" class="tab ${tab === 'info' ? 'active' : ''}" data-tab="info">기본</button>
        <button type="button" class="tab ${tab === 'stops' ? 'active' : ''}" data-tab="stops">상·하차</button>
        <button type="button" class="tab ${tab === 'hist' ? 'active' : ''}" data-tab="hist">처리 기록</button>
      </div>
      <div class="tab-panel ${tab === 'info' ? 'active' : ''}" data-panel="info">
        <div class="form-grid" style="max-width:100%">
          <label>오더번호</label><span>${orderNoHtml(o)} <code class="order-raw-code">${o.id}</code></span>
          <label>화주</label><span>${o.customer}</span>
          <label>수신자</label><span>${o.recipient || '—'}</span>
          <label>화물</label><span>${o.cargo || '—'}${o.tons ? ` · ${o.tons}` : ''}</span>
          <label>시간창</label><span>${o.window}</span>
          <label>접수시간</label><span>${formatDateTimeShort(o.created_at)}</span>
          <label>연락처</label><span>${o.contact || '—'}</span>
          <label>상차</label><span>${o.pickup}</span>
          <label>하차</label><span>${o.delivery}</span>
          ${o.cancelReason ? `<label>취소 사유</label><span>${o.cancelReason}</span>` : ''}
        </div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:12px">수정은 목록의 「수정」 버튼 · 접수 건만 필드 편집</p>
      </div>
      <div class="tab-panel ${tab === 'stops' ? 'active' : ''}" data-panel="stops">${orderStopsTableHtml(o)}</div>
      <div class="tab-panel ${tab === 'hist' ? 'active' : ''}" data-panel="hist">${orderHistoryTableHtml(o)}</div>`;
  }

  function bindOrderDetail(root, o) {
    const card = $('#inlineDetail', root);
    $('#inlineDetailBack', root).onclick = () => { selectedOrderId = null; orderDetailTab = 'info'; renderPage(); };
    $('#inlineDetailSave', root).onclick = () => {
      openOrderEditModal(o, root);
    };
    bindDetailTabs(card);
    const trip = tripForOrder(o);
    if (trip) bindHandoverActions(root, trip);
  }

  function selectOrder(id, opts = {}) {
    selectedOrderId = id;
    orderDetailTab = opts.tab || 'info';
    renderPage();
    loadOrderEvents(id);
  }

  function staffById(id) {
    return DATA.staff.find(s => s.id === id) || null;
  }

  function staffDetailBodyHtml(s) {
    const joinDate = s.created_at ? s.created_at.split('T')[0] : '—';
    const isSelf = s.id === _currentUserId;
    return `
      <div class="form-grid" style="max-width:100%">
        <label>이름</label><input readonly value="${s.name}" style="background:var(--input-bg,var(--dark-input,#23272e));opacity:.8">
        <label>아이디</label><input readonly value="${s.username}" style="background:var(--input-bg,var(--dark-input,#23272e));opacity:.8">
        <label>연락처</label><input readonly value="${s.phone || '—'}" style="background:var(--input-bg,var(--dark-input,#23272e));opacity:.8">
        <label>가입일</label><input readonly value="${joinDate}" style="background:var(--input-bg,var(--dark-input,#23272e));opacity:.8">
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin-top:12px">연락처·비밀번호는 ⚙ 설정 페이지에서 본인이 직접 변경합니다.</p>
      ${isSelf ? '' : `<div style="margin-top:16px"><button type="button" class="btn btn-sm" id="deleteStaffBtn" style="background:var(--danger,#ef4444);color:#fff;border:none">삭제</button></div>`}`;
  }

  function bindStaffDetail(root, s) {
    $('#inlineDetailBack', root).onclick = () => { selectedStaffId = null; renderPage(); };
    $('#inlineDetailSave', root).onclick = () => { selectedStaffId = null; renderPage(); };
    const delBtn = $('#deleteStaffBtn', root);
    if (delBtn) delBtn.onclick = async () => {
      if (!confirm(`"${s.name}" 계정을 삭제하시겠습니까?`)) return;
      const res = await apiFetch(`/users/${s.id}`, { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        toast('담당자가 삭제되었습니다.');
        selectedStaffId = null;
        await loadRealData();
      } else {
        const err = await res.json().catch(() => ({}));
        toast(err.detail || '삭제 실패', 'error');
      }
    };
  }

  function selectStaff(id) {
    selectedStaffId = id;
    renderPage();
  }

  function milestoneStatusBadge(status) {
    const map = {
      '완료': 'badge-ok',
      '진행중': 'badge-run',
      '예정': 'badge-muted',
    };
    return `<span class="badge ${map[status] || 'badge-muted'}">${status}</span>`;
  }

  function eventsForCalDate(ymd) {
    return DATA.scheduleEvents.filter(e => e.date === ymd);
  }

  function renderCalendarGridHtml(year, month) {
    const firstDow = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const dows = ['일', '월', '화', '수', '목', '금', '토'];
    let cells = dows.map(d => `<div class="cal-dow">${d}</div>`).join('');
    for (let i = 0; i < firstDow; i++) cells += '<div class="cal-cell empty"></div>';
    const nowD = new Date();
    const todayNum = (nowD.getFullYear() === year && nowD.getMonth() + 1 === month) ? nowD.getDate() : -1;
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const evts = eventsForCalDate(ymd);
      const hasOrder = evts.some(e => e.type === 'order');
      const hasTrip = evts.some(e => e.type === 'trip');
      const cls = ['cal-cell', d === todayNum ? 'today' : '', hasOrder && hasTrip ? 'has-both' : hasOrder ? 'has-order' : hasTrip ? 'has-trip' : ''].filter(Boolean).join(' ');
      const dots = evts.map(e => `<span class="cal-dot ${e.type}" title="${e.orderId}"></span>`).join('');
      const hint = evts[0] ? `<div class="cal-event-hint">${evts[0].label} · ${evts[0].orderId}</div>` : '';
      cells += `<div class="${cls}"><div class="cal-day-num">${d}</div><div class="cal-dots">${dots}</div>${hint}</div>`;
    }
    return cells;
  }

  function renderScheduleCalendar(root) {
    const year = calendarYear, month = calendarMonth;
    const monthLabel = `${year}년 ${month}월`;
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const monthEvents = DATA.scheduleEvents
      .filter(e => e.date.startsWith(monthPrefix))
      .sort((a, b) => a.date.localeCompare(b.date));
    const todayY = new Date().getFullYear(), todayM = new Date().getMonth() + 1;
    const isCurrentMonth = year === todayY && month === todayM;
    root.innerHTML = `
      <div class="page-sticky-top">
      ${pageChromeHtml('schedule-calendar', { title: '일정 캘린더', desc: `${monthLabel} · 오더·운행 일정` })}
      </div>
      <div class="page-scroll-main">
      <div class="cal-wrap">
        <div class="cal-hd" style="display:flex;align-items:center;gap:8px">
          <button type="button" class="btn btn-sm" id="calPrev">&#8249;</button>
          <h3 style="margin:0">${monthLabel}</h3>
          <button type="button" class="btn btn-sm" id="calNext">&#8250;</button>
          ${isCurrentMonth ? '' : `<button type="button" class="btn btn-sm" id="calToday" style="margin-left:4px">오늘</button>`}
          <span class="badge badge-info" style="margin-left:4px">${monthEvents.length}건</span>
        </div>
        <div class="cal-legend">
          <span><i class="dot-order"></i>오더·배차</span>
          <span><i class="dot-trip"></i>운행·Trip</span>
        </div>
        <div class="cal-grid">${renderCalendarGridHtml(year, month)}</div>
      </div>
      <div class="card" style="margin-top:10px">
        <div class="card-hd"><h2>${monthLabel} 일정</h2></div>
        <div class="card-bd" style="padding:0">
          ${monthEvents.length === 0
            ? '<p style="padding:20px;color:var(--text-muted);text-align:center">이번 달 일정이 없습니다</p>'
            : tableScrollWrap(`<table>
            <thead><tr><th>날짜</th><th>ID</th><th>유형</th><th>내용</th></tr></thead>
            <tbody>${monthEvents.map(e => `
              <tr>
                <td>${e.date}</td>
                <td><code style="font-size:11px">${e.orderId}</code></td>
                <td>${e.type === 'trip' ? '<span class="badge badge-run">운행</span>' : '<span class="badge badge-info">오더</span>'}</td>
                <td>${e.label}</td>
              </tr>`).join('')}
            </tbody>
          </table>`)}
        </div>
      </div>
      </div>`;

    $('#calPrev', root).onclick = () => {
      if (calendarMonth === 1) { calendarYear--; calendarMonth = 12; }
      else { calendarMonth--; }
      renderScheduleCalendar(root);
    };
    $('#calNext', root).onclick = () => {
      if (calendarMonth === 12) { calendarYear++; calendarMonth = 1; }
      else { calendarMonth++; }
      renderScheduleCalendar(root);
    };
    const todayBtn = $('#calToday', root);
    if (todayBtn) todayBtn.onclick = () => {
      calendarYear = new Date().getFullYear();
      calendarMonth = new Date().getMonth() + 1;
      renderScheduleCalendar(root);
    };
  }

  function renderScheduleGantt(root) {
    const hours = ['06', '09', '12', '15', '18', '21'];
    const todayLabel = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
    const ganttBody = DATA.ganttRows.length === 0
      ? '<p style="padding:24px;color:var(--text-muted);text-align:center">오늘 등록된 운행이 없습니다</p>'
      : `<div class="gantt-scroll"><div class="gantt-wrap">
          <div class="gantt-scale">${hours.map(h => `<span>${h}:00</span>`).join('')}</div>
          ${DATA.ganttRows.map(row => `
            <div class="gantt-row">
              <div class="gantt-label">${row.label}<code>${row.sub} · ${row.orderId}</code></div>
              <div class="gantt-track">
                <div class="gantt-bar" style="left:${row.startPct}%;width:${row.widthPct}%;background:${row.color}" title="${row.orderId}">${row.text}</div>
              </div>
            </div>`).join('')}
        </div></div>`;
    root.innerHTML = `
      <div class="page-sticky-top">
      ${pageChromeHtml('schedule-gantt', { title: '간트 · 차량·기사', desc: `${todayLabel} 06–21시 타임라인` })}
      </div>
      ${ganttBody}`;
  }

  function renderScheduleMilestones(root) {
    const milestoneItems = DATA.milestones.length === 0
      ? '<p style="padding:24px;color:var(--text-muted);text-align:center">운행 기록이 없습니다</p>'
      : DATA.milestones.map(m => `
          <article class="milestone-item">
            <div class="milestone-date">${m.date}</div>
            <div>
              <div class="milestone-title">${m.title}</div>
              <div class="milestone-meta">${m.note}${m.orderId ? ` · <code>${m.orderId}</code>` : ''}</div>
            </div>
            ${milestoneStatusBadge(m.status)}
          </article>`).join('');
    root.innerHTML = `
      <div class="page-sticky-top">
      ${pageChromeHtml('schedule-milestones', { title: '마일스톤', desc: `운행 이력 최근 ${DATA.milestones.length}건` })}
      </div>
      <div class="page-scroll-main milestone-list">
        ${milestoneItems}
      </div>`;
  }

  function driverVehicleLabel(d) {
    const v = d.vehicleId ? vehicleById(d.vehicleId) : null;
    return v ? `${v.plate} · ${v.tonnage}` : '—';
  }

  function vehicleDriverLabel(v) {
    const d = DATA.drivers.find(x => x.vehicleId === v.id);
    return d ? d.name : '—';
  }

  function vehicleOptionLabel(v) {
    return `${v.plate} · ${v.tonnage} · ${v.type}`;
  }

  function vehiclePreviewHtml(v) {
    if (!v) return '<span class="empty-hint">차량 미선택</span>';
    return `<strong>${v.plate}</strong> · ${v.tonnage} · ${v.type} · max ${v.weight_kg} kg
      <div class="fleet-meta" style="margin-top:4px">
        <span>출발: 최근 GPS ${vehicleGpsCoordText(v)}</span>
        <span class="coord">${vehicleLastGpsLabel(v)} · 갱신 ${vehicleLastGpsAt(v)}</span>
      </div>`;
  }

  function vehicleSelectOptions(selectedId, { allowEmpty = false, disabledIds = [] } = {}) {
    const opts = allowEmpty ? '<option value="">— 차량 선택 —</option>' : '';
    const dis = new Set((disabledIds || []).map(Number));
    return opts + DATA.vehicles.map(v => {
      const sel = Number(selectedId) === v.id ? ' selected' : '';
      const disAttr = dis.has(v.id) ? ' disabled' : '';
      return `<option value="${v.id}"${sel}${disAttr}>${vehicleOptionLabel(v)}</option>`;
    }).join('');
  }

  function driverSelectOptions(selectedId, { allowEmpty = false } = {}) {
    const opts = allowEmpty ? '<option value="">— 기사 선택 —</option>' : '';
    return opts + DATA.drivers.map(d => {
      const sel = Number(selectedId) === d.id ? ' selected' : '';
      return `<option value="${d.id}"${sel}>${d.name} · ${driverVehicleLabel(d)}</option>`;
    }).join('');
  }

  function applyVehicleMetaToRow(row, vehicleId) {
    const v = vehicleById(vehicleId);
    if (!v || !row) return;
    row.vehicleId = v.id;
    if ('plate' in row) row.plate = v.plate;
    if ('tonnage' in row) row.tonnage = v.tonnage;
    if ('type' in row) row.type = v.type;
    if ('weight_kg' in row) row.weight_kg = v.weight_kg;
  }

  function applyVehicleToFleetRow(fleetRow, vehicleId) {
    applyVehicleMetaToRow(fleetRow, vehicleId);
    const v = vehicleById(vehicleId);
    if (!v || !fleetRow || !('start_lat' in fleetRow)) return;
    fleetRow.start_lat = v.start_lat;
    fleetRow.start_lon = v.start_lon;
    fleetRow.start_city = vehicleLastGpsLabel(v);
    if ('start_place' in fleetRow) fleetRow.start_place = '최근 GPS';
  }

  function syncDispatchPlanFromFleet(fleetRow, plan) {
    if (!fleetRow || !plan) return;
    const v = vehicleById(fleetRow.vehicleId);
    const d = driverById(fleetRow.driverId);
    if (v) {
      plan.vehicleId = v.id;
      plan.plate = v.plate;
      plan.tonnage = v.tonnage;
    }
    if (d) plan.driver = d.name;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function normalizePhone(value) {
    const raw = String(value || '').trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('82') && digits.length >= 11) {
      const local = `0${digits.slice(2)}`;
      if (local.length === 10) return `${local.slice(0,3)}-${local.slice(3,6)}-${local.slice(6)}`;
      if (local.length === 11) return `${local.slice(0,3)}-${local.slice(3,7)}-${local.slice(7)}`;
    }
    if (digits.startsWith('02')) {
      if (digits.length === 9) return `${digits.slice(0,2)}-${digits.slice(2,5)}-${digits.slice(5)}`;
      if (digits.length === 10) return `${digits.slice(0,2)}-${digits.slice(2,6)}-${digits.slice(6)}`;
    }
    if (digits.length === 10) return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
    if (digits.length === 11) return `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
    return raw;
  }

  function toast(msg, type) {
    const t = $('#toast');
    t.textContent = msg || '저장되었습니다';
    t.className = `toast show${type === 'error' ? ' toast-error' : ''}`;
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  function openModal(title, bodyHtml, onSave, opts = {}) {
    const saveLabel = opts.saveLabel || '저장';
    const box = $('#modalBox');
    box.className = 'modal';
    box.innerHTML = `
      <div class="modal-hd"><h3>${title}</h3><button type="button" class="modal-close" data-close>&times;</button></div>
      <div class="modal-bd">${bodyHtml}</div>
      <div class="modal-ft">
        <button type="button" class="btn" data-close>취소</button>
        <button type="button" class="btn btn-primary" id="modalSave">${saveLabel}</button>
      </div>`;
    $('#modalOverlay').classList.add('open');
    box.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
    $('#modalSave').onclick = () => {
      const form = box.querySelector('form');
      if (form && !validateForm(form)) return;
      closeModal();
      if (onSave) onSave();
      else toast();
    };
  }

  function openModalLarge(title, bodyHtml, onSave) {
    openModal(title, bodyHtml, onSave);
    $('#modalBox').classList.add('modal-lg');
  }

  function closeModal() {
    $('#modalOverlay').classList.remove('open');
  }

  function validateForm(form) {
    let ok = true;
    form.querySelectorAll('[required]').forEach(inp => {
      const invalid = !inp.value.trim();
      inp.classList.toggle('invalid', invalid);
      if (invalid) ok = false;
    });
    return ok;
  }

  function paginationHtml(totalItems, currentPage, listKey) {
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    if (totalPages <= 1) return '';
    let btns = `<button type="button"${currentPage <= 1 ? ' disabled' : ''} data-page="${Math.max(1, currentPage - 1)}" data-list="${listKey}">‹</button>`;
    for (let i = 1; i <= totalPages; i++) {
      btns += `<button type="button" class="${i === currentPage ? 'active' : ''}" data-page="${i}" data-list="${listKey}">${i}</button>`;
    }
    btns += `<button type="button"${currentPage >= totalPages ? ' disabled' : ''} data-page="${Math.min(totalPages, currentPage + 1)}" data-list="${listKey}">›</button>`;
    return `<div class="pagination">${btns}<span>${currentPage} / ${totalPages} 페이지</span></div>`;
  }

  function bindPagination(container) {
    container.querySelectorAll('.pagination button[data-list]:not([disabled])').forEach(btn => {
      btn.onclick = () => {
        const pg = Number(btn.dataset.page);
        if (btn.dataset.list === 'orders') orderPage = pg;
        else if (btn.dataset.list === 'vehicles') vehiclePage = pg;
        else if (btn.dataset.list === 'customers') customerPage = pg;
        else if (btn.dataset.list === 'drivers') driverPage = pg;
        renderPage();
      };
    });
  }

  const NAV_ICONS = {
    dashboard: '▦',
    control: '◎',
    dispatch: '▣',
    basic: '◉',
    customers: '◇',
    schedule: '◷',
  };

  /** 대시보드만 theme-dashboard, 접수·오더·배차 등은 theme-app(다크) */
  function syncSubNavLayout() {
    document.body.classList.remove('main-with-sub');
  }

  function applyPageTheme() {
    document.body.classList.remove('theme-dashboard', 'theme-app');
    document.body.classList.add('page-compact');
    if (currentPage === 'dashboard') document.body.classList.add('theme-dashboard');
    else document.body.classList.add('theme-app');
    syncSubNavLayout();
  }

  function detailEmptyHint(text) {
    return `<div class="detail-empty-hint">${text || '행을 선택하면 상세가 표시됩니다.'}</div>`;
  }

  function masterDetailShell(topHtml, listHtml, detailHtml) {
    const pane = detailHtml || detailEmptyHint();
    const sticky = topHtml ? `<div class="page-sticky-top">${topHtml}</div>` : '';
    return `
      ${sticky}
      <div class="page-body-fill master-detail-split${detailHtml ? ' has-detail' : ''}">
        <div class="master-detail-list">${listHtml}</div>
        <div class="master-detail-pane">${pane}</div>
      </div>`;
  }

  function tableScrollWrap(innerHtml) {
    return `<div class="table-scroll">${innerHtml}</div>`;
  }

  function renderNav() {
    const nav = $('#navMain');
    nav.innerHTML = '';
    NAV.forEach(group => {
      const isActive = currentMain === group.id;
      const hasSub = MAIN_WITH_SUB.includes(group.id);
      const item = el('div', 'nav-main-item' + (isActive ? ' active' : '') + (hasSub ? ' has-sub' : ''));
      const btn = el('button', 'nav-pill' + (isActive ? ' active' : ''), '');
      btn.type = 'button';
      btn.dataset.main = group.id;
      btn.title = group.label;
      btn.innerHTML = `<span class="nav-pill-icon" aria-hidden="true">${NAV_ICONS[group.id] || '•'}</span><span class="nav-pill-label">${group.label}</span>`;
      btn.onclick = () => {
        gotoPage(group.id, group.pages[0].id);
      };
      item.appendChild(btn);
      if (hasSub) {
        btn.setAttribute('aria-haspopup', 'true');
        const flyout = el('div', 'nav-sub-flyout');
        flyout.setAttribute('role', 'menu');
        flyout.setAttribute('aria-label', group.label + ' 하위 메뉴');
        group.pages.forEach(p => {
          const subBtn = el('button', 'nav-sub-btn' + (currentPage === p.id ? ' active' : ''), p.label);
          subBtn.type = 'button';
          subBtn.setAttribute('role', 'menuitem');
          subBtn.dataset.page = p.id;
          subBtn.onclick = (e) => {
            e.stopPropagation();
            gotoPage(group.id, p.id);
          };
          flyout.appendChild(subBtn);
        });
        item.appendChild(flyout);
      }
      nav.appendChild(item);
    });
    applyPageTheme();
  }

  function renderPage() {
    if (isMapPage()) hideLiveMap();
    const main = $('#mainContent');
    main.innerHTML = '';
    applyPageTheme();
    const page = el('section', 'page active page-viewport');
    main.appendChild(page);
    const root = el('div', 'page-center page-shell page-viewport-inner');
    page.appendChild(root);

    switch (currentPage) {
      case 'dashboard': renderDashboard(root); break;
      case 'control-live': renderControlLive(root); break;
      case 'bulk-dispatch': renderBulkDispatch(root); break;
      case 'dispatch-assign': renderDispatchAssign(root); break;
      case 'trip-stats': renderTripStats(root); break;
      case 'drivers': renderDrivers(root); break;
      case 'vehicles': renderVehicles(root); break;
      case 'staff': renderStaff(root); break;
      case 'profile': renderProfile(root); break;
      case 'customer-list': renderCustomers(root); break;
      case 'customer-loc': renderCustomerLoc(root); break;
      case 'order-intake': renderOrderIntake(root); break;
      case 'order-list': renderOrderList(root); break;
      case 'schedule-calendar': renderScheduleCalendar(root); break;
      case 'schedule-gantt': renderScheduleGantt(root); break;
      case 'schedule-milestones': renderScheduleMilestones(root); break;
    }
  }

  function renderDashboard(root) {
    hideLiveMap();
    const orderTabs = ['전체', '접수', '배차', '운행중', '완료'];
    const filteredOrders = DATA.orders.filter(o => dashOrderTab === '전체' || o.status === dashOrderTab);
    const dashboardOrders = filteredOrders.slice(0, 5);
    const completed = DATA.orders.filter(o => o.status === '완료').length;
    const total = DATA.orders.length;
    const pct = total ? Math.round((completed / total) * 100) : 0;
    const fleetByType = {};
    DATA.vehicles.forEach(v => { fleetByType[v.type] = (fleetByType[v.type] || 0) + 1; });
    const fleetMax = Math.max(...Object.values(fleetByType), 1);
    const fleetRows = Object.entries(fleetByType).sort((a, b) => b[1] - a[1]);
    const cargoMap = {};
    DATA.orders.forEach(o => {
      const label = (o.cargo || '').trim();
      if (!label) return;
      cargoMap[label] = (cargoMap[label] || 0) + 1;
    });
    const cargoChips = Object.entries(cargoMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count]) => ({ label, count }));
    root.innerHTML = `
        ${pageChromeHtml('dashboard', {
          title: '운영 대시보드',
          desc: '오더·차량·운행 현황 요약',
        })}
        <div class="dash-layout">
          <aside class="dash-left" aria-label="요약 위젯">
            <div class="dash-widget">
              <h2>오늘 배송 진행</h2>
              <div class="dash-cargo-chips">
                ${cargoChips.length ? cargoChips.map(c => `<span class="dash-cargo-chip">${c.label} ${c.count}건</span>`).join('') : '<span class="text-muted-hint">접수된 화물 없음</span>'}
              </div>
              <div class="dash-gauge-wrap">
                <div class="dash-gauge" style="--pct:${pct}">
                  <svg class="dash-gauge-svg" viewBox="0 0 140 78" aria-hidden="true">
                    <path class="dash-gauge-track" d="M 12 68 A 58 58 0 0 1 128 68" />
                    <path class="dash-gauge-fill" d="M 12 68 A 58 58 0 0 1 128 68" />
                  </svg>
                  <span class="dash-gauge-num">${pct}%</span>
                </div>
                <p style="font-size:12px;color:#8b93a7">${completed}건 / ${total}건 목표 (${pct}%)</p>
              </div>
            </div>
            <div class="dash-widget">
              <h2>차종별 가용 차량</h2>
              ${fleetRows.map(([type, n]) => `
                <div class="dash-fleet-row">
                  <span>${type}</span>
                  <div class="dash-fleet-bar"><i style="width:${Math.round(n / fleetMax * 100)}%"></i></div>
                  <span>${n}</span>
                </div>`).join('')}
              <p style="font-size:11px;color:#6b7280;margin-top:8px">등록 ${DATA.vehicles.length}대 · 기사 ${DATA.drivers.length}명</p>
            </div>
            <div class="dash-widget">
              <h2>바로가기</h2>
              <div class="dash-quick-links">
                <button type="button" class="dash-quick-link" data-goto-main="dispatch" data-goto-page="order-intake">
                  <strong>접수 창</strong>
                </button>
                <button type="button" class="dash-quick-link" data-goto-main="dispatch" data-goto-page="bulk-dispatch">
                  <strong>자동 배차</strong>
                </button>
                <button type="button" class="dash-quick-link" data-goto-main="dispatch" data-goto-page="dispatch-assign">
                  <strong>수동 배차</strong>
                </button>
              </div>
            </div>
          </aside>
          <div class="dash-right">
            <div class="dash-map-card" aria-label="요약 지도"></div>
            <div class="dash-orders-card">
              <div class="dash-orders-hd">
                <h2>오더</h2>
                <div class="dash-order-tabs" role="tablist" aria-label="오더 상태">
                  ${orderTabs.map(t => `
                    <button type="button" role="tab" class="${dashOrderTab === t ? 'active' : ''}" data-otab="${t}">${t}</button>`).join('')}
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>오더번호</th><th>고객</th><th>경로</th><th>시간창</th><th>기사</th><th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  ${dashboardOrders.length ? dashboardOrders.map(o => `
                    <tr data-goto-orders>
                      <td>${orderNoHtml(o, { raw: false })}</td>
                      <td>${o.customer}</td>
                      <td class="route-cell"><strong>${o.pickup}</strong><br>→ ${o.delivery}</td>
                      <td>${o.window}</td>
                      <td>${o.driver || '—'}</td>
                      <td>${statusBadge(o.status)}</td>
                    </tr>`).join('') : `
                    <tr><td colspan="6" style="text-align:center;padding:24px;color:#8b93a7">해당 상태의 오더가 없습니다</td></tr>`}
                </tbody>
              </table>
              <div class="dash-orders-ft">
                <span>${filteredOrders.length > 5 ? `최근 5건 표시 · 전체 ${filteredOrders.length}건` : `전체 ${filteredOrders.length}건`}</span>
                <button type="button" id="dashGoOrderList">전체 오더 목록 보기 →</button>
              </div>
            </div>
          </div>
        </div>`;
    root.querySelectorAll('.dash-quick-link[data-goto-main]').forEach(btn => {
      btn.onclick = () => gotoPage(btn.dataset.gotoMain, btn.dataset.gotoPage);
    });
    root.querySelectorAll('.dash-order-tabs button').forEach(btn => {
      btn.onclick = () => {
        dashOrderTab = btn.dataset.otab;
        renderDashboard(root);
      };
    });
    const goOrderList = () => {
      if (dashOrderTab !== '전체') orderFilter = dashOrderTab;
      gotoPage('dispatch', 'order-list');
    };
    root.querySelectorAll('[data-goto-orders]').forEach(tr => { tr.onclick = goOrderList; });
    $('#dashGoOrderList', root).onclick = goOrderList;
    if (map && isMapPage()) showLiveMap(currentPage);
  }

  function renderControlLive(root) {
    const trips = Array.isArray(DATA.trips) ? DATA.trips : (DATA.statsTrips || []);
    const vehiclesWithGps = DATA.vehicles.filter(v => v.driverId && v.start_lat != null && v.start_lon != null);
    const runningTrips = trips.filter(t => ['운행중', '진행', 'in_progress'].includes(t.status));
    const activeTrips = trips.filter(t => !['완료', '취소', 'completed', 'cancelled'].includes(t.status));
    const gpsRows = DATA.vehicles.map(v => {
      const d = DATA.drivers.find(x => x.id === v.driverId);
      const hasGps = v.start_lat != null && v.start_lon != null;
      return `
        <tr>
          <td>${v.plate || v.name || `차량 ${v.id}`}</td>
          <td>${d?.name || v.driver || '미연결'}</td>
          <td>${statusBadge(v.status || '가용')}</td>
          <td>${hasGps ? `${Number(v.start_lat).toFixed(5)}, ${Number(v.start_lon).toFixed(5)}` : '위치 없음'}</td>
          <td>${v.last_gps_at || (hasGps ? '등록 좌표' : '—')}</td>
        </tr>`;
    }).join('');
    root.innerHTML = `
      ${pageChromeHtml('control-live', {
        title: '실시간 운행관제',
        desc: '기사 앱 GPS와 차량 배정 정보를 기반으로 현재 위치를 확인합니다',
      })}
      <div class="control-layout">
        <section class="control-map-panel" aria-label="실시간 차량 위치 지도">
          <div class="control-map-toolbar">
            <div>
              <strong>차량 위치</strong>
              <span>${vehiclesWithGps.length}대 위치 수신 · 운행 ${runningTrips.length}건</span>
            </div>
            <button type="button" class="btn btn-sm" id="controlRefresh">새로고침</button>
          </div>
          <div class="control-map-card" aria-label="지도"></div>
        </section>
        <aside class="control-side-panel" aria-label="관제 요약">
          <div class="control-metric-grid">
            <div><span>활성 운행</span><strong>${activeTrips.length}</strong></div>
            <div><span>위치 수신</span><strong>${vehiclesWithGps.length}</strong></div>
            <div><span>등록 차량</span><strong>${DATA.vehicles.length}</strong></div>
            <div><span>등록 기사</span><strong>${DATA.drivers.length}</strong></div>
          </div>
          <div class="control-table-card">
            <h2>차량별 최근 위치</h2>
            <div class="table-scroll">
              <table>
                <thead><tr><th>차량</th><th>기사</th><th>상태</th><th>좌표</th><th>수신</th></tr></thead>
                <tbody>${gpsRows || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">등록 차량이 없습니다</td></tr>'}</tbody>
              </table>
            </div>
          </div>
        </aside>
      </div>`;
    const refresh = root.querySelector('#controlRefresh');
    if (refresh) refresh.onclick = (e) => {
      e.preventDefault();
      loadData({ preserveScroll: true });
    };
    setTimeout(() => showLiveMap('control-live'), 50);
  }

  function renderDrivers(root) {
    const q = root._search || '';
    const allRows = DATA.drivers.filter(d =>
      !q || d.name.includes(q) || driverVehicleLabel(d).includes(q) || d.phone.includes(q)
    );
    const rows = allRows.slice((driverPage - 1) * PAGE_SIZE, driverPage * PAGE_SIZE);
    const selected = selectedDriverId ? DATA.drivers.find(d => d.id === selectedDriverId) : null;
    const pendingHtml = DATA.pendingDrivers.length ? `
      <div class="card" style="margin-bottom:12px;border-left:3px solid var(--lime)">
        <div class="card-hd" style="padding:12px 16px">
          <h3 style="font-size:14px;margin:0">승인 대기 <span class="badge badge-warn">${DATA.pendingDrivers.length}</span></h3>
        </div>
        <div class="card-bd" style="padding:0">
          <table style="width:100%">
            <thead><tr><th>이름</th><th>연락처</th><th>가입일</th><th></th></tr></thead>
            <tbody>${DATA.pendingDrivers.map(p => `
              <tr data-pending-id="${p.id}">
                <td>${p.name}</td><td>${p.phone}</td><td>${(p.created_at || '').slice(0, 10)}</td>
                <td style="white-space:nowrap">
                  <button type="button" class="btn btn-sm btn-primary btn-approve-driver" data-uid="${p.id}" data-name="${escapeHtml(p.name)}">승인</button>
                  <button type="button" class="btn btn-sm btn-danger-outline btn-reject-driver" data-uid="${p.id}" data-name="${escapeHtml(p.name)}" style="margin-left:4px">거절</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '';
    const listCard = `
      <div class="card card-fill" style="display:flex;flex-direction:column;min-height:0">
        <div class="card-hd">
          <h2>기사 목록</h2>
          <div class="toolbar">
            <input type="search" class="search" placeholder="이름·번호판·연락처 검색" id="driverSearch" value="${q}">
            <button type="button" class="btn btn-primary" id="addDriver">+ 추가</button>
          </div>
        </div>
        <div class="card-bd" style="padding:8px 12px 0;overflow-y:auto;flex:1;min-height:0">
          ${pendingHtml}
          ${tableScrollWrap(`<table id="driverTable">
            <thead><tr><th>이름</th><th>배정 차량</th><th>상태</th><th>연락처</th><th></th></tr></thead>
            <tbody>${rows.map(d => `
              <tr data-id="${d.id}" class="${selectedDriverId === d.id ? 'selected' : ''}">
                <td>${d.name}${(_driverUnread[d.id] || 0) > 0 ? `<span class="badge badge-info driver-chat-badge" style="margin-left:4px">${_driverUnread[d.id]}</span>` : ''}</td><td>${driverVehicleLabel(d)}</td><td>${statusBadge(d.status)}</td><td>${d.phone}</td>
                <td><button type="button" class="btn btn-sm btn-danger-outline btn-del-driver" data-uid="${d.id}" data-name="${escapeHtml(d.name)}">삭제</button></td>
              </tr>`).join('')}
            </tbody>
          </table>`)}
          ${paginationHtml(allRows.length, driverPage, 'drivers')}
        </div>
      </div>`;
    root.innerHTML = masterDetailShell(
      pageChromeHtml('drivers', { desc: '등록 기사 · 좌측 목록 · 우측 상세' }),
      listCard,
      selected ? inlineDetailCardHtml(selected.name, driverDetailBodyHtml(selected)) : ''
    );

    $('#driverSearch', root).oninput = (e) => { driverPage = 1; root._search = e.target.value; renderDrivers(root); };

    // 기사 추가
    $('#addDriver', root).onclick = () => {
      openModal('기사 추가', `
        <form id="driverForm">
          <div class="form-grid" style="max-width:100%">
            <label>아이디 *</label><input name="username" required placeholder="로그인 아이디">
            <label>이름 *</label><input name="name" required>
            <label>연락처 *</label><input name="phone" required placeholder="010-0000-0000">
            <label>비밀번호 *</label><input name="password" type="password" required placeholder="초기 비밀번호">
          </div>
        </form>`, async () => {
        const form = document.getElementById('driverForm');
        const fd = Object.fromEntries(new FormData(form));
        if (!fd.username || !fd.name || !fd.phone || !fd.password) { toast('모든 필수 항목을 입력하세요'); return; }
        const orgRes = await apiFetch(`/organizations/me`);
        const org = orgRes.ok ? await orgRes.json() : {};
        const res = await apiFetch(`/auth/register`, {
          method: 'POST',
          body: JSON.stringify({ username: fd.username, password: fd.password, phone: normalizePhone(fd.phone), name: fd.name, org_code: org.org_code || '', role: 'driver' }),
        });
        if (!res.ok) { const e = await res.json(); toast(e.detail || '등록 실패'); return; }
        toast(`기사 «${fd.name}» 등록 완료 · 승인 후 앱 이용 가능`);
        await loadRealData();
      });
    };

    // 기사 삭제
    root.querySelectorAll('.btn-del-driver').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`기사 «${btn.dataset.name}»를 삭제하시겠습니까?\n관련 배송·대화 이력도 함께 삭제됩니다.`)) return;
        const res = await apiFetch(`/users/${btn.dataset.uid}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) { const e = await res.json().catch(() => ({})); toast(e.detail || '삭제 실패'); return; }
        toast('기사가 삭제되었습니다');
        if (selectedDriverId === btn.dataset.uid) selectedDriverId = null;
        await loadRealData();
      };
    });

    // pending 기사 승인
    root.querySelectorAll('.btn-approve-driver').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const res = await apiFetch(`/auth/approve/${btn.dataset.uid}`, { method: 'POST' });
        if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '승인 실패'); return; }
        toast(`기사 «${btn.dataset.name}» 승인 완료`);
        await loadRealData();
      };
    });

    // pending 기사 거절(삭제)
    root.querySelectorAll('.btn-reject-driver').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`기사 «${btn.dataset.name}» 가입을 거절하시겠습니까?`)) return;
        const res = await apiFetch(`/users/${btn.dataset.uid}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) { const e = await res.json().catch(() => ({})); toast(e.detail || '거절 실패'); return; }
        toast(`기사 «${btn.dataset.name}» 가입 거절`);
        await loadRealData();
      };
    });

    const tbody = $('#driverTable tbody', root);
    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.onclick = (e) => { if (e.target.closest('button')) return; selectDriver(tr.dataset.id); };
    });
    if (selected) bindDriverDetail(root, selected);
    bindPagination(root);
  }

  function renderVehicles(root) {
    const q = (root._search || '').trim().toLowerCase();
    const allRows = DATA.vehicles.filter(v => {
      if (!q) return true;
      const hay = `${v.plate} ${v.tonnage} ${v.type} ${vehicleLastGpsLabel(v)} ${v.status} ${vehicleDriverLabel(v)}`.toLowerCase();
      return hay.includes(q);
    });
    const rows = allRows.slice((vehiclePage - 1) * PAGE_SIZE, vehiclePage * PAGE_SIZE);
    const selected = selectedVehicleId ? vehicleById(selectedVehicleId) : null;
    const listCard = `
      <div class="card card-fill">
        <div class="card-hd">
          <h2>차량 목록</h2>
          <div class="toolbar">
            <input type="search" class="search" placeholder="번호판·톤급·위치·기사 검색" id="vehicleSearch" value="${root._search || ''}">
            <button type="button" class="btn btn-primary" id="addVehicle">+ 차량 등록</button>
          </div>
        </div>
        <div class="card-bd" style="padding:0;display:flex;flex-direction:column;min-height:0">
          ${tableScrollWrap(`<table id="vehicleTable">
            <thead><tr><th>번호판</th><th>톤급</th><th>차종</th><th>최근 위치</th><th>상태</th><th>연결 기사</th><th></th></tr></thead>
            <tbody>${rows.length ? rows.map(v => `
              <tr data-id="${v.id}" class="${selectedVehicleId === v.id ? 'selected' : ''}">
                <td><strong>${v.plate}</strong></td>
                <td>${v.tonnage}</td>
                <td>${v.type}</td>
                <td>${vehicleLastGpsTableCell(v)}</td>
                <td>${statusBadge(v.status)}</td>
                <td>${vehicleDriverLabel(v)}</td>
                <td><button type="button" class="btn btn-sm btn-danger-outline btn-del-vehicle" data-vid="${v.id}" data-plate="${escapeHtml(v.plate)}">삭제</button></td>
              </tr>`).join('') : `
              <tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">검색 결과가 없습니다</td></tr>`}
            </tbody>
          </table>`)}
          ${paginationHtml(allRows.length, vehiclePage, 'vehicles')}
        </div>
      </div>`;
    root.innerHTML = masterDetailShell(
      pageChromeHtml('vehicles', { desc: '차량 마스터 · 좌측 목록 · 우측 상세' }),
      listCard,
      selected ? inlineDetailCardHtml(selected.plate, vehicleDetailBodyHtml(selected)) : ''
    );

    $('#vehicleSearch', root).oninput = (e) => { vehiclePage = 1; root._search = e.target.value; renderVehicles(root); };
    $('#addVehicle', root).onclick = () => {
      openModal('차량 등록', `
        <form id="vehicleForm">
          <div class="form-grid" style="max-width:100%">
            <label>번호판 *</label><input name="plate_number" required placeholder="12가3456">
            <label>차종 *</label>
            <select name="vehicle_type"><option value="윙바디">윙바디</option><option value="탑차">탑차</option><option value="카고">카고</option></select>
            <label>총중량(kg) *</label><input name="weight_kg" type="number" min="0" required placeholder="예: 5000">
            <label>높이(m) *</label><input name="height_m" type="number" step="0.01" min="0" required placeholder="예: 2.5">
            <label>길이(cm)</label><input name="length_cm" type="number" min="0" placeholder="예: 650">
            <label>폭(cm)</label><input name="width_cm" type="number" min="0" placeholder="예: 220">
          </div>
        </form>`, async () => {
        const form = document.getElementById('vehicleForm');
        const fd = Object.fromEntries(new FormData(form));
        if (!fd.plate_number || !fd.vehicle_type || !fd.weight_kg || !fd.height_m) { toast('필수 항목을 입력하세요'); return; }
        const body = {
          plate_number: fd.plate_number.trim(),
          vehicle_type: fd.vehicle_type,
          weight_kg: parseFloat(fd.weight_kg),
          height_m: parseFloat(fd.height_m),
          length_cm: fd.length_cm ? parseFloat(fd.length_cm) : null,
          width_cm: fd.width_cm ? parseFloat(fd.width_cm) : null,
        };
        const res = await apiFetch(`/vehicles`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '차량 등록 실패'); return; }
        toast(`차량 «${fd.plate_number}» 등록 완료`);
        await loadRealData();
      });
    };

    const tbody = $('#vehicleTable tbody', root);
    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.onclick = (e) => { if (e.target.closest('button')) return; selectVehicle(tr.dataset.id); };
    });

    // 차량 삭제
    root.querySelectorAll('.btn-del-vehicle').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`차량 «${btn.dataset.plate}»를 비활성화하시겠습니까?`)) return;
        const res = await apiFetch(`/vehicles/${btn.dataset.vid}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) { const e = await res.json().catch(() => ({})); toast(e.detail || '삭제 실패'); return; }
        toast(`차량 «${btn.dataset.plate}» 비활성화 완료`);
        if (selectedVehicleId === Number(btn.dataset.vid)) selectedVehicleId = null;
        await loadRealData();
      };
    });

    if (selected) bindVehicleDetail(root, selected);
    bindPagination(root);
  }

  function renderStaff(root) {
    const selected = selectedStaffId ? staffById(selectedStaffId) : null;
    const listCard = `
      <div class="card card-fill">
        <div class="card-hd">
          <h2>담당자</h2>
          <button type="button" class="btn btn-primary" id="addStaff">+ 추가</button>
        </div>
        <div class="card-bd" style="padding:0;display:flex;flex-direction:column;min-height:0">
          ${tableScrollWrap(`<table id="staffTable">
            <thead><tr><th>이름</th><th>아이디</th><th>연락처</th><th>가입일</th></tr></thead>
            <tbody>${DATA.staff.map(s => `
              <tr data-id="${s.id}" class="${selectedStaffId === s.id ? 'selected' : ''}">
                <td>${s.name}${s.id === _currentUserId ? ' <span class="badge badge-ok" style="font-size:10px">나</span>' : ''}</td>
                <td>${s.username}</td>
                <td>${s.phone || '—'}</td>
                <td>${s.created_at ? s.created_at.split('T')[0] : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>`)}
        </div>
      </div>`;
    root.innerHTML = masterDetailShell(
      pageChromeHtml('staff', { desc: '담당자 · 좌측 목록 · 우측 상세' }),
      listCard,
      selected ? inlineDetailCardHtml(selected.name, staffDetailBodyHtml(selected), { saveLabel: '닫기' }) : ''
    );
    $('#staffTable tbody', root).querySelectorAll('tr[data-id]').forEach(tr => {
      tr.onclick = () => selectStaff(tr.dataset.id);
    });
    if (selected) bindStaffDetail(root, selected);
    $('#addStaff', root).onclick = async () => {
      const orgRes = await apiFetch(`/organizations/me`);
      const org = orgRes.ok ? await orgRes.json() : null;
      const orgCode = org?.org_code || '';
      openModal('담당자 추가', `
        <form id="addStaffForm">
          <div class="form-grid" style="max-width:100%">
            <label>이름 *</label><input id="sfName" required placeholder="홍길동">
            <label>아이디 *</label><input id="sfUsername" required placeholder="login_id">
            <label>비밀번호 *</label><input id="sfPassword" type="password" required placeholder="8자 이상">
            <label>연락처 *</label><input id="sfPhone" required placeholder="010-0000-0000">
          </div>
          <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
            <button type="button" class="btn" id="sfCancel">취소</button>
            <button type="submit" class="btn btn-primary">추가</button>
          </div>
        </form>`);
      document.getElementById('sfCancel').onclick = closeModal;
      document.getElementById('addStaffForm').onsubmit = async (e) => {
        e.preventDefault();
        const body = {
          name: document.getElementById('sfName').value.trim(),
          username: document.getElementById('sfUsername').value.trim(),
          password: document.getElementById('sfPassword').value,
          phone: normalizePhone(document.getElementById('sfPhone').value),
          org_code: orgCode,
          role: 'admin',
        };
        const res = await apiFetch(`/auth/register`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (res.ok || res.status === 201) {
          toast('담당자가 추가되었습니다.');
          closeModal();
          await loadRealData();
        } else {
          const err = await res.json().catch(() => ({}));
          toast(err.detail || '추가 실패', 'error');
        }
      };
    };
  }

  function renderProfile(root) {
    const me = DATA.me || {};
    root.innerHTML = `
      <div class="page-sticky-top">
      ${pageChromeHtml('profile', { desc: '계정 정보 및 비밀번호 변경' })}
      </div>
      <div class="page-scroll-main">
      <div class="card">
        <div class="card-bd">
          <div class="tabs" id="profileTabs">
            <button type="button" class="tab active" data-tab="info">내 정보</button>
            <button type="button" class="tab" data-tab="pw">비밀번호 변경</button>
          </div>
          <div class="tab-panel active" data-panel="info">
            <form id="infoForm" class="form-grid">
              <label>아이디</label><input value="${me.username || ''}" disabled style="opacity:.6">
              <label>이름</label><input value="${me.name || ''}" disabled style="opacity:.6">
              <label>역할</label><input value="${me.role === 'admin' ? '관리자' : me.role || ''}" disabled style="opacity:.6">
              <label>전화번호</label><input type="tel" name="phone" value="${me.phone || ''}" placeholder="010-0000-0000">
            </form>
          </div>
          <div class="tab-panel" data-panel="pw">
            <form id="pwForm" class="form-grid">
              <label>현재 비밀번호 *</label><input type="password" name="current_password" required minlength="1">
              <label>새 비밀번호 *</label><input type="password" name="new_password" required minlength="4" placeholder="4자 이상">
              <label>새 비밀번호 확인 *</label><input type="password" name="new_password_confirm" required>
            </form>
          </div>
          <div style="margin-top:16px">
            <button type="button" class="btn btn-primary" id="saveProfile">저장</button>
          </div>
        </div>
      </div>
      </div>`;
    root.querySelectorAll('#profileTabs .tab').forEach(tab => {
      tab.onclick = () => {
        root.querySelectorAll('#profileTabs .tab').forEach(t => t.classList.remove('active'));
        root.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        root.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
      };
    });
    $('#saveProfile', root).onclick = async () => {
      const activePanel = root.querySelector('.tab-panel.active');
      const tab = activePanel?.dataset.panel;

      if (tab === 'info') {
        const phone = normalizePhone(activePanel.querySelector('[name="phone"]').value);
        if (!phone) { toast('전화번호를 입력하세요', 'error'); return; }
        const res = await apiFetch(`/auth/me`, {
          method: 'PATCH',
          body: JSON.stringify({ phone }),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '저장 실패', 'error'); return; }
        const updated = await res.json();
        if (DATA.me) DATA.me.phone = updated.phone;
        toast('전화번호가 저장됐습니다');

      } else if (tab === 'pw') {
        const form = activePanel.querySelector('#pwForm');
        const current_password = form.querySelector('[name="current_password"]').value;
        const new_password     = form.querySelector('[name="new_password"]').value;
        const confirm          = form.querySelector('[name="new_password_confirm"]').value;
        if (!current_password || !new_password) { toast('모든 항목을 입력하세요', 'error'); return; }
        if (new_password.length < 4) { toast('새 비밀번호는 4자 이상이어야 합니다', 'error'); return; }
        if (new_password !== confirm) { toast('새 비밀번호가 일치하지 않습니다', 'error'); return; }
        const res = await apiFetch(`/auth/me`, {
          method: 'PATCH',
          body: JSON.stringify({ current_password, new_password }),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '비밀번호 변경 실패', 'error'); return; }
        toast('비밀번호가 변경됐습니다');
        form.reset();
      }
    };
  }

  function renderCustomers(root) {
    const q = root._search || '';
    const filterChips = ['전체', '정규', '임시(당일)'];
    const allRows = DATA.customers.filter(c =>
      customerMatchesListFilter(c, customerListFilter) &&
      (!q || c.name.includes(q) || (c.contact || '').includes(q) || (c.phone || '').includes(q))
    );
    const rows = allRows.slice((customerPage - 1) * PAGE_SIZE, customerPage * PAGE_SIZE);
    const selected = selectedCustomerId ? customerById(selectedCustomerId) : null;
    const detailTab = selected ? customerDetailTab : 'info';
    const listCard = `
      <div class="card card-fill">
        <div class="card-hd">
          <h2>고객 목록</h2>
          <div class="toolbar" style="flex-wrap:wrap;gap:8px">
            <div class="chips" id="custFilterChips">
              ${filterChips.map(f => `<button type="button" class="chip ${customerListFilter === f ? 'active' : ''}" data-cf="${f}">${f}</button>`).join('')}
            </div>
            <input type="search" class="search" id="custSearch" placeholder="고객명·담당자" value="${q}">
            <button type="button" class="btn btn-primary" id="addCust">+ 추가</button>
          </div>
          <p class="cust-filter-hint">임시(당일): 접수 시 등록한 당일 화주만 · 일자 종료 후 목록에서 숨김</p>
        </div>
        <div class="card-bd" style="padding:0;display:flex;flex-direction:column;min-height:0">
          ${tableScrollWrap(`<table>
            <thead><tr><th>고객명</th><th>담당자</th><th>연락처</th><th>주소</th><th>최근 배송</th><th></th></tr></thead>
            <tbody>${rows.length ? rows.map(c => `
              <tr data-id="${c.id}" class="${selectedCustomerId === c.id ? 'selected' : ''}">
                <td><strong>${c.name}</strong> ${customerTempBadgeHtml(c)}</td>
                <td>${c.contact || '—'}</td><td>${c.phone || '—'}</td><td>${c.address || '—'}</td>
                <td class="recent-ship">${c.lastOrderDate || '—'}</td>
                <td><button type="button" class="btn btn-sm edit-cust">수정</button></td>
              </tr>`).join('') : `
              <tr><td colspan="6" class="empty-hint" style="padding:16px">표시할 고객이 없습니다.</td></tr>`}
            </tbody>
          </table>`)}
          ${paginationHtml(allRows.length, customerPage, 'customers')}
        </div>
      </div>`;
    const detailTitle = selected
      ? `${selected.name} ${customerTempBadgeHtml(selected)}`
      : '';
    root.innerHTML = masterDetailShell(
      pageChromeHtml('customer-list', { desc: '거래처 · 좌측 목록 · 우측 상세 · 당일 임시 화주' }),
      listCard,
      selected ? inlineDetailCardHtml(detailTitle, customerDetailBodyHtml(selected, detailTab)) : ''
    );
    root.querySelectorAll('#custFilterChips .chip').forEach(chip => {
      chip.onclick = () => {
        customerPage = 1;
        customerListFilter = chip.dataset.cf;
        renderCustomers(root);
      };
    });
    $('#custSearch', root).oninput = (e) => { customerPage = 1; root._search = e.target.value; renderCustomers(root); };
    $('#addCust', root).onclick = () => customerModal();
    root.querySelectorAll('.edit-cust').forEach((btn, i) => {
      btn.onclick = (e) => { e.stopPropagation(); customerModal(rows[i] || DATA.customers[i]); };
    });
    root.querySelectorAll('tbody tr[data-id]').forEach(tr => {
      tr.onclick = (e) => {
        if (e.target.closest('.edit-cust')) return;
        customerDetailTab = 'info';
        selectCustomer(tr.dataset.id);
      };
    });
    if (selected) bindCustomerDetail(root, selected);
    bindPagination(root);
  }

  function customerModal(c) {
    const isEdit = !!c;
    openModal(isEdit ? '고객 수정' : '고객 추가', `
      <form id="custModalForm">
        <div class="form-grid" style="max-width:100%">
          <label>고객명 *</label><input name="name" required value="${c?.name || ''}">
          <label>담당자</label><input name="contact" value="${c?.contact || ''}">
          <label>연락처</label><input name="phone" value="${c?.phone || ''}">
          <label>주소</label>
          <div class="place-search-wrap">
            <input type="text" class="place-search" name="address" value="${c?.address || ''}" placeholder="주소 또는 장소 검색…" data-place-value="address" data-lat="${c?.lat ?? ''}" data-lon="${c?.lon ?? ''}">
          </div>
        </div>
      </form>`, async () => {
      const form = $('#custModalForm');
      if (!form) return;
      const name    = form.querySelector('[name="name"]').value.trim();
      const contact = form.querySelector('[name="contact"]').value.trim();
      const phone   = normalizePhone(form.querySelector('[name="phone"]').value);
      const addressEl = form.querySelector('[name="address"]');
      const address = addressEl.value.trim();
      const lat = address ? (addressEl.dataset.lat ? Number(addressEl.dataset.lat) : null) : null;
      const lon = address ? (addressEl.dataset.lon ? Number(addressEl.dataset.lon) : null) : null;
      if (!name) { toast('고객명을 입력하세요'); return; }
      const body = { name, contact: contact || null, phone: phone || null, address: address || null, lat, lon };
      let res;
      if (isEdit) {
        res = await apiFetch(`/customers/${c.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        res = await apiFetch(`/customers`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '저장 실패'); return; }
      const saved = await res.json();
      if (isEdit) {
        const idx = DATA.customers.findIndex(x => x.id === c.id);
        if (idx >= 0) Object.assign(DATA.customers[idx], saved);
      } else {
        DATA.customers.push({ ...saved, shipmentHistory: [], totalShipments: 0, lastOrderDate: null });
      }
      toast(isEdit ? '고객 정보 수정됨' : '고객이 등록됐습니다');
      renderPage();
    });
    const form = $('#custModalForm');
    if (form) {
      const addressEl = form.querySelector('[name="address"]');
      addressEl?.addEventListener('input', () => {
        delete addressEl.dataset.lat;
        delete addressEl.dataset.lon;
        delete addressEl.dataset.placeName;
      });
      bindPlaceSearch(form);
    }
  }

  function renderCustomerLoc(root) {
    _miniMapInstance = null;
    const positioned = DATA.customers.filter(c => c.lat != null && c.lon != null);
    const missingCount = DATA.customers.length - positioned.length;
    root.innerHTML = `
      <div class="page-sticky-top">
      ${pageChromeHtml('customer-loc', { desc: '고객 주소 좌표 · 고객 마스터 기준' })}
      </div>
      <div class="page-body-fill split" style="grid-template-columns:1fr 1fr;min-height:0">
        <div>
          <div class="card">
            <div class="card-hd">
              <h2>위치 목록</h2>
              <span style="font-size:12px;color:var(--text-muted)">좌표 등록 ${positioned.length}건 · 미등록 ${missingCount}건</span>
            </div>
            <div class="card-bd">
              <ul class="loc-list">${positioned.length ? positioned.map(c => {
                return `<li>
                  <div>
                    <button type="button" class="link-btn cust-history-link" data-cid="${c.id}"><strong>${c.name}</strong></button>
                    <br><span class="coord">${c.address || '주소 미입력'} · ${Number(c.lat).toFixed(4)}, ${Number(c.lon).toFixed(4)}</span>
                  </div>
                </li>`;
              }).join('') : '<li class="empty-hint">주소 자동완성으로 좌표가 등록된 고객이 없습니다.</li>'}</ul>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-hd"><h2>지도</h2></div>
          <div class="card-bd" style="padding:0;height:400px">
            <div id="miniMapCanvas" style="width:100%;height:100%"></div>
          </div>
        </div>
      </div>
      </div>`;
    root.querySelectorAll('.cust-history-link').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        selectedCustomerId = Number(btn.dataset.cid);
        customerDetailTab = 'history';
        gotoPage('customers', 'customer-list');
      };
    });
    // 고객 주소 좌표 마커 표시
    initCustomerLocMap(root);
  }

  function initCustomerLocMap(root) {
    if (!window.kakao || !window.kakao.maps) return;
    const canvas = $('#miniMapCanvas', root);
    if (!canvas) return;
    _miniMapMarkers.forEach(m => m.setMap(null));
    _miniMapMarkers = [];
    if (_miniMapInstance) {
      // 이미 존재하면 재사용
    } else {
      _miniMapInstance = new kakao.maps.Map(canvas, {
        center: new kakao.maps.LatLng(37.5665, 126.978),
        level: 10,
      });
    }
    const points = DATA.customers.filter(c => c.lat != null && c.lon != null);
    if (!points.length) return;
    const bounds = new kakao.maps.LatLngBounds();
    points.forEach(c => {
      const pos = new kakao.maps.LatLng(c.lat, c.lon);
      const marker = new kakao.maps.Marker({ position: pos, map: _miniMapInstance, title: c.name });
      _miniMapMarkers.push(marker);
      bounds.extend(pos);
    });
    _miniMapInstance.setBounds(bounds);
    kakao.maps.event.trigger(_miniMapInstance, 'resize');
  }

  function bulkEndPolicyBadge(policy) {
    if (policy === 'return_to_depot') return '<span class="badge badge-info">복귀</span>';
    return '<span class="badge badge-muted">open_end</span>';
  }

  function bulkAssignedOrderIds() {
    const ids = new Set();
    Object.values(bulkOrderAssignments).forEach(list => (list || []).forEach(id => ids.add(id)));
    return ids;
  }

  function bulkOrderPool(stops) {
    const assigned = bulkAssignedOrderIds();
    return stops.filter(s => !assigned.has(s.id));
  }

  function bulkAvailableDrivers() {
    return DATA.drivers.filter(d => d.status === '운행가능' || d.status === '운행중');
  }

  function bulkDriverVehicle(driverId) {
    const driver = driverById(driverId);
    return driver?.vehicleId ? vehicleById(driver.vehicleId) : DATA.vehicles.find(v => v.driverId === driverId) || null;
  }

  function bulkDriverCardsHtml(drivers) {
    return drivers.map(d => {
      const vehicle = bulkDriverVehicle(d.id);
      const assigned = bulkOrderAssignments[String(d.id)] || [];
      const picked = bulkSelectedDriverIds.includes(d.id);
      return `
        <div class="bulk-driver-card ${picked ? 'picked' : ''}" data-driver-id="${d.id}">
          <div class="bulk-driver-card-hd">
            <label class="bulk-driver-pick">
              <input type="checkbox" class="bulk-driver-chk" data-id="${d.id}" ${picked ? 'checked' : ''} aria-label="${d.name} 선택">
              <span class="bulk-driver-pick-text">
                <strong>${d.name}</strong>
                <span class="bulk-driver-vehicle">${vehicle ? `${vehicle.plate} · ${vehicle.tonnage || '—'}` : '연결 차량 없음'}</span>
              </span>
            </label>
            ${statusBadge(d.status)}
          </div>
          <div class="bulk-driver-assigned">
            <p class="field-label">배정 오더 ${assigned.length}건</p>
            ${assigned.length ? assigned.map(id => `<span class="badge badge-muted">${id}</span>`).join(' ') : '<p class="bulk-driver-empty">아직 배정 없음</p>'}
          </div>
        </div>`;
    }).join('');
  }

  function renderBulkDispatch(root) {
    DATA.bulkDispatch.stops = unassignedForDispatch();
    DATA.bulkDispatch.vehicles = DATA.dispatchFleet.map(f => {
      const v = vehicleById(f.vehicleId);
      const d = driverById(f.driverId);
      return {
        id: f.id, vehicleId: f.vehicleId, driverId: f.driverId,
        available: f.available !== false,
        label: v?.plate || `차량${f.id}`,
        plate: v?.plate || '—', tonnage: v?.tonnage || '—',
        type: v?.type || '—', weight_kg: v?.weight_kg || 0,
        start_lat: v?.start_lat ?? null, start_lon: v?.start_lon ?? null,
        start_city: vehicleLastGpsLabel(v), end_policy: 'open_end', driver: d?.name || '—',
      };
    });
    const bd = DATA.bulkDispatch;
    const res = bd.results;
    const plans = res.plans;
    const tabIdx = Math.min(bulkDispatchTab, plans.length - 1);
    const plan = plans[tabIdx] || plans[0];
    const drivers = bulkAvailableDrivers();
    const driverIds = new Set(drivers.map(d => d.id));
    Object.keys(bulkOrderAssignments).forEach(id => {
      if (!driverIds.has(Number(id))) delete bulkOrderAssignments[id];
    });
    const validStopIds = new Set(bd.stops.map(s => s.id));
    Object.keys(bulkOrderAssignments).forEach(id => {
      bulkOrderAssignments[id] = (bulkOrderAssignments[id] || []).filter(orderId => validStopIds.has(orderId));
      if (!bulkOrderAssignments[id].length) delete bulkOrderAssignments[id];
    });
    bulkSelectedOrderIds = bulkSelectedOrderIds.filter(id => validStopIds.has(id) && !bulkAssignedOrderIds().has(id));
    bulkSelectedDriverIds = bulkSelectedDriverIds.filter(id => driverIds.has(id));
    const pool = bulkOrderPool(bd.stops);
    const poolIds = pool.map(s => s.id);
    const allPoolSelected = poolIds.length > 0 && poolIds.every(id => bulkSelectedOrderIds.includes(id));
    const assignedCount = Object.values(bulkOrderAssignments).reduce((sum, list) => sum + (list?.length || 0), 0);
    const assignedDriverCount = Object.values(bulkOrderAssignments).filter(list => list?.length).length;
    const canAssign = bulkSelectedOrderIds.length > 0 && bulkSelectedDriverIds.length > 0;
    const canRunBulk = assignedCount > 0 && assignedDriverCount > 0;
    const driverBarLabel = !bulkSelectedDriverIds.length
      ? '선택'
      : bulkSelectedDriverIds.length === 1
        ? (driverById(bulkSelectedDriverIds[0])?.name || '선택')
        : `${bulkSelectedDriverIds.length}명`;

    const visitLi = (v) => {
      const cls = v.kind === 'rest' ? 'rest' : (v.kind === 'origin' || v.kind === 'end' ? v.kind : '');
      return `<li class="${cls}">${v.text}</li>`;
    };

    root.innerHTML = `
      <div class="page-sticky-top">
      ${pageChromeHtml('bulk-dispatch', { desc: '다차량·다배송지 자동 배정 · 경로 미리보기' })}
      </div>
      <div class="page-body-fill dispatch-two-pane dispatch-two-pane--bulk page-bulk-dispatch">
      <div class="dispatch-work-pane">
      <div class="card bulk-setup-card" id="sec-bulk-setup">
        <div class="card-hd card-hd--dispatch">
          <div class="card-hd-lead">
            <h2>오더·기사 배정</h2>
            <span class="text-muted-hint" style="font-size:12px">미배정 오더를 선택해 기사별로 배정한 뒤 일괄 최적화</span>
          </div>
        </div>
        <div class="card-bd" style="padding-top:0">
          <p class="field-label">출발 방식</p>
          <div class="departure-mode" role="radiogroup" aria-label="출발 방식">
            <button type="button" class="${bulkDepartureMode === 'distributed' ? 'active' : ''}" data-departure="distributed">
              <strong>분산 출발</strong>
              차량별 최근 GPS 위치에서 출발 (기본)
            </button>
            <button type="button" class="${bulkDepartureMode === 'depot' ? 'active' : ''}" data-departure="depot">
              <strong>단일 센터 출발</strong>
              공통 창고 1곳에서 전 차량 출발
            </button>
          </div>
          <div id="bulkDepotBlock" class="${bulkDepartureMode === 'depot' ? '' : 'is-hidden'}">
            <div class="form-grid" style="max-width:100%;grid-template-columns:120px 1fr;margin-bottom:12px">
              <label>센터(Depot)</label>
              <div class="toolbar">
                <input type="text" value="${bd.depot.name}" id="bulkDepotName" style="flex:1;min-width:160px">
                <button type="button" class="btn btn-sm" id="bulkDepotMap">지도에서 선택</button>
                <span class="coord">${bd.depot.lat}, ${bd.depot.lon}</span>
              </div>
            </div>
            <div class="map-placeholder map-short" style="margin-bottom:16px" id="bulkDepotMapPreview" aria-label="센터 위치 지도"></div>
          </div>

          <label class="toolbar" style="margin-top:12px;font-size:13px;cursor:pointer">
            <input type="checkbox" id="bulkAllowMixed" ${bulkAllowMixedLoad ? 'checked' : ''}>
            혼적 허용 <span class="text-muted-hint">(동일 차량·복수 화주·화물)</span>
          </label>

          <div class="dispatch-setup-grid bulk-assign-grid">
            <div class="dispatch-setup-main dispatch-setup-main--stack">
              <p class="field-label" style="margin-top:16px">미배정 오더 <span class="text-muted-hint" style="font-weight:400">· 행 클릭 또는 체크로 다중 선택</span></p>
              <div id="bulkOrderPool">
                ${tableScrollWrap(`<table class="bulk-pool-table">
                  <thead><tr>
                    <th><input type="checkbox" id="chkAllBulkPool" ${allPoolSelected ? 'checked' : ''} aria-label="전체 선택"></th>
                    <th>오더번호</th><th>혼적</th><th>화주</th><th>경로</th><th>규격</th><th>시간창</th><th>상태</th>
                  </tr></thead>
                  <tbody id="bulkOrderPoolBody">
                    ${pool.length ? dispatchListTableRows(pool, {
                      rowClass: 'bulk-pool-row order-row-clickable',
                      dataAttr: 'bulk-order-id',
                      checkbox: true,
                      checkboxClass: 'bulk-pool-chk',
                      selectedIds: bulkSelectedOrderIds,
                    }) : `
                      <tr><td colspan="8" class="empty-hint" style="padding:16px">미배정 오더가 없습니다.</td></tr>`}
                  </tbody>
                </table>`)}
              </div>
              <p class="empty-hint dispatch-table-foot">${pool.length}건 미배정 · ${bulkSelectedOrderIds.length ? `<strong>${bulkSelectedOrderIds.length}</strong>건 선택` : '선택 없음'}</p>
            </div>
            <aside class="dispatch-setup-fleet" aria-label="가용 기사">
              <div class="driver-panel bulk-driver-panel">
                <div class="bulk-driver-panel-hd">
                  <h3>가용 기사 <span class="text-muted-hint" style="font-weight:400;font-size:12px">· 체크로 다중 선택</span></h3>
                  <label class="bulk-driver-select-all">
                    <input type="checkbox" id="chkAllBulkDrivers" ${drivers.length && bulkSelectedDriverIds.length === drivers.length ? 'checked' : ''} aria-label="전체 선택">
                    <span>전체</span>
                  </label>
                </div>
                <input type="search" class="search bulk-driver-search" placeholder="기사 검색" id="bulkDriverSearch">
                <div class="bulk-driver-list" id="bulkDriverList">${bulkDriverCardsHtml(drivers)}</div>
              </div>
            </aside>
          </div>

          <div class="bulk-setup-footer">
            <div class="bulk-assign-bar ${canAssign ? '' : 'bulk-assign-bar--dim'}" id="bulkAssignBar">
              <span class="bulk-assign-bar-label">오더 <strong>${bulkSelectedOrderIds.length}</strong>건</span>
              <span class="bulk-assign-bar-arrow" aria-hidden="true">→</span>
              <span class="bulk-assign-bar-label">기사 <strong>${driverBarLabel}</strong></span>
              <button type="button" class="btn btn-primary" id="bulkAssignToDriver" ${canAssign ? '' : 'disabled'}>기사에게 배정</button>
            </div>
            <div class="bulk-setup-exec">
              <p class="bulk-pre-kpi">미배정 <strong>${pool.length}</strong>건 · 기사 배정 <strong>${assignedCount}</strong>건 · 배정 기사 <strong>${assignedDriverCount}</strong>명</p>
              <div class="card-actions bulk-setup-actions">
                <button type="button" class="btn btn-primary" id="runBulkDispatch" ${canRunBulk ? '' : 'disabled'}>일괄 배차 실행</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

      <div class="dispatch-result-pane">
      <div class="card dispatch-result-card" id="bulkResultsCard" style="${bulkDispatchRan ? '' : 'opacity:.6'}">
        <div class="card-hd">
          <h2>결과 — 차량별 방문 순서·미배정</h2>
        </div>
        <div class="card-bd">
          ${bulkDispatchRan ? '' : '<p class="empty-hint" style="padding:0 0 12px">「일괄 배차 실행」 후 차량별 방문 순서·미배정·지도가 표시됩니다.</p>'}
          <div id="bulkResultsBlock" style="${bulkDispatchRan ? '' : 'display:none'}">
            <div class="bulk-summary">
              <span><strong>${res.summary.vehicles}</strong>대 차량</span>
              <span><strong>${res.summary.stops}</strong>건 배송지</span>
              <span><strong style="color:var(--warning)">${res.summary.unassigned}</strong>건 미배정</span>
              <span class="text-muted-hint">혼적 허용 ${bulkAllowMixedLoad ? 'ON' : 'OFF'}</span>
            </div>
            <p class="preview-meta" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
              <span class="field-label" style="margin:0">차량별 혼적</span>
              ${plans.map(p => `<span>${p.plate} ${mixedLoadBadge(!!p.mixed_load)}</span>`).join('')}
            </p>

            <div class="tabs" id="bulkVehicleTabs">
              ${plans.map((p, i) => `
                <button type="button" class="tab ${i === tabIdx ? 'active' : ''}" data-btab="${i}">${p.plate} · ${bd.vehicles[i]?.tonnage || '—'} | ${p.driver} ${p.mixed_load ? '· 혼적' : ''}</button>`).join('')}
            </div>
            <div class="split" style="margin-top:12px">
              <div>
                <h3 style="font-size:13px;margin-bottom:4px">방문 순서 · ${plan?.plate || '—'} · ${bd.vehicles[tabIdx]?.tonnage || ''} · ${plan?.driver || '—'}</h3>
                <p style="font-size:12px;margin-bottom:8px">혼적 여부 ${mixedLoadBadge(!!(plan?.mixed_load))} · ${plan?.mixed_load ? '복수 화주·화물' : '단독배차'}</p>
                <ol class="visit-ol">${(plan?.visits || []).map(visitLi).join('')}</ol>
                <p class="preview-meta"><strong>계획</strong> ${plan?.duration || '—'} · ${plan?.distance || '—'}</p>
              </div>
              <div>
                <div class="map-placeholder map-tall" id="bulkRouteMap" aria-label="배차 경로 지도"></div>
              </div>
            </div>

            <div style="margin-top:20px">
              <p class="field-label">미배정 ${res.unassigned.length}건</p>
              ${tableScrollWrap(`<table>
                <thead><tr>
                  <th>오더번호</th><th>혼적</th><th>화주</th><th>경로</th><th>규격</th><th>시간창</th><th>상태</th><th>사유</th>
                </tr></thead>
                <tbody>
                  ${res.unassigned.map((u, i) => {
                    const n = normalizeDispatchListRow(u, i);
                    return `<tr title="${n.tooltip}">
                      <td>${n.orderId}</td>
                      <td>${mixedLoadBadge(!!u.mixed_load)}</td>
                      <td>${n.shipper}</td>
                      ${routeCellHtml(n.pickup, n.delivery)}
                      <td>${n.tons}</td>
                      <td>${n.window}</td>
                      <td>${statusBadge(n.status)}</td>
                      <td><span class="badge badge-warn">${u.reason}</span></td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>`)}
              <button type="button" class="btn btn-sm" style="margin-top:12px" id="bulkManualReassign">수동으로 미배정 건 재배정</button>
            </div>
          </div>
        </div>
      </div>
      </div>`;

    $('#bulkAllowMixed', root)?.addEventListener('change', (e) => {
      bulkAllowMixedLoad = e.target.checked;
    });
    root.querySelectorAll('.departure-mode button[data-departure]').forEach(btn => {
      btn.onclick = () => {
        const mode = btn.dataset.departure;
        if (mode === bulkDepartureMode) return;
        bulkDepartureMode = mode;
        renderBulkDispatch(root);
      };
    });
    $('#bulkDepotMap', root)?.addEventListener('click', () => {
      const address = $('#bulkDepotName', root)?.value?.trim();
      if (!address) { toast('센터 이름/주소를 입력하세요'); return; }
      apiFetch(`/address/coord?query=${encodeURIComponent(address)}` )
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data?.lat) { toast('주소 좌표를 찾을 수 없습니다'); return; }
          DATA.bulkDispatch.depot = { name: address, lat: data.lat, lon: data.lon, address };
          toast(`센터 위치 설정: ${address}`);
          renderBulkDispatch(root);
        })
        .catch(() => toast('주소 변환 실패'));
    });
    $('#chkAllBulkPool', root)?.addEventListener('change', (e) => {
      const ids = new Set(bulkSelectedOrderIds);
      poolIds.forEach(id => e.target.checked ? ids.add(id) : ids.delete(id));
      bulkSelectedOrderIds = [...ids];
      renderBulkDispatch(root);
    });
    root.querySelectorAll('.bulk-pool-chk').forEach(chk => {
      chk.onchange = (e) => {
        const ids = new Set(bulkSelectedOrderIds);
        e.target.checked ? ids.add(chk.dataset.id) : ids.delete(chk.dataset.id);
        bulkSelectedOrderIds = [...ids];
        renderBulkDispatch(root);
      };
    });
    root.querySelectorAll('.bulk-pool-row').forEach(tr => {
      tr.onclick = (e) => {
        if (e.target.closest('input')) return;
        const id = tr.dataset.bulkOrderId;
        const ids = new Set(bulkSelectedOrderIds);
        ids.has(id) ? ids.delete(id) : ids.add(id);
        bulkSelectedOrderIds = [...ids];
        renderBulkDispatch(root);
      };
    });
    $('#chkAllBulkDrivers', root)?.addEventListener('change', (e) => {
      bulkSelectedDriverIds = e.target.checked ? drivers.map(d => d.id) : [];
      renderBulkDispatch(root);
    });
    root.querySelectorAll('.bulk-driver-chk').forEach(chk => {
      chk.onchange = (e) => {
        const id = Number(chk.dataset.id);
        const ids = new Set(bulkSelectedDriverIds);
        e.target.checked ? ids.add(id) : ids.delete(id);
        bulkSelectedDriverIds = [...ids];
        renderBulkDispatch(root);
      };
    });
    root.querySelectorAll('.bulk-driver-card').forEach(card => {
      card.onclick = (e) => {
        if (e.target.closest('input')) return;
        const id = Number(card.dataset.driverId);
        const ids = new Set(bulkSelectedDriverIds);
        ids.has(id) ? ids.delete(id) : ids.add(id);
        bulkSelectedDriverIds = [...ids];
        renderBulkDispatch(root);
      };
    });
    $('#bulkDriverSearch', root)?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      root.querySelectorAll('.bulk-driver-card').forEach(card => {
        card.style.display = card.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
    $('#bulkAssignToDriver', root)?.addEventListener('click', () => {
      if (!bulkSelectedOrderIds.length || !bulkSelectedDriverIds.length) return;
      const orderIds = [...bulkSelectedOrderIds];
      const driverIds = [...bulkSelectedDriverIds];
      orderIds.forEach((orderId, idx) => {
        const driverId = driverIds[idx % driverIds.length];
        const key = String(driverId);
        if (!bulkOrderAssignments[key]) bulkOrderAssignments[key] = [];
        if (!bulkOrderAssignments[key].includes(orderId)) bulkOrderAssignments[key].push(orderId);
      });
      bulkSelectedOrderIds = [];
      toast(`${orderIds.length}건을 기사 ${driverIds.length}명에게 배정했습니다`);
      renderBulkDispatch(root);
    });
    root.querySelectorAll('.bulk-vehicle-select').forEach(sel => {
      sel.onchange = () => {
        const row = bd.vehicles.find(x => x.id === Number(sel.dataset.bulkRow));
        if (!row) return;
        applyVehicleToFleetRow(row, sel.value);
        const fleetRow = DATA.dispatchFleet.find(f => f.id === row.id);
        if (fleetRow) fleetRow.vehicleId = row.vehicleId;
        const plan = bd.results.plans.find((_, i) => bd.vehicles[i]?.id === row.id);
        if (plan) {
          plan.plate = row.plate;
          const d = driverById(row.driverId);
          if (d) plan.driver = d.name;
        }
        const prev = root.querySelector(`.bulk-vehicle-preview[data-bulk-row="${row.id}"]`);
        if (prev) prev.innerHTML = vehiclePreviewHtml(vehicleById(row.vehicleId));
        toast(`차량 변경: ${row.plate} (기사·상태 유지)`);
      };
    });
    root.querySelectorAll('.bulk-driver-select').forEach(sel => {
      sel.onchange = () => {
        const row = bd.vehicles.find(x => x.id === Number(sel.dataset.bulkRow));
        if (!row) return;
        row.driverId = sel.value || null;
        const fleetRow = DATA.dispatchFleet.find(f => f.id === row.id);
        if (fleetRow) fleetRow.driverId = row.driverId;
        const d = driverById(row.driverId);
        if (d) row.driver = d.name;
        const plan = bd.results.plans.find((_, i) => bd.vehicles[i]?.id === row.id);
        if (plan && d) plan.driver = d.name;
        toast(`기사 연결: ${d?.name || ''} (차량 유지)`);
        if (bulkDispatchRan) renderBulkDispatch(root);
      };
    });
    $('#runBulkDispatch', root).onclick = async () => {
      if (!canRunBulk) { toast('기사별로 오더를 먼저 배정하세요'); return; }
      const tasks = [];
      const skipped = [];
      const assignedOrderIds = [...bulkAssignedOrderIds()];
      assignedOrderIds.forEach(orderId => {
        const stop = bd.stops.find(s => s.id === orderId);
        const ord = DATA.orders.find(o => o.id === stop.id);
        const task = dispatchTaskFromOrder(ord);
        if (!task) { skipped.push(stop.id); return; }
        tasks.push(task);
      });
      if (!tasks.length) { toast('좌표 정보가 있는 배송 건이 없습니다.'); return; }

      const driver_ids = Object.entries(bulkOrderAssignments)
        .filter(([, ids]) => ids?.length)
        .map(([driverId]) => driverId);
      const vehicle_assignments = {};
      driver_ids.forEach(driverId => {
        const vehicle = bulkDriverVehicle(driverId);
        if (vehicle?.id) vehicle_assignments[driverId] = Number(vehicle.id);
      });
      if (!driver_ids.length) { toast('배정된 기사가 없습니다.'); return; }

      const btn = $('#runBulkDispatch', root);
      btn.disabled = true;
      btn.innerHTML = '<span class="loading"></span>배차 중…';
      try {
        const body = { tasks, driver_ids, vehicle_assignments, departure_time: new Date().toISOString() };
        const res = await apiFetch(`/trips/auto-dispatch`, {
          method: 'POST', body: JSON.stringify(body),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          toast(e.detail || '배차 실패');
          btn.disabled = false; btn.textContent = '일괄 배차 실행';
          return;
        }
        const result = await res.json();
        const trips = result.trips || [];
        _bulkDispatchTrips = trips;
        DATA.bulkDispatch.results = {
          summary: { vehicles: trips.length, stops: tasks.length, unassigned: skipped.length + pool.length },
          plans: trips.map(t => {
            const dv = driverById(t.driver_id);
            const vv = vehicleById(t.vehicle_id);
            return {
              plate: vv?.plate || '—', tonnage: vv?.tonnage || '—', driver: dv?.name || '—',
              mixed_load: false,
              visits: (t.waypoints || []).map(w => ({
                kind: '', text: `${w.name} (${w.type === 'loading' ? '상차' : '하차'})`,
              })),
              duration: '—', distance: '—',
            };
          }),
          unassigned: skipped.map(id => ({
            id, reason: '좌표 정보 없음', orderId: id, shipper: '—',
            mixed_load: false, tons: '—', window: '—', status: '접수',
          })),
        };
        bulkDispatchRan = true;
        bulkDispatchTab = 0;
        bulkOrderAssignments = {};
        toast(skipped.length
          ? `배차 완료 · ${trips.length}대 · ${tasks.length}건 (${skipped.length}건 좌표 미확인 제외)`
          : `배차 완료 · ${trips.length}대 · ${tasks.length}건`);
        await loadRealData();
      } catch (err) {
        toast('배차 중 오류가 발생했습니다');
      } finally {
        btn.disabled = false; btn.textContent = '일괄 배차 실행';
        if (document.body.contains(root)) renderBulkDispatch(root);
      }
    };
    root.querySelectorAll('#bulkVehicleTabs .tab').forEach(tab => {
      tab.onclick = () => {
        bulkDispatchTab = Number(tab.dataset.btab);
        renderBulkDispatch(root);
      };
    });
    $('#bulkManualReassign', root)?.addEventListener('click', () => {
      gotoPage('dispatch', 'dispatch-assign');
    });

    // 지도 초기화
    setTimeout(() => {
      if (typeof kakao === 'undefined' || !kakao.maps) return;
      if (bulkDepartureMode === 'depot') {
        const depotEl = document.getElementById('bulkDepotMapPreview');
        if (depotEl) {
          const center = new kakao.maps.LatLng(bd.depot.lat, bd.depot.lon);
          const m = new kakao.maps.Map(depotEl, { center, level: 5 });
          new kakao.maps.Marker({ map: m, position: center });
        }
      }
      if (bulkDispatchRan && _bulkDispatchTrips[bulkDispatchTab]?.waypoints?.length) {
        const routeEl = document.getElementById('bulkRouteMap');
        if (routeEl) {
          const wpts = _bulkDispatchTrips[bulkDispatchTab].waypoints;
          const center = new kakao.maps.LatLng(wpts[0].lat, wpts[0].lon);
          const m = new kakao.maps.Map(routeEl, { center, level: 10 });
          wpts.forEach(w => new kakao.maps.Marker({ map: m, position: new kakao.maps.LatLng(w.lat, w.lon) }));
        }
      }
    }, 0);
  }

  function unassignedForDispatch() {
    const fromOrders = DATA.orders
      .filter(o => o.status === '접수')
      .map(o => ({
        id: o.id,
        pickup: o.pickup,
        delivery: o.delivery,
        shipper: o.customer,
        customer: o.customer,
        cargo: o.cargo || '—',
        tons: o.tons,
        window: o.window,
        contact: o.contact || '—',
        latestAt: o.window || '—',
        source: '오더',
        status: o.status,
        mixed_load: o.mixed_load,
      }));
    return fromOrders;
  }

  function dispatchTaskFromOrder(ord) {
    if (!ord?.pickup_lat || !ord?.pickup_lon || !ord?.lat || !ord?.lon) return null;
    return {
      loadings: [{
        name: ord.pickup || '상차지',
        lat: ord.pickup_lat,
        lon: ord.pickup_lon,
        delivery_id: ord.id,
        recipient_name: ord.recipient || null,
        cargo_type: ord.cargo || null,
        cargo_size: ord.tons || null,
        shipper_name: ord.customer || null,
        contact_phone: normalizePhone(ord.contact) || null,
        shipper_phone: normalizePhone(ord.contact) || null,
      }],
      unloadings: [{
        name: ord.delivery || '하차지',
        lat: ord.lat,
        lon: ord.lon,
        delivery_id: ord.id,
        recipient_name: ord.recipient || null,
        cargo_type: ord.cargo || null,
        cargo_size: ord.tons || null,
        shipper_name: ord.customer || null,
        contact_phone: normalizePhone(ord.contact) || null,
        shipper_phone: normalizePhone(ord.contact) || null,
      }],
    };
  }

  function dispatchVehicleAssignmentsFromRows(rows) {
    const assignments = {};
    const driverIds = [];
    rows.forEach(row => {
      if (!row?.driverId) return;
      driverIds.push(row.driverId);
      if (row.vehicleId) assignments[row.driverId] = Number(row.vehicleId);
    });
    return { driver_ids: driverIds, vehicle_assignments: assignments };
  }

  function applyDispatchTripsResult(trips, skipped = []) {
    _dispatchRunTrips = trips;
    DATA.dispatchPlans = trips.map(t => {
      const dv = driverById(t.driver_id);
      const vv = vehicleById(t.vehicle_id);
      return {
        plate: vv?.plate || '—', tonnage: vv?.tonnage || '—', driver: dv?.name || '—',
        mixed_load: false,
        visits: (t.waypoints || []).map(w => `${w.name} (${w.type === 'loading' ? '상차' : '하차'})`),
        duration: '—', distance: '—',
      };
    });
    DATA.dispatchAssigned = trips.map(t => {
      const dv = driverById(t.driver_id);
      const vv = vehicleById(t.vehicle_id);
      return {
        id: t.id.slice(0, 8), label: `${(t.waypoints || []).length}개 경유지`,
        plate: vv?.plate || '—', tonnage: vv?.tonnage || '—', driver: dv?.name || '—',
      };
    });
    DATA.dispatchUnassigned = skipped.map(id => ({ id, label: '좌표 미확인', reason: '좌표 정보 없음' }));
    dispatchRan = true;
    dispatchPreviewTab = 0;
  }

  function bindRouteCalc(btn, box, list) {
    if (!btn || !box || !list) return;
    btn.onclick = async () => {
      const ord = dispatchPendingSelectedId
        ? DATA.orders.find(o => o.id === dispatchPendingSelectedId) : null;
      if (!ord) { toast('배송 건을 먼저 선택하세요'); return; }
      const v = vehicleById(dispatchManualVehicleId);
      const stops = [];
      if (v?.start_lat != null && v?.start_lon != null) {
        stops.push({ seq: 1, name: `출발 (${v.plate})`, lat: v.start_lat, lon: v.start_lon, role: '출발' });
      }
      if (ord.pickup_lat && ord.pickup_lon) {
        stops.push({ seq: stops.length + 1, name: ord.pickup || '상차지', lat: ord.pickup_lat, lon: ord.pickup_lon, role: '상차' });
      } else if (ord.pickup && ord.pickup !== '—') {
        stops.push({ seq: stops.length + 1, name: ord.pickup, lat: null, lon: null, role: '상차' });
      }
      if (ord.lat && ord.lon) {
        stops.push({ seq: stops.length + 1, name: ord.delivery || '하차지', lat: ord.lat, lon: ord.lon, role: '하차' });
      } else {
        stops.push({ seq: stops.length + 1, name: ord.delivery || '하차지', lat: null, lon: null, role: '하차' });
      }
      btn.disabled = true;
      btn.innerHTML = '<span class="loading"></span>계산 중…';
      box.classList.remove('show');
      try {
        const res = await apiFetch(`/route/preview`, {
          method: 'POST',
          body: JSON.stringify({ stops }),
        });
        const routeData = res.ok ? await res.json() : null;
        btn.disabled = false;
        btn.textContent = '경로 계산';
        const distKm  = routeData ? (routeData.distance_m / 1000).toFixed(1) : null;
        const durMin  = routeData ? Math.round(routeData.duration_sec / 60)  : null;
        list.innerHTML = stops.map((s, i) => {
          const role  = s.role ? ` <span class="badge badge-info">${s.role}</span>` : '';
          const coord = (s.lat && s.lon) ? ` <span class="coord">(${s.lat.toFixed(4)}, ${s.lon.toFixed(4)})</span>` : '';
          const isLast = i === stops.length - 1;
          const summary = (isLast && distKm != null)
            ? ` <span style="color:var(--primary);font-weight:600">총 ${distKm}km · 약 ${durMin}분</span>` : '';
          return `<li>${s.seq}. ${s.name}${role}${coord}${summary}</li>`;
        }).join('');
        // 지도에 경로선 표시
        if (routeData?.polyline?.length > 1 && _dispatchRouteMapInstance) {
          if (_dispatchRoutePolyline) { _dispatchRoutePolyline.setMap(null); _dispatchRoutePolyline = null; }
          const path = routeData.polyline.map(([lat, lon]) => new kakao.maps.LatLng(lat, lon));
          _dispatchRoutePolyline = new kakao.maps.Polyline({
            map: _dispatchRouteMapInstance, path,
            strokeWeight: 4, strokeColor: '#4f67f5', strokeOpacity: 0.85,
          });
        }
        box.classList.add('show');
        toast(distKm != null ? `경로 계산 완료 · ${distKm}km · ${durMin}분` : '경로 미리보기가 준비되었습니다');
      } catch (e) {
        btn.disabled = false;
        btn.textContent = '경로 계산';
        list.innerHTML = stops.map(s => {
          const role  = s.role ? ` <span class="badge badge-info">${s.role}</span>` : '';
          const coord = (s.lat && s.lon) ? ` <span class="coord">(${s.lat.toFixed(4)}, ${s.lon.toFixed(4)})</span>` : '';
          return `<li>${s.seq}. ${s.name}${role}${coord}</li>`;
        }).join('');
        box.classList.add('show');
        toast('경로 계산 실패 · 경유지 목록만 표시합니다', 'error');
      }
    };
  }

  function manualAssignPanelHtml(ids) {
    const drivers = DATA.drivers.filter(d => d.status === '운행가능' || d.status === '운행중');
    return `
      <div class="driver-panel">
        <h3>투입 차량</h3>
        <select id="${ids.vehicle}" style="width:100%;margin-bottom:8px">
          ${vehicleSelectOptions(dispatchManualVehicleId, { allowEmpty: true })}
        </select>
        <div class="vehicle-preview" id="${ids.vehiclePreview}" style="margin-bottom:12px">${vehiclePreviewHtml(vehicleById(dispatchManualVehicleId))}</div>
        <h3>연결 기사</h3>
        <input type="search" class="search" placeholder="기사 검색" style="width:100%;margin-bottom:8px" id="${ids.driverSearch}">
        <div class="driver-list" id="${ids.drivers}">
          ${drivers.map(d => `
            <div class="driver-row ${dispatchManualDriverId === d.id ? 'picked' : ''}" data-id="${d.id}">
              <div><strong>${d.name}</strong><br><span class="text-muted-hint" style="font-size:11px">기본차량 ${driverVehicleLabel(d)}</span></div>
              ${statusBadge(d.status)}
            </div>`).join('')}
        </div>
        <p class="text-muted-hint" style="font-size:11px;margin-top:8px">기사: <span id="${ids.pickedDriver}">없음</span>
          · 차량: <span id="${ids.pickedVehicle}">없음</span></p>
      </div>`;
  }

  function bindManualAssignPanel(root, ids) {
    const vehSel = $(`#${ids.vehicle}`, root);
    const vehPrev = $(`#${ids.vehiclePreview}`, root);
    const refreshVehicle = () => {
      dispatchManualVehicleId = vehSel?.value ? Number(vehSel.value) : null;
      const v = vehicleById(dispatchManualVehicleId);
      if (vehPrev) vehPrev.innerHTML = vehiclePreviewHtml(v);
      const pv = $(`#${ids.pickedVehicle}`, root);
      if (pv) pv.textContent = v ? `${v.plate} · ${v.tonnage}` : '없음';
    };
    if (vehSel) {
      vehSel.onchange = refreshVehicle;
      refreshVehicle();
    }
    root.querySelectorAll(`#${ids.drivers} .driver-row`).forEach(row => {
      row.onclick = () => {
        root.querySelectorAll(`#${ids.drivers} .driver-row`).forEach(r => r.classList.remove('picked'));
        row.classList.add('picked');
        dispatchManualDriverId = row.dataset.id;
        const d = DATA.drivers.find(x => x.id === dispatchManualDriverId);
        const pd = $(`#${ids.pickedDriver}`, root);
        if (pd) pd.textContent = d ? d.name : '없음';
        if (d?.vehicleId && vehSel && !vehSel.value) {
          vehSel.value = String(d.vehicleId);
          refreshVehicle();
        }
      };
    });
    const pickedD = dispatchManualDriverId ? DATA.drivers.find(x => x.id === dispatchManualDriverId) : null;
    const pd = $(`#${ids.pickedDriver}`, root);
    if (pd) pd.textContent = pickedD ? pickedD.name : '없음';
    const search = $(`#${ids.driverSearch}`, root);
    if (search) {
      search.oninput = (e) => {
        const q = e.target.value.toLowerCase();
        root.querySelectorAll(`#${ids.drivers} .driver-row`).forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      };
    }
  }

  function renderDispatchAssign(root) {
    const _allUnassigned = unassignedForDispatch();
    const _passRegion = o => dispatchRegionSel === '전체' || addressToRegion(o.pickup || '') === dispatchRegionSel;
    const _passSite = (() => {
      if (dispatchSiteSel === '전체') return () => true;
      const site = ROUTEON_SITES.find(s => s.place_name === dispatchSiteSel);
      return site ? o => addressToRegion(o.pickup || '') === site.region : () => true;
    })();
    DATA.dispatchOrders = _allUnassigned.filter(_passRegion).filter(_passSite);
    const plans = DATA.dispatchPlans;
    const tabIdx = Math.min(dispatchPreviewTab, plans.length - 1);
    const plan = plans[tabIdx] || plans[0];
    let unassigned = _allUnassigned.filter(_passRegion).filter(_passSite);
    if (dispatchPendingMixedOnly) unassigned = unassigned.filter(o => isMixedLoad(o));
    const visiblePendingIds = new Set(unassigned.map(o => o.id));
    dispatchPendingSelectedIds = dispatchPendingSelectedIds.filter(id => visiblePendingIds.has(id));
    if (dispatchPendingSelectedId && !visiblePendingIds.has(dispatchPendingSelectedId)) dispatchPendingSelectedId = dispatchPendingSelectedIds[0] || null;
    if (!dispatchPendingSelectedId && dispatchPendingSelectedIds.length) dispatchPendingSelectedId = dispatchPendingSelectedIds[0];
    const selectedRows = unassigned.filter(o => dispatchPendingSelectedIds.includes(o.id));
    const selectedPending = unassigned.find(o => o.id === dispatchPendingSelectedId)
      || (dispatchPendingSelectedId ? unassignedForDispatch().find(o => o.id === dispatchPendingSelectedId) : null);
    const hasManualSelection = selectedRows.length > 0;
    const vehicleLabel = dispatchManualVehicleId ? (() => { const v = vehicleById(dispatchManualVehicleId); return v ? `${v.plate} · ${v.tonnage || '—'}` : '선택'; })() : '미선택';
    const driverLabel = dispatchManualDriverId ? (driverById(dispatchManualDriverId)?.name || '선택') : '미선택';
    const assignIds = {
      vehicle: 'dispatchAssignVehicle',
      vehiclePreview: 'dispatchAssignVehiclePreview',
      driverSearch: 'dispatchAssignDriverSearch',
      drivers: 'dispatchAssignDrivers',
      pickedDriver: 'dispatchPickedDriver',
      pickedVehicle: 'dispatchPickedVehicle',
    };

    root.innerHTML = `
      <div class="page-sticky-top">
      ${pageChromeHtml('dispatch-assign', { desc: '미배차 건 선택 · 차량·기사 · 경로 계산 · 배차 결과' })}
      </div>
      <div class="page-body-fill dispatch-two-pane dispatch-two-pane--manual">
      <div class="dispatch-work-pane">

      <div class="card" id="sec-dispatch-pending">
        <div class="card-hd">
          <h2>미배차 건</h2>
          <span style="font-size:12px;color:var(--text-muted)">접수 저장 · 행 클릭 또는 체크로 다중 선택</span>
          <label class="toolbar" style="margin-left:auto;font-size:12px;cursor:pointer;font-weight:normal">
            <input type="checkbox" id="dispatchMixedOnlyFilter" ${dispatchPendingMixedOnly ? 'checked' : ''}> 혼적만
          </label>
        </div>
        <div class="card-bd" style="padding:0">
          ${tableScrollWrap(`<table>
            <thead>
              <tr>
                <th><input type="checkbox" id="chkAllPending" ${unassigned.length && dispatchPendingSelectedIds.length === unassigned.length ? 'checked' : ''} aria-label="전체 선택"></th><th>오더번호</th><th>혼적</th><th>화주</th><th>경로</th><th>규격</th><th>시간창</th><th>상태</th>
              </tr>
            </thead>
            <tbody id="pendingIntakeBody">
              ${unassigned.length ? dispatchListTableRows(
                unassigned.map(o => ({ ...o, status: o.status || '접수', customer: o.shipper })),
                { rowClass: 'pending-row order-row-clickable bulk-pool-row', dataAttr: 'pending-id', checkbox: true, checkboxClass: 'pending-chk', selectedIds: dispatchPendingSelectedIds }
              ) : `
                <tr><td colspan="8" class="empty-hint" style="padding:16px">${dispatchPendingMixedOnly ? '혼적 미배차 건이 없습니다.' : '미배차 건이 없습니다. 접수 창에서 저장하세요.'}</td></tr>`}
            </tbody>
          </table>`)}
          <p class="empty-hint dispatch-table-foot" style="padding:0 16px 12px">${unassigned.length}건 · ${selectedRows.length ? `<strong>${selectedRows.length}</strong>건 선택` : '선택 없음'}</p>
        </div>
      </div>

      <div class="card" id="sec-dispatch-manual" style="${selectedPending ? '' : 'opacity:.7'}">
        <div class="card-hd"><h2>선택 건 배정</h2></div>
        <div class="card-bd">
          ${selectedPending ? `
            <p class="field-label" style="margin-bottom:12px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
              <span><strong>${selectedRows.length}건 선택</strong> · 대표 ${selectedPending.id} · ${placeShortLabel(selectedPending.pickup)} ▶ ${placeShortLabel(selectedPending.delivery)} · ${selectedPending.shipper || selectedPending.customer}</span>
              <span style="font-weight:normal;font-size:12px">혼적 여부 <strong>${mixedLoadLabel(isMixedLoad(selectedPending))}</strong> ${mixedLoadBadge(isMixedLoad(selectedPending))}</span>
              <label style="font-weight:normal;font-size:12px;display:inline-flex;align-items:center;gap:4px;cursor:pointer">
                <input type="checkbox" id="toggleSelectedMixed" ${isMixedLoad(selectedPending) ? 'checked' : ''}> 혼적 (편집)
              </label>
            </p>
            <div class="intake-layout-wrap">
              <div class="intake-main">
                <div class="intake-actions">
                  <button type="button" class="btn" id="calcRouteAssign">경로 계산</button>
                  <button type="button" class="btn btn-primary" id="confirmDispatchAssign" ${hasManualSelection ? '' : 'disabled'}>배정 확정</button>
                </div>
                <div class="route-box" id="routeBoxAssign">
                  <strong>경로 미리보기</strong>
                  <ol class="route-list" id="routeListAssign"></ol>
                  <svg class="route-svg" viewBox="0 0 300 60" preserveAspectRatio="none">
                    <polyline points="10,50 80,30 150,45 220,20 290,35" fill="none" stroke="#c6f135" stroke-width="2" stroke-dasharray="4 2"/>
                    <circle cx="10" cy="50" r="4" fill="#c6f135"/><circle cx="290" cy="35" r="4" fill="#a8d42e"/>
                  </svg>
                </div>
                <div class="map-placeholder map-tall" id="dispatchRouteMap" style="margin-top:12px" aria-label="선택 건 경로 지도"></div>
              </div>
              ${manualAssignPanelHtml(assignIds)}
            </div>` : `
            <p class="empty-hint">위 「미배차 건」에서 건을 선택한 뒤 차량·기사를 지정하고 경로를 계산하세요.</p>`}
          <div class="bulk-setup-footer manual-setup-footer">
            <div class="bulk-assign-bar ${hasManualSelection ? '' : 'bulk-assign-bar--dim'}" id="manualAssignBar">
              <span class="bulk-assign-bar-label">오더 <strong>${selectedRows.length}</strong>건</span>
              <span class="bulk-assign-bar-arrow" aria-hidden="true">→</span>
              <span class="bulk-assign-bar-label">차량 <strong>${vehicleLabel}</strong></span>
              <span class="bulk-assign-bar-label">기사 <strong>${driverLabel}</strong></span>
            </div>
          </div>
        </div>
      </div>

      <details class="dispatch-collapse">
        <summary>다건 배송 건 · 배차 설정</summary>
        <div class="dispatch-collapse-bd">
      <div class="card" id="sec-dispatch-orders">
        <div class="card-hd">
          <h2>배송 건 (다건 배차)</h2>
          <button type="button" class="btn btn-sm" id="addDispatchOrder">+ 건 추가</button>
        </div>
        <div class="card-bd" style="padding:0">
          ${tableScrollWrap(`<table>
            <thead>
              <tr>
                <th><input type="checkbox" id="chkAllDispatch" checked aria-label="전체 선택"></th>
                <th>오더번호</th><th>혼적</th><th>화주</th><th>경로</th><th>규격</th><th>시간창</th><th>상태</th>
              </tr>
            </thead>
            <tbody>
              ${dispatchListTableRows(
                DATA.dispatchOrders.map(o => ({ ...o, order_id: o.id, status: '배차대기', window: o.latestAt })),
                { checkbox: true, checkboxClass: 'dispatch-chk', rowClass: 'order-row-clickable' }
              )}
            </tbody>
          </table>`)}
        </div>
      </div>

      <div class="card" id="sec-dispatch-fleet">
        <div class="card-hd">
          <h2>배차 설정 · 차량·기사</h2>
          <button type="button" class="btn btn-primary" id="runDispatch">배차 실행</button>
        </div>
        <div class="card-bd">
          <div class="toolbar" style="margin-bottom:16px">
            <label>배차 일자</label><input type="date" id="dispatchDate" value="${new Date().toISOString().slice(0, 10)}">
            <label>권역</label>
            <select id="dispatchRegionFilter">${odRegionSelectHtml(dispatchRegionSel)}</select>
            <label>거점</label>
            <select id="dispatchSiteFilter"><option value="전체"${dispatchSiteSel === '전체' ? ' selected' : ''}>전체</option>${ROUTEON_SITES.map(s => `<option value="${s.place_name}"${s.place_name === dispatchSiteSel ? ' selected' : ''}>${s.place_name} (${s.region})</option>`).join('')}</select>
          </div>
          <ul class="checklist" id="fleetChecklist">
            ${DATA.dispatchFleet.map(f => {
              const v = vehicleById(f.vehicleId);
              const dr = driverById(f.driverId);
              return `
              <li class="${f.available ? '' : 'unavail'}" data-fleet-id="${f.id}">
                <input type="checkbox" id="fleet-${f.id}" ${f.available ? 'checked' : ''} ${f.available ? '' : 'disabled'}>
                <label for="fleet-${f.id}">
                  <div class="vehicle-bind-row">
                    <span style="font-size:11px;color:var(--text-muted);min-width:36px">차량</span>
                    <select class="fleet-vehicle-select" data-fleet-id="${f.id}" ${f.available ? '' : 'disabled'}>
                      ${vehicleSelectOptions(f.vehicleId)}
                    </select>
                    ${v ? statusBadge(v.status === '운행중' ? '운행중(차량)' : v.status) : ''}
                  </div>
                  <div class="vehicle-preview fleet-vehicle-preview" data-fleet-id="${f.id}">${vehiclePreviewHtml(v)}</div>
                  <div class="vehicle-bind-row" style="margin-top:8px">
                    <span style="font-size:11px;color:var(--text-muted);min-width:36px">기사</span>
                    <select class="fleet-driver-select" data-fleet-id="${f.id}" ${f.available ? '' : 'disabled'}>
                      ${driverSelectOptions(f.driverId)}
                    </select>
                    ${dr ? statusBadge(dr.status) : ''}
                  </div>
                  <small>${f.available ? '차량·기사 각각 선택' : (f.note || '가용 불가')}</small>
                </label>
              </li>`;
            }).join('')}
          </ul>
        </div>
      </div>
        </div>
      </details>

      </div>
      <div class="dispatch-result-pane">
      <div class="card dispatch-result-card" id="sec-dispatch-preview" style="${dispatchRan ? '' : 'opacity:.65'}">
        <div class="card-hd">
          <h2>배차 결과</h2>
          <div class="toolbar">
            <button type="button" class="btn btn-sm" id="manualReassign" ${dispatchRan ? '' : 'disabled'}>수동 재배정</button>
            <button type="button" class="btn btn-sm" id="singleDispatch" ${dispatchRan ? '' : 'disabled'}>단건 배차</button>
          </div>
        </div>
        <div class="card-bd">
          ${dispatchRan ? '' : '<p class="empty-hint" style="padding:0 0 12px">「배차 실행」 후 방문 순서·지도·배정 현황이 표시됩니다.</p>'}
          <div id="previewBlock" style="${dispatchRan ? '' : 'display:none'}">
            <div class="tabs" id="vehicleTabs">
              ${plans.map((p, i) => `
                <button type="button" class="tab ${i === tabIdx ? 'active' : ''}" data-vtab="${i}">${p.plate} · ${p.tonnage} | ${p.driver}${p.mixed_load ? ' · 혼적' : ''}</button>`).join('')}
            </div>
            <div class="split" style="margin-top:12px">
              <div>
                <p class="field-label" style="display:flex;align-items:center;gap:8px">방문 순서 ${mixedLoadBadge(!!(plan?.mixed_load))}</p>
                <ol class="visit-ol">${(plan?.visits || []).map(v => `<li>${v}</li>`).join('')}</ol>
                <p class="preview-meta"><strong>계획</strong> ${plan?.duration || '—'} · ${plan?.distance || '—'}</p>
              </div>
              <div>
                <div class="map-placeholder map-tall" aria-label="배차 경로 지도"></div>
              </div>
            </div>
            <div class="assign-cols" style="margin-top:20px">
              <div>
                <div class="assign-col-hd">배정 완료 ${DATA.dispatchAssigned.length}건</div>
                <ul class="route-list">
                  ${DATA.dispatchAssigned.map(a => `<li>${a.id} ${a.label}<br>
                    → <strong>${a.plate}</strong> · ${a.tonnage} · ${a.driver}</li>`).join('')}
                </ul>
              </div>
              <div>
                <div class="assign-col-hd">미배정 ${DATA.dispatchUnassigned.length}건</div>
                <ul class="route-list">
                  ${DATA.dispatchUnassigned.map(u => `<li>${u.id} ${u.label}<br><small style="color:var(--text-muted)">${u.reason}</small></li>`).join('')}
                </ul>
              </div>
            </div>
            <div class="card-actions" style="margin-top:16px">
              <button type="button" class="btn btn-primary" id="btnTripCreate">Trip 생성</button>
              <button type="button" class="btn" id="btnFinalCheck">순서 확인</button>
              <button type="button" class="btn btn-primary" id="btnAppHandoff">앱 조회 상태</button>
            </div>
          </div>
        </div>
      </div>
      </div>
      </div>`;


    const pickPending = (id) => {
      dispatchPendingSelectedId = id;
      if (!dispatchPendingSelectedIds.includes(id)) dispatchPendingSelectedIds = [id];
      renderDispatchAssign(root);
    };
    root.querySelectorAll('.pending-row').forEach(tr => {
      tr.onclick = (e) => {
        if (e.target.tagName === 'INPUT') return;
        const id = tr.dataset.pendingId;
        const ids = new Set(dispatchPendingSelectedIds);
        ids.has(id) ? ids.delete(id) : ids.add(id);
        dispatchPendingSelectedIds = [...ids];
        dispatchPendingSelectedId = dispatchPendingSelectedIds.includes(id) ? id : (dispatchPendingSelectedIds[0] || null);
        renderDispatchAssign(root);
      };
    });
    $('#chkAllPending', root)?.addEventListener('change', (e) => {
      dispatchPendingSelectedIds = e.target.checked ? unassigned.map(o => o.id) : [];
      dispatchPendingSelectedId = dispatchPendingSelectedIds[0] || null;
      renderDispatchAssign(root);
    });
    root.querySelectorAll('.pending-chk').forEach(chk => {
      chk.onchange = (e) => {
        const ids = new Set(dispatchPendingSelectedIds);
        e.target.checked ? ids.add(chk.dataset.id) : ids.delete(chk.dataset.id);
        dispatchPendingSelectedIds = [...ids];
        dispatchPendingSelectedId = e.target.checked ? chk.dataset.id : (dispatchPendingSelectedIds[0] || null);
        renderDispatchAssign(root);
      };
    });
    $('#dispatchMixedOnlyFilter', root)?.addEventListener('change', (e) => {
      dispatchPendingMixedOnly = e.target.checked;
      renderDispatchAssign(root);
    });
    $('#dispatchRegionFilter', root)?.addEventListener('change', e => {
      dispatchRegionSel = e.target.value;
      renderDispatchAssign(root);
    });
    $('#dispatchSiteFilter', root)?.addEventListener('change', e => {
      dispatchSiteSel = e.target.value;
      renderDispatchAssign(root);
    });

    if (selectedPending) {
      $('#toggleSelectedMixed', root)?.addEventListener('change', (e) => {
        const val = e.target.checked;
        selectedPending.mixed_load = val;
        const ord = DATA.orders.find(o => o.id === selectedPending.id);
        if (ord) ord.mixed_load = val;
        const pi = pendingIntakes.find(p => p.id === selectedPending.id);
        if (pi) pi.mixed_load = val;
        renderDispatchAssign(root);
      });
      bindManualAssignPanel(root, assignIds);
      bindRouteCalc($('#calcRouteAssign', root), $('#routeBoxAssign', root), $('#routeListAssign', root));
      $('#confirmDispatchAssign', root).onclick = async () => {
        if (!dispatchManualVehicleId) {
          toast('투입 차량을 선택하세요');
          return;
        }
        if (!dispatchManualDriverId) {
          toast('기사를 선택하세요');
          return;
        }
        const v = vehicleById(dispatchManualVehicleId);
        const d = driverById(dispatchManualDriverId);
        const selectedIds = [...dispatchPendingSelectedIds];
        const selectedOrders = selectedIds.map(id => DATA.orders.find(o => o.id === id)).filter(Boolean);
        const capacityMessage = capacityViolationMessage(v, selectedOrders);
        if (capacityMessage) {
          toast(capacityMessage, 'error');
          return;
        }
        const tasks = [];
        const skipped = [];
        selectedIds.forEach(ordId => {
          const ord = DATA.orders.find(o => o.id === ordId);
          const task = dispatchTaskFromOrder(ord);
          task ? tasks.push(task) : skipped.push(ordId);
        });
        if (!tasks.length) {
          toast('상차지·하차지 좌표가 필요합니다. 오더를 수정해 좌표를 저장하세요');
          return;
        }
        const res = await apiFetch(`/trips/auto-dispatch`, {
          method: 'POST',
          body: JSON.stringify({
            tasks,
            driver_ids: [dispatchManualDriverId],
            vehicle_assignments: { [dispatchManualDriverId]: Number(dispatchManualVehicleId) },
            departure_time: new Date().toISOString(),
          }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          toast(e.detail || '배차 실패');
          return;
        }
        const result = await res.json();
        const trips = result.trips || [];
        applyDispatchTripsResult(trips, skipped);
        selectedIds.forEach(ordId => {
          const ord = DATA.orders.find(o => o.id === ordId);
          if (!ord) return;
          ord.status = '운행중';
          ord.driver = d?.name || '—';
        });
        selectedIds.forEach(ordId => {
          const idx = pendingIntakes.findIndex(p => p.id === ordId);
          if (idx >= 0) pendingIntakes.splice(idx, 1);
        });
        toast(`Trip 생성 완료 · ${tasks.length}건 · ${v?.plate || ''} ${d ? '· ' + d.name : ''}`);
        dispatchPendingSelectedId = null;
        dispatchPendingSelectedIds = [];
        _lastManualAssign = null;
        await loadRealData();
      };
    }

    const chkAll = $('#chkAllDispatch', root);
    if (chkAll) {
      chkAll.onchange = () => {
        root.querySelectorAll('.dispatch-chk').forEach(c => { c.checked = chkAll.checked; });
      };
    }
    $('#addDispatchOrder', root).onclick = () => {
      openModal('배송 건 추가', `
        <form>
          <div class="form-grid" style="max-width:100%">
            <label>상차지 주소 *</label><input id="addOrdPickup" required placeholder="상차지 주소">
            <label>하차지 주소 *</label><input id="addOrdDelivery" required placeholder="하차지 주소">
            <label>화주</label><input id="addOrdShipper" placeholder="화주명">
            <label>화물 종류</label><select id="addOrdCargo">${cargoTypeOptionsHtml()}</select>
            <label>규격</label><input id="addOrdSize" placeholder="예: 5톤, 3파레트">
            <label>희망 도착</label>
            <div>${desiredArrivalFieldsHtml({ dateName: 'dispatch_latest_at_date', hourName: 'dispatch_latest_at_hour', hint: true })}</div>
          </div>
        </form>`, async () => {
          const pickup = document.getElementById('addOrdPickup')?.value?.trim();
          const delivery = document.getElementById('addOrdDelivery')?.value?.trim();
          if (!pickup || !delivery) { toast('상차지·하차지 주소를 입력하세요'); return false; }
          const dateEl = document.querySelector('[name="dispatch_latest_at_date"]');
          const hourEl = document.querySelector('[name="dispatch_latest_at_hour"]');
          const deadline = (dateEl?.value && hourEl?.value) ? `${dateEl.value} ${hourEl.value}:00` : null;
          try {
            const [coordPu, coordDl] = await Promise.all([
              apiFetch(`/address/coord?query=${encodeURIComponent(pickup)}` ).then(r => r.ok ? r.json() : null),
              apiFetch(`/address/coord?query=${encodeURIComponent(delivery)}` ).then(r => r.ok ? r.json() : null),
            ]);
            const body = {
              address: delivery, lat: coordDl?.lat || null, lon: coordDl?.lon || null,
              pickup_address: pickup, pickup_lat: coordPu?.lat || null, pickup_lon: coordPu?.lon || null,
              shipper_name: document.getElementById('addOrdShipper')?.value?.trim() || null,
              contact_phone: null,
              shipper_phone: null,
              cargo_type: document.getElementById('addOrdCargo')?.value?.trim() || null,
              cargo_size: document.getElementById('addOrdSize')?.value?.trim() || null,
              deadline,
            };
            const res = await apiFetch(`/deliveries`, {
              method: 'POST', body: JSON.stringify(body),
            });
            if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '등록 실패'); return false; }
            toast('배송 건이 추가되었습니다');
            await loadRealData();
            renderDispatchAssign(root);
          } catch (_e) { toast('오류가 발생했습니다'); return false; }
        });
    };
    $('#runDispatch', root).onclick = async () => {
      const checked = root.querySelectorAll('#fleetChecklist input:checked:not(:disabled)');
      if (!checked.length) { toast('투입 차량을 1대 이상 선택하세요'); return; }

      const checkedOrderIds = Array.from(root.querySelectorAll('.dispatch-chk:checked'))
        .map(chk => chk.dataset.id).filter(Boolean);
      if (!checkedOrderIds.length) { toast('배차할 배송 건을 선택하세요'); return; }

      const tasks = [];
      const skipped = [];
      const _siteForRun = dispatchSiteSel !== '전체' ? ROUTEON_SITES.find(s => s.place_name === dispatchSiteSel) : null;
      checkedOrderIds.forEach(ordId => {
        const ord = DATA.orders.find(o => o.id === ordId);
        if (dispatchRegionSel !== '전체' && addressToRegion(ord.pickup || '') !== dispatchRegionSel) return;
        if (_siteForRun && addressToRegion(ord.pickup || '') !== _siteForRun.region) return;
        const task = dispatchTaskFromOrder(ord);
        if (!task) { skipped.push(ordId); return; }
        tasks.push(task);
      });
      if (!tasks.length) { toast('좌표 정보가 있는 배송 건이 없습니다.'); return; }

      const selectedRows = [];
      checked.forEach(chk => {
        const li = chk.closest('li[data-fleet-id]');
        const row = DATA.dispatchFleet.find(f => f.id === Number(li?.dataset.fleetId));
        if (row?.driverId) selectedRows.push(row);
      });
      const { driver_ids, vehicle_assignments } = dispatchVehicleAssignmentsFromRows(selectedRows);
      if (!driver_ids.length) { toast('선택된 차량에 기사가 없습니다.'); return; }
      const selectedOrdersForCapacity = checkedOrderIds.map(id => DATA.orders.find(o => o.id === id)).filter(Boolean);
      const selectedVehiclesForCapacity = selectedRows.map(row => vehicleById(row.vehicleId)).filter(Boolean);
      const capacityMessage = fleetCapacityViolationMessage(selectedVehiclesForCapacity, selectedOrdersForCapacity);
      if (capacityMessage) { toast(capacityMessage, 'error'); return; }

      const btn = $('#runDispatch', root);
      btn.disabled = true; btn.innerHTML = '<span class="loading"></span>배차 중…';
      try {
        const body = { tasks, driver_ids, vehicle_assignments, departure_time: new Date().toISOString() };
        const res = await apiFetch(`/trips/auto-dispatch`, {
          method: 'POST', body: JSON.stringify(body),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          toast(e.detail || '배차 실패');
          btn.disabled = false; btn.textContent = '배차 실행';
          return;
        }
        const result = await res.json();
        const trips = result.trips || [];
        applyDispatchTripsResult(trips, skipped);
        toast(skipped.length
          ? `배차 완료 · ${trips.length}대 (${skipped.length}건 제외)`
          : `배차 완료 · ${trips.length}대 · ${tasks.length}건`);
        await loadRealData();
      } catch (err) {
        toast('배차 중 오류가 발생했습니다');
      } finally {
        btn.disabled = false; btn.textContent = '배차 실행';
        if (document.body.contains(root)) renderDispatchAssign(root);
      }
    };
    root.querySelectorAll('.fleet-vehicle-select').forEach(sel => {
      sel.onchange = () => {
        const row = DATA.dispatchFleet.find(x => x.id === Number(sel.dataset.fleetId));
        if (!row) return;
        applyVehicleToFleetRow(row, sel.value);
        const planIdx = DATA.dispatchFleet.findIndex(x => x.id === row.id);
        syncDispatchPlanFromFleet(row, DATA.dispatchPlans[planIdx]);
        const prev = root.querySelector(`.fleet-vehicle-preview[data-fleet-id="${row.id}"]`);
        if (prev) prev.innerHTML = vehiclePreviewHtml(vehicleById(row.vehicleId));
        toast(`차량 변경: ${vehicleById(row.vehicleId)?.plate || ''} (기사 상태 유지)`);
        if (dispatchRan) renderDispatchAssign(root);
      };
    });
    root.querySelectorAll('.fleet-driver-select').forEach(sel => {
      sel.onchange = () => {
        const row = DATA.dispatchFleet.find(x => x.id === Number(sel.dataset.fleetId));
        if (!row) return;
        row.driverId = sel.value || null;
        syncDispatchPlanFromFleet(row, DATA.dispatchPlans[DATA.dispatchFleet.findIndex(x => x.id === row.id)]);
        toast(`기사 연결 변경: ${driverById(row.driverId)?.name || ''} (차량 유지)`);
        if (dispatchRan) renderDispatchAssign(root);
      };
    });
    root.querySelectorAll('#vehicleTabs .tab').forEach(tab => {
      tab.onclick = () => {
        dispatchPreviewTab = Number(tab.dataset.vtab);
        renderDispatchAssign(root);
      };
    });
    $('#manualReassign', root).onclick = () => {
      const unassignedCount = DATA.dispatchUnassigned?.length || 0;
      if (!unassignedCount) { toast('재배정할 미배정 건이 없습니다'); return; }
      const pendingSec = document.getElementById('sec-dispatch-pending');
      if (pendingSec) pendingSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast(`${unassignedCount}건 미배정 — 미배차 건 목록에서 선택 후 배정하세요`);
    };
    $('#singleDispatch', root).onclick = () => {
      const unassigned = unassignedForDispatch();
      openModal('단건 배차 — 차량·기사', `
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">배송 건에 투입 <strong>차량</strong>과 <strong>기사</strong>를 각각 지정합니다.</p>
        <div class="form-grid" style="max-width:100%">
          <label>배송 건</label>
          <select id="singleOrder"><option value="">— 선택 —</option>${unassigned.map(o => `<option value="${o.id}">${displayOrderNo(o)} · ${placeShortLabel(o.pickup)} ▶ ${placeShortLabel(o.delivery)}</option>`).join('')}</select>
          <label>투입 차량 *</label>
          <select id="singleVehicle">${vehicleSelectOptions(DATA.dispatchFleet[0]?.vehicleId)}</select>
          <label>연결 기사 *</label>
          <select id="singleDriver">${driverSelectOptions(DATA.dispatchFleet[0]?.driverId, { allowEmpty: true })}</select>
        </div>
        <div class="vehicle-preview" id="singleVehiclePreview" style="margin-top:12px"></div>
      `, async () => {
        const ordId = document.getElementById('singleOrder')?.value;
        const vehicleId = document.getElementById('singleVehicle')?.value;
        const driverId = document.getElementById('singleDriver')?.value;
        if (!ordId) { toast('배송 건을 선택하세요'); return false; }
        if (!vehicleId) { toast('차량을 선택하세요'); return false; }
        if (!driverId) { toast('기사를 선택하세요'); return false; }
        const ord = DATA.orders.find(o => o.id === ordId);
        const capacityMessage = capacityViolationMessage(vehicleById(vehicleId), [ord]);
        if (capacityMessage) { toast(capacityMessage, 'error'); return false; }
        const task = dispatchTaskFromOrder(ord);
        if (!task) { toast('상차지·하차지 좌표가 필요합니다', 'error'); return false; }
        const res = await apiFetch(`/trips/auto-dispatch`, {
          method: 'POST',
          body: JSON.stringify({
            tasks: [task],
            driver_ids: [driverId],
            vehicle_assignments: { [driverId]: Number(vehicleId) },
            departure_time: new Date().toISOString(),
          }),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '배정 실패'); return false; }
        const result = await res.json();
        applyDispatchTripsResult(result.trips || []);
        const dv = driverById(driverId);
        toast(`Trip 생성 완료 · ${dv?.name || ''}`);
        await loadRealData();
      });
      const vSel = document.getElementById('singleVehicle');
      const prev = document.getElementById('singleVehiclePreview');
      const refresh = () => { if (prev) prev.innerHTML = vehiclePreviewHtml(vehicleById(vSel?.value)); };
      if (vSel) { vSel.onchange = refresh; refresh(); }
    };
    $('#btnTripCreate', root).onclick = async () => {
      if (_dispatchRunTrips.length > 0) {
        toast(`Trip ${_dispatchRunTrips.length}건 생성 완료 · 운행 현황에서 확인하세요`);
        return;
      }
      if (!_lastManualAssign) {
        toast('먼저 배차를 실행하세요');
        return;
      }
      const { driverId, vehicleId, order } = _lastManualAssign;
      if (!driverId || !vehicleId) { toast('차량·기사 정보가 없습니다. 다시 배차해주세요', 'error'); return; }
      const waypoints = [];
      const orderWaypointMeta = {
        delivery_id: order?.id || null,
        recipient_name: order?.recipient || null,
        cargo_type: order?.cargo || null,
        cargo_size: order?.tons || null,
        shipper_name: order?.customer || null,
        contact_phone: normalizePhone(order?.contact) || null,
        shipper_phone: normalizePhone(order?.contact) || null,
      };
      if (order?.pickup_lat && order?.pickup_lon) {
        waypoints.push({ name: order.pickup || '상차지', lat: order.pickup_lat, lon: order.pickup_lon, type: 'loading', ...orderWaypointMeta });
      }
      let destName = null, destLat = null, destLon = null;
      if (order?.lat && order?.lon) {
        if (waypoints.length) {
          destName = order.delivery || null; destLat = order.lat; destLon = order.lon;
        } else {
          waypoints.push({ name: order.delivery || '하차지', lat: order.lat, lon: order.lon, type: 'unloading', ...orderWaypointMeta });
        }
      }
      if (!waypoints.length) { toast('경유지 좌표가 없습니다. 오더에 좌표를 입력하세요', 'error'); return; }
      const body = {
        driver_id: driverId, vehicle_id: vehicleId,
        dest_name: destName, dest_lat: destLat, dest_lon: destLon,
        waypoints,
        departure_time: new Date().toISOString(),
      };
      const btn = $('#btnTripCreate', root);
      btn.disabled = true; btn.textContent = '생성 중…';
      const res = await apiFetch(`/trips`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      btn.disabled = false; btn.textContent = 'Trip 생성';
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || 'Trip 생성 실패', 'error'); return; }
      const trip = await res.json();
      _lastManualAssign = null;
      toast(`Trip 생성 완료 · ${trip.id.slice(0, 8)}`);
      await loadRealData();
      renderPage();
    };
    $('#btnFinalCheck', root).onclick = () => {
      openModalLarge('순서·노드 최종 확인', `
        <p style="font-size:13px;margin-bottom:12px">차량별 방문 순서와 지도 노드를 확인합니다.</p>
        <ol class="visit-ol">${((plans[tabIdx] || plans[0])?.visits || []).map(v => `<li>${v}</li>`).join('')}</ol>`, () => toast('최종 확인 완료'));
    };
    $('#btnAppHandoff', root).onclick = () => {
      const assigned = DATA.dispatchAssigned;
      if (!assigned.length) { toast('배차 결과가 없습니다. 먼저 배차를 실행하세요'); return; }
      openModal('기사 앱 조회 가능', `
        <p style="font-size:13px;margin-bottom:12px">아래 Trip은 서버에 생성되어 기사 앱의 운행 목록에서 조회 가능합니다.<br>별도 푸시 알림은 전송하지 않으며, 기사가 앱에서 <strong>경로 최적화</strong>를 실행하면 운행이 시작됩니다.</p>
        <ul class="route-list">
          ${assigned.map(a => `<li><strong>${a.driver}</strong> · ${a.plate} (${a.tonnage})<br><small style="color:var(--text-muted)">${a.label}</small></li>`).join('')}
        </ul>`);
    };

    // 지도 초기화
    setTimeout(() => {
      if (typeof kakao === 'undefined' || !kakao.maps) return;
      if (selectedPending) {
        const routeEl = document.getElementById('dispatchRouteMap');
        if (routeEl) {
          const ord = DATA.orders.find(o => o.id === selectedPending.id);
          if (ord?.pickup_lat && ord?.lat) {
            const center = new kakao.maps.LatLng(
              (ord.pickup_lat + ord.lat) / 2,
              (ord.pickup_lon + ord.lon) / 2,
            );
            const m = new kakao.maps.Map(routeEl, { center, level: 10 });
            _dispatchRouteMapInstance = m;
            _dispatchRoutePolyline = null;
            new kakao.maps.Marker({ map: m, position: new kakao.maps.LatLng(ord.pickup_lat, ord.pickup_lon) });
            new kakao.maps.Marker({ map: m, position: new kakao.maps.LatLng(ord.lat, ord.lon) });
          }
        }
      }
      if (dispatchRan && _dispatchRunTrips[dispatchPreviewTab]?.waypoints?.length) {
        const resultMapEl = root.querySelector('#sec-dispatch-preview .map-placeholder');
        if (resultMapEl) {
          const wpts = _dispatchRunTrips[dispatchPreviewTab].waypoints;
          const center = new kakao.maps.LatLng(wpts[0].lat, wpts[0].lon);
          const m = new kakao.maps.Map(resultMapEl, { center, level: 10 });
          wpts.forEach(w => new kakao.maps.Marker({ map: m, position: new kakao.maps.LatLng(w.lat, w.lon) }));
        }
      }
    }, 0);
  }

  function renderTripStats(root) {
    const s = DATA.statsSummary;
    const periodChips = ['일', '주', '월'];
    const tripSelected = selectedTripId ? DATA.statsTrips.find(x => x.id === selectedTripId) : null;
    const tripListCard = `
      <div class="card card-fill">
        <div class="card-hd"><h2>Trip 목록</h2><span style="font-size:12px;color:var(--text-muted)">행 클릭 → 우측 상세</span></div>
        <div class="card-bd" style="padding:0;display:flex;flex-direction:column;min-height:0">
          ${tableScrollWrap(`<table id="tripStatsTable">
            <thead><tr><th>Trip</th><th>기사</th><th>일자</th><th>상태</th><th>안전</th></tr></thead>
            <tbody>
              ${DATA.statsTrips.map(t => `
                <tr class="trip-row${selectedTripId === t.id ? ' selected' : ''}" data-trip="${t.id}">
                  <td>${t.id}</td><td>${t.driver}</td><td>${t.date}</td>
                  <td>${statusBadge(t.status)}${tripExtraBadgesHtml(t)}</td>
                  <td>${t.safety === '주의' ? '<span class="badge badge-warn">주의</span>' : t.safety === '적합' ? '<span class="badge badge-ok">적합</span>' : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>`)}
        </div>
      </div>`;
    root.innerHTML = `
      <div class="page-sticky-top">
      ${pageChromeHtml('trip-stats', { desc: '운행 이후 — 완료 Trip 사후 통계·리포트' })}
      <div class="info-banner" style="margin-bottom:8px">관제 통계 — 계획 vs 실제 미노출 (팀 합의)</div>

      <div class="filter-bar card" style="padding:8px 12px;margin-bottom:0">
        <span style="font-weight:600;font-size:13px">기간</span>
        <div class="chips" id="statsPeriodChips">
          ${periodChips.map(p => `<button type="button" class="chip ${statsPeriod === p ? 'active' : ''}" data-p="${p}">${p}</button>`).join('')}
        </div>
        <label>기사</label><select id="statsDriver"><option value="">전체</option>${DATA.drivers.map(d => `<option>${d.name}</option>`).join('')}</select>
        <label>차량</label><select id="statsVehicle"><option value="">전체</option>${DATA.vehicleStats.map(v => `<option>${v.plate}</option>`).join('')}</select>
        <label>권역</label><select id="statsRegionFilter">${odRegionSelectHtml('전체')}</select>
        <button type="button" class="btn btn-sm btn-primary" id="statsApply">조회</button>
      </div>
      </div>
      <div class="page-scroll-main">

      <div class="stat-grid-6">
        <div class="stat-card compact"><div class="num">${s.completed}</div><div class="lbl">완료 Trip</div></div>
        <div class="stat-card compact"><div class="num">${s.inProgress}</div><div class="lbl">진행 중</div></div>
        <div class="stat-card compact"><div class="num">${s.cancelled}</div><div class="lbl">취소</div></div>
        <div class="stat-card compact"><div class="num">${s.incomplete}</div><div class="lbl">미완료</div></div>
        <div class="stat-card compact"><div class="num">${s.assignedOk}</div><div class="lbl">배정 완료</div></div>
        <div class="stat-card compact"><div class="num">${s.assignedPending}</div><div class="lbl">미배정</div></div>
      </div>
      <div class="stat-card compact" style="margin-bottom:16px;max-width:240px">
        <div class="num" style="color:var(--warning)">${s.safetyIssues}</div>
        <div class="lbl">안전 이슈 Trip (주의 수준 포함)</div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-hd"><h2>일별 운행 현황</h2></div>
        <div class="card-bd">
          <div id="byDayChart"><p style="text-align:center;color:var(--text-muted);padding:24px">조회 버튼을 눌러 그래프를 불러오세요</p></div>
        </div>
      </div>

      <details class="dispatch-collapse" open>
        <summary>기사·차량 실적 · 궤적 지도</summary>
        <div class="dispatch-collapse-bd">
      <div class="card">
        <div class="card-hd"><h2>기사별 실적</h2></div>
        <div class="card-bd" style="padding:0">
          ${tableScrollWrap(`<table>
            <thead>
              <tr>
                <th>기사</th><th>완료 Trip</th><th>운행시간 합</th><th>운행시간 평균</th>
                <th>거리 합</th><th>거리 평균</th><th>운행 일수</th>
              </tr>
            </thead>
            <tbody>
              ${DATA.driverStats.map(d => `
                <tr class="trip-row" data-driver="${d.name}">
                  <td>${d.name}</td><td>${d.trips}</td><td>${d.hoursSum}</td><td>${d.hoursAvg}</td>
                  <td>${d.distSum}</td><td>${d.distAvg}</td><td>${d.days}</td>
                </tr>`).join('')}
            </tbody>
          </table>`)}
        </div>
      </div>

      <div class="card">
        <div class="card-hd"><h2>차량별 실적</h2></div>
        <div class="card-bd" style="padding:0">
          ${tableScrollWrap(`<table>
            <thead><tr><th>차량</th><th>담당 기사</th><th>완료 Trip</th><th>운행시간 합</th><th>거리 합</th></tr></thead>
            <tbody>
              ${DATA.vehicleStats.map(v => `
                <tr><td>${v.plate}</td><td>${v.driver}</td><td>${v.trips}</td><td>${v.hoursSum}</td><td>${v.distSum}</td></tr>`).join('')}
            </tbody>
          </table>`)}
        </div>
      </div>

      <div class="card">
        <div class="card-hd"><h2>Trip 궤적 (지도)</h2></div>
        <div class="card-bd">
          <p class="page-desc" style="margin-bottom:8px">기사별 실적 행 클릭 → 해당 기사의 GPS 궤적 표시</p>
          <div id="tripTrajectoryMap" style="width:100%;height:320px;background:var(--bg-card);border-radius:8px;overflow:hidden"></div>
        </div>
      </div>
        </div>
      </details>

      ${masterDetailShell('', tripListCard, tripSelected ? inlineDetailCardHtml(`Trip ${tripSelected.id}`, tripDetailBodyHtml(tripSelected), { saveLabel: '닫기' }) : '')}

      <details class="dev-collapse">
        <summary>개발용 숨김 (내부·감사 — 관제 미노출)</summary>
        <div class="dev-hidden">
          계획 vs 실제 소요·거리 · 주행/휴게 상세 비교 · 재경로 횟수 · 휴게소 방문 횟수 — API·DB 집계만 사용, UI 미노출.
        </div>
      </details>
      </div>`;

    root.querySelectorAll('#statsPeriodChips .chip').forEach(chip => {
      chip.onclick = () => { statsPeriod = chip.dataset.p; renderTripStats(root); };
    });
    $('#statsApply', root).onclick = async () => {
      const periodMap = { '일': 'today', '주': 'week', '월': 'month' };
      const period = periodMap[statsPeriod] || 'week';
      const driverName = $('#statsDriver', root)?.value || '';
      const vehiclePlate = $('#statsVehicle', root)?.value || '';
      const regionFilter = $('#statsRegionFilter', root)?.value || '전체';
      const driver = driverName ? DATA.drivers.find(d => d.name === driverName) : null;
      const vehicle = vehiclePlate ? DATA.vehicles.find(v => v.plate === vehiclePlate) : null;
      const params = new URLSearchParams({ period });
      if (driver) params.set('driver_id', driver.driverId || driver.id);
      if (vehicle) params.set('vehicle_id', vehicle.id);
      const res = await apiFetch(`/stats/by-day?${params}`);
      if (!res.ok) { toast('조회 실패'); return; }
      const rows = await res.json();
      const filterLabel = [driverName, vehiclePlate, regionFilter !== '전체' ? regionFilter : ''].filter(Boolean).join(' · ');
      renderByDayChart($('#byDayChart', root), rows, `${statsPeriod}간 일별 운행 현황${filterLabel ? ` · ${filterLabel}` : ''}`);
    };
    root.querySelectorAll('tbody .trip-row[data-trip]').forEach(tr => {
      tr.onclick = () => selectTrip(tr.dataset.trip);
    });
    root.querySelectorAll('tbody .trip-row[data-driver]').forEach(tr => {
      tr.onclick = async () => {
        const driverName = tr.dataset.driver;
        const driver = DATA.drivers.find(d => d.name === driverName);
        if (!driver) { toast('기사 정보를 찾을 수 없습니다'); return; }
        const periodMap = { '일': 'today', '주': 'week', '월': 'month' };
        const period = periodMap[statsPeriod] || 'week';
        const res = await apiFetch(`/stats/route-history?driver_id=${driver.id}&period=${period}`);
        if (!res.ok) { toast('궤적 조회 실패'); return; }
        const coords = await res.json();
        if (!coords.length) { toast(`${driverName} 궤적 데이터 없음`); return; }
        showRouteOnTrajectoryMap($('#tripTrajectoryMap', root), coords, driverName);
      };
    });
    if (tripSelected) {
      $('#inlineDetailBack', root).onclick = () => { selectedTripId = null; renderPage(); };
      $('#inlineDetailSave', root).onclick = () => { selectedTripId = null; renderPage(); };
      bindHandoverActions(root, tripSelected);
      const tripMapEl = root.querySelector('#tripRouteMapCanvas');
      if (tripMapEl) showTripRoutePolyline(tripMapEl, tripSelected.id);
    }

    // 탭 진입 시 기본 기간(주)으로 차트 자동 로드
    setTimeout(() => $('#statsApply', root)?.click(), 0);
  }

  function renderByDayChart(el, rows, title) {
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:24px">데이터 없음</p>';
      return;
    }
    const max = Math.max(...rows.map(r => r.count), 1);
    const W = 600, H = 160, padL = 24, padR = 8, padB = 36, padT = 16;
    const n = rows.length;
    const step = (W - padL - padR) / n;
    const barW = Math.max(4, Math.min(28, step - 6));
    const bars = rows.map((r, i) => {
      const x = padL + i * step + (step - barW) / 2;
      const bh = Math.max(2, (r.count / max) * (H - padT - padB));
      const y = padT + (H - padT - padB) - bh;
      const label = r.date.slice(5);
      return `
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${bh.toFixed(1)}" fill="var(--primary,#4f7cff)" rx="2"/>
        <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="currentColor">${r.count}</text>
        <text x="${(x + barW / 2).toFixed(1)}" y="${(H - 6).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--text-muted,#888)"
          transform="rotate(-40,${(x + barW / 2).toFixed(1)},${(H - 6).toFixed(1)})">${label}</text>`;
    }).join('');
    el.innerHTML = `
      <p style="font-size:12px;font-weight:600;margin-bottom:4px">${escapeHtml(title || '일별 운행')}</p>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-height:${H}px;overflow:visible">${bars}</svg>`;
  }

  function showRouteOnTrajectoryMap(el, coords, driverName) {
    if (!el || !coords.length) return;
    if (!map) { el.innerHTML = '<p style="padding:24px;color:var(--text-muted)">지도가 초기화되지 않았습니다</p>'; return; }
    if (_trajectoryPolyline) { _trajectoryPolyline.setMap(null); _trajectoryPolyline = null; }
    const path = coords.map(c => new kakao.maps.LatLng(c.lat, c.lon));
    _trajectoryPolyline = new kakao.maps.Polyline({
      path,
      strokeWeight: 3,
      strokeColor: '#4f7cff',
      strokeOpacity: 0.9,
      strokeStyle: 'solid',
      map,
    });
    const bounds = new kakao.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    map.setBounds(bounds);
    const container = document.getElementById('map-container');
    if (container) {
      el.innerHTML = '';
      container.style.display = 'block';
      container.style.position = 'relative';
      container.style.width = '100%';
      container.style.height = '320px';
      el.appendChild(container);
      kakao.maps.event.trigger(map, 'resize');
      map.setBounds(bounds);
    }
    toast(`${driverName} 궤적 표시 (${coords.length}개 포인트)`);
  }

  async function showTripRoutePolyline(el, tripId) {
    if (!el || !window.kakao?.maps) return;
    if (_tripRoutePolyline) { _tripRoutePolyline.setMap(null); _tripRoutePolyline = null; }
    _tripRouteMapInstance = null;
    el.innerHTML = '';
    _tripRouteMapInstance = new kakao.maps.Map(el, {
      center: new kakao.maps.LatLng(36.5, 127.5),
      level: 10,
    });
    kakao.maps.event.trigger(_tripRouteMapInstance, 'resize');

    const res = await apiFetch(`/trips/${tripId}/polyline`);
    if (!res.ok) {
      el.innerHTML = '<p style="padding:24px;text-align:center;color:var(--text-muted)">경로 데이터 없음 (최적화 전)</p>';
      return;
    }
    const data = await res.json();
    if (!data.polyline?.length) {
      el.innerHTML = '<p style="padding:24px;text-align:center;color:var(--text-muted)">경로 좌표 없음</p>';
      return;
    }

    const path = data.polyline.map(p => new kakao.maps.LatLng(p.lat, p.lon));
    _tripRoutePolyline = new kakao.maps.Polyline({
      path,
      strokeWeight: 4,
      strokeColor: '#4f7cff',
      strokeOpacity: 0.9,
      strokeStyle: 'solid',
      map: _tripRouteMapInstance,
    });

    const bounds = new kakao.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    _tripRouteMapInstance.setBounds(bounds);

    const nodeIcon = { origin: '🏁', destination: '🏴', waypoint: '📦', rest_stop: '☕' };
    (data.nodes || []).forEach(n => {
      const icon = nodeIcon[n.type] || '📍';
      new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(n.lat, n.lon),
        content: `<div style="background:#fff;border:1px solid #ccc;border-radius:4px;padding:2px 6px;font-size:11px;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis">${icon} ${n.name}</div>`,
        yAnchor: 1.5,
        map: _tripRouteMapInstance,
      });
    });
  }

  function intakePlaceInput(name, value, required, tabindex) {
    return `
      <div class="place-search-wrap">
        <input type="text" class="place-search intake-field" name="${name}" ${required ? 'required' : ''} placeholder="장소 검색…" value="${value}" tabindex="${tabindex}" data-intake-field="${name}">
        <button type="button" class="place-clear" data-clear="${name}" aria-label="지우기" tabindex="-1">&times;</button>
      </div>`;
  }

  function bindPlaceSearch(root) {
    if (!window.kakao?.maps?.services) return;
    const ps = new kakao.maps.services.Places();
    root.querySelectorAll('input.place-search').forEach(inp => {
      if (inp.dataset.placeBound === '1') return;
      inp.dataset.placeBound = '1';
      let dropdown = null;
      let debounce = null;

      inp.addEventListener('input', () => {
        clearTimeout(debounce);
        const q = inp.value.trim();
        if (!q || q.length < 2) { removeDrop(); return; }
        debounce = setTimeout(() => {
          ps.keywordSearch(q, (data, status) => {
            removeDrop();
            if (status !== kakao.maps.services.Status.OK || !data.length) return;
            // 중복 place_name 제거 후 실제 장소명(주소와 다른 것) 우선 정렬
            const seen = new Set();
            const filtered = data
              .filter(p => { if (seen.has(p.place_name)) return false; seen.add(p.place_name); return true; })
              .sort((a, b) => {
                const aAddr = a.place_name === a.road_address_name || a.place_name === a.address_name;
                const bAddr = b.place_name === b.road_address_name || b.place_name === b.address_name;
                return (aAddr ? 1 : 0) - (bAddr ? 1 : 0);
              });
            showDrop(filtered.slice(0, 7));
          });
        }, 300);
      });

      inp.addEventListener('blur', () => setTimeout(removeDrop, 200));
      inp.addEventListener('keydown', (e) => {
        if (!dropdown) return;
        const items = dropdown.querySelectorAll('.place-suggestion');
        const current = dropdown.querySelector('.place-suggestion.active');
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = current ? current.nextElementSibling : items[0];
          if (next) setActive(next);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = current ? current.previousElementSibling : items[items.length - 1];
          if (prev) setActive(prev);
        } else if (e.key === 'Enter') {
          const active = dropdown.querySelector('.place-suggestion.active');
          if (active) { e.preventDefault(); active.click(); }
        } else if (e.key === 'Escape') {
          removeDrop();
        }
      });

      function setActive(item) {
        if (!dropdown) return;
        dropdown.querySelectorAll('.place-suggestion').forEach(x => {
          x.classList.remove('active');
          x.style.background = 'transparent';
        });
        item.classList.add('active');
        item.style.background = 'var(--t-card-hover,#252a35)';
        item.scrollIntoView({ block: 'nearest' });
      }

      function showDrop(places) {
        dropdown = document.createElement('div');
        dropdown.className = 'place-autocomplete-drop';
        dropdown.style.cssText = 'position:absolute;left:0;right:0;top:100%;z-index:9999;background:var(--dark-card,#1c2029);border:1px solid var(--dark-border,rgba(255,255,255,.08));border-radius:0 0 6px 6px;box-shadow:0 4px 16px rgba(0,0,0,.45);max-height:240px;overflow-y:auto';
        places.forEach(p => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'place-suggestion';
          item.style.cssText = 'display:block;width:100%;text-align:left;padding:7px 12px;font-size:13px;border:none;border-bottom:1px solid var(--dark-border,rgba(255,255,255,.08));background:transparent;cursor:pointer;line-height:1.4;color:var(--t-text-muted,#8b93a7)';
          const cat = p.category_group_name ? `<span style="font-size:10px;margin-left:5px;font-weight:500;color:var(--t-text-muted,#8b93a7)">${escapeHtml(p.category_group_name)}</span>` : '';
          item.innerHTML = `<strong style="font-size:13px;font-weight:600;color:var(--t-text-muted,#8b93a7)">${escapeHtml(p.place_name)}</strong>${cat}<br><span style="font-size:11px;color:var(--t-text-muted,#8b93a7)">${escapeHtml(p.road_address_name || p.address_name || '')}</span>`;
          item.onmouseover = () => setActive(item);
          item.onmouseout  = () => { item.classList.remove('active'); item.style.background = 'transparent'; };
          item.onclick = () => {
            inp.value = inp.dataset.placeValue === 'address'
              ? (p.road_address_name || p.address_name || p.place_name)
              : p.place_name;
            inp.dataset.lat = p.y;
            inp.dataset.lon = p.x;
            inp.dataset.placeName = p.place_name;
            inp.dataset.address = p.road_address_name || p.address_name || '';
            removeDrop();
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          };
          dropdown.appendChild(item);
        });
        const wrap = inp.closest('.place-search-wrap') || inp.parentElement;
        wrap.style.position = 'relative';
        wrap.appendChild(dropdown);
      }

      function removeDrop() { dropdown?.remove(); dropdown = null; }
    });
  }

  function pendingIntakeCustomerCell(name) {
    const nm = name || '—';
    const c = DATA.customers.find(x => x.name === nm);
    const short = nm.length > 8 ? `${nm.slice(0, 8)}…` : nm;
    const badge = c && isTemporaryCustomer(c) ? ' <span class="badge badge-temp" style="font-size:9px;padding:1px 5px">당일</span>' : '';
    return `${short}${badge}`;
  }

  function pendingIntakeTableHtml(items) {
    if (!items.length) {
      return `<div class="pending-scroll"><p class="pending-intake-empty" id="pendingIntakeEmpty">Enter로 대기열에 추가</p></div>`;
    }
    return `<div class="pending-scroll"><table id="pendingIntakeTable">
      <thead><tr><th>#</th><th>혼적</th><th>상차</th><th>하차</th><th>화주</th><th></th></tr></thead>
      <tbody>${items.map((r, i) => `
        <tr data-pid="${r._pid}">
          <td>${i + 1}</td>
          <td>${mixedLoadBadge(isMixedLoad(r))}</td>
          <td title="${r.pickup || ''}">${(r.pickup || '—').slice(0, 10)}${(r.pickup || '').length > 10 ? '…' : ''}</td>
          <td title="${r.delivery || ''}">${(r.delivery || '—').slice(0, 10)}${(r.delivery || '').length > 10 ? '…' : ''}</td>
          <td>${pendingIntakeCustomerCell(r.customer)}</td>
          <td class="pending-actions">
            <button type="button" class="btn-icon" data-pending-edit="${r._pid}">수정</button>
            <button type="button" class="btn-icon danger" data-pending-del="${r._pid}">삭제</button>
          </td>
        </tr>`).join('')}
      </tbody></table></div>`;
  }

  function openPendingIntakeEditModal(root, idx) {
    const row = root._pendingIntakes[idx];
    if (!row) return;
    const custId = DATA.customers.find(c => c.name === row.customer)?.id;
    openModal(`대기 접수 수정 #${idx + 1}`, `
      <form id="pendingEditForm">
        <div class="form-grid" style="max-width:100%">
          <label>화주</label><select name="customer">${intakeCustomerSelectOptions(custId)}</select>
          <label>상차지 *</label><input name="pickup" required value="${row.pickup || ''}">
          <label>하차지 *</label><input name="delivery" required value="${row.delivery || ''}">
          <label>수신자</label><input name="recipient" value="${row.recipient || ''}">
          <label>화물 종류</label>${cargoTypeSelectHtml('cargo', row.cargo || '')}
          <label>규격</label><input name="tons" value="${row.tons || ''}" placeholder="예: 5톤, 3파레트">
          <label>연락처</label><input name="contact" value="${row.contact || ''}">
          <label>희망 도착</label>
          <div>${desiredArrivalFieldsHtml({ value: row.latestAt || '', dateName: 'pending_latest_at_date', hourName: 'pending_latest_at_hour', hint: true })}</div>
          <label>혼적 여부</label>
          <div>${intakeMixedLoadRadioHtml('intake-mixed-edit', isMixedLoad(row))}</div>
        </div>
      </form>`, () => {
      const form = $('#pendingEditForm');
      if (!form) return;
      row.customer = customerNameFromIntakeValue(form.querySelector('[name="customer"]').value);
      row.pickup = form.querySelector('[name="pickup"]').value.trim();
      row.delivery = form.querySelector('[name="delivery"]').value.trim();
      row.recipient = form.querySelector('[name="recipient"]').value.trim();
      row.cargo = form.querySelector('[name="cargo"]').value.trim();
      row.tons = form.querySelector('[name="tons"]').value.trim();
      row.contact = normalizePhone(form.querySelector('[name="contact"]').value);
      row.latestAt = readDesiredArrival(form, 'pending_latest_at_date', 'pending_latest_at_hour');
      const mixedChecked = form.querySelector('input[name="intake-mixed-edit"]:checked');
      row.mixed_load = mixedChecked ? mixedChecked.value === '1' : false;
      renderPendingIntakePanel(root);
      bindPendingIntakeActions(root);
      toast('대기 접수가 수정되었습니다');
    });
    const form = $('#pendingEditForm');
    const sel = form?.querySelector('[name="customer"]');
    if (sel) bindIntakeCustomerSelect(form, sel);
  }

  function bindPendingIntakeActions(root) {
    root.querySelectorAll('[data-pending-edit]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const pid = btn.dataset.pendingEdit;
        const idx = (root._pendingIntakes || []).findIndex(r => r._pid === pid);
        if (idx >= 0) openPendingIntakeEditModal(root, idx);
      };
    });
    root.querySelectorAll('[data-pending-del]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const pid = btn.dataset.pendingDel;
        const arr = root._pendingIntakes || [];
        const idx = arr.findIndex(r => r._pid === pid);
        if (idx < 0) return;
        arr.splice(idx, 1);
        renderPendingIntakePanel(root);
        bindPendingIntakeActions(root);
        toast('대기 접수를 삭제했습니다');
      };
    });
  }

  function openOrderEditModal(o, listRoot) {
    const custOpts = DATA.customers.map(c =>
      `<option value="${c.name}" ${c.name === o.customer ? 'selected' : ''}>${c.name}</option>`
    ).join('');
    const editableStatusByCurrent = {
      '접수': ['접수', '운행중', '취소'],
      '운행중': ['운행중', '완료', '취소'],
    };
    const statusChoices = editableStatusByCurrent[o.status] || [o.status];
    const statusOpts = statusChoices.map(s =>
      `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`
    ).join('');
    // 완료·취소 상태는 조회 전용, 나머지는 상태 변경 가능 (접수 상태만 필드 전체 수정)
    const canSave = o.status !== '완료' && o.status !== '취소';
    const ro = orderIsEditable(o) ? '' : ' disabled';
    openModal(`${canSave ? '오더 수정' : '오더 조회'} · ${displayOrderNo(o)}`, `
      <form id="orderEditForm">
        <div class="form-grid" style="max-width:100%">
          <label>오더번호</label><input value="${displayOrderNo(o)}" title="${o.id}" disabled>
          <label>화주(고객) *</label><select name="customer" required${ro}>${custOpts}</select>
          <label>상차지 *</label><input name="pickup" required value="${o.pickup || ''}"${ro}>
          <label>하차지 *</label><input name="delivery" required value="${o.delivery || ''}"${ro}>
          <label>수신자</label><input name="recipient" value="${o.recipient || ''}"${ro}>
          <label>화물 종류</label>${cargoTypeSelectHtml('cargo', o.cargo || '', ro)}
          <label>규격</label><input name="tons" value="${o.tons || ''}" placeholder="예: 5톤, 3파레트"${ro}>
          <label>연락처</label><input name="contact" value="${o.contact || ''}"${ro}>
          <label>희망 도착</label>
          <div>${desiredArrivalFieldsHtml({ value: o.window === '—' ? '' : (o.window || ''), dateName: 'order_latest_at_date', hourName: 'order_latest_at_hour', disabled: !!ro, hint: true })}</div>
          <label>상태</label><select name="status"${canSave ? '' : ' disabled'}>${statusOpts}</select>
          <label>기사</label><input value="${o.driver || '—'}" disabled>
        </div>
        ${!orderIsEditable(o) ? `<p class="text-muted-hint" style="font-size:12px;margin-top:10px">${canSave ? '상태만 변경 가능합니다. 주소·화물 수정은 접수 상태에서만 가능합니다.' : '조회 전용입니다.'}</p>` : ''}
      </form>`, async () => {
      const form = $('#orderEditForm');
      if (!form) return;
      if (canSave) {
        const statusKoMap = { '접수': 'pending', '운행중': 'in_progress', '완료': 'done', '취소': 'cancelled' };
        const selectedStatus = form.querySelector('[name="status"]')?.value;
        const body = { status: statusKoMap[selectedStatus] || undefined };
        if (orderIsEditable(o)) {
          const pickup = form.querySelector('[name="pickup"]').value.trim();
          const delivery = form.querySelector('[name="delivery"]').value.trim();
          const recipient = form.querySelector('[name="recipient"]').value.trim();
          const cargo = form.querySelector('[name="cargo"]').value.trim();
          const tonsStr = form.querySelector('[name="tons"]').value.trim();
          const contact = normalizePhone(form.querySelector('[name="contact"]').value);
          const customer = form.querySelector('[name="customer"]').value;
          const latest = readDesiredArrival(form, 'order_latest_at_date', 'order_latest_at_hour');
          // 주소 변경 시 좌표 재조회
          const [coordPu, coordDl] = await Promise.all([
            pickup ? apiFetch(`/address/coord?query=${encodeURIComponent(pickup)}` ).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
            delivery ? apiFetch(`/address/coord?query=${encodeURIComponent(delivery)}` ).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
          ]);
          Object.assign(body, {
            address: delivery || undefined,
            lat: coordDl?.lat ?? null,
            lon: coordDl?.lon ?? null,
            pickup_address: pickup || undefined,
            pickup_lat: coordPu?.lat ?? null,
            pickup_lon: coordPu?.lon ?? null,
            recipient_name: recipient || undefined,
            cargo_type: cargo || undefined,
            cargo_size: tonsStr || undefined,
            contact_name: contact || undefined,
            contact_phone: normalizePhone(contact) || undefined,
            shipper_phone: normalizePhone(contact) || undefined,
            shipper_name: customer || undefined,
            deadline: latest ? latest.replace('T', ' ').slice(0, 16) : undefined,
          });
          o.customer = customer; o.pickup = pickup; o.delivery = delivery;
          o.recipient = recipient; o.cargo = cargo; o.tons = tonsStr; o.contact = contact;
          o.window = latest ? formatIntakeWindow(latest) : '—';
        }
        const res = await apiFetch(`/deliveries/${o.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '저장 실패', 'error'); return; }
        const updated = await res.json();
        o.lat = updated.lat; o.lon = updated.lon;
        o.pickup_lat = updated.pickup_lat; o.pickup_lon = updated.pickup_lon;
        if (updated.status) {
          const deliveryStatusMap = { pending: '접수', in_progress: '운행중', done: '완료', done_manual: '완료', cancelled: '취소', scheduled: '배차' };
          o.status = deliveryStatusMap[updated.status] || updated.status;
        }
        toast('오더가 수정되었습니다');
      } else {
        toast('조회 완료');
      }
      renderOrderList(listRoot);
    });
    const ft = $('#modalBox').querySelector('.modal-ft');
    if (orderCanCancel(o)) {
      const cancelBtn = el('button', 'btn');
      cancelBtn.type = 'button';
      cancelBtn.textContent = '접수 취소';
      cancelBtn.style.marginRight = 'auto';
      cancelBtn.onclick = async () => {
        const res = await apiFetch(`/deliveries/${o.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'cancelled' }),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '취소 처리 실패', 'error'); return; }
        o.status = '취소';
        closeModal();
        toast('오더가 취소 처리되었습니다');
        renderOrderList(listRoot);
      };
      ft.insertBefore(cancelBtn, ft.firstChild);
    }
    if (orderCanDelete(o)) {
      const delBtn = el('button', 'btn btn-danger-outline');
      delBtn.type = 'button';
      delBtn.textContent = '삭제';
      delBtn.onclick = async () => {
        const res = await apiFetch(`/deliveries/${o.id}`, {
          method: 'DELETE',
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '삭제 실패', 'error'); return; }
        const i = DATA.orders.findIndex(x => x.id === o.id);
        if (i >= 0) DATA.orders.splice(i, 1);
        closeModal();
        toast('오더가 삭제되었습니다');
        renderOrderList(listRoot);
      };
      ft.insertBefore(delBtn, ft.firstChild);
    }
  }

  function getIntakeFields(root) {
    return [...root.querySelectorAll('.intake-field')].filter(el => !el.disabled && el.offsetParent !== null);
  }

  function getIntakeFieldsForTask(root, taskNum) {
    const card = root.querySelector(`[data-task="${taskNum}"]`);
    if (!card) return [];
    return [...card.querySelectorAll('.intake-field')].filter(el => !el.disabled && el.offsetParent !== null);
  }

  function readIntakeField(form, name) {
    const el = form.querySelector(`[name="${name}"]`);
    return el ? el.value.trim() : '';
  }

  function readIntakeMixedLoad(form, taskNum) {
    const checked = form.querySelector(`input[name="intake-mixed-${taskNum}"]:checked`);
    return checked ? checked.value === '1' : false;
  }

  function intakeMixedLoadRadioHtml(groupName, mixed, tabindex) {
    const isMixed = !!mixed;
    const tab = tabindex != null ? ` tabindex="${tabindex}"` : '';
    return `
      <div class="radio-group" role="radiogroup" aria-label="혼적 여부">
        <label class="radio-label">
          <input type="radio" class="intake-field" name="${groupName}" value="0"${!isMixed ? ' checked' : ''}${tab} data-intake-field="${groupName}">
          <span>단독</span>
        </label>
        <label class="radio-label">
          <input type="radio" class="intake-field" name="${groupName}" value="1"${isMixed ? ' checked' : ''} data-intake-field="${groupName}">
          <span>혼적</span>
        </label>
      </div>
      <span class="text-muted-hint intake-mixed-hint">복수 화주·화물 동일 차량 적재</span>`;
  }

  function suggestIntakeMixedLoadFromRecipients(root) {
    const form = $('#intakeForm', root);
    if (!form) return;
    const byTask = [];
    root.querySelectorAll('[data-task]').forEach(card => {
      const tn = Number(card.dataset.task);
      const r = readIntakeField(form, `recipient_${tn}`);
      if (r) byTask.push({ tn, r });
    });
    if (byTask.length < 2 || new Set(byTask.map(x => x.r)).size < 2) return;
    let changed = false;
    byTask.forEach(({ tn }) => {
      const solo = form.querySelector(`input[name="intake-mixed-${tn}"][value="0"]`);
      const mixedRadio = form.querySelector(`input[name="intake-mixed-${tn}"][value="1"]`);
      if (solo?.checked && mixedRadio) {
        mixedRadio.checked = true;
        changed = true;
      }
    });
    if (changed) toast('복수 수신자 감지 · 혼적 제안');
  }

  function collectIntakeRow(form, taskNum) {
    const custVal = taskNum === 1 ? readIntakeField(form, 'customer') : '';
    const puEl  = form.querySelector(`[name="pickup_${taskNum}"]`);
    const delEl = form.querySelector(`[name="delivery_${taskNum}"]`);
    return {
      pickup:      puEl  ? puEl.value.trim()  : '',
      pickup_lat:  puEl?.dataset.lat  ? parseFloat(puEl.dataset.lat)  : null,
      pickup_lon:  puEl?.dataset.lon  ? parseFloat(puEl.dataset.lon)  : null,
      delivery:    delEl ? delEl.value.trim() : '',
      lat:         delEl?.dataset.lat ? parseFloat(delEl.dataset.lat) : null,
      lon:         delEl?.dataset.lon ? parseFloat(delEl.dataset.lon) : null,
      recipient:   readIntakeField(form, `recipient_${taskNum}`),
      cargo:       readIntakeField(form, `cargo_${taskNum}`),
      tons:        readIntakeField(form, `tons_${taskNum}`),
      customer:    taskNum === 1 ? customerNameFromIntakeValue(custVal) : '',
      latestAt:    taskNum === 1 ? readDesiredArrival(form) : '',
      contact:     taskNum === 1 ? readIntakeField(form, 'contact') : '',
      mixed_load:  readIntakeMixedLoad(form, taskNum),
    };
  }

  function collectIntakeRows(root, form, taskNum) {
    const base = {
      customer: taskNum === 1 ? customerNameFromIntakeValue(readIntakeField(form, 'customer')) : '',
      latestAt: taskNum === 1 ? readDesiredArrival(form) : '',
      contact: taskNum === 1 ? readIntakeField(form, 'contact') : '',
      mixed_load: readIntakeMixedLoad(form, taskNum),
    };
    const card = root.querySelector(`[data-task="${taskNum}"]`);
    const puMainEl = form.querySelector(`[name="pickup_${taskNum}"]`);
    const pickups = [{
      value: puMainEl ? puMainEl.value.trim() : '',
      lat:   puMainEl?.dataset.lat ? parseFloat(puMainEl.dataset.lat) : null,
      lon:   puMainEl?.dataset.lon ? parseFloat(puMainEl.dataset.lon) : null,
      cargo: readIntakeField(form, `pickup_cargo_${taskNum}`),
      tons:  readIntakeField(form, `pickup_tons_${taskNum}`),
    }];
    if (card) card.querySelectorAll('[data-extra-pickup]').forEach(row => {
      const el = form.querySelector(`[name="pickup_${taskNum}_extra_${row.dataset.extraPickup}"]`);
      const v = el ? el.value.trim() : '';
      const s = row.dataset.extraPickup;
      if (v) pickups.push({
        value: v,
        lat: el?.dataset.lat ? parseFloat(el.dataset.lat) : null,
        lon: el?.dataset.lon ? parseFloat(el.dataset.lon) : null,
        cargo: readIntakeField(form, `pickup_cargo_${taskNum}_extra_${s}`),
        tons: readIntakeField(form, `pickup_tons_${taskNum}_extra_${s}`),
      });
    });
    const delMainEl = form.querySelector(`[name="delivery_${taskNum}"]`);
    const deliveries = [{
      delivery:  delMainEl ? delMainEl.value.trim() : '',
      lat:       delMainEl?.dataset.lat ? parseFloat(delMainEl.dataset.lat) : null,
      lon:       delMainEl?.dataset.lon ? parseFloat(delMainEl.dataset.lon) : null,
      recipient: readIntakeField(form, `recipient_${taskNum}`),
      cargo:     readIntakeField(form, `cargo_${taskNum}`),
      tons:      readIntakeField(form, `tons_${taskNum}`),
    }];
    if (card) card.querySelectorAll('[data-extra-delivery]').forEach(row => {
      const s = row.dataset.extraDelivery;
      const delEl = form.querySelector(`[name="delivery_${taskNum}_extra_${s}"]`);
      deliveries.push({
        delivery:  delEl ? delEl.value.trim() : '',
        lat:       delEl?.dataset.lat ? parseFloat(delEl.dataset.lat) : null,
        lon:       delEl?.dataset.lon ? parseFloat(delEl.dataset.lon) : null,
        recipient: readIntakeField(form, `recipient_${taskNum}_extra_${s}`),
        cargo:     readIntakeField(form, `cargo_${taskNum}_extra_${s}`),
        tons:      readIntakeField(form, `tons_${taskNum}_extra_${s}`),
      });
    });
    const count = Math.max(pickups.length, deliveries.length);
    return Array.from({ length: count }, (_, i) => {
      const pu = pickups[Math.min(i, pickups.length - 1)];
      const dl = deliveries[Math.min(i, deliveries.length - 1)];
      return {
        ...base,
        pickup:     pu.value,
        pickup_lat: pu.lat,
        pickup_lon: pu.lon,
        delivery:   dl.delivery,
        lat:        dl.lat,
        lon:        dl.lon,
        recipient:  dl.recipient,
        cargo:      dl.cargo || pu.cargo,
        tons:       dl.tons || pu.tons,
      };
    });
  }

  function clearIntakeRow(form, taskNum) {
    [`pickup_${taskNum}`, `pickup_cargo_${taskNum}`, `pickup_tons_${taskNum}`, `delivery_${taskNum}`, `recipient_${taskNum}`, `cargo_${taskNum}`, `tons_${taskNum}`].forEach(name => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el) {
        el.value = '';
        delete el.dataset.lat;
        delete el.dataset.lon;
      }
    });
    if (taskNum === 1) {
      ['latest_at_date', 'latest_at_hour'].forEach(name => {
        const el = form.querySelector(`[name="${name}"]`);
        if (el) el.value = '';
      });
    }
    const solo = form.querySelector(`input[name="intake-mixed-${taskNum}"][value="0"]`);
    if (solo) solo.checked = true;
  }

  function renderPendingIntakePanel(root) {
    const wrap = $('#pendingIntakePanel', root);
    if (!wrap) return;
    const items = root._pendingIntakes || [];
    wrap.innerHTML = `
      <h4>접수 대기열 <span class="text-muted-hint">(${items.length})</span></h4>
      ${pendingIntakeTableHtml(items)}`;
    bindPendingIntakeActions(root);
  }

  function validateIntakeRow(form, taskNum) {
    let ok = true;
    [`pickup_${taskNum}`, `delivery_${taskNum}`].forEach(name => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el && !el.value.trim()) {
        el.classList.add('invalid');
        ok = false;
      } else if (el) {
        el.classList.remove('invalid');
      }
    });
    if (taskNum === 1) {
      const cust = form.querySelector('[name="customer"]');
      const bad = !cust?.value?.trim() || cust.value === '__add_temp__';
      if (cust && bad) {
        cust.classList.add('invalid');
        ok = false;
      } else if (cust) {
        cust.classList.remove('invalid');
      }
    }
    return ok;
  }

  function addPendingIntake(root, row) {
    root._pendingIntakes = root._pendingIntakes || [];
    row._pid = row._pid || `pi-${++pendingIntakeSeq}`;
    root._pendingIntakes.push(row);
    renderPendingIntakePanel(root);
    return root._pendingIntakes.length;
  }

  function commitIntakeRow(root, taskNum) {
    const form = $('#intakeForm', root);
    if (!form) return false;
    if (!validateIntakeRow(form, taskNum)) {
      toast('필수 항목을 입력하세요');
      return false;
    }
    const rows = collectIntakeRows(root, form, taskNum);
    if (!rows.length || (!rows[0].pickup && !rows[0].delivery)) return false;
    rows.forEach(row => addPendingIntake(root, row));
    clearIntakeRow(form, taskNum);
    const card = root.querySelector(`[data-task="${taskNum}"]`);
    if (card) {
      card.querySelectorAll('.extra-stop-row').forEach(el => el.remove());
      card._pickupExtraSeq = 0;
      card._deliveryExtraSeq = 0;
    }
    const nextFields = getIntakeFieldsForTask(root, taskNum);
    if (nextFields[0]) nextFields[0].focus();
    toast(`접수 ${root._pendingIntakes.length}건 추가됨`);
    return true;
  }

  function getActiveIntakeTaskNum(root) {
    const active = document.activeElement;
    const card = active?.closest?.('[data-task]');
    if (card && root.contains(card)) return Number(card.dataset.task) || 1;
    return 1;
  }

  function getOrderIntakeRoot() {
    if (currentPage !== 'order-intake') return null;
    const form = document.querySelector('#intakeForm');
    return form ? form.closest('.page-viewport-inner') : null;
  }

  function addIntakePickupStop(root, taskNum) {
    const card = root.querySelector(`[data-task="${taskNum}"]`);
    if (!card) return;
    const pickupBlock = card.querySelectorAll('.stop-block')[0];
    if (!pickupBlock) return;
    const addBtn = pickupBlock.querySelector('[data-add-pickup]');
    if (!addBtn) return;
    card._pickupExtraSeq = (card._pickupExtraSeq || 0) + 1;
    const seq = card._pickupExtraSeq;
    const name = `pickup_${taskNum}_extra_${seq}`;
    const row = document.createElement('div');
    row.className = 'extra-stop-row';
    row.dataset.extraPickup = seq;
    row.innerHTML = `<div class="place-search-wrap"><input type="text" class="place-search intake-field" name="${name}" placeholder="추가 상차지 검색…" data-intake-field="${name}"><button type="button" class="place-clear" data-clear="${name}" aria-label="지우기" tabindex="-1">&times;</button></div><div class="delivery-fields">${cargoTypeSelectHtml(`pickup_cargo_${taskNum}_extra_${seq}`, '', ` class="intake-field" data-intake-field="pickup_cargo_${taskNum}_extra_${seq}"`)}<input type="text" class="intake-field" name="pickup_tons_${taskNum}_extra_${seq}" placeholder="상차 규격 예: 5톤" data-intake-field="pickup_tons_${taskNum}_extra_${seq}"></div><button type="button" class="intake-aux-link remove-extra-stop" tabindex="-1">✕ 제거</button>`;
    row.querySelector('.remove-extra-stop').addEventListener('click', () => row.remove());
    row.querySelector('.place-clear')?.addEventListener('click', () => {
      const inp = row.querySelector(`[name="${name}"]`);
      if (inp) { inp.value = ''; delete inp.dataset.lat; delete inp.dataset.lon; }
    });
    pickupBlock.insertBefore(row, addBtn);
    bindPlaceSearch(row);
    bindIntakeKeyboard(root);
    row.querySelector('.intake-field').focus();
  }

  function addIntakeDeliveryStop(root, taskNum) {
    const card = root.querySelector(`[data-task="${taskNum}"]`);
    if (!card) return;
    const deliveryBlock = card.querySelectorAll('.stop-block')[1];
    if (!deliveryBlock) return;
    const addBtn = deliveryBlock.querySelector('[data-add-delivery]');
    if (!addBtn) return;
    card._deliveryExtraSeq = (card._deliveryExtraSeq || 0) + 1;
    const seq = card._deliveryExtraSeq;
    const row = document.createElement('div');
    row.className = 'extra-stop-row';
    row.dataset.extraDelivery = seq;
    row.innerHTML = `<div class="place-search-wrap"><input type="text" class="place-search intake-field" name="delivery_${taskNum}_extra_${seq}" placeholder="추가 하차지 검색…" data-intake-field="delivery_${taskNum}_extra_${seq}"><button type="button" class="place-clear" data-clear="delivery_${taskNum}_extra_${seq}" aria-label="지우기" tabindex="-1">&times;</button></div><div class="delivery-fields"><input type="text" class="intake-field" name="recipient_${taskNum}_extra_${seq}" placeholder="수신자(고객사명)" data-intake-field="recipient_${taskNum}_extra_${seq}">${cargoTypeSelectHtml(`cargo_${taskNum}_extra_${seq}`, '', ` class="intake-field" data-intake-field="cargo_${taskNum}_extra_${seq}"`)}<input type="text" class="intake-field" name="tons_${taskNum}_extra_${seq}" placeholder="규격 예: 5톤, 3파레트" data-intake-field="tons_${taskNum}_extra_${seq}"></div><button type="button" class="intake-aux-link remove-extra-stop" tabindex="-1">✕ 제거</button>`;
    row.querySelector('.remove-extra-stop').addEventListener('click', () => row.remove());
    row.querySelector('.place-clear')?.addEventListener('click', () => {
      const inp = row.querySelector(`[name="delivery_${taskNum}_extra_${seq}"]`);
      if (inp) { inp.value = ''; delete inp.dataset.lat; delete inp.dataset.lon; }
    });
    deliveryBlock.insertBefore(row, addBtn);
    bindPlaceSearch(row);
    bindIntakeKeyboard(root);
    row.querySelector('[data-intake-field^="recipient_"]')?.addEventListener('blur', () => suggestIntakeMixedLoadFromRecipients(root));
    row.querySelector('.intake-field').focus();
  }

  function bindIntakeStopShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (currentPage !== 'order-intake') return;
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'p' && key !== 'd') return;
      const root = getOrderIntakeRoot();
      if (!root) return;
      e.preventDefault();
      const taskNum = getActiveIntakeTaskNum(root);
      if (key === 'p') addIntakePickupStop(root, taskNum);
      else addIntakeDeliveryStop(root, taskNum);
    });
  }

  function bindIntakeKeyboard(root) {
    root.querySelectorAll('.intake-field').forEach(field => {
      if (field.dataset.intakeKeyBound === '1') return;
      field.dataset.intakeKeyBound = '1';
      field.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (e.shiftKey) return;
        e.preventDefault();
        const taskCard = field.closest('[data-task]');
        const taskNum = taskCard ? Number(taskCard.dataset.task) : 1;
        const fields = getIntakeFieldsForTask(root, taskNum);
        const idx = fields.indexOf(field);
        if (idx >= 0 && idx < fields.length - 1) {
          fields[idx + 1].focus();
          if (fields[idx + 1].select) fields[idx + 1].select();
          return;
        }
        commitIntakeRow(root, taskNum);
      });
    });
  }

  function taskCardHtml(taskNum, custOpts, sample, tabBase) {
    const pickup = '';
    const delivery = '';
    const defaultMixed = taskNum === 1 ? isMixedLoad(sample) : false;
    const t = tabBase || (taskNum - 1) * 10;
    return `
      <article class="task-card" data-task="${taskNum}">
        <div class="task-card-head">
          <h3>${taskNum === 1 ? '접수 입력' : `추가 태스크 ${taskNum}`}</h3>
          <button type="button" class="task-remove" data-remove-task="${taskNum}" aria-label="태스크 삭제" ${taskNum === 1 ? 'hidden' : ''} tabindex="-1">&times;</button>
        </div>
        <div class="stop-block">
          <div class="stop-label"><span class="ico">📍</span> 상차지</div>
          ${intakePlaceInput(`pickup_${taskNum}`, pickup, taskNum === 1, t + 1)}
          <div class="delivery-fields">
            ${cargoTypeSelectHtml(`pickup_cargo_${taskNum}`, '', ` class="intake-field" tabindex="${t + 2}" data-intake-field="pickup_cargo_${taskNum}"`)}
            <input type="text" class="intake-field" name="pickup_tons_${taskNum}" placeholder="상차 규격 예: 5톤" tabindex="${t + 3}" data-intake-field="pickup_tons_${taskNum}">
          </div>
          <button type="button" class="intake-aux-link" data-add-pickup="${taskNum}" tabindex="-1">+ 상차지 추가</button>
        </div>
        <div class="stop-block">
          <div class="stop-label"><span class="ico">📦</span> 하차지</div>
          ${intakePlaceInput(`delivery_${taskNum}`, delivery, taskNum === 1, t + 4)}
          <div class="delivery-fields">
            <input type="text" class="intake-field" name="recipient_${taskNum}" placeholder="수신자(고객사명)" tabindex="${t + 5}" data-intake-field="recipient_${taskNum}">
            ${cargoTypeSelectHtml(`cargo_${taskNum}`, '', ` class="intake-field" tabindex="${t + 6}" data-intake-field="cargo_${taskNum}"`)}
            <input type="text" class="intake-field" name="tons_${taskNum}" placeholder="하차 규격 예: 2톤, 3파레트" tabindex="${t + 7}" data-intake-field="tons_${taskNum}">
          </div>
          <button type="button" class="intake-aux-link" data-add-delivery="${taskNum}" tabindex="-1">+ 하차지 추가</button>
        </div>
        ${taskNum === 1 ? `
          <div class="stop-block task-meta-divider">
            <div class="form-grid" style="max-width:100%;grid-template-columns:100px 1fr;gap:10px 12px">
              <label>화주(고객) *</label>
              <div class="intake-customer-control">
                <select class="intake-field" name="customer" required tabindex="${t + 8}" data-intake-field="customer">${custOpts}</select>
                <button type="button" class="btn btn-sm" data-temp-customer tabindex="-1">+ 임시 화주 추가</button>
              </div>
              <label>희망 도착</label>
              <div>
                ${desiredArrivalFieldsHtml({
                  value: sample?.window && sample.window !== '—' ? sample.window : '',
                  tabindexDate: t + 9,
                  tabindexHour: t + 10,
                  intakeField: true,
                  hint: true,
                })}
              </div>
              <label>연락처</label>
              <input class="intake-field" name="contact" placeholder="담당 연락처" tabindex="${t + 11}" data-intake-field="contact">
              <label>혼적 여부</label>
              <div>${intakeMixedLoadRadioHtml(`intake-mixed-${taskNum}`, defaultMixed, t + 12)}</div>
            </div>
          </div>` : `
          <div class="stop-block task-meta-divider">
            <div class="form-grid" style="max-width:100%;grid-template-columns:100px 1fr;gap:8px 12px">
              <label>혼적 여부</label>
              <div>${intakeMixedLoadRadioHtml(`intake-mixed-${taskNum}`, defaultMixed, t + 8)}</div>
            </div>
          </div>`}
      </article>`;
  }

  function renderOrderIntake(root) {
    const selectedCustId = root._intakeCustomerId ?? null;
    const custOpts = intakeCustomerSelectOptions(selectedCustId);
    const taskCount = root._taskCount || 1;
    root._pendingIntakes = root._pendingIntakes || [];
    root.innerHTML = `
        <div class="page-sticky-top">
        ${pageChromeHtml('order-intake', { desc: '화주·상·하차 입력 · Enter 대기열 · 저장 후 배차·지정' })}
        </div>
        <form id="intakeForm" class="page-body-fill intake-viewport">
          <div class="card intake-compact" style="margin-bottom:0;flex:1;min-height:0;display:flex;flex-direction:column">
            <div class="card-hd intake-hd">
              <h2>배송 접수</h2>
              <div class="intake-hd-meta">
                <span class="intake-kbd-hint inline"><kbd>Enter</kbd> 다음 · 마지막 <kbd>Enter</kbd> 대기열 · <kbd>Alt+P</kbd> 상차지 · <kbd>Alt+D</kbd> 하차지</span>
                <button type="button" class="btn btn-sm" id="excelTemplate">양식 다운로드</button>
                <button type="button" class="btn-excel btn-excel-sm" id="excelImport">엑셀</button>
              </div>
            </div>
            <div class="card-bd">
              <div class="intake-layout-wrap">
                <div class="intake-main">
                  <div id="taskCardsList">
                    ${Array.from({ length: taskCount }, (_, i) => taskCardHtml(i + 1, custOpts, null, i * 10)).join('')}
                  </div>
                  <button type="button" class="intake-aux-link" id="addTaskCard" style="margin-bottom:8px">+ 태스크 추가</button>
                  <div class="intake-actions" style="margin-top:10px">
                    <button type="button" class="btn-add-intake" id="addIntakeRow">접수 추가</button>
                    <button type="button" class="btn btn-primary" id="submitOrder">접수 저장</button>
                  </div>
                </div>
                <div class="pending-intake-wrap compact" id="pendingIntakePanel">
                  <h4>접수 대기열 <span class="text-muted-hint">(${root._pendingIntakes.length})</span></h4>
                  ${pendingIntakeTableHtml(root._pendingIntakes)}
                </div>
              </div>
            </div>
          </div>
        </form>`;

    bindPendingIntakeActions(root);

    $('#excelTemplate', root).onclick = downloadIntakeExcelTemplate;

    $('#excelImport', root).onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.xlsx,.xls,.csv';
      inp.onchange = async () => {
        const file = inp.files[0];
        if (!file) return;
        let rows;
        try {
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(buf, { type: 'array', cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        } catch {
          toast('파일을 읽는 중 오류가 발생했습니다', 'error');
          return;
        }
        if (!rows.length) { toast('엑셀에 데이터가 없습니다', 'error'); return; }

        let added = 0;
        let geocoded = 0;
        for (const rawRow of rows) {
          const expanded = rowsFromExcelOrder(rawRow);
          for (const row of expanded) {
            await geocodeIntakeRow(row);
            if ((row.pickup && row.pickup_lat && row.pickup_lon) || (row.delivery && row.lat && row.lon)) geocoded++;
            addPendingIntake(root, row);
            added++;
          }
        }

        if (!added) { toast('유효한 행이 없습니다 (하차지 또는 상차지 필수)', 'error'); return; }
        toast(`엑셀 ${added}건 대기열 추가 · 좌표 ${geocoded}건 변환`);
      };
      inp.click();
    };
    $('#addTaskCard', root).onclick = () => {
      root._taskCount = (root._taskCount || 1) + 1;
      renderOrderIntake(root);
    };
    root.querySelectorAll('[data-remove-task]').forEach(btn => {
      btn.onclick = () => {
        root._taskCount = Math.max(1, (root._taskCount || 1) - 1);
        renderOrderIntake(root);
      };
    });
    root.querySelectorAll('.place-clear').forEach(btn => {
      btn.onclick = () => {
        const inp = root.querySelector(`[name="${btn.dataset.clear}"]`);
        if (inp) inp.value = '';
      };
    });
    root.querySelectorAll('[data-add-pickup]').forEach(btn => {
      btn.onclick = () => addIntakePickupStop(root, Number(btn.dataset.addPickup));
    });
    root.querySelectorAll('[data-add-delivery]').forEach(btn => {
      btn.onclick = () => addIntakeDeliveryStop(root, Number(btn.dataset.addDelivery));
    });

    bindIntakeKeyboard(root);
    bindPlaceSearch(root);
    root.querySelectorAll('[data-intake-field^="recipient_"]').forEach(inp => {
      inp.addEventListener('blur', () => suggestIntakeMixedLoadFromRecipients(root));
    });
    const custSel = root.querySelector('[name="customer"]');
    if (custSel) bindIntakeCustomerSelect(root, custSel);
    root.querySelectorAll('[data-temp-customer]').forEach(btn => {
      btn.onclick = () => openTempCustomerFromIntake(root, root.querySelector('[name="customer"]'));
    });

    $('#addIntakeRow', root).onclick = () => {
      const active = document.activeElement;
      const card = active?.closest?.('[data-task]');
      const taskNum = card ? Number(card.dataset.task) : 1;
      commitIntakeRow(root, taskNum);
    };

    $('#submitOrder', root).onclick = async () => {
      const form = $('#intakeForm', root);
      for (const card of root.querySelectorAll('[data-task]')) {
        const taskNum = Number(card.dataset.task);
        const draftRows = collectIntakeRows(root, form, taskNum);
        if (!draftRows.some(r => r.pickup || r.delivery)) continue;
        if (!validateIntakeRow(form, taskNum)) {
          toast('필수 항목을 입력하세요');
          return;
        }
        draftRows.forEach(row => addPendingIntake(root, row));
        clearIntakeRow(form, taskNum);
        card.querySelectorAll('.extra-stop-row').forEach(el => el.remove());
        card._pickupExtraSeq = 0;
        card._deliveryExtraSeq = 0;
      }
      const queue = [...(root._pendingIntakes || [])];
      if (!queue.length) {
        toast('접수할 건을 입력하거나 대기 목록에 추가하세요');
        return;
      }
      const btn = $('#submitOrder', root);
      if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
      const ok = await commitPendingRowsToOrders(queue);
      if (btn) { btn.disabled = false; btn.textContent = '접수 저장'; }
      if (!ok) return;
      const total = queue.length;
      root._pendingIntakes = [];
      renderPendingIntakePanel(root);
      toast(`접수 완료 ${total}건 · DB 저장 완료`);
    };
  }

  function renderOrderList(root) {
    const statuses = ['전체', '접수', '배차대기', '배차', '운행중', '완료', '취소'];
    const allRows = DATA.orders.filter(o => orderMatchesFilter(o, orderFilter));
    const rows = allRows.slice((orderPage - 1) * PAGE_SIZE, orderPage * PAGE_SIZE);
    const rowIds = rows.map(o => o.id);
    selectedOrderIds = selectedOrderIds.filter(id => DATA.orders.some(o => o.id === id));
    const allPageSelected = rowIds.length > 0 && rowIds.every(id => selectedOrderIds.includes(id));
    const selected = selectedOrderId ? orderById(selectedOrderId) : null;
    const detailTab = selected ? orderDetailTab : 'info';
    const listCard = `
      <div class="card card-fill">
        <div class="card-hd">
          <h2>오더 목록</h2>
          <div class="chips" id="orderChips">
            ${statuses.map(s => `<button type="button" class="chip ${orderFilter === s ? 'active' : ''}" data-f="${s}">${s}</button>`).join('')}
          </div>
          <div class="order-list-selection-actions" aria-label="오더 선택 작업">
            <button type="button" class="btn btn-sm" id="orderSelectVisible">${allPageSelected ? '현재 페이지 해제' : '현재 페이지 선택'}</button>
            <button type="button" class="btn btn-sm" id="orderClearSelection" ${selectedOrderIds.length ? '' : 'disabled'}>선택 해제</button>
          </div>
          <button type="button" class="btn btn-sm btn-primary" id="goOrderIntake" style="margin-left:auto">+ 접수 창</button>
        </div>
        <div class="order-bulk-bar ${selectedOrderIds.length ? '' : 'is-idle'}">
          <span>선택 <strong>${selectedOrderIds.length}</strong>건</span>
          <span class="text-muted-hint">행 클릭은 상세 보기, 체크박스는 일괄 선택</span>
          <button type="button" class="btn btn-sm" id="orderGoDispatch" ${selectedOrderIds.length ? '' : 'disabled'}>선택 건 배차지정</button>
        </div>
        <div class="card-bd" style="padding:0;display:flex;flex-direction:column;min-height:0">
          ${tableScrollWrap(`<table>
            <thead><tr>
              <th><input type="checkbox" id="chkAllOrdersPage" ${allPageSelected ? 'checked' : ''} aria-label="현재 페이지 전체 선택"></th><th>상태</th><th>접수 시간</th><th>혼적</th><th>상차지/하차지</th><th>화물</th><th>화주</th><th>기사</th><th>시간창</th><th>오더번호</th><th></th>
            </tr></thead>
            <tbody>${rows.length ? rows.map(o => {
              const editable = orderIsEditable(o);
              const rowCls = [
                'order-row-clickable',
                o.status === '취소' ? 'order-row-cancelled' : '',
                selectedOrderId === o.id ? 'selected' : '',
                selectedOrderIds.includes(o.id) ? 'picked' : '',
              ].filter(Boolean).join(' ');
              const statusCell = `${statusBadge(o.status)}${editable ? '<span class="badge-edit">수정</span>' : ''}`;
              return `
              <tr class="${rowCls}" data-order-id="${o.id}">
                <td><input type="checkbox" class="order-list-chk" data-id="${o.id}" ${selectedOrderIds.includes(o.id) ? 'checked' : ''} aria-label="${o.id} 선택"></td>
                <td>${statusCell}</td>
                <td>${formatDateTimeShort(o.created_at)}</td>
                <td>${mixedLoadBadge(isMixedLoad(o))}</td>
                <td class="route-cell"><strong>${o.pickup || '—'}</strong><br>→ ${o.delivery || '—'}</td>
                <td>${o.cargo || '—'}${o.tons ? ` · ${o.tons}` : ''}</td>
                <td>${o.customer}</td>
                <td>${o.driver || '—'}</td>
                <td>${o.window}</td>
                <td>${orderNoHtml(o)}</td>
                <td><button type="button" class="btn btn-sm edit-order" data-order-id="${o.id}">수정</button></td>
              </tr>`;
            }).join('') : `
              <tr><td colspan="11" class="empty-hint" style="padding:20px">해당 상태의 오더가 없습니다.</td></tr>`}
            </tbody>
          </table>`)}
          ${paginationHtml(allRows.length, orderPage, 'orders')}
        </div>
      </div>`;
    root.innerHTML = masterDetailShell(
      pageChromeHtml('order-list', { desc: '좌측 목록 · 우측 상세 · 수정 버튼으로 편집' }),
      listCard,
      selected ? inlineDetailCardHtml(`${displayOrderNo(selected)} · ${selected.customer}`, orderDetailBodyHtml(selected, detailTab), { saveLabel: '수정' }) : ''
    );
    const goIntakeBtn = $('#goOrderIntake', root);
    if (goIntakeBtn) goIntakeBtn.onclick = () => {
      currentPage = 'order-intake';
      renderPage();
    };
    root.querySelectorAll('#orderChips .chip').forEach(chip => {
      chip.onclick = () => { orderPage = 1; orderFilter = chip.dataset.f; selectedOrderId = null; renderOrderList(root); };
    });
    const syncOrderSelection = () => renderOrderList(root);
    $('#chkAllOrdersPage', root)?.addEventListener('change', (e) => {
      const ids = new Set(selectedOrderIds);
      rowIds.forEach(id => e.target.checked ? ids.add(id) : ids.delete(id));
      selectedOrderIds = [...ids];
      syncOrderSelection();
    });
    $('#orderSelectVisible', root)?.addEventListener('click', () => {
      const ids = new Set(selectedOrderIds);
      const select = !allPageSelected;
      rowIds.forEach(id => select ? ids.add(id) : ids.delete(id));
      selectedOrderIds = [...ids];
      syncOrderSelection();
    });
    $('#orderClearSelection', root)?.addEventListener('click', () => {
      selectedOrderIds = [];
      syncOrderSelection();
    });
    $('#orderGoDispatch', root)?.addEventListener('click', () => {
      dispatchPendingSelectedIds = selectedOrderIds.filter(id => DATA.orders.some(o => o.id === id && o.status === '접수'));
      dispatchPendingSelectedId = dispatchPendingSelectedIds[0] || null;
      gotoPage('dispatch', 'dispatch-assign');
    });
    root.querySelectorAll('.order-list-chk').forEach(chk => {
      chk.onchange = (e) => {
        const ids = new Set(selectedOrderIds);
        e.target.checked ? ids.add(chk.dataset.id) : ids.delete(chk.dataset.id);
        selectedOrderIds = [...ids];
        syncOrderSelection();
      };
    });
    root.querySelectorAll('.edit-order').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const o = DATA.orders.find(x => x.id === btn.dataset.orderId);
        if (o) openOrderEditModal(o, root);
      };
    });
    root.querySelectorAll('tbody tr[data-order-id]').forEach(tr => {
      tr.onclick = (e) => {
        if (e.target.closest('.edit-order') || e.target.closest('.order-list-chk')) return;
        orderDetailTab = 'info';
        selectOrder(tr.dataset.orderId);
      };
    });
    if (selected) bindOrderDetail(root, selected);
    bindPagination(root);
  }


  // ── 카카오맵 ──────────────────────────────────────────────────

  function fixedLiveMapLevel(page = currentPage) {
    return LIVE_MAP_FIXED_VIEW[page]?.level || 12;
  }

  function applyLiveMapFixedView(page = currentPage) {
    if (!map || !window.kakao?.maps) return;
    map.setLevel(fixedLiveMapLevel(page));
    if (typeof map.setDraggable === 'function') map.setDraggable(false);
    if (typeof map.setZoomable === 'function') map.setZoomable(false);
  }

  function initMap(page = currentPage) {
    const container = document.getElementById('map');
    if (!window.kakao?.maps || !container || map) return;
    const opts = {
      center: new kakao.maps.LatLng(LIVE_MAP_DEFAULT_CENTER.lat, LIVE_MAP_DEFAULT_CENTER.lon),
      level: fixedLiveMapLevel(page),
    };
    map = new kakao.maps.Map(container, opts);
    applyLiveMapFixedView(page);
  }

  function onKakaoReady() {
    _kakaoReady = true;
    connectLocationWebSocket();
    if (isMapPage()) showLiveMap(currentPage);
    else if (currentPage === 'customer-loc') initCustomerLocMap(document.getElementById('mainContent'));
    else if (currentPage === 'order-intake') bindPlaceSearch(document.getElementById('mainContent'));
    else if (currentPage === 'dispatch-assign') renderPage();
    else if (currentPage === 'bulk-dispatch') renderPage();
    else initMap();
  }

  function isMapPage(page = currentPage) {
    return page === 'dashboard' || page === 'control-live';
  }

  function showLiveMap(page = currentPage) {
    const mapCard = document.querySelector(page === 'dashboard' ? '.dash-map-card' : '.control-map-card');
    const container = document.getElementById('map-container');
    if (!mapCard || !container) return;
    const pageChanged = _liveMapPage !== page;
    container.style.display = 'block';
    container.style.position = 'relative';
    container.style.width = '100%';
    container.style.height = '100%';
    if (!mapCard.contains(container)) {
      mapCard.innerHTML = '';
      mapCard.appendChild(container);
    }
    if (pageChanged) {
      const mapEl = document.getElementById('map');
      if (mapEl) mapEl.innerHTML = '';
      map = null;
      _driverMarkers = {};
      _liveMapCenteredPage = null;
      _liveMapPage = page;
    }
    if (!window.kakao?.maps) {
      container.innerHTML = '<div id="map" style="width:100%;height:100%;"></div>';
      const mapEl = document.getElementById('map');
      if (mapEl) {
        mapEl.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:13px">지도를 불러오는 중입니다</div>';
      }
      return;
    }
    if (!document.getElementById('map')) {
      container.innerHTML = '<div id="map" style="width:100%;height:100%;"></div>';
    }
    if (!map) initMap(page);
    if (map) {
      applyLiveMapFixedView(page);
      kakao.maps.event.trigger(map, 'resize');
      renderVehicleLocationMarkers();
      setTimeout(() => {
        applyLiveMapFixedView(page);
        kakao.maps.event.trigger(map, 'resize');
        renderVehicleLocationMarkers();
      }, 120);
    }
  }

  function hideLiveMap() {
    const container = document.getElementById('map-container');
    if (!container) return;
    document.body.appendChild(container);
    container.style.display = 'none';
  }

  function updateDriverMarker(driverId, lat, lon, name) {
    if (!map) return;
    const position = new kakao.maps.LatLng(lat, lon);
    if (_driverMarkers[driverId]) {
      _driverMarkers[driverId].setPosition(position);
      _driverMarkers[driverId].setMap(map);
    } else {
      const marker = new kakao.maps.Marker({ position, title: name, map });
      _driverMarkers[driverId] = marker;
    }
  }

  function driverHasActiveTrip(driverId) {
    const trips = Array.isArray(DATA.statsTrips) ? DATA.statsTrips : [];
    return trips.some(t => t.driverId === driverId && t.status === '운행중');
  }

  function renderVehicleLocationMarkers() {
    if (!map) return;
    let sumLat = 0;
    let sumLon = 0;
    let count = 0;
    DATA.vehicles.forEach(v => {
      if (!v.driverId || v.start_lat == null || v.start_lon == null) return;
      const driver = DATA.drivers.find(d => d.id === v.driverId);
      const lat = Number(v.start_lat);
      const lon = Number(v.start_lon);
      updateDriverMarker(v.driverId, lat, lon, driver?.name || v.driver || v.plate);
      sumLat += lat;
      sumLon += lon;
      count += 1;
    });
    if (count > 0 && _liveMapCenteredPage !== _liveMapPage) {
      map.setCenter(new kakao.maps.LatLng(sumLat / count, sumLon / count));
      _liveMapCenteredPage = _liveMapPage;
    }
    applyLiveMapFixedView(_liveMapPage || currentPage);
  }

  // ── WebSocket ──────────────────────────────────────────────────

  function connectLocationWebSocket() {
    const token = getToken();
    if (!token || _locationWS) return;
    const ws = new WebSocket(`${WS_BASE}/ws/location?token=${token}`);
    _locationWS = ws;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'location' || msg.type === 'gps') {
          const d = DATA.drivers.find(x => x.id === (msg.driver_id || msg.user_id));
          if (d) {
            const v = DATA.vehicles.find(x => x.driverId === d.id);
            if (v && driverHasActiveTrip(d.id)) {
              v.start_lat = Number(msg.lat);
              v.start_lon = Number(msg.lon);
              v.last_gps_label = `${Number(msg.lat).toFixed(2)}, ${Number(msg.lon).toFixed(2)}`;
              v.last_gps_at = '실시간';
              updateDriverMarker(d.id, msg.lat, msg.lon, d.name);
            }
          }
        }
      } catch {}
    };
    ws.onclose = () => { _locationWS = null; setTimeout(connectLocationWebSocket, 5000); };
    ws.onerror = () => ws.close();
  }

  function updateChatNotifUI() {
    const total = Object.values(_driverUnread).reduce((s, n) => s + n, 0);
    const dot = document.getElementById('notifBadge');
    if (dot) dot.style.display = total > 0 ? '' : 'none';
    const messageBadge = document.getElementById('messageBadge');
    if (messageBadge) messageBadge.style.display = total > 0 ? '' : 'none';

    const drop = document.getElementById('notifDropdown');
    if (!drop) return;
    const entries = Object.entries(_driverUnread).filter(([, n]) => n > 0);
    if (!entries.length) {
      drop.innerHTML = '<div class="topbar-dropdown-header">알림</div><div class="topbar-dropdown-empty">새 알림이 없습니다</div>';
      return;
    }
    const items = entries.map(([driverId, n]) => {
      const d = DATA.drivers.find(x => x.id === driverId);
      const name = d ? escapeHtml(d.name) : '기사';
      return `<button type="button" class="topbar-dropdown-item" onclick="window.open('/chat.html?driver_id=${driverId}','_blank')">💬 ${name}<span class="badge badge-info" style="margin-left:auto">${n}</span></button>`;
    }).join('');
    drop.innerHTML = `<div class="topbar-dropdown-header">새 메시지</div>${items}`;

    // 기사 목록 테이블 배지 갱신
    document.querySelectorAll('#driverTable tbody tr[data-id]').forEach(tr => {
      const dId = tr.dataset.id;
      const count = _driverUnread[dId] || 0;
      let el = tr.querySelector('.driver-chat-badge');
      if (count > 0) {
        if (!el) { el = document.createElement('span'); el.className = 'badge badge-info driver-chat-badge'; el.style.marginLeft = '4px'; tr.querySelector('td').appendChild(el); }
        el.textContent = count;
      } else if (el) { el.remove(); }
    });
  }

  async function loadChatConversations() {
    try {
      const r = await apiFetch(`/chat/conversations`);
      if (!r.ok) return;
      const convs = await r.json();
      convs.forEach(c => {
        const partnerId = c.partner?.id;
        if (!partnerId) return;
        _convDriverMap[c.id] = partnerId;
        if ((c.unread_count || 0) > 0) _driverUnread[partnerId] = c.unread_count;
      });
      updateChatNotifUI();
    } catch {}
  }

  function connectChatWebSocket() {
    const token = getToken();
    if (!token || _chatWS) return;
    const ws = new WebSocket(`${WS_BASE}/ws/chat?token=${token}`);
    _chatWS = ws;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'chat.message' && msg.sender_id !== _currentUserId) {
          const driverId = _convDriverMap[msg.conversation_id];
          if (driverId) { _driverUnread[driverId] = (_driverUnread[driverId] || 0) + 1; updateChatNotifUI(); }
        } else if (msg.type === 'chat.read' && msg.reader_id === _currentUserId) {
          const driverId = _convDriverMap[msg.conversation_id];
          if (driverId) { _driverUnread[driverId] = 0; updateChatNotifUI(); }
        }
      } catch {}
    };
    ws.onclose = () => { _chatWS = null; setTimeout(connectChatWebSocket, 5000); };
    ws.onerror = () => ws.close();
  }

  // ── 배차 API 연동 ────────────────────────────────────────────

  async function createTripManual(vehicleId, driverId, tasks, departureName) {
    const waypoints = [];
    tasks.forEach((t, gi) => {
      (t.loadings || []).forEach(l => { if (l?.lat) waypoints.push({ ...l, name: l.name, lat: l.lat, lon: l.lon, type: 'loading', task_group: gi }); });
      (t.unloadings || []).forEach(u => { if (u?.lat) waypoints.push({ ...u, name: u.name, lat: u.lat, lon: u.lon, type: 'unloading', task_group: gi }); });
    });
    if (!waypoints.length) { alert('경유지를 1개 이상 입력하세요.'); return null; }
    const body = { driver_id: driverId, vehicle_id: vehicleId, waypoints, departure_time: new Date().toISOString() };
    if (departureName) body.origin_name = departureName;
    const res = await apiFetch(`/trips`, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) { const err = await res.json(); alert(err.detail || '운행 생성 실패'); return null; }
    return await res.json();
  }

  async function init() {
    if (!requireAdminSession()) return;
    const d = new Date();
    $('#headerDate').textContent = d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
    $('#brandHome').onclick = () => gotoPage('dashboard', 'dashboard');
    $('#modalOverlay').onclick = (e) => { if (e.target === $('#modalOverlay')) closeModal(); };
    // 탑바 버튼 이벤트
    $('#messageBtn').onclick = () => { location.href = '/chat.html'; };
    $('#settingsBtn').onclick = () => { location.href = '/settings.html'; };
    $('#notifBtn').onclick = (e) => { e.stopPropagation(); const d = document.getElementById('notifDropdown'); if (d.classList.contains('open')) { _closeAllDropdowns(); } else { _openDropdown('notifDropdown'); } };
    $('#userMenuBtn').onclick = (e) => { e.stopPropagation(); const d = document.getElementById('userDropdown'); if (d.classList.contains('open')) { _closeAllDropdowns(); } else { _openDropdown('userDropdown'); } };
    $('#ddProfile').onclick = () => { _closeAllDropdowns(); gotoPage('profile'); };
    $('#ddSettings').onclick = () => { _closeAllDropdowns(); location.href = '/settings.html'; };
    $('#ddLogout').onclick = () => logout();
    document.addEventListener('click', () => _closeAllDropdowns());
    bindIntakeStopShortcuts();
    applyInitialQueryState();
    renderNav();
    renderPage();
    await loadRealData();
    loadChatConversations();
    connectChatWebSocket();
    // 카카오맵 초기화
    try {
      const cr = await apiFetch(`/config`);
      if (cr.ok) {
        const cfg = await cr.json();
        const key = cfg.kakao_js_key || cfg.kakao_key || cfg.key;
        if (key) {
          const s = document.createElement('script');
          s.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&libraries=services&autoload=false`;
          s.onload = () => {
            kakao.maps.load(onKakaoReady);
          };
          document.head.appendChild(s);
        }
      }
    } catch (e) {
      console.warn('카카오맵 초기화 실패:', e);
    }
  }

  init();
})();
