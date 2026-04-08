import { useEffect, useMemo, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'todo-assignee-crud'
const TASK_STATUSES = ['todo', 'in_progress', 'done', 'blocked']
const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

// Legacy saved `status` values only (UI is English)
const STATUS_ALIASES = {
  yapilacak: 'todo',
  'yapılacak': 'todo',
  beklemede: 'todo',
  'devam ediyor': 'in_progress',
  yapiliyor: 'in_progress',
  'yapılıyor': 'in_progress',
  tamamlandi: 'done',
  tamamlandı: 'done',
  bitti: 'done',
  engelli: 'blocked',
  engellendi: 'blocked',
}

function getStatusLabel(status) {
  if (status === 'in_progress') return 'In progress'
  if (status === 'done') return 'Done'
  if (status === 'blocked') return 'Blocked'
  return 'To-do'
}

function normalizeAssigneeName(s) {
  const normalized = String(s).trim().replace(/\s+/g, ' ')
  if (normalized === 'Ortak') return 'Shared'
  return normalized
}

function normalizeStatus(rawStatus, done) {
  if (typeof rawStatus === 'string') {
    const key = rawStatus.trim().toLowerCase()
    const mapped = STATUS_ALIASES[key] ?? key
    if (TASK_STATUSES.includes(mapped)) return mapped
  }
  if (done === true) return 'done'
  return 'todo'
}

function isValidYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

function todayYmd() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

function daysInMonth(year, monthOneBased) {
  return new Date(year, monthOneBased, 0).getDate()
}

function taskScheduledDayKey(task) {
  if (typeof task.scheduledFor === 'string' && isValidYmd(task.scheduledFor)) {
    return task.scheduledFor
  }
  return localDayKeyFromIso(task.createdAt)
}

function taskCalendarTimeIso(task) {
  if (typeof task.scheduledFor === 'string' && isValidYmd(task.scheduledFor)) {
    const [y, m, d] = task.scheduledFor.split('-').map(Number)
    return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString()
  }
  return task.createdAt
}

function appendCalendarSearchParts(parts, year, month, day) {
  const date = new Date(year, month - 1, day)
  const monthName = EN_MONTHS[month - 1]
  const shortMonth = monthName.slice(0, 3)
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  const variants = [
    `${year}-${mm}-${dd}`,
    `${year}/${month}/${day}`,
    `${year}/${mm}/${dd}`,
    `${month}/${day}/${year}`,
    `${mm}/${dd}/${year}`,
    `${day}/${month}/${year}`,
    `${dd}/${mm}/${year}`,
    `${year}${mm}${dd}`,
    monthName,
    shortMonth,
    String(year),
    String(day),
    String(month),
    date.toLocaleDateString('en-US', { dateStyle: 'medium' }),
    date.toLocaleDateString('en-US', { dateStyle: 'long' }),
    date.toLocaleDateString('en-US', { weekday: 'long' }),
    date.toLocaleDateString('en-US', { weekday: 'short' }),
  ]
  for (const v of variants) {
    if (v) parts.push(v)
  }
}

function appendDateSearchForYmd(parts, ymd) {
  if (!isValidYmd(ymd)) return
  const [y, m, d] = ymd.split('-').map(Number)
  appendCalendarSearchParts(parts, y, m, d)
}

function appendDateSearchForCreatedAt(parts, iso) {
  if (!isValidIsoDate(iso)) return
  const dt = new Date(iso)
  appendCalendarSearchParts(parts, dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
  parts.push(formatTaskDate(iso))
}

function taskSearchBlob(task) {
  const parts = [task.title, task.assignee]
  if (typeof task.scheduledFor === 'string') {
    parts.push(task.scheduledFor)
    appendDateSearchForYmd(parts, task.scheduledFor)
  }
  appendDateSearchForCreatedAt(parts, task.createdAt)
  for (const e of task.noteEntries ?? []) {
    if (e?.text) parts.push(e.text)
    if (e?.author) parts.push(e.author)
    for (const h of e.history ?? []) {
      if (h?.text) parts.push(h.text)
      if (h?.author) parts.push(h.author)
    }
  }
  return parts.filter(Boolean).join('\0').toLowerCase()
}

function taskMatchesSearch(task, rawQuery) {
  const q = String(rawQuery).trim().toLowerCase()
  if (!q) return true
  return taskSearchBlob(task).includes(q)
}

function isValidIsoDate(s) {
  if (typeof s !== 'string') return false
  const n = Date.parse(s)
  return !Number.isNaN(n)
}

function legacyCreatedAt(index, total) {
  const stepMs = 60_000
  return new Date(Date.now() - (total - index) * stepMs).toISOString()
}

function formatTaskDate(iso) {
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function localDayKeyFromIso(iso) {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDayColumnHeading(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { dateStyle: 'medium' })
}

function sortNoteEntriesNewestFirst(entries) {
  return [...entries].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  )
}

function sortNoteHistoryNewestFirst(history) {
  return [...history].sort(
    (a, b) => new Date(b.editedAt) - new Date(a.editedAt)
  )
}

function parseNoteEntries(rawTask, fallbackCreatedAt) {
  if (Array.isArray(rawTask.noteEntries)) {
    return rawTask.noteEntries
      .map((e) => {
        if (!e || typeof e.text !== 'string') return null
        const text = e.text.trim()
        if (!text) return null
        const id =
          typeof e.id === 'string' && e.id ? e.id : newId()
        const author =
          typeof e.author === 'string'
            ? normalizeAssigneeName(e.author)
            : ''
        let createdAt =
          typeof e.createdAt === 'string' ? e.createdAt : ''
        if (!isValidIsoDate(createdAt)) createdAt = fallbackCreatedAt
        const history = Array.isArray(e.history)
          ? e.history
              .map((h) => {
                if (!h || typeof h.text !== 'string') return null
                const oldText = h.text.trim()
                if (!oldText) return null
                const oldAuthor =
                  typeof h.author === 'string'
                    ? normalizeAssigneeName(h.author)
                    : ''
                let editedAt =
                  typeof h.editedAt === 'string' ? h.editedAt : ''
                if (!isValidIsoDate(editedAt)) editedAt = createdAt
                return { text: oldText, author: oldAuthor, editedAt }
              })
              .filter(Boolean)
          : []
        return { id, author, text, createdAt, history }
      })
      .filter(Boolean)
      .sort(
        (a, b) =>
          new Date(b.createdAt) - new Date(a.createdAt)
      )
  }
  if (typeof rawTask.note === 'string' && rawTask.note.trim()) {
    return [
      {
        id: newId(),
        author: '',
        text: rawTask.note.trim(),
        createdAt: fallbackCreatedAt,
        history: [],
      },
    ]
  }
  return []
}

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const total = parsed.length
    return parsed
      .map((t, index) => {
        if (
          !t ||
          typeof t.id !== 'string' ||
          typeof t.title !== 'string' ||
          typeof t.done !== 'boolean'
        ) {
          return null
        }
        if (typeof t.assignee !== 'string') return null
        const assignee = normalizeAssigneeName(t.assignee)
        if (!assignee) return null
        let createdAt = t.createdAt
        if (!isValidIsoDate(createdAt)) {
          createdAt = legacyCreatedAt(index, total)
        }
        const status = normalizeStatus(t.status, t.done)
        const scheduledRaw = t.scheduledFor
        const scheduledFor =
          typeof scheduledRaw === 'string' && isValidYmd(scheduledRaw)
            ? scheduledRaw
            : undefined
        return {
          id: t.id,
          title: t.title,
          assignee,
          done: status === 'done',
          status,
          createdAt,
          ...(scheduledFor ? { scheduledFor } : {}),
          noteEntries: parseNoteEntries(t, createdAt),
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function saveTasks(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
}

function newId() {
  return crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function App() {
  const [tasks, setTasks] = useState(loadTasks)
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [newStatus, setNewStatus] = useState('todo')
  const [newTaskDate, setNewTaskDate] = useState(() => todayYmd())
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [statusPickerTaskId, setStatusPickerTaskId] = useState(null)
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  const [noteDraftByTask, setNoteDraftByTask] = useState({})
  const [noteEditByTask, setNoteEditByTask] = useState({})
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear()
    return Array.from({ length: 11 }, (_, i) => current - 1 + i)
  }, [])
  const safeDate = isValidYmd(newTaskDate) ? newTaskDate : todayYmd()
  const [safeYear, safeMonth, safeDay] = safeDate.split('-').map(Number)
  const dayOptions = Array.from(
    { length: daysInMonth(safeYear, safeMonth) },
    (_, i) => i + 1
  )

  useEffect(() => {
    saveTasks(tasks)
  }, [tasks])

  const assigneeSuggestions = useMemo(() => {
    const set = new Set(tasks.map((t) => t.assignee))
    return [...set].sort((a, b) =>
      a.localeCompare(b, 'en', { sensitivity: 'base' })
    )
  }, [tasks])

  const sortedFiltered = useMemo(() => {
    const list = [...tasks]
    const searched = searchQuery.trim()
      ? list.filter((t) => taskMatchesSearch(t, searchQuery))
      : list
    return searched.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    )
  }, [tasks, searchQuery])

  const tasksByDay = useMemo(() => {
    const map = new Map()
    for (const task of sortedFiltered) {
      const key = taskScheduledDayKey(task)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(task)
    }
    const keys = [...map.keys()].sort()
    return keys.map((dayKey) => ({
      dayKey,
      tasks: map
        .get(dayKey)
        .sort(
          (a, b) =>
            new Date(b.createdAt) - new Date(a.createdAt)
        ),
    }))
  }, [sortedFiltered])

  function handleAdd(e) {
    e.preventDefault()
    const t = title.trim()
    const name = normalizeAssigneeName(assignee)
    if (!t || !name) return
    const scheduleKey = isValidYmd(newTaskDate) ? newTaskDate : todayYmd()
    setTasks((prev) => [
      ...prev,
      {
        id: newId(),
        title: t,
        assignee: name,
        done: false,
        status: newStatus,
        createdAt: new Date().toISOString(),
        scheduledFor: scheduleKey,
        noteEntries: [],
      },
    ])
    setTitle('')
    setAssignee('')
    setNewStatus('todo')
    setNewTaskDate(todayYmd())
  }

  function setPlannedDatePart(part, rawValue) {
    const nextValue = Number(rawValue)
    if (!Number.isFinite(nextValue)) return
    let year = safeYear
    let month = safeMonth
    let day = safeDay
    if (part === 'year') year = nextValue
    if (part === 'month') month = nextValue
    const maxDay = daysInMonth(year, month)
    if (part === 'day') day = Math.min(nextValue, maxDay)
    else day = Math.min(day, maxDay)
    const ymd = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    setNewTaskDate(ymd)
  }

  function handleDelete(id) {
    setTasks((prev) => prev.filter((x) => x.id !== id))
    setStatusPickerTaskId((open) => (open === id ? null : open))
    if (editingId === id) {
      setEditingId(null)
      setEditTitle('')
    }
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setNoteDraftByTask((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setNoteEditByTask((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function handleToggleDone(id) {
    setTasks((prev) =>
      prev.map((x) =>
        x.id === id
          ? {
              ...x,
              done: !x.done,
              status: x.done ? 'todo' : 'done',
            }
          : x
      )
    )
  }

  function changeStatus(id, status) {
    if (!TASK_STATUSES.includes(status)) return
    setTasks((prev) =>
      prev.map((x) =>
        x.id === id
          ? {
              ...x,
              status,
              done: status === 'done',
            }
          : x
      )
    )
  }

  function startEdit(task) {
    setEditingId(task.id)
    setEditTitle(task.title)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditTitle('')
  }

  function saveEdit(id) {
    const t = editTitle.trim()
    if (!t) return
    setTasks((prev) =>
      prev.map((x) => (x.id === id ? { ...x, title: t } : x))
    )
    setEditingId(null)
    setEditTitle('')
  }

  function changeAssignee(id, value) {
    setTasks((prev) =>
      prev.map((x) => (x.id === id ? { ...x, assignee: value } : x))
    )
  }

  function commitAssignee(id, raw) {
    const n = normalizeAssigneeName(raw)
    changeAssignee(id, n || 'Unassigned')
  }

  function toggleExpanded(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function getNoteDraft(taskId) {
    return (
      noteDraftByTask[taskId] ?? {
        author: '',
        text: '',
      }
    )
  }

  function setNoteDraft(taskId, patch) {
    setNoteDraftByTask((prev) => ({
      ...prev,
      [taskId]: {
        ...(prev[taskId] ?? { author: '', text: '' }),
        ...patch,
      },
    }))
  }

  function appendNoteEntry(taskId) {
    const draft = getNoteDraft(taskId)
    const text = draft.text.trim()
    if (!text) return
    const author = normalizeAssigneeName(draft.author)
    const entry = {
      id: newId(),
      author,
      text,
      createdAt: new Date().toISOString(),
      history: [],
    }
    setTasks((prev) =>
      prev.map((x) =>
        x.id === taskId
          ? {
              ...x,
              noteEntries: sortNoteEntriesNewestFirst([
                ...x.noteEntries,
                entry,
              ]),
            }
          : x
      )
    )
    setNoteDraft(taskId, { text: '' })
  }

  function getEditingNote(taskId, entryId) {
    return noteEditByTask[taskId]?.[entryId] ?? null
  }

  function startNoteEdit(taskId, entry) {
    setNoteEditByTask((prev) => ({
      ...prev,
      [taskId]: {
        ...(prev[taskId] ?? {}),
        [entry.id]: {
          author: entry.author ?? '',
          text: entry.text ?? '',
        },
      },
    }))
  }

  function setEditingNote(taskId, entryId, patch) {
    setNoteEditByTask((prev) => ({
      ...prev,
      [taskId]: {
        ...(prev[taskId] ?? {}),
        [entryId]: {
          ...((prev[taskId] ?? {})[entryId] ?? { author: '', text: '' }),
          ...patch,
        },
      },
    }))
  }

  function cancelNoteEdit(taskId, entryId) {
    setNoteEditByTask((prev) => {
      const byTask = { ...(prev[taskId] ?? {}) }
      delete byTask[entryId]
      const next = { ...prev }
      if (Object.keys(byTask).length === 0) {
        delete next[taskId]
      } else {
        next[taskId] = byTask
      }
      return next
    })
  }

  function saveNoteEdit(taskId, entryId) {
    const current = getEditingNote(taskId, entryId)
    if (!current) return
    const text = current.text.trim()
    if (!text) return
    const author = normalizeAssigneeName(current.author)
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              noteEntries: sortNoteEntriesNewestFirst(
                t.noteEntries.map((e) =>
                  e.id === entryId
                    ? {
                        ...e,
                        text,
                        author,
                        history: [
                          ...(Array.isArray(e.history) ? e.history : []),
                          {
                            text: e.text,
                            author: e.author ?? '',
                            editedAt: new Date().toISOString(),
                          },
                        ],
                      }
                    : e
                )
              ),
            }
          : t
      )
    )
    cancelNoteEdit(taskId, entryId)
  }

  function deleteNoteEntry(taskId, entryId) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              noteEntries: sortNoteEntriesNewestFirst(
                t.noteEntries.filter((e) => e.id !== entryId)
              ),
            }
          : t
      )
    )
    cancelNoteEdit(taskId, entryId)
  }

  return (
    <div className="app" lang="en">
      <datalist id="assignee-datalist">
        {assigneeSuggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <header className="header">
        <h1>Team To-do Tracker</h1>
      </header>

      <form className="form" onSubmit={handleAdd}>
        <label className="sr-only" htmlFor="new-title">
          New task
        </label>
        <input
          id="new-title"
          className="input input-grow"
          type="text"
          autoComplete="off"
          placeholder="Write a task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label className="sr-only" htmlFor="new-assignee">
          Assignee name
        </label>
        <input
          id="new-assignee"
          className="input input-assignee-field"
          type="text"
          autoComplete="off"
          placeholder="Who’s it for?"
          list="assignee-datalist"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        />
        <label className="sr-only" htmlFor="new-status">
          Task status
        </label>
        <select
          id="new-status"
          className="select status-select"
          value={newStatus}
          onChange={(e) => setNewStatus(e.target.value)}
        >
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {getStatusLabel(status)}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="new-date">
          Planned date
        </label>
        <div className="date-picker-en" role="group" aria-label="Planned date">
          <select
            className="select input-date-month"
            value={safeMonth}
            onChange={(e) => setPlannedDatePart('month', e.target.value)}
            aria-label="Month"
          >
            {EN_MONTHS.map((month, idx) => (
              <option key={month} value={idx + 1}>
                {month}
              </option>
            ))}
          </select>
          <select
            className="select input-date-day"
            value={safeDay}
            onChange={(e) => setPlannedDatePart('day', e.target.value)}
            aria-label="Day"
          >
            {dayOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            className="select input-date-year"
            value={safeYear}
            onChange={(e) => setPlannedDatePart('year', e.target.value)}
            aria-label="Year"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">
          Add
        </button>
      </form>

      <div className="filters" role="search">
        <label className="sr-only" htmlFor="task-search">
          Search tasks, people, or dates
        </label>
        <input
          id="task-search"
          type="search"
          className="input filter-search"
          autoComplete="off"
          placeholder="Search tasks, people, or dates…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="task-board" aria-live="polite">
        {sortedFiltered.length === 0 ? (
          <p className="empty">
            {searchQuery.trim()
              ? 'No tasks match your search.'
              : 'No tasks yet.'}
          </p>
        ) : (
          <div className="day-board">
            {tasksByDay.map(({ dayKey, tasks: dayTasks }) => (
              <section
                key={dayKey}
                className="day-column"
                aria-labelledby={`day-heading-${dayKey}`}
              >
                <h2
                  id={`day-heading-${dayKey}`}
                  className="day-column-heading"
                >
                  {formatDayColumnHeading(dayKey)}
                </h2>
                <ul className="list day-column-list">
                  {dayTasks.map((task) => {
            const isOpen = expandedIds.has(task.id)
            const noteCount = task.noteEntries.length
            const hasNotes = noteCount > 0
            const draft = getNoteDraft(task.id)
            return (
              <li
                key={task.id}
                className={`task-card ${task.done ? 'row-done' : ''}`}
              >
                <div className="row">
                  <label className="check-wrap">
                    <input
                      type="checkbox"
                      className="check"
                      checked={task.done}
                      onChange={() => handleToggleDone(task.id)}
                      aria-label={
                        task.done ? 'Mark as not done' : 'Mark as done'
                      }
                    />
                    <span className="check-ui" aria-hidden />
                  </label>

                  <div className="row-main">
                    <div className="status-line">
                      {statusPickerTaskId === task.id ? (
                        <select
                          id={`status-${task.id}`}
                          className="select status-select status-select-inline"
                          value={task.status}
                          autoFocus
                          aria-label="Task status"
                          onChange={(e) => {
                            changeStatus(task.id, e.target.value)
                            setStatusPickerTaskId(null)
                          }}
                          onBlur={() => {
                            window.setTimeout(() => setStatusPickerTaskId(null), 0)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              setStatusPickerTaskId(null)
                            }
                          }}
                        >
                          {TASK_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {getStatusLabel(status)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          type="button"
                          className={`badge badge-status badge-status-${task.status} badge-status-trigger`}
                          onClick={() =>
                            setStatusPickerTaskId((open) =>
                              open === task.id ? null : task.id
                            )
                          }
                          aria-label={`Status: ${getStatusLabel(task.status)}. Click to change`}
                        >
                          {getStatusLabel(task.status)}
                        </button>
                      )}
                    </div>
                    {editingId === task.id ? (
                      <div className="edit-row">
                        <input
                          className="input input-edit"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(task.id)
                            if (e.key === 'Escape') cancelEdit()
                          }}
                          autoFocus
                          aria-label="Edit task title"
                        />
                        <div className="edit-actions">
                          <button
                            type="button"
                            className="btn btn-small"
                            onClick={() => saveEdit(task.id)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="btn btn-small btn-ghost"
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="task-heading">
                        <span className="title">{task.title}</span>
                        <time
                          className="task-meta"
                          dateTime={taskCalendarTimeIso(task)}
                        >
                          {formatTaskDate(taskCalendarTimeIso(task))}
                        </time>
                      </div>
                    )}
                  </div>

                  <div className="row-footer">
                    <span className="badge badge-assignee">
                      {task.assignee}
                    </span>

                    <label className="sr-only" htmlFor={`assign-${task.id}`}>
                      Assignee name
                    </label>
                    <input
                      id={`assign-${task.id}`}
                      className="input input-assignee-field input-assignee-row"
                      type="text"
                      autoComplete="off"
                      list="assignee-datalist"
                      value={task.assignee}
                      onChange={(e) => changeAssignee(task.id, e.target.value)}
                      onBlur={(e) => commitAssignee(task.id, e.target.value)}
                      aria-label="Assignee name"
                    />

                    <div className="row-actions">
                      <button
                        type="button"
                        className={`btn btn-small btn-ghost note-toggle ${hasNotes ? 'note-toggle-filled' : ''}`}
                        onClick={() => toggleExpanded(task.id)}
                        aria-expanded={isOpen}
                        aria-controls={`task-note-${task.id}`}
                        id={`task-note-trigger-${task.id}`}
                      >
                        {isOpen
                          ? 'Hide notes'
                          : hasNotes
                            ? `Notes (${noteCount})`
                            : 'Add note'}
                      </button>
                      {editingId !== task.id && (
                        <button
                          type="button"
                          className="btn btn-small btn-ghost"
                          onClick={() => startEdit(task)}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-small btn-danger"
                        onClick={() => handleDelete(task.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <div
                    className="row-note"
                    id={`task-note-${task.id}`}
                    role="region"
                    aria-labelledby={`task-note-trigger-${task.id}`}
                  >
                    <p className="note-thread-title">Notes in this task</p>
                    <div className="note-entries">
                      {!hasNotes ? (
                        <p className="note-empty">
                          No notes yet. Write yours below—more people can add
                          their own lines here.
                        </p>
                      ) : (
                        sortNoteEntriesNewestFirst(task.noteEntries).map(
                          (entry) => {
                          const editing = getEditingNote(task.id, entry.id)
                          return (
                            <article
                              key={entry.id}
                              className="note-entry"
                            >
                              <header className="note-entry-head">
                                <span className="note-entry-author">
                                  {entry.author || 'Someone'}
                                </span>
                                <time
                                  className="note-entry-time"
                                  dateTime={entry.createdAt}
                                >
                                  {formatTaskDate(entry.createdAt)}
                                </time>
                              </header>
                              {editing ? (
                                <div className="note-edit-form">
                                  <label
                                    className="note-label"
                                    htmlFor={`edit-note-author-${entry.id}`}
                                  >
                                    Name
                                  </label>
                                  <input
                                    id={`edit-note-author-${entry.id}`}
                                    className="input note-author-input"
                                    type="text"
                                    autoComplete="off"
                                    list="assignee-datalist"
                                    value={editing.author}
                                    onChange={(e) =>
                                      setEditingNote(task.id, entry.id, {
                                        author: e.target.value,
                                      })
                                    }
                                  />
                                  <label
                                    className="note-label"
                                    htmlFor={`edit-note-text-${entry.id}`}
                                  >
                                    Text
                                  </label>
                                  <textarea
                                    id={`edit-note-text-${entry.id}`}
                                    className="input note-input"
                                    value={editing.text}
                                    onChange={(e) =>
                                      setEditingNote(task.id, entry.id, {
                                        text: e.target.value,
                                      })
                                    }
                                    rows={3}
                                    spellCheck
                                  />
                                  <div className="note-entry-actions">
                                    <button
                                      type="button"
                                      className="btn btn-small"
                                      onClick={() =>
                                        saveNoteEdit(task.id, entry.id)
                                      }
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-small btn-ghost"
                                      onClick={() =>
                                        cancelNoteEdit(task.id, entry.id)
                                      }
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="note-entry-text">
                                    {entry.text}
                                  </div>
                                  {Array.isArray(entry.history) &&
                                    entry.history.length > 0 && (
                                      <div className="note-history">
                                        <p className="note-history-title">
                                          Previous versions
                                        </p>
                                        {sortNoteHistoryNewestFirst(
                                          entry.history
                                        ).map((old, idx) => (
                                          <div
                                            key={`${entry.id}-history-${old.editedAt}-${idx}`}
                                            className="note-history-item"
                                          >
                                            <div className="note-history-meta">
                                              <span>
                                                {old.author || 'Someone'}
                                              </span>
                                              <time dateTime={old.editedAt}>
                                                {formatTaskDate(old.editedAt)}
                                              </time>
                                            </div>
                                            <div className="note-history-text">
                                              {old.text}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  <div className="note-entry-actions">
                                    <button
                                      type="button"
                                      className="btn btn-small btn-ghost"
                                      onClick={() =>
                                        startNoteEdit(task.id, entry)
                                      }
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-small btn-danger"
                                      onClick={() =>
                                        deleteNoteEntry(task.id, entry.id)
                                      }
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </>
                              )}
                            </article>
                          )
                        })
                      )}
                    </div>

                    <div className="note-composer">
                      <label
                        className="note-label"
                        htmlFor={`note-author-${task.id}`}
                      >
                        Your name
                      </label>
                      <input
                        id={`note-author-${task.id}`}
                        className="input note-author-input"
                        type="text"
                        autoComplete="off"
                        placeholder="Who is writing?"
                        list="assignee-datalist"
                        value={draft.author}
                        onChange={(e) =>
                          setNoteDraft(task.id, { author: e.target.value })
                        }
                      />
                      <label
                        className="note-label"
                        htmlFor={`note-text-${task.id}`}
                      >
                        Your text
                      </label>
                      <textarea
                        id={`note-text-${task.id}`}
                        className="input note-input"
                        value={draft.text}
                        onChange={(e) =>
                          setNoteDraft(task.id, { text: e.target.value })
                        }
                        placeholder="Add a comment, detail, or follow-up…"
                        rows={3}
                        spellCheck
                      />
                      <button
                        type="button"
                        className="btn btn-primary note-add-btn"
                        onClick={() => appendNoteEntry(task.id)}
                      >
                        Add to this task
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
