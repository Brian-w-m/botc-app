export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <main className="min-h-screen px-6 py-16">
      <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-[#131720] p-8">
        <p className="text-xs tracking-widest text-violet-200">ROOM CREATED</p>
        <h1 className="mt-4 text-3xl font-semibold">Your table is ready</h1>
        <p className="mt-3 text-zinc-400">Share this code with the other players.</p>
        <div className="my-8 rounded-2xl bg-black/30 p-7 text-center">
          <p className="text-4xl font-semibold tracking-[0.3em]">{code}</p>
          <p className="mt-3 text-xs text-zinc-600">ROOM CODE</p>
        </div>
        <p className="text-sm leading-6 text-zinc-500">This is an early foundation screen. Joining, authenticated player sessions and live lobby updates are the next implementation slice.</p>
      </div>
    </main>
  );
}
