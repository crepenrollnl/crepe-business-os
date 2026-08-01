import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";

export function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
        <h1 className="mb-6 text-center text-2xl font-bold">
          Set a new password
        </h1>

        <ResetPasswordForm />
      </div>
    </div>
  );
}
