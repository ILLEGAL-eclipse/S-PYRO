import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">That page does not exist in S-PYRO.</p>
      <Link href="/" className="mt-5 inline-block text-sm text-primary hover:underline">Back to Overview</Link>
    </div>
  );
}
