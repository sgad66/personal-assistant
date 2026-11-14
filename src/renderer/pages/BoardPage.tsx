import React, { useEffect, useMemo, useState } from 'react'
import { getWeekStart } from '@shared/time-kit'
import { useAppStore } from '../stores/app-store'
import { useNavigationStore } from '../stores/navigation-store'
import { useScheduleStore } from '../stores/schedule-store'
import { useAgentStore } from '../stores/agent-store'
import HomeDashboard from '../components/home/HomeDashboard'

interface BoardPageProps {
  readonly onOpenSettings: () => void
}

export default function BoardPage({ onOpenSettings }: BoardPageProps): React.ReactElement {
  const navigate = useNavigationStore((state) => state.navigate)
  const home = useAppStore((state) => state.home)
  const bootstrap = useAppStore((state) => state.bootstrap)
  const week = useScheduleStore((state) => state.week)
  const load = useScheduleStore((state) => state.load)
  const openDetail = useScheduleStore((state) => state.openDetail)
  const setSeedPrompt = useAgentStore((state) => state.setSeedPrompt)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const currentWeekStart = home?.currentWeekStart ?? getWeekStart(now)
  useEffect(() => {
    if (!week || week.weekStart !== currentWeekStart) {
      void load(currentWeekStart)
    }
  }, [week, currentWeekStart, load])

  const today = useMemo(() => week?.days.find((day) => day.isToday), [week])
  const startPrompt = (text: string): void => {
    if (text.length > 0) setSeedPrompt(text)
    navigate('agent')
  }

  return (
    <main className="page board-page">
      <HomeDashboard
        days={week?.days ?? []}
        week={week}
        today={today}
        now={now}
        aiStatus={home?.aiStatus ?? 'local'}
        openDetail={(eventId) => void openDetail(eventId)}
        prompt={startPrompt}
        openWeek={() => navigate('week')}
        openSettings={onOpenSettings}
      />
    </main>
  )
}