export const dynamic = 'force-dynamic'

import AppShell from '@/components/AppShell'
import TodoListManager from '@/components/TodoListManager'

export default function TodoListPage() {
  return (
    <AppShell>
      <TodoListManager />
    </AppShell>
  )
}
