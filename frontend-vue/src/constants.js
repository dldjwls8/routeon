export const NAV = [
  { id: 'dashboard', label: '대시보드', icon: '📊', pages: [{ id: 'dashboard', label: '요약' }] },
  { id: 'control', label: '운행관제', icon: '📡', pages: [{ id: 'control-live', label: '실시간 차량 관제' }] },
  { id: 'dispatch', label: '오더관리', icon: '📦', pages: [
    { id: 'order-intake', label: '오더접수' },
    { id: 'order-list', label: '오더목록' },
    { id: 'dispatch-manage', label: '배차관리' },
  ]},
  { id: 'customers', label: '고객관리', icon: '🏢', pages: [{ id: 'customer-list', label: '고객 관리' }] },
  { id: 'schedule', label: '일정·통계', icon: '📅', pages: [
    { id: 'schedule-calendar', label: '캘린더' },
    { id: 'schedule-gantt', label: '간트' },
    { id: 'schedule-milestones', label: '마일스톤' },
    { id: 'trip-stats', label: '사후 통계' },
  ]},
  { id: 'basic', label: '기본정보', icon: '⚙️', pages: [
    { id: 'drivers', label: '자기사' },
    { id: 'vehicles', label: '차량' },
    { id: 'staff', label: '담당자' },
    { id: 'profile', label: '기업 정보' },
  ]},
];

export const PAGE_SIZE = 20;

export const ORDER_STATUS_MAP = {
  pending: '접수',
  in_progress: '운행중',
  done: '완료',
  cancelled: '취소',
  done_manual: '완료',
};

export const TRIP_STATUS_MAP = {
  pending: '대기',
  assigned: '배차',
  in_progress: '운행중',
  completed: '완료',
  cancelled: '취소',
};

export function statusBadgeClass(status) {
  switch (status) {
    case '완료': return 'badge-ok';
    case '운행중': return 'badge-run';
    case '접수': return 'badge-info';
    case '배차': return 'badge-warn';
    case '취소': return 'badge-muted';
    default: return 'badge-muted';
  }
}

export function deliveryDisplayStatus(order) {
  const s = ORDER_STATUS_MAP[order.status] || order.status;
  if (s === '접수' && order.driver_id) return '배차';
  return s;
}
