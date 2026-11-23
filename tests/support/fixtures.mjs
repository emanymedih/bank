export const alice = { id: "partner-1", name: "Участник А" };
export const bob = { id: "partner-2", name: "Участник Б" };

export function makeCar(overrides = {}) {
  return {
    id: "test-car", name: "Машина для проверки", vin: "", mileage: null, year: 2017,
    bought: "2026-10-01", buy: 100_000_000, sold: null, price: null,
    shares: [
      { partner: alice.id, buy: 50_000_000, weight: 5000, withdrawn: false },
      { partner: bob.id, buy: 50_000_000, weight: 5000, withdrawn: false },
    ],
    expenses: [], ...overrides,
  };
}

export function makeLedger(...cars) {
  return { partners: [alice, bob], cars };
}

export function expense(overrides = {}) {
  return {
    id: "paint", name: "Покраска", date: "2026-10-18", amount: 6_200_000, payer: alice.id,
    ...overrides,
  };
}
