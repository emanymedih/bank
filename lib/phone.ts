// Российский мобильный номер в формате +79XXXXXXXXX; 8/7/9-начала принимаются, мусор отклоняется.
export function normalizeRussianPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/\D/g, "");
  let national: string | null = null;
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) national = digits.slice(1);
  else if (digits.length === 10 && digits[0] === "9") national = digits;
  if (!national || national[0] !== "9") return null;
  return "+7" + national;
}

export function maskPhone(phone: string): string {
  return phone.slice(0, 3) + " *** *** " + phone.slice(10);
}
