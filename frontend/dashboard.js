(function () {
  'use strict';

  const API = 'http://168.138.45.63:8000';

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

  function getToken() { return localStorage.getItem('token'); }
  function getAuthHeaders() {
    const t = getToken();
    return t ? { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` } : { 'Content-Type': 'application/json' };
  }
  function requireAdminSession() {
    if (!getToken() || localStorage.getItem('role') !== 'admin') {
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

  const ROUTEON_GEN_TASKS = [
    { id: 1, pickup: { place: '상지빌딩', address: '서울특별시 성동구 마장로35길 66, 지하1층 (마장동)' },
      delivery: { place: '주식회사 쿱로지스틱스', address: '충청북도 괴산군 괴산읍 자연식품2길 51, 괴산아이쿱 상온창고' },
      shipper: '상지빌딩', cargo: '일반화물 18.1t', contact: '장수빈', latestAt: '2026-06-01 14:00', cargo_id: 'T1-C1', mixed_load: true },
    { id: 2, pickup: { place: '경동물류(주)', address: '경상남도 양산시 물금읍 제방로 27-9, 1동' },
      delivery: { place: '주식회사 태명산업', address: '전북특별자치도 군산시 외항로 885, 주식회사 태명산업 (오식도동)' },
      shipper: '경동물류(주)', cargo: '하역 22.2t', contact: '이서연', latestAt: '2026-06-01 16:30', cargo_id: 'T2-C1', mixed_load: false },
    { id: 3, pickup: { place: '(주)에스피씨지에프에스', address: '경기도 용인시 처인구 백암면 한택로88번길 260' },
      delivery: { place: '쿠팡풀필먼트서비스(유)', address: '경기도 이천시 마장면 이장로 329-38, CBRE GI 서이천 물류센터' },
      shipper: '(주)에스피씨지에프에스', cargo: '일반화물 6.7t', contact: '장예진', latestAt: '2026-06-01 12:00', cargo_id: 'T3-C1', mixed_load: false },
    { id: 4, pickup: { place: '대전농업협동조합', address: '전라남도 담양군 대전면 추성1로 208' },
      delivery: { place: '(주)개미창고', address: '경기도 이천시 마장면 이장로311번길 5-30, 신관 2층' },
      shipper: '대전농업협동조합', cargo: '양곡·영농자재 9.8t', contact: '윤수빈', latestAt: '2026-06-01 17:00', cargo_id: 'T4-C1', mixed_load: true },
  ];

  const BULK_NODE_ROWS = [
    { name: '(주)유상냉장 보세창고', address: '경기도 용인시 기흥구 동탄기흥로 741 (고매동, 유상냉장)', tons: 2.5, tw: '2026-06-01T11:00', cargo_id: 'T5-C1', mixed_load: true },
    { name: '위킵 인천저온센터', address: '인천광역시 미추홀구 염전로143번길 45, 지하1층 101,102호 (도화동)', tons: 2.4, tw: '2026-06-01T11:30', cargo_id: 'T5-C2', mixed_load: true },
    { name: '쿠팡로지스틱스서비스 유한회사', address: '경상남도 김해시 장유로55번길 30-15(부곡동)', tons: 8.0, tw: '2026-06-01T15:00', cargo_id: 'T6-C1', mixed_load: true },
    { name: '삼양사', address: '대구광역시 북구 유통단지로13길 8 (산격동)', tons: 7.9, tw: '2026-06-01T16:00', cargo_id: 'T6-C2', mixed_load: true },
    { name: '대봉유통', address: '경상남도 김해시 진례면 고모로341번길 5', tons: 3.0, tw: '2026-06-01T13:00', cargo_id: 'T7-C1', mixed_load: true },
    { name: '(주)아시안타이거즈 트랜스팩', address: '경기도 김포시 월곶면 고정로 79-34', tons: 3.0, tw: '2026-06-01T14:30', cargo_id: 'T7-C2', mixed_load: true },
  ].map((r, idx) => {
    const ll = addressToFakeLatLon(r.address);
    const kg = Math.round(r.tons * 1000);
    const tripPrefix = (r.cargo_id || '').split('-')[0];
    const pickupByTrip = { T5: '인천', T6: '경남', T7: '경기' };
    const twTime = r.tw && r.tw.includes('T') ? r.tw.split('T')[1]?.slice(0, 5) : '—';
    return { ...r, lat: ll.lat, lon: ll.lon, region: ll.region, cargo_weight_kg: kg,
      latest_at: r.tw + ':00+09:00',
      order_id: `B-260601-${String(idx + 1).padStart(2, '0')}`,
      shipper: r.name.replace(/\(주\)/g, '').trim(),
      pickup: pickupByTrip[tripPrefix] || ll.region,
      delivery: ll.region,
      status: '배차대기',
      window: twTime,
    };
  });

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

  function dispatchStopTooltip(item) {
    const parts = [];
    if (item.name) parts.push(item.name);
    if (item.address) parts.push(item.address);
    if (item.cargo_id) parts.push(`cargo_id: ${item.cargo_id}`);
    if (item.lat != null && item.lon != null) parts.push(`${item.lat}, ${item.lon}`);
    if (item.cargo_weight_kg != null) parts.push(`${item.cargo_weight_kg} kg`);
    if (item.tw) parts.push(`마감 ${formatTwClose(item.tw)}`);
    if (item.pickupAddr) parts.push(`상차 ${item.pickupAddr}`);
    if (item.deliveryAddr) parts.push(`하차 ${item.deliveryAddr}`);
    return parts.join(' · ').replace(/"/g, '&quot;');
  }

  function formatDispatchTons(item) {
    if (item.tons != null && item.tons !== '') {
      if (typeof item.tons === 'number') return `${item.tons}톤`;
      const ts = String(item.tons);
      return ts.includes('톤') ? ts : `${ts}톤`;
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
    const tripPrefix = (item.cargo_id || '').split('-')[0];
    const pickupByTrip = { T5: '인천', T6: '경남', T7: '경기' };
    const pickup = pickupRaw
      ? placeShortLabel(pickupRaw)
      : (item.pickupShort || pickupByTrip[tripPrefix] || placeShortLabel(item.region) || '물류센터');
    const delivery = deliveryRaw
      ? placeShortLabel(deliveryRaw)
      : (item.deliveryShort || placeShortLabel(item.name) || placeShortLabel(item.address));
    return {
      orderId: item.order_id || item.id || `B-260601-${String(idx + 1).padStart(2, '0')}`,
      shipper: item.shipper || item.customer || placeShortLabel(item.name) || '—',
      pickup,
      delivery,
      tons: formatDispatchTons(item),
      window: item.window || (item.tw && item.tw.includes('T') ? item.tw.split('T')[1]?.slice(0, 5) : null) || item.latestAt || '—',
      status: item.status || '배차대기',
      tooltip: dispatchStopTooltip(item),
    };
  }

  function dispatchListTableRows(rows, opts = {}) {
    return rows.map((item, i) => {
      const n = normalizeDispatchListRow(item, i);
      const selected = opts.selectedId === (item.id || item.order_id || n.orderId);
      const rowCls = [opts.rowClass || 'order-row-clickable', selected ? 'selected' : ''].filter(Boolean).join(' ');
      const dataId = item.id || item.order_id || n.orderId;
      const lead = opts.radioName
        ? `<td><input type="radio" name="${opts.radioName}" value="${dataId}" ${selected ? 'checked' : ''} aria-label="선택"></td>`
        : (opts.checkbox
          ? `<td><input type="checkbox" class="${opts.checkboxClass || 'dispatch-chk'}" ${opts.checked !== false ? 'checked' : ''} data-id="${dataId}"></td>`
          : '');
      return `<tr class="${rowCls}" ${opts.dataAttr ? `data-${opts.dataAttr}="${dataId}"` : ''} title="${n.tooltip}">
        ${lead}
        <td>${n.orderId}</td>
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
          <th>오더번호</th><th>혼적</th><th>화주</th><th>경로</th><th>톤수</th><th>시간창</th><th>상태</th>
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
    shipper: { email: '', company: '' },
  };

  async function loadRealData() {
    try {
      const hdrs = getAuthHeaders();

      // 기사 목록
      const dr = await fetch(`${API}/users?role=driver`, { headers: hdrs });
      if (dr.ok) {
        const users = await dr.json();
        DATA.drivers = users.map(u => ({
          id: u.id,
          name: u.name || u.username,
          vehicleId: null,
          status: '운행가능',
          phone: u.phone || '',
          history: [],
        }));
      }

      // 차량 목록
      const vr = await fetch(`${API}/vehicles`, { headers: hdrs });
      if (vr.ok) {
        const vehs = await vr.json();
        DATA.vehicles.splice(0);
        vehs.forEach(v => DATA.vehicles.push({
          id: v.id,
          plate: v.plate_number,
          tonnage: v.tonnage || `${((v.max_load_kg || 0) / 1000).toFixed(1)}톤`,
          type: v.vehicle_type || '카고',
          max_load_kg: v.max_load_kg || 0,
          start_lat: 37.4563,
          start_lon: 126.7052,
          last_gps_label: '',
          last_gps_at: '',
          status: '가용',
        }));
      }

      // 운행 목록
      const tr = await fetch(`${API}/trips`, { headers: hdrs });
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
      const sr = await fetch(`${API}/stats/summary?period=all`, { headers: hdrs });
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
      const dbdr = await fetch(`${API}/stats/by-driver?period=all`, { headers: hdrs });
      if (dbdr.ok) {
        const rows = await dbdr.json();
        DATA.driverStats = rows.map(r => ({
          name: r.name || r.username || '',
          driverId: r.driver_id,
          trips: r.total_trips || 0,
          hoursSum: r.total_duration_min != null ? `${Math.floor(r.total_duration_min/60)}h ${Math.round(r.total_duration_min%60)}m` : '—',
          hoursAvg: r.avg_duration_min != null ? `${Math.floor(r.avg_duration_min/60)}h ${Math.round(r.avg_duration_min%60)}m` : '—',
          distSum: r.total_distance_km != null ? `${Math.round(r.total_distance_km)} km` : '—',
          distAvg: '—',
          days: r.work_days || 0,
        }));
      }

      // 차량별 통계
      const dbv = await fetch(`${API}/stats/by-vehicle?period=all`, { headers: hdrs });
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
      const meRes = await fetch(`${API}/auth/me`, { headers: hdrs });
      if (meRes.ok) {
        const me = await meRes.json();
        _currentUserId = me.id;
        const userEl = document.getElementById('topbarUserName');
        if (userEl) userEl.textContent = me.name || me.username || '관리자';
        const roleEl = document.getElementById('topbarUserRole');
        if (roleEl) roleEl.textContent = me.role === 'admin' ? '관리자' : me.role;
      }
      const or2 = await fetch(`${API}/organizations/me`, { headers: hdrs });
      if (or2.ok) {
        const org = await or2.json();
        const bt = document.querySelector('.brand-text');
        if (bt && bt.childNodes[0]) bt.childNodes[0].nodeValue = org.name || 'RouteOn';
      }

      // 배송(오더) 목록
      const dvr = await fetch(`${API}/deliveries`, { headers: hdrs });
      if (dvr.ok) {
        const deliveries = await dvr.json();
        const deliveryStatusMap = { pending: '접수', in_progress: '운행중', done: '완료', done_manual: '완료' };
        DATA.orders = deliveries.map(d => ({
          id: d.id,
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
          tons: d.cargo_weight_ton != null ? `${d.cargo_weight_ton}톤` : '',
          contact: d.contact_name || '',
          mixed_load: !!d.mixed_load,
        }));
        // 캘린더에 오더 이벤트 추가
        deliveries.forEach(d => {
          const eventDate = (d.deadline || d.created_at || '').split('T')[0];
          if (eventDate) {
            DATA.scheduleEvents.push({
              date: eventDate, type: 'order',
              label: d.address || '배송',
              orderId: d.id.slice(0, 8),
            });
          }
        });
      }

      // 승인 대기 기사 목록
      const pr = await fetch(`${API}/users?role=pending`, { headers: hdrs });
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
      const cr = await fetch(`${API}/customers`, { headers: hdrs });
      if (cr.ok) {
        const customers = await cr.json();
        DATA.customers = customers.map(c => ({
          id:              c.id,
          name:            c.name,
          contact:         c.contact || '',
          phone:           c.phone || '',
          address:         c.address || '',
          memo:            c.memo || '',
          temporary:       !!c.temporary,
          valid_date:      c.valid_date || null,
          totalShipments:  0,
          lastOrderDate:   null,
          shipmentHistory: [],
        }));
      }

      // 담당자(관리자) 목록
      const admR = await fetch(`${API}/users?role=admin`, { headers: hdrs });
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
      DATA.dispatchFleet = DATA.vehicles.map((v, i) => ({
        id: v.id,
        vehicleId: v.id,
        driverId: DATA.drivers[i]?.id || null,
        available: v.status === '가용',
      }));

      // 페이지 재렌더링
      renderPage();
      if (currentPage === 'dashboard') showDashboardMap();

    } catch (e) {
      console.error('데이터 로드 오류:', e);
    }
  }


  const MAIN_WITH_SUB = ['orders', 'dispatch', 'schedule', 'basic', 'customers'];

  const NAV = [
    { id: 'dashboard', label: '대시보드', pages: [{ id: 'dashboard', label: '요약' }] },
    { id: 'orders', label: '오더관리', pages: [
      { id: 'order-intake', label: '접수 창' },
      { id: 'order-list', label: '오더 목록' },
    ]},
    { id: 'dispatch', label: '배차·지정', pages: [
      { id: 'bulk-dispatch', label: '일괄 자동 배차' },
      { id: 'dispatch-assign', label: '단건·수동 배차' },
    ]},
    { id: 'schedule', label: '일정·업무', pages: [
      { id: 'schedule-calendar', label: '캘린더' },
      { id: 'schedule-gantt', label: '간트' },
      { id: 'schedule-milestones', label: '마일스톤' },
    ]},
    { id: 'customers', label: '고객관리', pages: [
      { id: 'customer-list', label: '고객 관리' },
      { id: 'customer-loc', label: '고객 위치' },
    ]},
    { id: 'stats', label: '운행 통계', pages: [{ id: 'trip-stats', label: '사후 통계' }] },
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
  let dispatchPreviewTab = 0;
  let dispatchRan = false;
  let bulkDispatchRan = false;
  let bulkDispatchTab = 0;
  let bulkDepartureMode = 'distributed';
  let bulkAllowMixedLoad = true;
  let dispatchPendingMixedOnly = false;
  let dashOrderTab = '전체';
  let pendingIntakes = [];
  let pendingIntakeSeq = 0;
  let dispatchPendingSelectedId = null;
  let dispatchManualVehicleId = null;
  let dispatchManualDriverId = null;

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
    if (currentPage === 'dashboard' && page !== 'dashboard') hideDashboardMap();
    currentMain = main;
    const group = NAV.find(g => g.id === main);
    currentPage = page || (group ? group.pages[0].id : NAV[0].pages[0].id);
    renderNav();
    renderPage();
    if (currentPage === 'dashboard') setTimeout(showDashboardMap, 50);
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
    const hdrs = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
    const batch = rows.map(r => ({
      address: r.delivery || '주소 미입력',
      lat: null,
      lon: null,
      deadline: r.latestAt ? r.latestAt.replace('T', ' ').slice(0, 16) : null,
      recipient_name: r.recipient || null,
      cargo_type: r.cargo || null,
      cargo_weight_ton: r.tons ? parseFloat(r.tons) || null : null,
      pickup_address: r.pickup || null,
      pickup_lat: null,
      pickup_lon: null,
      shipper_name: r.customer || null,
      contact_name: r.contact || null,
      mixed_load: !!r.mixed_load,
    }));
    const res = await fetch(`${API}/deliveries/batch`, {
      method: 'POST',
      headers: hdrs,
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
        customer: d.shipper_name || '—',
        status: statusMap[d.status] || '접수',
        pickup: d.pickup_address || '—',
        delivery: d.address,
        window: d.deadline ? d.deadline.slice(0, 16).replace('T', ' ') : '—',
        driver: null,
        recipient: d.recipient_name || '',
        cargo: d.cargo_type || '',
        tons: d.cargo_weight_ton != null ? `${d.cargo_weight_ton}톤` : '',
        contact: d.contact_name || '',
        mixed_load: !!d.mixed_load,
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
    return `
      <label>마지막 GPS <span class="badge badge-muted">읽기 전용</span></label>
      <p style="margin:0;font-size:13px">${v.start_lat}, ${v.start_lon} · 갱신 ${vehicleLastGpsAt(v)}</p>
      <p style="font-size:11px;color:var(--text-muted);margin:6px 0 0">관리자 입력 없음 · 앱 위치 로그 기준(목업)</p>`;
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

  function handoverMockDisclaimerHtml() {
    return '<p class="handover-mock-bar">목업 · 실 API 미연동 · Phase 2 (운행 중 기사·차량 교체·대차)</p>';
  }

  function pushHandoverHistory(trip, entry) {
    if (!trip.handoverHistory) trip.handoverHistory = [];
    trip.handoverHistory.push({ at: mockNow(), ...entry });
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
      const res = await fetch(`${API}/trips/${trip.id}/reassign`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
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
      const res = await fetch(`${API}/trips/${trip.id}/reassign`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
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
            <input type="checkbox" name="needsRelay"> 인근 대차·환적 요청(목업)
          </label></span>
        </div>
      </form>`, () => {
      const form = $('#handoverAccidentForm');
      if (!form) return;
      const reason = form.querySelector('[name="reason"]').value;
      const needsRelay = form.querySelector('[name="needsRelay"]').checked;
      pushHandoverHistory(trip, { type: 'incident', reason, needsRelay });
      if (!trip.flags) trip.flags = [];
      if (needsRelay) {
        trip.relayPending = true;
        if (!trip.flags.includes('relay')) trip.flags.push('relay');
      }
      toast(needsRelay ? '사고 신고 · 대차 대기(목업)' : '사고·지연 신고 접수(목업)');
      renderPage();
    }, { saveLabel: '신고 접수' });
  }

  function bindHandoverActions(root, trip) {
    if (!trip || !tripSupportsHandover(trip)) return;
    $('#btnHandoverDriver', root)?.addEventListener('click', () => openDriverChangeModal(trip));
    $('#btnHandoverVehicle', root)?.addEventListener('click', () => openVehicleChangeModal(trip));
    $('#btnHandoverAccident', root)?.addEventListener('click', () => openAccidentReportModal(trip));
    $('#btnTripComplete', root)?.addEventListener('click', async () => {
      if (!confirm('운행을 완료 처리하시겠습니까?')) return;
      const res = await fetch(`${API}/trips/${trip.id}/status?status=completed`, { method: 'PATCH', headers: getAuthHeaders() });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.detail || '처리 실패'); return; }
      toast('운행 완료 처리됨');
      await loadRealData();
      selectedTripId = null;
    });
    $('#btnTripCancel', root)?.addEventListener('click', async () => {
      if (!confirm('운행을 취소하시겠습니까?')) return;
      const res = await fetch(`${API}/trips/${trip.id}/status?status=cancelled`, { method: 'PATCH', headers: getAuthHeaders() });
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

  function mockNow() {
    const d = new Date();
    return `${mockToday()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function mockToday() {
    return new Date().toISOString().split('T')[0];
  }

  function isTemporaryCustomer(c) {
    return !!c?.temporary;
  }

  function isTempCustomerActiveToday(c) {
    return isTemporaryCustomer(c) && (c.valid_date || mockToday()) === mockToday();
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
    return `${opts}<option value="__add_temp__">+ 임시 화주 추가</option>`;
  }

  function customerNameFromIntakeValue(value) {
    if (!value || value === '__add_temp__') return '';
    const c = customerById(value);
    return c ? c.name : String(value);
  }

  function openTempCustomerModal(onSaved) {
    openModal('임시 화주 추가', `
      <form id="tempCustForm">
        <p class="cust-temp-banner" style="margin-top:0">당일 의뢰용 · 고객 마스터 미등록 · 유효일 ${mockToday()}</p>
        <div class="form-grid" style="max-width:100%">
          <label>화주명 *</label><input name="name" required placeholder="업체명">
          <label>연락처</label><input name="phone" placeholder="010-0000-0000">
          <label>메모</label><input name="memo" value="당일 의뢰" placeholder="당일 의뢰">
        </div>
      </form>`, async () => {
      const form = $('#tempCustForm');
      if (!form) return;
      const name  = form.querySelector('[name="name"]').value.trim();
      const phone = form.querySelector('[name="phone"]').value.trim();
      const memo  = form.querySelector('[name="memo"]').value.trim() || '당일 의뢰';
      const today = mockToday();
      const res = await fetch(`${API}/customers`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
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

  function customerMatchesListFilter(c, filter) {
    if (filter === '정규') return !isTemporaryCustomer(c);
    if (filter === '임시(당일)') return isTempCustomerActiveToday(c);
    return true;
  }

  function customerHistoryTableHtml(history) {
    if (!history?.length) return '<p class="empty-hint">배송 이력 없음</p>';
    return `<div class="drawer-history-wrap">
      <table class="drawer-history-table">
        <thead><tr><th>날짜</th><th>오더번호</th><th>상·하차</th><th>톤수</th><th>상태</th></tr></thead>
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
      const phone   = $('#custPhone', root).value.trim();
      const address = $('#custAddress', root).value.trim();
      const res = await fetch(`${API}/customers/${c.id}`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
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
          <label>상태 <span class="badge badge-muted">목업</span></label>
          <select id="driverStatus">
            <option ${d.status === '운행가능' ? 'selected' : ''}>운행가능</option>
            <option ${d.status === '운행중' ? 'selected' : ''}>운행중</option>
            <option ${d.status === '휴무' ? 'selected' : ''}>휴무</option>
          </select>
        </div>
        <div class="driver-vehicle-split">
          <div>
            <label style="font-size:12px;font-weight:600">배정 차량 <span class="badge badge-muted">목업</span></label>
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
    $('#inlineDetailSave', root).onclick = () => {
      d.status = $('#driverStatus', root).value;
      const vid = $('#driverVehicleAssign', root).value;
      d.vehicleId = vid ? Number(vid) : null;  // vehicle id는 integer
      d.history.push({ at: new Date().toISOString().slice(0, 10), note: `배정 차량 → ${vid ? driverVehicleLabel(d) : '미배정'}` });
      toast('기사·차량 정보가 저장되었습니다 (목업)');
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
        <label>톤급 <span class="badge badge-muted">목업</span></label>
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
        <label>연결 기사 <span class="badge badge-muted">선택</span></label>
        <select id="vehDriver">
          <option value="">— 미연결 —</option>
          ${DATA.drivers.map(d => `<option value="${d.id}" ${linked && linked.id === d.id ? 'selected' : ''}>${d.name}</option>`).join('')}
        </select>
      </div>
      <div class="vehicle-preview" id="vehCoordPreview" style="margin-top:16px">
        <p style="font-size:11px;color:var(--text-muted);margin:0 0 6px">배차 출발점 · 최근 GPS (목업)</p>
        ${vehiclePreviewHtml(v)}
      </div>`;
  }

  function bindVehicleDetail(root, v) {
    $('#inlineDetailBack', root).onclick = () => { selectedVehicleId = null; renderPage(); };
    $('#inlineDetailSave', root).onclick = () => {
      v.tonnage = $('#vehTonnage', root).value;
      v.type = $('#vehType', root).value;
      v.status = $('#vehStatus', root).value;
      const driverId = $('#vehDriver', root).value;
      DATA.drivers.forEach(d => {
        if (d.vehicleId === v.id) d.vehicleId = null;
      });
      if (driverId) {
        const d = driverById(driverId);
        if (d) d.vehicleId = v.id;
      }
      toast('차량 정보가 저장되었습니다 (목업)');
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

  function orderHistoryTableHtml(o) {
    const hist = o.changeHistory?.length ? o.changeHistory : [
      { at: '—', user: '—', note: '변경 이력 없음' },
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
        <button type="button" class="tab ${tab === 'hist' ? 'active' : ''}" data-tab="hist">변경 이력</button>
      </div>
      <div class="tab-panel ${tab === 'info' ? 'active' : ''}" data-panel="info">
        <div class="form-grid" style="max-width:100%">
          <label>오더번호</label><span><code>${o.id}</code></span>
          <label>화주</label><span>${o.customer}</span>
          <label>수신자</label><span>${o.recipient || '—'}</span>
          <label>화물</label><span>${o.cargo || '—'}${o.tons ? ` · ${o.tons}` : ''}</span>
          <label>시간창</label><span>${o.window}</span>
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
      const res = await fetch(`${API}/users/${s.id}`, { method: 'DELETE', headers: getAuthHeaders() });
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
    const now = new Date();
    const year = now.getFullYear(), month = now.getMonth() + 1;
    const monthLabel = `${year}년 ${month}월`;
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const monthEvents = DATA.scheduleEvents
      .filter(e => e.date.startsWith(monthPrefix))
      .sort((a, b) => a.date.localeCompare(b.date));
    root.innerHTML = `
      <div class="page-sticky-top">
      ${pageChromeHtml('schedule-calendar', { title: '일정 캘린더', desc: `${monthLabel} · 오더·운행 일정` })}
      </div>
      <div class="page-scroll-main">
      <div class="cal-wrap">
        <div class="cal-hd">
          <h3>${monthLabel}</h3>
          <span class="badge badge-info">${monthEvents.length}건</span>
        </div>
        <div class="cal-legend">
          <span><i class="dot-order"></i>오더·배차</span>
          <span><i class="dot-trip"></i>운행·Trip</span>
        </div>
        <div class="cal-grid">${renderCalendarGridHtml(year, month)}</div>
      </div>
      <div class="card" style="margin-top:10px">
        <div class="card-hd"><h2>이번 달 일정</h2></div>
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
    return `<strong>${v.plate}</strong> · ${v.tonnage} · ${v.type} · max ${v.max_load_kg} kg
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
    if ('max_load_kg' in row) row.max_load_kg = v.max_load_kg;
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

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg || '저장되었습니다';
    t.classList.add('show');
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
    dispatch: '▣',
    stats: '↗',
    basic: '◎',
    customers: '◇',
    orders: '☰',
    schedule: '◷',
  };

  /** 대시보드만 theme-dashboard, 접수·오더·배차 등은 theme-app(다크) */
  function syncSubNavLayout() {
    document.body.classList.toggle('main-with-sub', MAIN_WITH_SUB.includes(currentMain));
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

  function mockNoticeHtml() {
    return '<p class="mock-notice">목업 화면 · 저장·앱 전달은 미연동</p>';
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
      if (hasSub && isActive) {
        const flyout = el('div', 'nav-sub-flyout');
        flyout.setAttribute('role', 'group');
        flyout.setAttribute('aria-label', group.label + ' 하위 메뉴');
        group.pages.forEach(p => {
          const subBtn = el('button', 'nav-sub-btn' + (currentPage === p.id ? ' active' : ''), p.label);
          subBtn.type = 'button';
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
    const main = $('#mainContent');
    main.innerHTML = '';
    applyPageTheme();
    const page = el('section', 'page active page-viewport');
    main.appendChild(page);
    const root = el('div', 'page-center page-shell page-viewport-inner');
    page.appendChild(root);

    switch (currentPage) {
      case 'dashboard': renderDashboard(root); break;
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
    const orderTabs = ['전체', '접수', '배차', '운행중', '완료'];
    const filteredOrders = DATA.orders.filter(o => dashOrderTab === '전체' || o.status === dashOrderTab);
    const completed = DATA.orders.filter(o => o.status === '완료').length;
    const total = DATA.orders.length;
    const pct = total ? Math.round((completed / total) * 100) : 0;
    const fleetByType = {};
    DATA.vehicles.forEach(v => { fleetByType[v.type] = (fleetByType[v.type] || 0) + 1; });
    const fleetMax = Math.max(...Object.values(fleetByType), 1);
    const fleetRows = Object.entries(fleetByType).sort((a, b) => b[1] - a[1]);
    const cargoChips = [
      { label: '일반화물', kg: '12.4t' },
      { label: '냉장', kg: '6.2t' },
      { label: '양곡·자재', kg: '4.1t' },
      { label: '하역', kg: '2.2t' },
    ];
    root.innerHTML = `
        ${pageChromeHtml('dashboard', {
          title: '관제 대시보드',
          desc: '실시간 운행·오더 현황 요약 (목업 데이터)',
        })}
        <div class="dash-layout">
          <aside class="dash-left" aria-label="요약 위젯">
            <div class="dash-widget">
              <h2>오늘 배송 진행</h2>
              <div class="dash-cargo-chips">
                ${cargoChips.map(c => `<span class="dash-cargo-chip">${c.label} ${c.kg}</span>`).join('')}
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
                <button type="button" class="dash-quick-link" data-goto-main="orders" data-goto-page="order-intake">
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
            <div class="dash-map-card" aria-label="지도">
            </div>
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
                  ${filteredOrders.length ? filteredOrders.map(o => `
                    <tr data-goto-orders>
                      <td>${o.id}</td>
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
      gotoPage('orders', 'order-list');
    };
    root.querySelectorAll('[data-goto-orders]').forEach(tr => { tr.onclick = goOrderList; });
    $('#dashGoOrderList', root).onclick = goOrderList;
    if (map) showDashboardMap();
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
        const orgRes = await fetch(`${API}/organizations/me`, { headers: getAuthHeaders() });
        const org = orgRes.ok ? await orgRes.json() : {};
        const res = await fetch(`${API}/auth/register`, {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: fd.username, password: fd.password, phone: fd.phone, name: fd.name, org_code: org.org_code || '', role: 'driver' }),
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
        const res = await fetch(`${API}/users/${btn.dataset.uid}`, { method: 'DELETE', headers: getAuthHeaders() });
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
        const res = await fetch(`${API}/auth/approve/${btn.dataset.uid}`, { method: 'POST', headers: getAuthHeaders() });
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
        const res = await fetch(`${API}/users/${btn.dataset.uid}`, { method: 'DELETE', headers: getAuthHeaders() });
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
        const res = await fetch(`${API}/vehicles`, {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
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
        const res = await fetch(`${API}/vehicles/${btn.dataset.vid}`, { method: 'DELETE', headers: getAuthHeaders() });
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
      const orgRes = await fetch(`${API}/organizations/me`, { headers: getAuthHeaders() });
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
          phone: document.getElementById('sfPhone').value.trim(),
          org_code: orgCode,
          role: 'admin',
        };
        const res = await fetch(`${API}/auth/register`, {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
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
    const s = DATA.shipper;
    root.innerHTML = `
      <div class="page-sticky-top">
      ${pageChromeHtml('profile', { desc: '화주 기본정보 (요금·출금 메뉴 없음)' })}
      </div>
      <div class="page-scroll-main">
      <div class="card">
        <div class="card-bd">
          <div class="tabs" id="profileTabs">
            <button type="button" class="tab active" data-tab="shipper">화주 기본정보</button>
            <button type="button" class="tab" data-tab="pw">비밀번호 변경</button>
          </div>
          <div class="tab-panel active" data-panel="shipper">
            <form id="shipperForm" class="form-grid">
              <label>이메일</label><input type="email" value="${s.email}" required>
              <label>사업자명</label><input value="${s.company}" required>
            </form>
            <p style="margin-top:12px;font-size:12px;color:var(--text-muted)">예치금·가상계좌·요금 정책은 이 목업에 포함하지 않습니다.</p>
          </div>
          <div class="tab-panel" data-panel="pw">
            <form id="pwForm" class="form-grid">
              <label>현재 비밀번호</label><input type="password" required>
              <label>새 비밀번호</label><input type="password" required>
              <label>확인</label><input type="password" required>
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
    $('#saveProfile', root).onclick = () => {
      const active = root.querySelector('.tab-panel.active form');
      if (active && !validateForm(active)) return;
      toast();
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
          <p class="cust-filter-hint">임시(당일): 접수 시 등록한 당일 화주만 · 일자 종료 후 목록에서 숨김(목업)</p>
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
          <label>주소</label><input name="address" value="${c?.address || ''}">
        </div>
      </form>`, async () => {
      const form = $('#custModalForm');
      if (!form) return;
      const name    = form.querySelector('[name="name"]').value.trim();
      const contact = form.querySelector('[name="contact"]').value.trim();
      const phone   = form.querySelector('[name="phone"]').value.trim();
      const address = form.querySelector('[name="address"]').value.trim();
      if (!name) { toast('고객명을 입력하세요'); return; }
      const body = { name, contact: contact || null, phone: phone || null, address: address || null };
      let res;
      if (isEdit) {
        res = await fetch(`${API}/customers/${c.id}`, {
          method: 'PATCH',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`${API}/customers`, {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
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
  }

  function renderCustomerLoc(root) {
    const custOpts = DATA.customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    root.innerHTML = `
      <div class="page-sticky-top">
      ${pageChromeHtml('customer-loc', { desc: '배송·상하차 지점 좌표 (마일리지 없음)' })}
      </div>
      <div class="page-body-fill split" style="grid-template-columns:1fr 1fr;min-height:0">
        <div>
          <div class="card">
            <div class="card-hd">
              <h2>위치 목록</h2>
              <button type="button" class="btn btn-primary btn-sm" id="addLoc">+ 위치 추가</button>
            </div>
            <div class="card-bd">
              <ul class="loc-list">${DATA.locations.map(l => {
                const c = DATA.customers.find(x => x.id === l.customerId);
                const custLink = c
                  ? `<button type="button" class="link-btn cust-history-link" data-cid="${c.id}">${c.name}</button>`
                  : '';
                return `<li>
                  <div><strong>${l.label}</strong><br><span class="coord">${custLink}${c ? ' · ' : ''}${l.lat.toFixed(4)}, ${l.lon.toFixed(4)}</span></div>
                  <button type="button" class="btn btn-sm edit-loc" data-id="${l.id}">편집</button>
                </li>`;
              }).join('')}</ul>
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
    $('#addLoc', root).onclick = () => locModal();
    root.querySelectorAll('.edit-loc').forEach(btn => {
      btn.onclick = () => {
        const l = DATA.locations.find(x => x.id === Number(btn.dataset.id));
        locModal(l);
      };
    });
    root.querySelectorAll('.cust-history-link').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        selectedCustomerId = Number(btn.dataset.cid);
        customerDetailTab = 'history';
        gotoPage('customers', 'customer-list');
      };
    });
    // 배송지 좌표 마커 표시
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
    const points = DATA.orders.filter(o => o.lat && o.lon);
    if (!points.length) return;
    const bounds = new kakao.maps.LatLngBounds();
    points.forEach(o => {
      const pos = new kakao.maps.LatLng(o.lat, o.lon);
      const marker = new kakao.maps.Marker({ position: pos, map: _miniMapInstance, title: o.delivery });
      _miniMapMarkers.push(marker);
      bounds.extend(pos);
    });
    _miniMapInstance.setBounds(bounds);
    kakao.maps.event.trigger(_miniMapInstance, 'resize');
  }

  function locModal(l) {
    const custOpts = DATA.customers.map(c =>
      `<option value="${c.id}" ${l && l.customerId === c.id ? 'selected' : ''}>${c.name}</option>`
    ).join('');
    openModal(l ? '위치 편집' : '위치 추가', `
      <form>
        <div class="form-grid" style="max-width:100%">
          <label>고객</label><select required>${custOpts}</select>
          <label>라벨 *</label><input required value="${l?.label || ''}">
          <label>위도</label><input type="number" step="0.0001" value="${l?.lat ?? ''}" placeholder="37.4979">
          <label>경도</label><input type="number" step="0.0001" value="${l?.lon ?? ''}" placeholder="127.0276">
        </div>
      </form>`);
  }

  function bulkEndPolicyBadge(policy) {
    if (policy === 'return_to_depot') return '<span class="badge badge-info">복귀</span>';
    return '<span class="badge badge-muted">open_end</span>';
  }

  function renderBulkDispatch(root) {
    const bd = DATA.bulkDispatch;
    const res = bd.results;
    const plans = res.plans;
    const tabIdx = Math.min(bulkDispatchTab, plans.length - 1);
    const plan = plans[tabIdx] || plans[0];

    const visitLi = (v) => {
      const cls = v.kind === 'rest' ? 'rest' : (v.kind === 'origin' || v.kind === 'end' ? v.kind : '');
      return `<li class="${cls}">${v.text}</li>`;
    };

    root.innerHTML = `
      <div class="page-sticky-top">
      ${pageChromeHtml('bulk-dispatch', { desc: '다차량·다배송지 자동 배정 · 경로 미리보기' })}
      ${mockNoticeHtml()}
      </div>
      <div class="page-scroll-main">
      <details class="dispatch-collapse" open>
        <summary>설정 — 출발·배송지·차량</summary>
        <div class="dispatch-collapse-bd">
      <div class="card">
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

          <p class="field-label" style="margin-top:16px">배송지 목록</p>
          ${bulkStopsTableHtml(bd.stops)}
          <p class="empty-hint" style="margin-top:8px;font-size:12px">${bd.stops.length}건 · 일괄 배차 대상 (목업)</p>

          <label class="toolbar" style="margin-top:12px;font-size:13px;cursor:pointer">
            <input type="checkbox" id="bulkAllowMixed" ${bulkAllowMixedLoad ? 'checked' : ''}>
            혼적 허용 <span class="text-muted-hint">(동일 차량·복수 화주·화물)</span>
          </label>

          <p class="field-label" style="margin-top:16px">가용 차량</p>
          <ul class="checklist" id="bulkFleetList">
            ${bd.vehicles.map(v => `
              <li class="${v.available === false ? 'unavail' : ''}" data-bulk-row="${v.id}">
                <input type="checkbox" id="bulk-v-${v.id}" checked ${v.available === false ? 'disabled' : ''}>
                <label for="bulk-v-${v.id}">
                  <div class="vehicle-bind-row">
                    <span style="font-size:11px;color:var(--text-muted);min-width:48px">${v.label}</span>
                    <select class="bulk-vehicle-select" data-bulk-row="${v.id}">
                      ${vehicleSelectOptions(v.vehicleId)}
                    </select>
                    ${bulkEndPolicyBadge(v.end_policy)}
                  </div>
                  <div class="vehicle-preview bulk-vehicle-preview" data-bulk-row="${v.id}">
                    <strong>${v.plate}</strong> · ${v.tonnage || '—'} · ${v.type || '—'} · max ${v.max_load_kg} kg
                    <div class="fleet-meta">
                      <span>출발: 최근 GPS (${Number(v.start_lat).toFixed(2)}, ${Number(v.start_lon).toFixed(2)})</span>
                      <span class="coord">${v.start_city || '—'} · GPS</span>
                    </div>
                  </div>
                  <div class="vehicle-bind-row" style="margin-top:6px">
                    <span style="font-size:11px;color:var(--text-muted);min-width:48px">기사</span>
                    <select class="bulk-driver-select" data-bulk-row="${v.id}">
                      ${driverSelectOptions(v.driverId)}
                    </select>
                  </div>
                </label>
              </li>`).join('')}
          </ul>

          <div class="card-actions">
            <button type="button" class="btn btn-primary" id="runBulkDispatch">일괄 배차 실행</button>
          </div>
        </div>
      </div>
        </div>
      </details>

      <details class="dispatch-collapse" ${bulkDispatchRan ? 'open' : ''}>
        <summary>결과 — 차량별 방문 순서·미배정</summary>
        <div class="dispatch-collapse-bd">
      <div class="card" id="bulkResultsCard" style="${bulkDispatchRan ? '' : 'opacity:.6'}">
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
                  <th>오더번호</th><th>혼적</th><th>화주</th><th>경로</th><th>톤수</th><th>시간창</th><th>상태</th><th>사유</th>
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
        </div>
      </details>
      </div>`;

    $('#bulkAllowMixed', root)?.addEventListener('change', (e) => {
      bulkAllowMixedLoad = e.target.checked;
      toast(bulkAllowMixedLoad ? '혼적 허용 (목업)' : '단독배차만 허용 (목업)');
    });
    root.querySelectorAll('.departure-mode button[data-departure]').forEach(btn => {
      btn.onclick = () => {
        const mode = btn.dataset.departure;
        if (mode === bulkDepartureMode) return;
        bulkDepartureMode = mode;
        renderBulkDispatch(root);
      };
    });
    $('#bulkDepotMap', root)?.addEventListener('click', () => toast('센터 위치 선택 (지도 목업)'));
    root.querySelectorAll('.bulk-vehicle-select').forEach(sel => {
      sel.onchange = () => {
        const row = bd.vehicles.find(x => x.id === Number(sel.dataset.bulkRow));
        if (!row) return;
        applyVehicleToFleetRow(row, sel.value);
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
        row.driverId = Number(sel.value);
        const d = driverById(row.driverId);
        if (d) row.driver = d.name;
        const plan = bd.results.plans.find((_, i) => bd.vehicles[i]?.id === row.id);
        if (plan && d) plan.driver = d.name;
        toast(`기사 연결: ${d?.name || ''} (차량 유지)`);
        if (bulkDispatchRan) renderBulkDispatch(root);
      };
    });
    $('#runBulkDispatch', root).onclick = () => {
      const checked = root.querySelectorAll('#bulkFleetList input:checked:not(:disabled)');
      if (!checked.length) { toast('가용 차량을 1대 이상 선택하세요'); return; }
      const btn = $('#runBulkDispatch', root);
      btn.disabled = true;
      btn.innerHTML = '<span class="loading"></span>일괄 배차 중…';
      setTimeout(() => {
        bulkDispatchRan = true;
        bulkDispatchTab = 0;
        toast('일괄 배차 계산이 완료되었습니다 (목업)');
        renderBulkDispatch(root);
      }, 2000);
    };
    root.querySelectorAll('#bulkVehicleTabs .tab').forEach(tab => {
      tab.onclick = () => {
        bulkDispatchTab = Number(tab.dataset.btab);
        renderBulkDispatch(root);
      };
    });
    $('#bulkManualReassign', root)?.addEventListener('click', () => {
      dispatchRan = false;
      gotoPage('dispatch', 'dispatch-assign');
      toast('단건·수동 배차로 이동 — 미배정 건 재배정 (목업)');
    });
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
    const seen = new Set(pendingIntakes.map(p => p.id));
    return [...pendingIntakes, ...fromOrders.filter(o => !seen.has(o.id))];
  }

  function bindRouteCalc(btn, box, list) {
    if (!btn || !box || !list) return;
    btn.onclick = () => {
      btn.disabled = true;
      btn.innerHTML = '<span class="loading"></span>계산 중…';
      box.classList.remove('show');
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '경로 계산';
        list.innerHTML = DATA.routePreview.map(s => {
          const role = s.role ? ` <span class="badge badge-info">${s.role}</span>` : '';
          return `<li>${s.seq}. ${s.name}${role} <span class="coord">(${s.lat}, ${s.lon})</span></li>`;
        }).join('');
        box.classList.add('show');
        toast('경로 미리보기가 준비되었습니다');
      }, 1000);
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
    const plans = DATA.dispatchPlans;
    const tabIdx = Math.min(dispatchPreviewTab, plans.length - 1);
    const plan = plans[tabIdx] || plans[0];
    let unassigned = unassignedForDispatch();
    if (dispatchPendingMixedOnly) unassigned = unassigned.filter(o => isMixedLoad(o));
    const selectedPending = unassigned.find(o => o.id === dispatchPendingSelectedId)
      || (dispatchPendingSelectedId ? unassignedForDispatch().find(o => o.id === dispatchPendingSelectedId) : null);
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
      ${mockNoticeHtml()}
      </div>
      <div class="page-scroll-main">

      <div class="card" id="sec-dispatch-pending">
        <div class="card-hd">
          <h2>미배차 건</h2>
          <span style="font-size:12px;color:var(--text-muted)">접수 저장 · 접수 상태 오더</span>
          <label class="toolbar" style="margin-left:auto;font-size:12px;cursor:pointer;font-weight:normal">
            <input type="checkbox" id="dispatchMixedOnlyFilter" ${dispatchPendingMixedOnly ? 'checked' : ''}> 혼적만
          </label>
        </div>
        <div class="card-bd" style="padding:0">
          ${tableScrollWrap(`<table>
            <thead>
              <tr>
                <th></th><th>오더번호</th><th>혼적</th><th>화주</th><th>경로</th><th>톤수</th><th>시간창</th><th>상태</th>
              </tr>
            </thead>
            <tbody id="pendingIntakeBody">
              ${unassigned.length ? dispatchListTableRows(
                unassigned.map(o => ({ ...o, status: o.status || '접수', customer: o.shipper })),
                { rowClass: 'pending-row order-row-clickable', dataAttr: 'pending-id', radioName: 'pendingPick', selectedId: dispatchPendingSelectedId }
              ) : `
                <tr><td colspan="8" class="empty-hint" style="padding:16px">${dispatchPendingMixedOnly ? '혼적 미배차 건이 없습니다.' : '미배차 건이 없습니다. 접수 창에서 저장하세요.'}</td></tr>`}
            </tbody>
          </table>`)}
        </div>
      </div>

      <div class="card" id="sec-dispatch-manual" style="${selectedPending ? '' : 'opacity:.7'}">
        <div class="card-hd"><h2>선택 건 배정</h2></div>
        <div class="card-bd">
          ${selectedPending ? `
            <p class="field-label" style="margin-bottom:12px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
              <span><strong>${selectedPending.id}</strong> · ${placeShortLabel(selectedPending.pickup)} ▶ ${placeShortLabel(selectedPending.delivery)} · ${selectedPending.shipper || selectedPending.customer}</span>
              <span style="font-weight:normal;font-size:12px">혼적 여부 <strong>${mixedLoadLabel(isMixedLoad(selectedPending))}</strong> ${mixedLoadBadge(isMixedLoad(selectedPending))}</span>
              <label style="font-weight:normal;font-size:12px;display:inline-flex;align-items:center;gap:4px;cursor:pointer">
                <input type="checkbox" id="toggleSelectedMixed" ${isMixedLoad(selectedPending) ? 'checked' : ''}> 혼적 (편집)
              </label>
            </p>
            <div class="intake-layout-wrap">
              <div class="intake-main">
                <div class="intake-actions">
                  <button type="button" class="btn" id="calcRouteAssign">경로 계산</button>
                  <button type="button" class="btn btn-primary" id="confirmDispatchAssign">배정 확정</button>
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
                <th>오더번호</th><th>혼적</th><th>화주</th><th>경로</th><th>톤수</th><th>시간창</th><th>상태</th>
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
            <label>배차 일자</label><input type="date" value="2026-06-01">
            <label>권역</label>
            <select id="dispatchRegionFilter">${odRegionSelectHtml('전체')}</select>
            <label>거점</label>
            <select id="dispatchSiteFilter">${siteSelectHtml('엔와이국제물류주식회사')}</select>
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

      <details class="dispatch-collapse" ${dispatchRan ? 'open' : ''}>
        <summary>배차 결과</summary>
        <div class="dispatch-collapse-bd">
      <div class="card" id="sec-dispatch-preview" style="${dispatchRan ? '' : 'opacity:.65'}">
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
              <button type="button" class="btn btn-primary" id="btnAppHandoff">기사 앱 전달</button>
            </div>
          </div>
        </div>
      </div>
        </div>
      </details>
      </div>`;


    const pickPending = (id) => {
      dispatchPendingSelectedId = id;
      renderDispatchAssign(root);
    };
    root.querySelectorAll('.pending-row').forEach(tr => {
      tr.onclick = (e) => {
        if (e.target.tagName === 'INPUT') return;
        pickPending(tr.dataset.pendingId);
      };
    });
    root.querySelectorAll('input[name="pendingPick"]').forEach(radio => {
      radio.onchange = () => { if (radio.checked) pickPending(radio.value); };
    });
    $('#dispatchMixedOnlyFilter', root)?.addEventListener('change', (e) => {
      dispatchPendingMixedOnly = e.target.checked;
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
        const ordId = dispatchPendingSelectedId;
        if (ordId) {
          const hdrs = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
          const res = await fetch(`${API}/deliveries/${ordId}/assign`, {
            method: 'PATCH',
            headers: hdrs,
            body: JSON.stringify({ driver_id: dispatchManualDriverId }),
          });
          if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            toast(e.detail || '배정 실패');
            return;
          }
          const ord = DATA.orders.find(o => o.id === ordId);
          if (ord) { ord.status = '배차'; ord.driver = d?.name || '—'; }
          const idx = pendingIntakes.findIndex(p => p.id === ordId);
          if (idx >= 0) pendingIntakes.splice(idx, 1);
        }
        toast(`배정 완료 · ${v?.plate || ''} ${d ? '· ' + d.name : ''}`);
        dispatchPendingSelectedId = null;
        dispatchRan = true;
        renderDispatchAssign(root);
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
            <label>상차 *</label><input required>
            <label>하차 *</label><input required>
            <label>화주</label><input>
            <label>화물</label><input>
            <label>연락처</label><input>
            <label>희망 도착</label>
            <div>${desiredArrivalFieldsHtml({ dateName: 'dispatch_latest_at_date', hourName: 'dispatch_latest_at_hour', hint: true })}</div>
          </div>
        </form>`, () => toast('배송 건이 추가되었습니다 (목업)'));
    };
    $('#runDispatch', root).onclick = () => {
      const checked = root.querySelectorAll('#fleetChecklist input:checked:not(:disabled)');
      if (!checked.length) { toast('투입 차량을 1대 이상 선택하세요'); return; }
      dispatchRan = true;
      toast('배차가 실행되었습니다 — 차량·기사 조합 기준 미리보기 (목업)');
      renderDispatchAssign(root);
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
        row.driverId = Number(sel.value);
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
    $('#manualReassign', root).onclick = () => toast('수동 재배정 화면 (목업)');
    $('#singleDispatch', root).onclick = () => {
      openModal('단건 배차 — 차량·기사', `
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">배송 건에 투입 <strong>차량</strong>과 <strong>기사</strong>를 각각 지정합니다. 기사 상태 변경은 자기사 관리에서 합니다.</p>
        <div class="form-grid" style="max-width:100%">
          <label>투입 차량 *</label>
          <select id="singleVehicle">${vehicleSelectOptions(DATA.dispatchFleet[0]?.vehicleId)}</select>
          <label>연결 기사</label>
          <select id="singleDriver">${driverSelectOptions(DATA.dispatchFleet[0]?.driverId, { allowEmpty: true })}</select>
        </div>
        <div class="vehicle-preview" id="singleVehiclePreview" style="margin-top:12px"></div>
      `, () => toast('단건 배차가 반영되었습니다 (목업)'));
      const vSel = $('#singleVehicle', $('#modalBox'));
      const prev = $('#singleVehiclePreview', $('#modalBox'));
      const refresh = () => { if (prev) prev.innerHTML = vehiclePreviewHtml(vehicleById(vSel.value)); };
      if (vSel) { vSel.onchange = refresh; refresh(); }
    };
    $('#btnTripCreate', root).onclick = () => toast('Trip이 생성되었습니다 (목업)');
    $('#btnFinalCheck', root).onclick = () => {
      openModalLarge('순서·노드 최종 확인', `
        <p style="font-size:13px;margin-bottom:12px">차량별 방문 순서와 지도 노드를 확인합니다. (계획 vs 실제 비교 없음)</p>
        <ol class="visit-ol">${plans[0].visits.map(v => `<li>${v}</li>`).join('')}</ol>`, () => toast('최종 확인 완료'));
    };
    $('#btnAppHandoff', root).onclick = () => toast('기사 앱으로 전달되었습니다 (목업)');
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
      ${pageChromeHtml('trip-stats', { desc: '운행 이후 — 완료 Trip 사후 통계·리포트 (가짜 데이터)' })}
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
      const driver = driverName ? DATA.drivers.find(d => d.name === driverName) : null;
      const params = new URLSearchParams({ period });
      if (driver) params.set('driver_id', driver.id);
      const res = await fetch(`${API}/stats/by-day?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) { toast('조회 실패'); return; }
      const rows = await res.json();
      renderByDayChart($('#byDayChart', root), rows, `${statsPeriod}간 일별 운행 현황${driverName ? ` · ${driverName}` : ''}`);
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
        const res = await fetch(`${API}/stats/route-history?driver_id=${driver.id}&period=${period}`, { headers: getAuthHeaders() });
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
    _tripRouteMapInstance = new kakao.maps.Map(el, {
      center: new kakao.maps.LatLng(36.5, 127.5),
      level: 10,
    });
    kakao.maps.event.trigger(_tripRouteMapInstance, 'resize');

    const res = await fetch(`${API}/trips/${tripId}/polyline`, { headers: getAuthHeaders() });
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
          <label>화물</label><input name="cargo" value="${row.cargo || ''}">
          <label>톤수</label><input name="tons" value="${row.tons || ''}">
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
      row.contact = form.querySelector('[name="contact"]').value.trim();
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
    const statusOpts = ['접수', '배차', '운행중', '완료', '취소'].map(s =>
      `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`
    ).join('');
    const ro = orderIsEditable(o) ? '' : ' disabled';
    openModal(`${orderIsEditable(o) ? '오더 수정' : '오더 조회'} · ${o.id}`, `
      <form id="orderEditForm">
        <div class="form-grid" style="max-width:100%">
          <label>오더번호</label><input value="${o.id}" disabled>
          <label>화주(고객) *</label><select name="customer" required${ro}>${custOpts}</select>
          <label>상차지 *</label><input name="pickup" required value="${o.pickup || ''}"${ro}>
          <label>하차지 *</label><input name="delivery" required value="${o.delivery || ''}"${ro}>
          <label>수신자</label><input name="recipient" value="${o.recipient || ''}"${ro}>
          <label>화물</label><input name="cargo" value="${o.cargo || ''}"${ro}>
          <label>톤수</label><input name="tons" value="${o.tons || ''}"${ro}>
          <label>연락처</label><input name="contact" value="${o.contact || ''}"${ro}>
          <label>희망 도착</label>
          <div>${desiredArrivalFieldsHtml({ value: o.window === '—' ? '' : (o.window || ''), dateName: 'order_latest_at_date', hourName: 'order_latest_at_hour', disabled: !!ro, hint: true })}</div>
          <label>상태</label><select name="status">${statusOpts}</select>
          <label>기사</label><input value="${o.driver || '—'}" disabled>
        </div>
        ${orderIsEditable(o) ? '' : '<p class="text-muted-hint" style="font-size:12px;margin-top:10px">접수 건만 상·하차·화물 등을 수정할 수 있습니다. 취소·삭제는 하단 버튼을 이용하세요.</p>'}
      </form>`, () => {
      const form = $('#orderEditForm');
      if (!form) return;
      if (orderIsEditable(o)) {
        o.customer = form.querySelector('[name="customer"]').value;
        o.pickup = form.querySelector('[name="pickup"]').value.trim();
        o.delivery = form.querySelector('[name="delivery"]').value.trim();
        o.recipient = form.querySelector('[name="recipient"]').value.trim();
        o.cargo = form.querySelector('[name="cargo"]').value.trim();
        o.tons = form.querySelector('[name="tons"]').value.trim();
        o.contact = form.querySelector('[name="contact"]').value.trim();
        const latest = readDesiredArrival(form, 'order_latest_at_date', 'order_latest_at_hour');
        o.window = latest ? formatIntakeWindow(latest) : '—';
        toast('오더가 수정되었습니다');
      } else {
        toast('상태가 변경되었습니다');
      }
      o.status = form.querySelector('[name="status"]').value;
      renderOrderList(listRoot);
    });
    const ft = $('#modalBox').querySelector('.modal-ft');
    if (orderCanCancel(o)) {
      const cancelBtn = el('button', 'btn');
      cancelBtn.type = 'button';
      cancelBtn.textContent = '접수 취소';
      cancelBtn.style.marginRight = 'auto';
      cancelBtn.onclick = () => {
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
      delBtn.onclick = () => {
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
          <input type="radio" name="${groupName}" value="1"${isMixed ? ' checked' : ''}>
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
    return {
      pickup: readIntakeField(form, `pickup_${taskNum}`),
      delivery: readIntakeField(form, `delivery_${taskNum}`),
      recipient: readIntakeField(form, `recipient_${taskNum}`),
      cargo: readIntakeField(form, `cargo_${taskNum}`),
      tons: readIntakeField(form, `tons_${taskNum}`),
      customer: taskNum === 1 ? customerNameFromIntakeValue(custVal) : '',
      latestAt: taskNum === 1 ? readDesiredArrival(form) : '',
      contact: taskNum === 1 ? readIntakeField(form, 'contact') : '',
      mixed_load: readIntakeMixedLoad(form, taskNum),
    };
  }

  function clearIntakeRow(form, taskNum) {
    [`pickup_${taskNum}`, `delivery_${taskNum}`, `recipient_${taskNum}`, `cargo_${taskNum}`, `tons_${taskNum}`].forEach(name => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el) el.value = '';
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
    const row = collectIntakeRow(form, taskNum);
    if (!row.pickup && !row.delivery) return false;
    const total = addPendingIntake(root, row);
    clearIntakeRow(form, taskNum);
    const nextFields = getIntakeFieldsForTask(root, taskNum);
    if (nextFields[0]) nextFields[0].focus();
    toast(`접수 ${total}건 추가됨`);
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

  function addIntakePickupStop(_root, _taskNum) {
    toast('상차지 행 추가됨');
  }

  function addIntakeDeliveryStop(_root, _taskNum) {
    toast('하차지 행 추가됨');
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
    const pickup = sample?.pickup || '';
    const delivery = sample?.delivery || '';
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
          <button type="button" class="intake-aux-link" data-add-pickup="${taskNum}" tabindex="-1">+ 상차지 추가</button>
        </div>
        <div class="stop-block">
          <div class="stop-label"><span class="ico">📦</span> 하차지</div>
          ${intakePlaceInput(`delivery_${taskNum}`, delivery, taskNum === 1, t + 2)}
          <div class="delivery-fields">
            <input type="text" class="intake-field" name="recipient_${taskNum}" placeholder="수신자(고객사명)" tabindex="${t + 3}" data-intake-field="recipient_${taskNum}">
            <input type="text" class="intake-field" name="cargo_${taskNum}" placeholder="화물 종류" tabindex="${t + 4}" data-intake-field="cargo_${taskNum}">
            <input type="text" class="intake-field" name="tons_${taskNum}" placeholder="톤수" tabindex="${t + 5}" data-intake-field="tons_${taskNum}">
          </div>
          <button type="button" class="intake-aux-link" data-add-delivery="${taskNum}" tabindex="-1">+ 하차지 추가</button>
        </div>
        ${taskNum === 1 ? `
          <div class="stop-block task-meta-divider">
            <div class="form-grid" style="max-width:100%;grid-template-columns:100px 1fr;gap:10px 12px">
              <label>화주(고객) *</label>
              <select class="intake-field" name="customer" required tabindex="${t + 6}" data-intake-field="customer">${custOpts}</select>
              <label>희망 도착</label>
              <div>
                ${desiredArrivalFieldsHtml({
                  value: sample?.window && sample.window !== '—' ? sample.window : '',
                  tabindexDate: t + 7,
                  tabindexHour: t + 8,
                  intakeField: true,
                  hint: true,
                })}
              </div>
              <label>연락처</label>
              <input class="intake-field" name="contact" placeholder="담당 연락처" tabindex="${t + 9}" data-intake-field="contact">
              <label>혼적 여부</label>
              <div>${intakeMixedLoadRadioHtml(`intake-mixed-${taskNum}`, defaultMixed, t + 10)}</div>
            </div>
          </div>` : `
          <div class="stop-block task-meta-divider">
            <div class="form-grid" style="max-width:100%;grid-template-columns:100px 1fr;gap:8px 12px">
              <label>혼적 여부</label>
              <div>${intakeMixedLoadRadioHtml(`intake-mixed-${taskNum}`, defaultMixed, t + 6)}</div>
            </div>
          </div>`}
      </article>`;
  }

  function renderOrderIntake(root) {
    const sample = DATA.orders.find(o => o.status === '접수') || DATA.orders[0];
    const sampleCustId = sample ? DATA.customers.find(c => c.name === sample.customer)?.id : null;
    const selectedCustId = root._intakeCustomerId ?? sampleCustId;
    const custOpts = intakeCustomerSelectOptions(selectedCustId);
    const taskCount = root._taskCount || 1;
    root._pendingIntakes = root._pendingIntakes || [];
    root.innerHTML = `
        <div class="page-sticky-top">
        ${pageChromeHtml('order-intake', { desc: '화주·상·하차 입력 · Enter 대기열 · 저장 후 배차·지정' })}
        </div>
        <form id="intakeForm" class="page-body-fill intake-viewport">
          <div class="card intake-compact" style="margin-bottom:0;height:100%;display:flex;flex-direction:column;min-height:0">
            <div class="card-hd intake-hd">
              <h2>배송 접수</h2>
              <div class="intake-hd-meta">
                <span class="intake-kbd-hint inline"><kbd>Enter</kbd> 다음 · 마지막 <kbd>Enter</kbd> 대기열 · <kbd>Alt+P</kbd> 상차지 · <kbd>Alt+D</kbd> 하차지</span>
                <button type="button" class="btn-excel btn-excel-sm" id="excelImport">엑셀</button>
              </div>
            </div>
            <div class="card-bd">
              <div class="intake-layout-wrap">
                <div class="intake-main">
                  <div id="taskCardsList">
                    ${Array.from({ length: taskCount }, (_, i) => taskCardHtml(i + 1, custOpts, i === 0 ? sample : null, i * 10)).join('')}
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

    $('#excelImport', root).onclick = () => toast('엑셀 파일을 불러왔습니다 (목업)');
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
    root.querySelectorAll('[data-intake-field^="recipient_"]').forEach(inp => {
      inp.addEventListener('blur', () => suggestIntakeMixedLoadFromRecipients(root));
    });
    const custSel = root.querySelector('[name="customer"]');
    if (custSel) bindIntakeCustomerSelect(root, custSel);

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
        const draft = collectIntakeRow(form, taskNum);
        if (!draft.pickup && !draft.delivery) continue;
        if (!validateIntakeRow(form, taskNum)) {
          toast('필수 항목을 입력하세요');
          return;
        }
        addPendingIntake(root, draft);
        clearIntakeRow(form, taskNum);
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
      const day = new Date().toISOString().slice(2, 10).replace(/-/g, '');
      queue.forEach((row) => {
        const n = pendingIntakes.length + 1;
        pendingIntakes.push({
          id: `P-${day}-${String(n).padStart(3, '0')}`,
          pickup: row.pickup,
          delivery: row.delivery,
          shipper: row.customer || '—',
          cargo: row.cargo || '—',
          contact: row.contact || '—',
          latestAt: row.latestAt || '—',
          source: '접수',
          mixed_load: !!row.mixed_load,
        });
      });
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
    const selected = selectedOrderId ? orderById(selectedOrderId) : null;
    const detailTab = selected ? orderDetailTab : 'info';
    const listCard = `
      <div class="card card-fill">
        <div class="card-hd">
          <h2>오더 목록</h2>
          <div class="chips" id="orderChips">
            ${statuses.map(s => `<button type="button" class="chip ${orderFilter === s ? 'active' : ''}" data-f="${s}">${s}</button>`).join('')}
          </div>
        </div>
        <div class="card-bd" style="padding:0;display:flex;flex-direction:column;min-height:0">
          ${tableScrollWrap(`<table>
            <thead><tr>
              <th>오더번호</th><th>혼적</th><th>화주</th><th>상차</th><th>하차</th><th>화물</th><th>시간창</th><th>기사</th><th>상태</th><th></th>
            </tr></thead>
            <tbody>${rows.length ? rows.map(o => {
              const editable = orderIsEditable(o);
              const rowCls = [
                'order-row-clickable',
                o.status === '취소' ? 'order-row-cancelled' : '',
                selectedOrderId === o.id ? 'selected' : '',
              ].filter(Boolean).join(' ');
              const statusCell = `${statusBadge(o.status)}${editable ? '<span class="badge-edit">수정</span>' : ''}`;
              return `
              <tr class="${rowCls}" data-order-id="${o.id}">
                <td>${o.id}</td><td>${mixedLoadBadge(isMixedLoad(o))}</td><td>${o.customer}</td><td>${o.pickup}</td><td>${o.delivery}</td>
                <td>${o.cargo || '—'}${o.tons ? ` · ${o.tons}` : ''}</td>
                <td>${o.window}</td><td>${o.driver || '—'}</td><td>${statusCell}</td>
                <td><button type="button" class="btn btn-sm edit-order" data-order-id="${o.id}">수정</button></td>
              </tr>`;
            }).join('') : `
              <tr><td colspan="10" class="empty-hint" style="padding:20px">해당 상태의 오더가 없습니다.</td></tr>`}
            </tbody>
          </table>`)}
          ${paginationHtml(allRows.length, orderPage, 'orders')}
        </div>
      </div>`;
    root.innerHTML = masterDetailShell(
      pageChromeHtml('order-list', { desc: '좌측 목록 · 우측 상세 · 수정 버튼으로 편집' }),
      listCard,
      selected ? inlineDetailCardHtml(`${selected.id} · ${selected.customer}`, orderDetailBodyHtml(selected, detailTab), { saveLabel: '수정' }) : ''
    );
    root.querySelectorAll('#orderChips .chip').forEach(chip => {
      chip.onclick = () => { orderPage = 1; orderFilter = chip.dataset.f; selectedOrderId = null; renderOrderList(root); };
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
        if (e.target.closest('.edit-order')) return;
        orderDetailTab = 'info';
        selectOrder(tr.dataset.orderId);
      };
    });
    if (selected) bindOrderDetail(root, selected);
    bindPagination(root);
  }


  // ── 카카오맵 ──────────────────────────────────────────────────

  function initMap() {
    const container = document.getElementById('map');
    if (!container || map) return;
    const opts = { center: new kakao.maps.LatLng(37.5665, 126.978), level: 10 };
    map = new kakao.maps.Map(container, opts);
  }

  function showDashboardMap() {
    const mapCard = document.querySelector('.dash-map-card');
    const container = document.getElementById('map-container');
    if (!mapCard || !container) return;
    mapCard.innerHTML = '';
    container.style.display = 'block';
    container.style.position = 'relative';
    container.style.width = '100%';
    container.style.height = '100%';
    mapCard.appendChild(container);
    if (map) kakao.maps.event.trigger(map, 'resize');
  }

  function hideDashboardMap() {
    const container = document.getElementById('map-container');
    if (!container) return;
    document.body.appendChild(container);
    container.style.display = 'none';
  }

  function updateDriverMarker(driverId, lat, lon, name) {
    if (!map) return;
    if (_driverMarkers[driverId]) {
      _driverMarkers[driverId].setPosition(new kakao.maps.LatLng(lat, lon));
    } else {
      const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(lat, lon), title: name, map });
      _driverMarkers[driverId] = marker;
    }
  }

  // ── WebSocket ──────────────────────────────────────────────────

  function connectLocationWebSocket() {
    const token = getToken();
    if (!token || _locationWS) return;
    const ws = new WebSocket(`ws://168.138.45.63:8000/ws/location?token=${token}`);
    _locationWS = ws;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'location' || msg.type === 'gps') {
          const d = DATA.drivers.find(x => x.id === (msg.driver_id || msg.user_id));
          if (d) updateDriverMarker(d.id, msg.lat, msg.lon, d.name);
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
      const r = await fetch(`${API}/chat/conversations`, { headers: getAuthHeaders() });
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
    const ws = new WebSocket(`ws://168.138.45.63:8000/ws/chat?token=${token}`);
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
    const hdrs = getAuthHeaders();
    const waypoints = [];
    tasks.forEach((t, gi) => {
      (t.loadings || []).forEach(l => { if (l?.lat) waypoints.push({ name: l.name, lat: l.lat, lon: l.lon, type: 'loading', task_group: gi }); });
      (t.unloadings || []).forEach(u => { if (u?.lat) waypoints.push({ name: u.name, lat: u.lat, lon: u.lon, type: 'unloading', task_group: gi }); });
    });
    if (!waypoints.length) { alert('경유지를 1개 이상 입력하세요.'); return null; }
    const body = { driver_id: driverId, vehicle_id: vehicleId, waypoints, departure_time: new Date().toISOString() };
    if (departureName) body.origin_name = departureName;
    const res = await fetch(`${API}/trips`, { method: 'POST', headers: hdrs, body: JSON.stringify(body) });
    if (!res.ok) { const err = await res.json(); alert(err.detail || '운행 생성 실패'); return null; }
    return await res.json();
  }

  async function runAutoDispatch(tasks, vehicleIds, departure) {
    const hdrs = getAuthHeaders();
    const dispatchTasks = tasks.map((t, i) => ({
      id: i + 1,
      loadings: (t.loadings || []).filter(l => l?.lat).map(l => ({ name: l.name, lat: l.lat, lon: l.lon, type: 'loading', task_group: i })),
      unloadings: (t.unloadings || []).filter(u => u?.lat).map(u => ({ name: u.name, lat: u.lat, lon: u.lon, type: 'unloading', task_group: i })),
    })).filter(t => t.loadings.length > 0);
    if (!dispatchTasks.length) { alert('배차할 태스크가 없습니다.'); return null; }
    const body = { tasks: dispatchTasks, vehicle_ids: vehicleIds, departure_time: departure || new Date().toISOString() };
    const res = await fetch(`${API}/trips/auto-dispatch`, { method: 'POST', headers: hdrs, body: JSON.stringify(body) });
    if (!res.ok) { const err = await res.json(); alert(err.detail || '자동 배차 실패'); return null; }
    return await res.json();
  }

  async function init() {
    if (!requireAdminSession()) return;
    const d = new Date();
    $('#headerDate').textContent = d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
    $('#brandHome').onclick = () => gotoPage('dashboard', 'dashboard');
    $('#modalOverlay').onclick = (e) => { if (e.target === $('#modalOverlay')) closeModal(); };
    // 탑바 버튼 이벤트
    $('#settingsBtn').onclick = () => { location.href = '/settings.html'; };
    $('#notifBtn').onclick = (e) => { e.stopPropagation(); const d = document.getElementById('notifDropdown'); if (d.classList.contains('open')) { _closeAllDropdowns(); } else { _openDropdown('notifDropdown'); } };
    $('#userMenuBtn').onclick = (e) => { e.stopPropagation(); const d = document.getElementById('userDropdown'); if (d.classList.contains('open')) { _closeAllDropdowns(); } else { _openDropdown('userDropdown'); } };
    $('#ddProfile').onclick = () => { _closeAllDropdowns(); gotoPage('profile'); };
    $('#ddSettings').onclick = () => { _closeAllDropdowns(); location.href = '/settings.html'; };
    $('#ddLogout').onclick = () => logout();
    document.addEventListener('click', () => _closeAllDropdowns());
    bindIntakeStopShortcuts();
    renderNav();
    renderPage();
    await loadRealData();
    loadChatConversations();
    connectChatWebSocket();
    // 카카오맵 초기화
    try {
      const cr = await fetch(`${API}/config`);
      if (cr.ok) {
        const cfg = await cr.json();
        const key = cfg.kakao_js_key || cfg.kakao_key || cfg.key;
        if (key) {
          const s = document.createElement('script');
          s.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&libraries=services&autoload=false`;
          s.onload = () => {
            kakao.maps.load(() => {
              initMap();
              connectLocationWebSocket();
              if (currentPage === 'dashboard') showDashboardMap();
            });
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
