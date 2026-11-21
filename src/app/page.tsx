import Link from "next/link";
import { ArrowUpRight, MoonStar, ShieldCheck, Users, Zap } from "lucide-react";

const features = [
  { icon: Users, title: "One table, many screens", text: "Everyone stays in the room. Each player gets their own private view." },
  { icon: ShieldCheck, title: "Private by design", text: "Player information is separated from public game state at the server boundary." },
  { icon: Zap, title: "Rules, not guesswork", text: "A deterministic TypeScript engine will own phase changes and action resolution." }
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-7 sm:px-10">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 font-semibold tracking-wide">
            <span className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06]"><MoonStar size={20} /></span>
            <span>NIGHTFALL</span>
          </Link>
          <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-400">FOUNDATION BUILD · 0.1</span>
        </header>

        <section className="grid flex-1 items-center gap-14 py-20 lg:grid-cols-[1.1fr_.9fr]">
          <div>
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-300/[0.07] px-3 py-1.5 text-xs font-medium text-violet-200">
              <span className="size-1.5 rounded-full bg-violet-300" /> THE TABLETOP STORYTELLER
            </p>
            <h1 className="max-w-2xl text-5xl font-semibold leading-[1.06] tracking-tight sm:text-7xl">
              The night has a <span className="text-violet-300">new voice.</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-zinc-400">
              A digital companion for in-person social deduction. Keep the conversation around the table and let each phone handle its own private moments.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link href="/create" className="inline-flex items-center gap-2 rounded-xl bg-violet-300 px-5 py-3.5 font-semibold text-zinc-950 transition hover:bg-violet-200">
                Create a room <ArrowUpRight size={18} />
              </Link>
              <a href="#how-it-works" className="rounded-xl border border-white/10 px-5 py-3.5 font-medium text-zinc-300 transition hover:bg-white/[0.05]">Explore the foundation</a>
            </div>
            <p className="mt-5 text-xs text-zinc-600">Original placeholder content only · No licensed scripts included</p>
          </div>

          <div className="relative mx-auto w-full max-w-md">
            <div className="absolute -inset-10 rounded-full bg-violet-500/10 blur-3xl" />
            <div className="relative rounded-[2rem] border border-white/10 bg-[#131720] p-5 shadow-2xl shadow-black/40">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div><p className="text-xs text-zinc-500">YOUR TABLE</p><p className="mt-1 font-medium">The Lantern Room</p></div>
                <span className="rounded-full bg-emerald-300/10 px-2.5 py-1 text-xs text-emerald-300">Waiting</span>
              </div>
              <div className="my-7 rounded-2xl border border-violet-200/10 bg-gradient-to-br from-violet-300/10 to-transparent p-6 text-center">
                <MoonStar className="mx-auto text-violet-200" size={34} />
                <p className="mt-4 text-sm text-zinc-400">A place for your next story</p>
                <p className="mt-1 text-2xl font-semibold tracking-[0.2em]">••••••</p>
                <p className="mt-2 text-xs text-zinc-600">ROOM CODE</p>
              </div>
              <div className="space-y-3">
                {["Player One", "Player Two", "Player Three"].map((name, i) => (
                  <div key={name} className="flex items-center gap-3 rounded-xl bg-white/[0.035] p-3">
                    <div className="grid size-9 place-items-center rounded-full bg-white/[0.07] text-sm text-zinc-300">{name[name.length - 1]}</div>
                    <span className="text-sm text-zinc-300">{name}</span>
                    <span className="ml-auto size-2 rounded-full bg-emerald-300" />
                  </div>
                ))}
              </div>
              <div className="mt-5 border-t border-white/10 pt-4 text-center text-xs text-zinc-600">Private player views · Shared table experience</div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="grid gap-4 border-t border-white/10 py-10 md:grid-cols-3">
          {features.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
              <Icon size={20} className="text-violet-200" />
              <h2 className="mt-4 font-medium">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{text}</p>
            </div>
          ))}
        </section>
        <footer className="flex flex-wrap justify-between gap-2 py-5 text-xs text-zinc-600">
          <span>NIGHTFALL · An independent prototype</span><span>Built for the table, not instead of it.</span>
        </footer>
      </div>
    </main>
  );
}
