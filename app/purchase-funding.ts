import { defaultWeights, totals } from "./ledger";
import type { Car, Ledger, Partner } from "./ledger";

export type FundingMode = "invested" | "purchase";

export function purchaseContributionAmounts(price: number, fixed: (number | null)[]) {
  if (!Number.isSafeInteger(price) || price < 0 || fixed.some(amount => amount !== null && (!Number.isSafeInteger(amount) || amount < 0))) return null;
  const remaining = price - fixed.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  const automatic = fixed.filter(amount => amount === null).length;
  if (remaining < 0 || (!automatic && remaining !== 0)) return null;
  const equal = automatic ? Math.floor(remaining / automatic) : 0;
  let remainder = automatic ? remaining % automatic : 0;
  return fixed.map(amount => {
    if (amount !== null) return amount;
    if (remainder === 0) return equal;
    remainder--;
    return equal + 1;
  });
}

export function purchaseContributionWeights(amounts: number[]) {
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (!total) return defaultWeights(amounts.length);
  const weights = amounts.map(amount => Math.floor(amount * 10_000 / total));
  const priority = amounts.map((amount, index) => ({ index, remainder: amount * 10_000 % total }))
    .sort((a, b) => b.remainder - a.remainder);
  const left = 10_000 - weights.reduce((sum, weight) => sum + weight, 0);
  for (const { index } of priority.slice(0, left)) weights[index]++;
  return weights;
}

export function fundingSources(partners: Partner[]) {
  return [
    ...partners.map((person, index) => ({ id: person.id, name: person.name, tone: index })),
    { id: null, name: "Общая касса", tone: -1 },
  ];
}

export type FundingSource = ReturnType<typeof fundingSources>[number];

export function carFunding(car: Car, through: string) {
  const purchase = new Map<string | null, number>();
  if (car.cashPurchase) purchase.set(null, car.buy);
  else for (const share of car.shares) purchase.set(share.partner, share.buy);

  const invested = new Map(purchase);
  for (const expense of car.expenses) {
    if (expense.date <= through) invested.set(expense.payer, (invested.get(expense.payer) ?? 0) + expense.amount);
  }

  return { purchase, invested };
}

export function fundingSnapshot(ledger: Ledger, through: string) {
  const cars = ledger.cars.filter(car => car.bought <= through).sort((a, b) => b.bought.localeCompare(a.bought));
  const active = cars.filter(car => !car.sold || car.sold > through);
  const deployed = new Map<string | null, number>();
  for (const car of active) {
    for (const [id, amount] of carFunding(car, through).invested) {
      deployed.set(id, (deployed.get(id) ?? 0) + amount);
    }
  }
  // Use the recorded deal profit for both the cash payout and the retained balance.
  const completed = cars.filter(car => car.sold && car.sold <= through).map(car => ({
    ...car,
    shares: car.shares.map(share => ({
      ...share,
      withdrawn: share.withdrawn && (!share.cashWithdrawalDate || share.cashWithdrawalDate <= through),
      payouts: share.payouts?.filter(payment => payment.date <= through),
    })),
  }));
  const { balances } = totals({ ...ledger, cars: completed });
  const total = [...deployed.values()].reduce((sum, amount) => sum + amount, 0);

  return { cars, active, deployed, balances, total };
}
