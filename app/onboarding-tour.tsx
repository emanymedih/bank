"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";

const steps = [
  {
    title: "Одна книга на всех",
    text: "Учёт общий: вы и партнёры видите одну кассу, машины и расчёты. Пригласить участника и назначить роль можно в кабинете.",
  },
  {
    title: "Касса — ваш банк",
    text: "Начальный остаток и все поступления и списания живут в кассе. «Доступно на покупку» сразу показывает, сколько можно вложить в следующую машину.",
  },
  {
    title: "Машина по госномеру",
    text: "Добавьте авто: госномер, цена покупки и доли участников. Марка и VIN могут подставиться сами — из вашей книги или поиска по номеру.",
  },
  {
    title: "Видно, кто что изменил",
    text: "Лента и вкладка «Правки» в карточке показывают каждое изменение с автором и суммами «было → стало». Задачи по машине — общие для всех.",
  },
];

export function OnboardingTour({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { primaryRef.current?.focus(); }, [step]);
  const finish = () => { try { localStorage.setItem("avto_tour_" + userId, "1"); } catch { /* storage недоступен */ } onDone(); };
  const current = steps[step];
  return <div className="tour-overlay" role="dialog" aria-modal="true" aria-labelledby="tour-title"
    onKeyDown={event => {
      if (event.key === "Escape") { finish(); return; }
      if (event.key !== "Tab") return;
      const nodes = cardRef.current?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea");
      if (!nodes?.length) return;
      const list = [...nodes].filter(node => !node.hasAttribute("disabled"));
      const first = list[0], last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
    <div className="tour-card" ref={cardRef}>
      <button className="tour-close" type="button" aria-label="Пропустить обучение" onClick={finish}><X size={18}/></button>
      <p className="tour-step">Шаг {step + 1} из {steps.length}</p>
      <h2 id="tour-title">{current.title}</h2>
      <p className="tour-text">{current.text}</p>
      <div className="tour-dots" aria-hidden="true">
        {steps.map((_, index) => <i key={index} className={index === step ? "active" : ""}/>)}
      </div>
      <div className="tour-actions">
        <button className="button secondary" type="button" onClick={finish}>Пропустить</button>
        {step > 0 && <button className="button secondary" type="button" onClick={() => setStep(step - 1)}>Назад</button>}
        <button ref={primaryRef} className="button primary" type="button" onClick={() => step + 1 < steps.length ? setStep(step + 1) : finish()}>
          {step + 1 < steps.length ? <>Далее<ArrowRight size={16}/></> : "Начать работу"}
        </button>
      </div>
    </div>
  </div>;
}