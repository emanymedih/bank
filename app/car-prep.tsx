"use client";

import { useState } from "react";
import type { ChangeEvent } from "react";
import { Camera, Check, ClipboardList, Download, ExternalLink, ImagePlus, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { maxPhotoBytes, maxPhotosPerUpload } from "./ledger";
import type { Car, CarPart, CarPhoto, PhotoPhase, WorkEntry } from "./ledger";
import type { PhotoSource } from "./car-report";

export async function preparePhotos(files: File[]) {
  if (!files.length) return [];
  if (files.length > maxPhotosPerUpload) throw new Error("Выберите не больше 8 фотографий за одну загрузку.");
  const ready = [];
  for (const file of files) {
    if (file.size > 32_000_000) throw new Error("Выберите фотографии размером до 32 МБ.");
    const source = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1500 / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Обработка фотографий недоступна на этом устройстве.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let compressed = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", .83));
      if (compressed && compressed.size > maxPhotoBytes) {
        compressed = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", .65));
      }
      if (!compressed || compressed.size > maxPhotoBytes) throw new Error("Фотография слишком большая.");
      ready.push(new File([compressed], "photo.jpg", { type: "image/jpeg" }));
    } catch {
      throw new Error("Не удалось открыть одну из фотографий. Попробуйте JPEG или PNG.");
    } finally {
      URL.revokeObjectURL(source);
    }
  }
  return ready;
}

function PhotoGallery({ photos, source, onEdit }: {
  photos: CarPhoto[]; source: PhotoSource; onEdit: (photo: CarPhoto) => void;
}) {
  if (!photos.length) return null;
  return <div className="prep-photos">{photos.map(photo => <figure key={photo.id}>
    <a href={source(photo)} target="_blank" rel="noreferrer" aria-label={photo.caption || "Открыть фотографию"}>
      <img src={source(photo)} alt={photo.caption || "Фото автомобиля"} loading="lazy"/>
    </a>
    <figcaption>
      <span>{photo.caption || "Добавить подпись"}</span>
      <button className="icon-button" onClick={() => onEdit(photo)} aria-label="Изменить подпись или удалить фото"><Pencil size={15}/></button>
    </figcaption>
  </figure>)}</div>;
}

function PhotoInput({ busy, onPick }: { busy: boolean; onPick: (files: File[]) => Promise<void> }) {
  const [uploading, setUploading] = useState(false);
  async function select(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) return;
    setUploading(true);
    try { await onPick(files); }
    finally { setUploading(false); }
  }
  return <label className={"button secondary photo-picker" + (busy || uploading ? " disabled" : "")}>
    <input type="file" accept="image/*" multiple disabled={busy || uploading} onChange={event => void select(event)}
      aria-label="Добавить фотографии"/>
    <ImagePlus size={17}/>{uploading ? "Загрузка…" : "Добавить фото"}
  </label>;
}

export function WorkHistory({ car, busy, error, source, dateLabel, onUpload, onWork, onPhoto, onReport }: {
  car: Car; busy: boolean; error: string; source: PhotoSource; dateLabel: (value: string) => string;
  onUpload: (phase: PhotoPhase, files: File[], workId?: string) => Promise<void>;
  onWork: (work?: WorkEntry) => void; onPhoto: (photo: CarPhoto) => void; onReport: () => void;
}) {
  const photos = car.photos ?? [];
  const works = [...(car.works ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  return <div className="prep">
    <div className="prep-report">
      <div><h3>Отчёт для покупателя</h3><p>Состояние при покупке, выполненные работы и итоговые фотографии.</p></div>
      <button className="button primary" onClick={onReport}><Download size={17}/>Скачать PDF</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="prep-section">
      <div className="detail-section-header"><h3><Camera size={18}/> При покупке</h3>
        <PhotoInput busy={busy} onPick={files => onUpload("before", files)}/></div>
      <p className="prep-help">Снимите машину спереди, сзади, с обоих бортов и с четырёх углов. Дополнительно можно снять крышу и салон.</p>
      <PhotoGallery photos={photos.filter(photo => photo.phase === "before")} source={source} onEdit={onPhoto}/>
    </section>
    <section className="prep-section">
      <div className="detail-section-header"><h3><Wrench size={18}/> Выполненные работы</h3>
        <button className="button secondary" onClick={() => onWork()}><Plus size={17}/>Добавить работу</button></div>
      {works.length ? <ol className="prep-timeline">{works.map(entry => <li key={entry.id}>
        <div className="prep-work-heading">
          <div><small>{dateLabel(entry.date)}</small><h4>{entry.name}</h4></div>
          <button className="icon-button" aria-label={"Изменить работу «" + entry.name + "»"} onClick={() => onWork(entry)}><Pencil size={16}/></button>
        </div>
        {entry.notes && <p>{entry.notes}</p>}
        <PhotoGallery photos={photos.filter(photo => photo.workId === entry.id)} source={source} onEdit={onPhoto}/>
        <PhotoInput busy={busy} onPick={files => onUpload("work", files, entry.id)}/>
      </li>)}</ol> : <p className="prep-help">Добавьте выполненную работу. К ней можно прикрепить несколько фотографий.</p>}
    </section>
    <section className="prep-section">
      <div className="detail-section-header"><h3><Camera size={18}/> После подготовки</h3>
        <PhotoInput busy={busy} onPick={files => onUpload("after", files)}/></div>
      <PhotoGallery photos={photos.filter(photo => photo.phase === "after")} source={source} onEdit={onPhoto}/>
    </section>
  </div>;
}

export function PartPlan({ car, busy, error, rub, onAdd, onBatch, onEdit, onRemove, onExpense, onToggle }: {
  car: Car; busy: boolean; error: string; rub: (amount: number) => string; onAdd: () => void; onBatch: () => void;
  onEdit: (part: CarPart) => void; onRemove: (part: CarPart) => void;
  onExpense: (part: CarPart) => void; onToggle: (part: CarPart) => void;
}) {
  const items = car.parts ?? [];
  const expenses = new Map(car.expenses.map(expense => [expense.id, expense.amount]));
  const plannedTotal = items.reduce((sum, part) => sum + (part.plannedPrice ?? 0), 0);
  const actualTotal = items.reduce((sum, part) => sum + (part.expenseId ? expenses.get(part.expenseId) ?? 0 : 0), 0);
  return <div className="prep">
    <div className="prep-report part-top">
      <div><h3>Список запчастей</h3><p>Отметьте купленное и добавьте расход, когда известна фактическая сумма.</p></div>
      <div className="part-actions">
        <button className="button secondary" onClick={onAdd}><Plus size={17}/>Позиция</button>
        <button className="button primary" onClick={onBatch}><ClipboardList size={17}/>Ввести списком</button>
      </div>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {(plannedTotal > 0 || actualTotal > 0) && <dl className="part-totals">
      {plannedTotal > 0 && <div><dt>По указанным ценам</dt><dd>{rub(plannedTotal)}</dd></div>}
      {actualTotal > 0 && <div><dt>В расходах по списку</dt><dd>{rub(actualTotal)}</dd></div>}
    </dl>}
    {items.length ? <ul className="part-list">{items.map(part => <li key={part.id}>
      <label className="part-title"><input type="checkbox" disabled={busy || Boolean(part.expenseId)} checked={part.acquired}
        aria-label={"Куплено: " + part.name} onChange={() => onToggle(part)}/>
        <span><b>{part.name}</b>{part.article && <small>Артикул · {part.article}</small>}
          {part.plannedPrice && <small>План · {rub(part.plannedPrice)}</small>}
          {part.expenseId && <small>В расходах · {rub(expenses.get(part.expenseId) ?? 0)}</small>}
        </span></label>
      <div className="part-row-actions">
        {part.link && <a className="icon-button" aria-label="Открыть объявление" href={part.link} target="_blank" rel="noreferrer"><ExternalLink size={15}/></a>}
        <button className="button secondary" onClick={() => onExpense(part)}>
          {part.expenseId ? <Pencil size={16}/> : <Check size={16}/>}{part.expenseId ? "Изменить расход" : "В расходы"}
        </button>
        <button className="icon-button" aria-label={"Изменить " + part.name} onClick={() => onEdit(part)}><Pencil size={15}/></button>
        <button className="icon-button" aria-label={"Удалить " + part.name} onClick={() => onRemove(part)}><Trash2 size={15}/></button>
      </div>
    </li>)}</ul> : <div className="empty prep-empty"><ClipboardList size={23}/><p>Пока нет запчастей в плане.</p></div>}
  </div>;
}
