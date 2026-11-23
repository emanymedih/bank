"use client";

import { useState } from "react";
import type { ChangeEvent } from "react";
import { Camera, Check, ImagePlus, X } from "lucide-react";
import { normalizePlate, plateCandidates } from "../lib/license-plate";

async function preparePlateImage(file: File) {
  if (file.size > 32_000_000) throw new Error("Выберите фото размером до 32 МБ.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    const scale = Math.min(2, 1550 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Браузер не смог обработать фотографию.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readPlate(file: File, onProgress: (value: number) => void) {
  let canvas: HTMLCanvasElement;
  try { canvas = await preparePlateImage(file); }
  catch (failure) {
    if (failure instanceof Error && file.size > 32_000_000) throw failure;
    throw new Error("Фото не открылось. Попробуйте JPEG, PNG или новый снимок.");
  }

  const { createWorker, OEM, PSM } = await import("tesseract.js");
  const assets = new URL("/ocr/", window.location.origin).href;
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: assets + "worker.min.js",
    corePath: assets,
    langPath: assets,
    workerBlobURL: false,
    logger: message => {
      if (message.status === "recognizing text") onProgress(Math.round(message.progress * 100));
    },
  });

  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 " });
    const initial = await worker.recognize(canvas);
    const candidates = plateCandidates(initial.data.text);
    if (candidates.length) return candidates;
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const second = await worker.recognize(canvas);
    return plateCandidates(second.data.text);
  } finally {
    await worker.terminate();
  }
}

export function PlatePhoto({ disabled, onApply }: { disabled: boolean; onApply: (plate: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [number, setNumber] = useState("");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || reading) return;
    setReading(true);
    setCandidates([]);
    setMessage("");
    setNumber("");
    setProgress(0);
    try {
      const values = await readPlate(file, setProgress);
      setCandidates(values);
      if (values.length === 1) setNumber(values[0]);
      if (!values.length) setMessage("Номер не прочитался. Снимите его крупнее или введите вручную.");
      else if (values.length > 1) setMessage("На фото читается несколько вариантов. Выберите нужный номер.");
    } catch (failure) {
      setMessage(failure instanceof Error && /фото/i.test(failure.message)
        ? failure.message : "Распознавание сейчас недоступно. Номер можно ввести вручную.");
    } finally {
      setReading(false);
    }
  }

  function apply() {
    const verified = normalizePlate(number);
    if (!verified || verified.length > 16) { setMessage("Проверьте госномер."); return; }
    onApply(verified);
    setOpen(false);
    setNumber("");
    setMessage("");
    setCandidates([]);
  }

  if (!open) return <div className="plate-entry">
    <button type="button" className="button secondary plate-open" disabled={disabled} onClick={() => setOpen(true)}>
      <Camera size={18}/>Заполнить по фото
    </button>
  </div>;

  return <div className="plate-entry plate-opened">
    <div className="plate-header">
      <div><b><Camera size={18}/> Заполнить по фото</b>
        <p>Госномер должен быть чистым и виден целиком. Снимите его крупно, прямо и без бликов.</p>
      </div>
      <button type="button" className="icon-button" aria-label="Закрыть ввод по фото" disabled={reading}
        onClick={() => setOpen(false)}><X size={18}/></button>
    </div>
    <div className="plate-actions">
      <label className={"button primary photo-picker" + (reading ? " disabled" : "")}><Camera size={17}/>Снять номер
        <input type="file" accept="image/*" capture="environment" aria-label="Снять номер" disabled={reading || disabled} onChange={event => void handlePhoto(event)}/>
      </label>
      <label className={"button secondary photo-picker" + (reading ? " disabled" : "")}><ImagePlus size={17}/>Выбрать фото
        <input type="file" accept="image/*" aria-label="Выбрать фото с госномером" disabled={reading || disabled} onChange={event => void handlePhoto(event)}/>
      </label>
    </div>
    {reading && <p className="plate-feedback" role="status">{progress ? "Распознаём номер… " + progress + "%" : "Загружаем распознавание…"}</p>}
    {message && <p className="plate-feedback" role="status">{message}</p>}
    {candidates.length > 1 && <div className="plate-options">{candidates.map(value =>
      <button type="button" key={value} className="button secondary" aria-pressed={number === value} onClick={() => setNumber(value)}>{value}</button>)}</div>}
    {!reading && (candidates.length > 0 || message) && <div className="plate-confirm">
      <label className="field">Проверьте номер<input value={number} onChange={event => setNumber(event.target.value.toUpperCase())} maxLength={20}
        autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="А123ВС250"/></label>
      <button type="button" className="button primary" onClick={apply} disabled={disabled || !number.trim()}><Check size={17}/>Использовать номер</button>
    </div>}
  </div>;
}
