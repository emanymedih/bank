"use client";

import { useState } from "react";
import type { ChangeEvent } from "react";
import { Camera, Check, ImagePlus, X } from "lucide-react";
import { normalizePlate, plateCandidates, plateFromParts } from "../lib/license-plate";
import { findPlateRegions } from "../lib/plate-image";
import type { ImageRegion } from "../lib/plate-image";

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

function luminance(pixels: Uint8ClampedArray, offset: number) {
  return (77 * pixels[offset] + 150 * pixels[offset + 1] + 29 * pixels[offset + 2]) >> 8;
}

function detectRegions(image: HTMLCanvasElement) {
  const scan = document.createElement("canvas");
  const scale = Math.min(1, 900 / Math.max(image.width, image.height));
  scan.width = Math.max(1, Math.round(image.width * scale));
  scan.height = Math.max(1, Math.round(image.height * scale));
  const context = scan.getContext("2d", { alpha: false });
  if (!context) return [];
  context.drawImage(image, 0, 0, scan.width, scan.height);
  const pixels = context.getImageData(0, 0, scan.width, scan.height).data;
  const gray = new Uint8Array(scan.width * scan.height);
  for (let index = 0; index < gray.length; index++) gray[index] = luminance(pixels, index * 4);
  return findPlateRegions(gray, scan.width, scan.height).map(box => ({
    x: box.x * image.width / scan.width, y: box.y * image.height / scan.height,
    width: box.width * image.width / scan.width, height: box.height * image.height / scan.height,
  }));
}

function plateCrop(image: HTMLCanvasElement, box: ImageRegion, left: number, top: number, right: number, bottom: number) {
  const width = box.width * (right - left), height = box.height * (bottom - top);
  const scale = Math.max(1, 100 / height);
  const padding = 18;
  const crop = document.createElement("canvas");
  crop.width = Math.ceil(width * scale) + 2 * padding;
  crop.height = Math.ceil(height * scale) + 2 * padding;
  const context = crop.getContext("2d", { alpha: false })!;
  context.fillStyle = "white";
  context.fillRect(0, 0, crop.width, crop.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, box.x + left * box.width, box.y + top * box.height, width, height,
    padding, padding, crop.width - 2 * padding, crop.height - 2 * padding);
  const pixels = context.getImageData(0, 0, crop.width, crop.height);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const gray = luminance(pixels.data, offset);
    pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = gray;
  }
  context.putImageData(pixels, 0, 0);
  return crop;
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
  const regions = detectRegions(canvas);
  const attempts = 2 + regions.length * 2;
  let completed = 0;
  let failStartup: () => void = () => {};
  const startupFailure = new Promise<never>((_, reject) => {
    failStartup = () => reject(new Error("OCR worker could not initialize"));
  });
  const startupTimer = window.setTimeout(() => failStartup(), 30_000);
  const workerReady = createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: assets + "worker.min.js",
    corePath: assets,
    langPath: assets,
    workerBlobURL: false,
    errorHandler: () => failStartup(),
    logger: message => {
      if (message.status === "recognizing text") onProgress(Math.round((completed + message.progress) / attempts * 100));
    },
  });

  let worker: Awaited<typeof workerReady>;
  try { worker = await Promise.race([workerReady, startupFailure]); }
  catch (failure) {
    void workerReady.then(late => late.terminate()).catch(() => {});
    throw failure;
  } finally {
    window.clearTimeout(startupTimer);
    failStartup = () => {};
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ";
  async function recognize(image: HTMLCanvasElement, mode: typeof PSM[keyof typeof PSM], whitelist = alphabet) {
    await worker.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: whitelist });
    try { return (await worker.recognize(image)).data.text; }
    finally { completed++; }
  }

  try {
    const candidates = plateCandidates(await recognize(canvas, PSM.SPARSE_TEXT));
    if (candidates.length) return candidates;
    const closeups = new Set<string>();
    for (const box of regions) {
      const main = await recognize(plateCrop(canvas, box, .035, .065, .75, .95), PSM.SINGLE_LINE);
      const region = await recognize(plateCrop(canvas, box, .76, 0, .995, .66), PSM.SINGLE_LINE, "0123456789");
      const candidate = plateFromParts(main, region);
      if (candidate) closeups.add(candidate);
    }
    if (closeups.size) return [...closeups];
    return plateCandidates(await recognize(canvas, PSM.SINGLE_LINE));
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
      if (!values.length) setMessage("Номер не прочитался. Обрежьте фото вокруг номера, сделайте снимок крупнее или введите номер вручную.");
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
        <p>Подойдёт фото автомобиля, на котором номер виден целиком. Снимок номера крупным планом распознаётся легче.</p>
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
