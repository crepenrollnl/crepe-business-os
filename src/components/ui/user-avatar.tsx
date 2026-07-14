type UserAvatarProps = {
  initials?: string;
};

export function UserAvatar({ initials = "CR" }: UserAvatarProps) {
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-semibold text-amber-800 ring-2 ring-white"
      aria-label="User avatar placeholder"
    >
      {initials}
    </div>
  );
}
