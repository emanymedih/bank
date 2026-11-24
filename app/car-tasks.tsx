"use client";

import { useState } from "react";
import { CalendarClock, Check, Plus, Trash2 } from "lucide-react";
import type { Car, CarTask } from "./ledger";
import { dateLabel } from "./format";

const today = () => new Date().toISOString().slice(0, 10);

export function CarTasks({ car, userName, busy, onSave }: {
  car: Car; userName?: string; busy: boolean; onSave: (car: Car, message: string, undoable?: boolean) => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const tasks = [...(car.tasks ?? [])].sort((a, b) =>
    Number(a.done) - Number(b.done) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.createdAt.localeCompare(b.createdAt));
  const open = tasks.filter(task => !task.done).length;

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = title.trim();
    if (!text) { setError("Напишите, что нужно сделать."); return; }
    const task: CarTask = { id: crypto.randomUUID(), title: text, due: due || undefined, done: false, author: userName, createdAt: today() };
    setTitle(""); setDue(""); setError("");
    await onSave({ ...car, tasks: [...(car.tasks ?? []), task] }, "Задача добавлена");
  }

  return <section className="panel car-tasks" aria-label="Задачи по автомобилю">
    <div className="section-header">
      <div><h2>Задачи</h2><p>Общие на всю книгу: их видят и отмечают все участники. {open ? `Открыто: ${open}.` : "Все задачи выполнены."}</p></div>
    </div>
    <form className="task-add" onSubmit={add}>
      <label className="field">Что сделать<input value={title} onChange={event => { setTitle(event.target.value); setError(""); }}
        placeholder="Например, заменить масло" maxLength={120} required/></label>
      <label className="field">Срок<input type="date" value={due} min={today()} onChange={event => setDue(event.target.value)}/></label>
      <button className="button primary" type="submit" disabled={busy}><Plus size={16}/>Добавить</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {tasks.length ? <ul className="task-list">
      {tasks.map(task => <li key={task.id} className={task.done ? "done" : ""}>
        <button type="button" className="task-check" disabled={busy} aria-pressed={task.done}
          aria-label={task.done ? "Вернуть в работу: " + task.title : "Отметить выполненной: " + task.title}
          onClick={() => void onSave({ ...car, tasks: (car.tasks ?? []).map(item => item.id === task.id ? { ...item, done: !item.done } : item) },
            task.done ? "Задача возвращена в работу" : "Задача выполнена")}>
          {task.done && <Check size={14} aria-hidden="true"/>}
        </button>
        <div className="task-body">
          <strong>{task.title}</strong>
          <small>
            {task.due && <span className={task.due < today() && !task.done ? "negative" : ""}><CalendarClock size={12} aria-hidden="true"/> {task.due < today() && !task.done ? "Просрочено · " : ""}{dateLabel(task.due)}</span>}
            {task.author && <span> · {task.author}</span>}
          </small>
        </div>
        <button type="button" className="task-remove" disabled={busy} aria-label={"Удалить задачу: " + task.title}
          onClick={() => setPendingRemove(pendingRemove === task.id ? null : task.id)}>
          <Trash2 size={15}/>
        </button>
        {pendingRemove === task.id && <div className="task-confirm" role="alert">
          <span>Удалить задачу «{task.title}»? Её можно будет вернуть из уведомления.</span>
          <button type="button" className="button danger" disabled={busy}
            onClick={() => { setPendingRemove(null); void onSave({ ...car, tasks: (car.tasks ?? []).filter(item => item.id !== task.id) }, "Задача удалена", true); }}>Удалить</button>
          <button type="button" className="button secondary" disabled={busy} onClick={() => setPendingRemove(null)}>Отмена</button>
        </div>}
      </li>)}
    </ul> : <p className="feed-empty">Пока нет задач. Добавьте первую — например, «Помыть и сфотографировать».</p>}
  </section>;
}