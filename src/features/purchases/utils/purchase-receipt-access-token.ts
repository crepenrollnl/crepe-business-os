import { supabase } from "@/lib/supabase";

export async function getPurchaseReceiptAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}
