import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Crepe'n Roll OS",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 text-base leading-relaxed text-zinc-900 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
        Privacy Policy — Crepe&apos;n Roll OS
      </h1>
      <p className="mt-2 text-sm text-zinc-600">Last updated: 7 October 2026</p>

      <p className="mt-6">
        Crepe&apos;n Roll OS is an internal business tool used by the owners of
        Crepe&apos;n Roll (Amsterdam, the Netherlands) to manage purchases,
        stock, production and sales. It is not offered to the public.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-zinc-950">What we store</h2>
      <p className="mt-2">
        The tool stores business records entered by its authorised users:
        purchases, receipts, stock, recipes, sales and accounting entries.
        Photos of purchase receipts are stored in the tool&apos;s private
        storage.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-zinc-950">Google Drive</h2>
      <p className="mt-2">
        When connected, the tool copies receipt photos into a &quot;Receipts&quot;
        folder in the Google Drive of the business&apos;s own Google account. It
        uses the Google Drive permission &quot;drive.file&quot;, which lets it
        create and manage only the files it has created itself. It cannot see,
        read, change or delete any other file in that Google Drive, and it does
        not access Gmail, contacts, calendar or any other Google data.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-zinc-950">
        Who can see the data
      </h2>
      <p className="mt-2">
        Only signed-in, authorised users of the business. We do not sell, rent
        or share this data with third parties, and we do not use it for
        advertising. Service providers that host the tool process the data on
        our behalf: Supabase (database and file storage), Vercel (hosting) and
        Google (Drive copies).
      </p>

      <h2 className="mt-8 text-lg font-semibold text-zinc-950">Retention</h2>
      <p className="mt-2">
        Records and receipt photos are kept for as long as the business is
        legally required to keep its administration. Copies on Google Drive stay
        there until the business deletes them.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-zinc-950">Removing access</h2>
      <p className="mt-2">
        The business can disconnect Google Drive at any time by removing the
        app&apos;s access at{" "}
        <a
          href="https://myaccount.google.com/permissions"
          className="break-all underline"
        >
          https://myaccount.google.com/permissions
        </a>
        .
      </p>

      <h2 className="mt-8 text-lg font-semibold text-zinc-950">Contact</h2>
      <p className="mt-2">
        <a href="mailto:crepenroll.nl@gmail.com" className="underline">
          crepenroll.nl@gmail.com
        </a>
      </p>

      <p className="mt-10">
        <a href="/login" className="text-sm font-medium text-zinc-700 underline">
          Back to sign in
        </a>
      </p>
    </main>
  );
}
