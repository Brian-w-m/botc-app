import Link from "next/link";
import { ArrowLeft, UsersRound } from "lucide-react";
import RoleSprite from "@/components/RoleSprite";
import { troubleBrewingRoles, troubleBrewingSetupCounts } from "@/lib/games/trouble-brewing";

const teams = ["Townsfolk", "Outsider", "Minion", "Demon"] as const;
const teamStyles: Record<(typeof teams)[number], string> = {
  Townsfolk: "border-sky-200/15 bg-sky-200/[0.05] text-sky-100",
  Outsider: "border-teal-200/15 bg-teal-200/[0.05] text-teal-100",
  Minion: "border-rose-200/15 bg-rose-200/[0.05] text-rose-100",
  Demon: "border-amber-200/15 bg-amber-200/[0.05] text-amber-100"
};

export default async function TroubleBrewingScriptPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();

  return (
    <main className="min-h-screen px-5 py-7 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <Link href={`/room/${code}/play`} className="inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-white">
          <ArrowLeft size={16} /> Back to game
        </Link>

        <header className="mt-8 border-b border-white/[0.08] pb-7">
          <p className="text-xs font-medium tracking-[0.22em] text-violet-200">PUBLIC GAME REFERENCE</p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Trouble Brewing</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">The full script, character abilities, and setup counts for each player total.</p>
        </header>

        <section className="mt-8" aria-labelledby="setup-heading">
          <div className="flex items-center gap-2 text-violet-200"><UsersRound size={17} /><h2 id="setup-heading" className="text-lg font-semibold text-white">Player setup</h2></div>
          <p className="mt-2 text-base text-zinc-400">Player totals run across the top; role categories are listed down the left.</p>
          <div className="mx-auto mt-4 max-w-5xl overflow-x-auto rounded-xl border border-white/10 bg-[#131720]">
            <table className="w-full min-w-[800px] border-collapse text-center text-sm">
              <thead className="text-xs uppercase tracking-[0.12em]">
                <tr>
                  <th scope="col" className="sticky left-0 bg-[#131720] px-4 py-3 text-left font-medium text-zinc-400">Players</th>
                  {Object.keys(troubleBrewingSetupCounts).map(total => <th key={total} scope="col" className="px-3 py-3 font-bold text-zinc-100">{total}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {teams.map((team, categoryIndex) => (
                  <tr key={team}>
                    <th scope="row" className={`sticky left-0 whitespace-nowrap border-r border-white/[0.06] px-4 py-3 text-left font-medium ${categoryIndex < 2 ? "bg-[#131720] text-sky-200" : "bg-[#131720] text-rose-200"}`}>{team}</th>
                    {Object.entries(troubleBrewingSetupCounts).map(([total, counts]) => <td key={total} className={`px-3 py-3 ${categoryIndex < 2 ? "bg-sky-300/[0.025] text-sky-100/80" : "bg-rose-300/[0.025] text-rose-100/80"}`}>{counts[categoryIndex]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10" aria-labelledby="roles-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium tracking-[0.18em] text-violet-200">ALL CHARACTERS</p>
              <h2 id="roles-heading" className="mt-2 text-2xl font-semibold">The script</h2>
            </div>
            <p className="text-sm text-zinc-500">{troubleBrewingRoles.length} characters</p>
          </div>

          <div className="mt-5 space-y-8">
            {teams.map(team => {
              const roles = troubleBrewingRoles.filter(role => role.team === team);
              return (
                <section key={team} aria-labelledby={`team-${team.toLowerCase()}`}>
                  <div className="mb-3 flex items-center gap-3">
                    <h3 id={`team-${team.toLowerCase()}`} className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">{team}</h3>
                    <span className="text-xs text-zinc-600">{roles.length}</span>
                    <div className="h-px flex-1 bg-white/[0.07]" />
                  </div>
                  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {roles.map(role => (
                      <li key={role.id} className={`flex min-h-28 items-center gap-4 rounded-2xl border p-4 ${teamStyles[team]}`}>
                        <RoleSprite roleName={role.name} size={64} className="size-16 shrink-0 drop-shadow-lg" />
                        <div className="min-w-0">
                          <h4 className="font-semibold text-zinc-100">{role.name}</h4>
                          <p className="mt-1 text-sm leading-5 text-zinc-400">{role.ability}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </section>

        <footer className="mt-10 border-t border-white/[0.08] pt-5 text-xs leading-5 text-zinc-600">
          This page is public to everyone in the room and shows the script only. Private roles and game information remain hidden.
        </footer>
      </div>
    </main>
  );
}
