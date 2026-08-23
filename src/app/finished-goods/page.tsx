import { redirect } from "next/navigation";

/** Legacy path — Finished Goods lives as a tab on `/inventory`. */
export default function Page() {
  redirect("/inventory?tab=finished-goods");
}
