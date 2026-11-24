import { requireUser } from "../auth";
import { Cabinet } from "./cabinet";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser("/account");
  return <Cabinet initialName={user.name} initialPhone={user.phone}/>;
}