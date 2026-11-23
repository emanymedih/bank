import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <Dashboard signedIn={Boolean(user)} signInUrl={chatGPTSignInPath("/")} sellerScope={user?.userId} />;
}
