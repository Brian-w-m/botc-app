import Link from "next/link";
import { ArrowLeft, UsersRound } from "lucide-react";
import JoinRoomForm from "@/components/JoinRoomForm";

export default function JoinPage() {
  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-white"><ArrowLeft size={16} /> Back</Link>
        <section className="mt-16 rounded-3xl border border-white/10 bg-[#131720] p-7 sm:p-10">
          <div className="grid size-12 place-items-center rounded-2xl bg-violet-300/10 text-violet-200"><UsersRound /></div>
          <p className="mt-7 text-xs font-medium tracking-[0.2em] text-violet-200">TAKE YOUR SEAT</p>
          <h1 className="mt-3 text-3xl font-semibold">Join a table</h1>
          <p className="mb-8 mt-3 leading-7 text-zinc-400">Enter the code shared by your Storyteller and choose the name everyone will see.</p>
          <JoinRoomForm />
        </section>
      </div>
    </main>
  );
}
