import React, { useState, useMemo } from "react";

// Premier League 2026-27 Prediction Desk
// - 20 clubs, double round-robin fixtures (380 matches)
// - Simple Poisson model using club strength ratings
// - Season Monte Carlo: simulate full season many times to estimate
//   champion/top-4/relegation probabilities and average points.

// Club strength ratings (arbitrary scale similar to Elo)
const TEAMS = {
  "Arsenal": [1850, ["Ødegaard", "Saka", "Ødegaard"]],
  "Manchester City": [1900, ["Haaland", "Foden", "De Bruyne"]],
  "Manchester United": [1760, ["Antony", "Rashford", "Mount"]],
  "Liverpool": [1840, ["Mohamed Salah", "Gakpo", "Nunez"]],
  "Chelsea": [1720, ["Nunez", "Coleman", "Sterling"]],
  "Tottenham": [1780, ["Kane", "Son", "Richarlison"]],
  "Newcastle United": [1765, ["Wilson", "Isak", "Guimaraes"]],
  "Aston Villa": [1700, ["Ollie Watkins", "Grealish", "Barkley"]],
  "West Ham United": [1650, ["Antonio", "Bowen", "Emerson"]],
  "Brighton": [1690, ["Mitchell", "Welbeck", "Grosicki"]],
  "Brentford": [1630, ["Toney", "Janelt", "Mbeumo"]],
  "Wolves": [1600, ["Jiménez", "Neves", "Pedro Neto"]],
  "Fulham": [1580, ["Mitrović", "Guehi", "Palhinha"]],
  "Crystal Palace": [1560, ["Olise", "Zaha", "Eze"]],
  "Everton": [1550, ["Calvert-Lewin", "Richarlison", "Gordon"]],
  "Leicester City": [1540, ["Vardy", "Lookman", "Ndidi"]],
  "Nottingham Forest": [1500, ["Gaston", "Sporar", "Gomes"]],
  "Bournemouth": [1490, ["Dominic Solanke", "Baimbridge", "King"]],
  "Burnley": [1470, ["Wood", "Brady", "Guehi"]],
  "Luton Town": [1450, ["Cornick", "Ilias", "Potts"]],
};

const CLUBS = Object.keys(TEAMS);

// generate double round-robin fixtures as matchdays (38 rounds)
function generateMatchdays(teams) {
  const t = teams.slice();
  const n = t.length;
  if (n % 2 !== 0) t.push("BYE");
  const N = t.length;
  const rounds = [];
  const arr = t.slice();
  for (let r = 0; r < N - 1; r++) {
    const pairs = [];
    for (let i = 0; i < N / 2; i++) {
      const a = arr[i];
      const b = arr[N - 1 - i];
      if (a !== "BYE" && b !== "BYE") {
        // alternate home advantage by round for variety
        if (r % 2 === 0) pairs.push({ home: a, away: b });
        else pairs.push({ home: b, away: a });
      }
    }
    rounds.push(pairs);
    // rotate (keep first fixed)
    arr.splice(1, 0, arr.pop());
  }
  // duplicate with swapped home/away for second half
  const secondHalf = rounds.map((rnd) => rnd.map((m) => ({ home: m.away, away: m.home })));
  return rounds.concat(secondHalf);
}

const ALL_MATCHDAYS = generateMatchdays(CLUBS); // 38 rounds
const ALL_MATCHES = ALL_MATCHDAYS.flat();

// map rating to strength; center near 0
const ratingOf = (pts) => (pts - 1500) / 200; // tuned for club scale

function expectedGoals(home, away) {
  const rH = ratingOf(TEAMS[home][0]);
  const rA = ratingOf(TEAMS[away][0]);
  const base = 1.35;
  let lamH = base * Math.exp(1.2 * (rH - rA));
  let lamA = base * Math.exp(1.2 * (rA - rH));
  // home advantage
  lamH *= 1.12;
  return [Math.max(0.1, lamH), Math.max(0.05, lamA)];
}

function samplePoisson(lam) {
  if (lam <= 0) return 0;
  const L = Math.exp(-lam);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function runSeasonMonteCarlo(N = 2000) {
  const teams = CLUBS.slice();
  const rankCounts = {};
  const avgPoints = {};
  teams.forEach((t) => { rankCounts[t] = Array(teams.length).fill(0); avgPoints[t] = 0; });

  for (let s = 0; s < N; s++) {
    const pts = {};
    teams.forEach((t) => pts[t] = 0);
    // play every fixture once (home/away)
    for (const m of ALL_MATCHES) {
      const [lh, la] = expectedGoals(m.home, m.away);
      const gh = samplePoisson(lh), ga = samplePoisson(la);
      if (gh > ga) pts[m.home] += 3;
      else if (gh < ga) pts[m.away] += 3;
      else { pts[m.home] += 1; pts[m.away] += 1; }
    }
    const table = teams.map((t) => ({ team: t, pts: pts[t] }))
      .sort((a, b) => b.pts - a.pts || a.team.localeCompare(b.team));
    table.forEach((row, idx) => { rankCounts[row.team][idx] += 1; avgPoints[row.team] += row.pts; });
  }

  // normalize
  teams.forEach((t) => { avgPoints[t] = Math.round((avgPoints[t] / N) * 10) / 10; });
  return { rankCounts, avgPoints, sims: N };
}

function pct(v, N) { return `${Math.round((v / N) * 1000) / 10}%`; }

function LeagueTable({ stats }) {
  const teams = CLUBS.slice().sort((a,b) => stats.avgPoints[b] - stats.avgPoints[a]);
  return (
    <div>
      <h2 style={{marginTop:0}}>Projected Table (by avg points)</h2>
      <table style={{width:'100%', borderCollapse:'collapse'}}>
        <thead>
          <tr style={{textAlign:'left'}}>
            <th>Pos</th><th>Club</th><th>Avg pts</th><th>Champ%</th><th>Top4%</th><th>Releg%</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t,i) => {
            const champ = stats.rankCounts[t][0];
            const top4 = stats.rankCounts[t].slice(0,4).reduce((a,b)=>a+b,0);
            const releg = stats.rankCounts[t].slice(-3).reduce((a,b)=>a+b,0);
            return (
              <tr key={t} style={{borderTop:'1px solid #eee'}}>
                <td style={{width:40}}>{i+1}</td>
                <td>{t}</td>
                <td style={{width:90}}>{stats.avgPoints[t]}</td>
                <td style={{width:90}}>{pct(champ, stats.sims)}</td>
                <td style={{width:90}}>{pct(top4, stats.sims)}</td>
                <td style={{width:90}}>{pct(releg, stats.sims)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FixturesList() {
  const [matchday, setMatchday] = React.useState(1);
  const rounds = ALL_MATCHDAYS;
  const cur = rounds[matchday - 1] || [];

  return (
    <div>
      <h2 style={{marginTop:0}}>Fixtures — Matchday {matchday}</h2>
      <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:8}}>
        <label style={{color:'#333'}}>Matchday</label>
        <select value={matchday} onChange={(e) => setMatchday(Number(e.target.value))}>
          {rounds.map((_, i) => <option key={i} value={i+1}>MD {i+1}</option>)}
        </select>
      </div>
      <div style={{maxHeight:420, overflow:'auto', border:'1px solid #eee', padding:8}}>
        {cur.map((m, i) => {
          const [lh, la] = expectedGoals(m.home, m.away);
          const probHomeWin = Math.min(0.99, Math.max(0.01, 1 - Math.exp(-(lh - la + 0.2))));
          return (
            <div key={i} style={{display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px dashed #f4f4f4'}}>
              <div style={{fontWeight:600}}>{m.home} <span style={{color:'#999'}}>v</span> {m.away}</div>
              <div style={{color:'#666'}}>xG {lh.toFixed(2)}–{la.toFixed(2)} · {Math.round(probHomeWin*100)}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState('table');
  const [stats, setStats] = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    // run in small batches to keep UI responsive (but here synchronous)
    const res = runSeasonMonteCarlo(1500);
    setStats(res);
    setRunning(false);
  };

  const quickStats = useMemo(() => stats, [stats]);

  return (
    <div style={{fontFamily:'Inter, system-ui, sans-serif', padding:20, maxWidth:1000, margin:'0 auto'}}>
      <h1 style={{marginBottom:6}}>Premier League 2026-27 Prediction Desk</h1>
      <p style={{color:'#666', marginTop:0}}>Season simulation using a Poisson model derived from club strength ratings.</p>

      <div style={{display:'flex', gap:8, marginBottom:16}}>
        <button onClick={() => setTab('table')} style={{padding:8, background: tab==='table'?'#222':'#eee', color: tab==='table'?'#fff':'#000'}}>League table</button>
        <button onClick={() => setTab('fixtures')} style={{padding:8, background: tab==='fixtures'?'#222':'#eee', color: tab==='fixtures'?'#fff':'#000'}}>Fixtures</button>
        <button onClick={run} style={{padding:8, marginLeft:'auto'}} disabled={running}>{running?'Running…':'Run season Monte Carlo'}</button>
      </div>

      {tab === 'fixtures' && <FixturesList />}
      {tab === 'table' && (stats ? <LeagueTable stats={stats} /> : <div>No simulation run yet. Click "Run season Monte Carlo".</div>)}
    </div>
  );
}
