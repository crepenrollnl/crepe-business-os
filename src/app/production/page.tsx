import { redirect } from "next/navigation";

/** Legacy path — Production Planning lives at `/production-planning`. */
export default function Page() {
  redirect("/production-planning");
}
