import { totals } from "./ledger";
import type { Car, Ledger, Partner } from "./ledger";

export type FundingMode = "invested" | "purchase";

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
