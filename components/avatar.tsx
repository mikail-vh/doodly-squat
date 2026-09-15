type Subject = { displayName: string; avatarUrl: string | null };

export function Avatar({ user, size = 32 }: { user: Subject; size?: number }) {
  const box = { width: size, height: size };

  if (user.avatarUrl) {
    return (
      // Provider CDNs already serve these at avatar size, so next/image would
      // only add an optimizer hop (and a sharp dependency) inside the container.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt=""
        width={size}
        height={size}
        style={box}
        className="sticker-sm shrink-0 rounded-full bg-paper object-cover"
      />
    );
  }

  return (
    <span
      aria-hidden
      style={{ ...box, fontSize: Math.round(size * 0.45) }}
      className="sticker-sm grid shrink-0 place-items-center rounded-full bg-brand font-display text-brand-ink"
    >
      {user.displayName.slice(0, 1).toUpperCase()}
    </span>
  );
}
