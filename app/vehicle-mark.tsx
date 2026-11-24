"use client";

import { useState } from "react";
import { CarFront } from "lucide-react";
import { vehicleBrand } from "./vehicle-brand";

export function VehicleMark({ name, className }: { name: string; className: string }) {
  const brand = vehicleBrand(name);
  const [unavailable, setUnavailable] = useState<string>();
  return <span className={className} aria-hidden="true">{brand && brand !== unavailable
    ? <img className="vehicle-mark-image" src={"/brand-marks/" + brand + ".webp"} width={25} height={24}
      alt="" decoding="async" loading="lazy" onError={() => setUnavailable(brand)}/>
    : <CarFront size={18}/>}</span>;
}
