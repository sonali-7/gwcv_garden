import Link from "next/link";

export function ViewTabs({ current }: { current: "garden" | "calendar" }) {
  return (
    <nav className="view-tabs" aria-label="Views">
      <Link href="/garden" aria-current={current === "garden" ? "page" : undefined}>
        Garden
      </Link>
      <Link href="/" aria-current={current === "calendar" ? "page" : undefined}>
        Calendar
      </Link>
    </nav>
  );
}
