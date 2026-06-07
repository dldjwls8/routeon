import { ref } from 'vue'
import { PAGE_SIZE } from '@/constants.js'

/** @file src/composables/useListPage.js
 *  목록 화면의 페이지네이션 / 검색 / 필터 상태를 관리하는 공통 composable.
 *  필터 로직은 뷰마다 상이하므로 allItems computed를 뷰에서 제공받는다.
 */

export function useListPage() {
  const page = ref(1)
  const search = ref('')
  const filter = ref('전체')

  /**
   * @param {any[]} allItems  필터링이 끝난 전체 아이템 배열
   */
  function paginate(allItems) {
    return allItems.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
  }

  function totalPages(allItems) {
    return Math.max(1, Math.ceil(allItems.length / PAGE_SIZE))
  }

  return { page, search, filter, paginate, totalPages, PAGE_SIZE }
}
