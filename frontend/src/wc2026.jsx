import React, { useState, useMemo, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// 2026 World Cup prediction desk
// Self-contained: team strength derived from April 2026 FIFA points / rank order.
// Model: bivariate-ish Poisson. Expected goals from attack vs defense strength,
// host advantage for USA/Mexico/Canada. Win/draw/loss from scoreline grid.
// ---------------------------------------------------------------------------

// FIFA points where known (Apr 2026); others interpolated from rank order.
// rating ~ centered so an average WC team sits near 0.
const TEAMS = {
  // name: [fifaPoints, [key attackers...]]
  France: [1877, ["Mbappé", "Dembélé", "Olise"]],
  Spain: [1876, ["Yamal", "Oyarzabal", "Olmo"]],
  Argentina: [1875, ["Messi", "J. Álvarez", "L. Martínez"]],
  England: [1826, ["Kane", "Bellingham", "Saka"]],
  Portugal: [1764, ["R. Leão", "B. Fernandes", "P. Neto"]],
  Brazil: [1761, ["Vinícius Jr", "Rodrygo", "Raphinha"]],
  Netherlands: [1758, ["Gakpo", "Depay", "Simons"]],
  Morocco: [1756, ["Hakimi", "En-Nesyri", "Ziyech"]],
  Belgium: [1735, ["De Bruyne", "Lukaku", "Doku"]],
  Germany: [1730, ["Wirtz", "Musiala", "Havertz"]],
  Croatia: [1717, ["Budimir", "Kramarić", "Sučić"]],
  Italy: [1700, ["Retegui", "Kean", "Raspadori"]],
  Colombia: [1693, ["L. Díaz", "J. Córdoba", "James"]],
  Senegal: [1689, ["Sarr", "Jackson", "Mané"]],
  Mexico: [1681, ["Raúl Jiménez", "Santi Giménez", "Lozano"]],
  USA: [1673, ["Pulisic", "Balogun", "Weah"]],
  Uruguay: [1673, ["Núñez", "Pellistri", "Araújo"]],
  Japan: [1660, ["Kubo", "Mitoma", "Ueda"]],
  Switzerland: [1649, ["Embolo", "Ndoye", "Vargas"]],
  Denmark: [1621, ["Højlund", "Hjulmand", "B. Lindstrøm"]],
  Iran: [1600, ["Taremi", "Azmoun", "Gholizadeh"]],
  "South Korea": [1585, ["Son", "Hwang Hee-chan", "Lee Kang-in"]],
  Ecuador: [1570, ["Valencia", "Caicedo", "Páez"]],
  Austria: [1560, ["Arnautović", "Baumgartner", "Gregoritsch"]],
  Türkiye: [1550, ["Yıldız", "Güler", "Aktürkoğlu"]],
  Australia: [1540, ["Duke", "Irvine", "McGree"]],
  Canada: [1535, ["David", "J. David", "Larin"]],
  Ukraine: [1520, ["Dovbyk", "Mudryk", "Yaremchuk"]],
  Norway: [1510, ["Haaland", "Sørloth", "Nusa"]],
  Panama: [1500, ["Fajardo", "Carrasquilla", "Waterman"]],
  Poland: [1495, ["Lewandowski", "Świderski", "Zalewski"]],
  Wales: [1485, ["Moore", "James", "Wilson"]],
  Algeria: [1470, ["Mahrez", "Amoura", "Bounedjah"]],
  Egypt: [1465, ["Salah", "Marmoush", "Trezeguet"]],
  Serbia: [1455, ["Mitrović", "Vlahović", "Tadić"]],
  Nigeria: [1450, ["Osimhen", "Lookman", "Boniface"]],
  Paraguay: [1440, ["A. Sanabria", "Almirón", "Enciso"]],
  Tunisia: [1420, ["Msakni", "Jebali", "Khazri"]],
  "Ivory Coast": [1415, ["Haller", "Krasso", "Pépé"]],
  Sweden: [1410, ["Gyökeres", "Isak", "Elanga"]],
  Czechia: [1405, ["Schick", "Hložek", "Černý"]],
  Slovakia: [1395, ["Strelec", "Haraslín", "Bož. Šranko"]],
  Qatar: [1330, ["Afif", "Ali", "Muntari"]],
  "Saudi Arabia": [1290, ["Al-Dawsari", "Al-Shehri", "Al-Buraikan"]],
  "South Africa": [1280, ["Mokoena", "Zwane", "Foster"]],
  Jordan: [1255, ["Al-Naimat", "Al-Tamari", "Olwan"]],
  "Cape Verde": [1235, ["Tavares", "Mendes", "Andrade"]],
  Ghana: [1215, ["Kudus", "J. Ayew", "Semenyo"]],
  Curaçao: [1140, ["Bacuna", "Janga", "Sambo"]],
  Haiti: [1130, ["Pierrot", "Bazile", "Mondésir"]],
  "New Zealand": [1115, ["Wood", "Garbett", "Stamenić"]],
  Uzbekistan: [1310, ["Shomurodov", "Urunov", "Masharipov"]],
  Iraq: [1300, ["Aymen Hussein", "Resan", "Ali Jasim"]],
  "Bosnia and Herzegovina": [1430, ["Džeko", "Demirović", "Tabaković"]],
  Scotland: [1385, ["Adams", "Dykes", "McGinn"]],
  "DR Congo": [1290, ["Mayele", "Bakambu", "Bongonda"]],
};

const HOSTS = ["USA", "Mexico", "Canada"];

// 12 groups (A-L) from the Dec 2025 draw.
const GROUPS = {
  A: ["Mexico", "South Africa", "South Korea", "Czechia"],
  B: ["Canada", "Bosnia and Herzegovina", "Qatar", "Switzerland"],
  C: ["Brazil", "Morocco", "Haiti", "Scotland"],
  D: ["USA", "Paraguay", "Australia", "Türkiye"],
  E: ["Germany", "Curaçao", "Ivory Coast", "Ecuador"],
  F: ["Netherlands", "Japan", "Sweden", "Tunisia"],
  G: ["Belgium", "Egypt", "Iran", "New Zealand"],
  H: ["Spain", "Cape Verde", "Saudi Arabia", "Uruguay"],
  I: ["France", "Senegal", "Iraq", "Norway"],
  J: ["Argentina", "Algeria", "Austria", "Jordan"],
  K: ["Portugal", "DR Congo", "Uzbekistan", "Colombia"],
  L: ["England", "Croatia", "Ghana", "Panama"],
};

// ---- model helpers --------------------------------------------------------

// map FIFA points to a strength rating centered near tournament average.
const ratingOf = (pts) => (pts - 1500) / 110; // ~ -3.5 .. +3.4

function expectedGoals(teamA, teamB) {
  const rA = ratingOf(TEAMS[teamA][0]);
  const rB = ratingOf(TEAMS[teamB][0]);
  const base = 1.35; // league-avg goals per team per match
  // attack scales with own rating, suppressed by opponent rating
  let lamA = base * Math.exp(0.32 * (rA - rB));
  let lamB = base * Math.exp(0.32 * (rB - rA));
  // host advantage (neutral-ish venues, modest bump)
  if (HOSTS.includes(teamA)) lamA *= 1.12;
  if (HOSTS.includes(teamB)) lamB *= 1.12;
  return [clamp(lamA), clamp(lamB)];
}
const clamp = (x) => Math.max(0.25, Math.min(4.2, x));

const poisson = (k, lam) =>
  (Math.pow(lam, k) * Math.exp(-lam)) / factorial(k);
const factorial = (n) => (n <= 1 ? 1 : n * factorial(n - 1));

function predict(teamA, teamB) {
  const [lamA, lamB] = expectedGoals(teamA, teamB);
  const MAX = 8;
  let pA = 0,
    pDraw = 0,
    pB = 0;
  const scoreGrid = [];
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = poisson(i, lamA) * poisson(j, lamB);
      if (i > j) pA += p;
      else if (i === j) pDraw += p;
      else pB += p;
      scoreGrid.push({ a: i, b: j, p });
    }
  }
  scoreGrid.sort((x, y) => y.p - x.p);
  const topScores = scoreGrid.slice(0, 3);
  const expTotal = lamA + lamB;
  // P(total > 2.5)
  let pUnder = 0;
  for (let i = 0; i <= MAX; i++)
    for (let j = 0; j <= MAX; j++)
      if (i + j <= 2) pUnder += poisson(i, lamA) * poisson(j, lamB);
  const pOver = 1 - pUnder;
  return { lamA, lamB, pA, pDraw, pB, topScores, expTotal, pOver, pUnder };
}

// goalscorer probabilities: distribute a team's expected goals across its
// listed attackers (declining share) + a "field" bucket. P(scores >=1).
function scorers(team, lam) {
  const names = TEAMS[team][1];
  const shares = [0.34, 0.24, 0.17]; // top 3 attackers
  return names.map((n, i) => {
    const indivLam = lam * shares[i];
    const pScore = 1 - Math.exp(-indivLam);
    return { name: n, p: pScore };
  });
}

const ALL_MATCHES = (() => {
  const out = [];
  Object.entries(GROUPS).forEach(([g, teams]) => {
    for (let i = 0; i < teams.length; i++)
      for (let j = i + 1; j < teams.length; j++)
        out.push({ group: g, a: teams[i], b: teams[j] });
  });
  return out;
})();

// ---- Monte Carlo simulation -------------------------------------------------

function samplePoisson(lam) {
  if (lam <= 0) return 0;
  const L = Math.exp(-lam);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function simulateGroupOnce(teams) {
  const pts = {}, gd = {}, gf = {};
  teams.forEach((t) => { pts[t] = 0; gd[t] = 0; gf[t] = 0; });
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const [lamA, lamB] = expectedGoals(teams[i], teams[j]);
      const gA = samplePoisson(lamA), gB = samplePoisson(lamB);
      gf[teams[i]] += gA; gf[teams[j]] += gB;
      gd[teams[i]] += gA - gB; gd[teams[j]] += gB - gA;
      if (gA > gB) pts[teams[i]] += 3;
      else if (gA === gB) { pts[teams[i]]++; pts[teams[j]]++; }
      else pts[teams[j]] += 3;
    }
  }
  return teams
    .map((t) => ({ team: t, pts: pts[t], gd: gd[t], gf: gf[t] }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
}

function simRound(matchups) {
  // knockout match: draw resolved by 50/50 penalty shootout
  return matchups.map(([a, b]) => {
    const [lamA, lamB] = expectedGoals(a, b);
    const gA = samplePoisson(lamA), gB = samplePoisson(lamB);
    if (gA !== gB) return gA > gB ? a : b;
    return Math.random() < 0.5 ? a : b;
  });
}

function toPairs(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i += 2) out.push([arr[i], arr[i + 1]]);
  return out;
}

function runMonteCarlo(N = 10000) {
  const counts = {};
  Object.values(GROUPS).flat().forEach((t) => {
    counts[t] = { advance: 0, r16: 0, qf: 0, sf: 0, final: 0, champ: 0 };
  });

  for (let s = 0; s < N; s++) {
    // --- group stage ---
    const standings = {};
    Object.entries(GROUPS).forEach(([g, teams]) => {
      standings[g] = simulateGroupOnce(teams);
    });

    // top 2 per group advance automatically
    Object.values(standings).forEach((ranked) => {
      counts[ranked[0].team].advance++;
      counts[ranked[1].team].advance++;
    });

    // best 8 third-place teams
    const thirds = Object.values(standings)
      .map((ranked) => ranked[2])
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
      .slice(0, 8);
    thirds.forEach((t) => counts[t.team].advance++);

    // --- R32 seeding (mirrors buildKnockoutRounds) ---
    const w  = (g) => standings[g][0].team;
    const ru = (g) => standings[g][1].team;
    const th = (i) => thirds[i].team;
    const r32 = [
      [w("A"), ru("B")], [w("C"), ru("D")], [w("E"), ru("F")], [w("G"), ru("H")],
      [th(0), th(1)],    [w("I"), ru("J")], [th(2), th(3)],    [w("K"), ru("L")],
      [w("B"), ru("A")], [w("D"), ru("C")], [w("F"), ru("E")], [w("H"), ru("G")],
      [th(4), th(5)],    [w("J"), ru("I")], [th(6), th(7)],    [w("L"), ru("K")],
    ];

    // --- knockout rounds ---
    const r16  = simRound(r32);        r16.forEach((t) => counts[t].r16++);
    const qf   = simRound(toPairs(r16));  qf.forEach((t) => counts[t].qf++);
    const sf   = simRound(toPairs(qf));   sf.forEach((t) => counts[t].sf++);
    const fin  = simRound(toPairs(sf));   fin.forEach((t) => counts[t].final++);
    const champ = simRound(toPairs(fin)); counts[champ[0]].champ++;
  }

  return counts;
}

// ---- knockout bracket -------------------------------------------------------

function computeGroupStandings() {
  const result = {};
  Object.entries(GROUPS).forEach(([g, teams]) => {
    result[g] = teams
      .map((team) => {
        let pts = 0;
        teams.filter((o) => o !== team).forEach((o) => {
          const pr = predict(team, o);
          pts += pr.pA * 3 + pr.pDraw;
        });
        return { team, pts };
      })
      .sort((a, b) => b.pts - a.pts);
  });
  return result;
}

function buildKnockoutRounds() {
  const standings = computeGroupStandings();
  const w = (g) => standings[g][0].team;
  const ru = (g) => standings[g][1].team;
  const thirds = Object.entries(standings)
    .map(([, ranked]) => ranked[2])
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 8)
    .map((x) => x.team);
  const t = (i) => thirds[i];

  // 16 R32 matchups: 12 winner/runner-up cross-pairings + 4 best-thirds matches
  const r32Seeds = [
    { a: w("A"), b: ru("B") },
    { a: w("C"), b: ru("D") },
    { a: w("E"), b: ru("F") },
    { a: w("G"), b: ru("H") },
    { a: t(0),   b: t(1) },
    { a: w("I"), b: ru("J") },
    { a: t(2),   b: t(3) },
    { a: w("K"), b: ru("L") },
    { a: w("B"), b: ru("A") },
    { a: w("D"), b: ru("C") },
    { a: w("F"), b: ru("E") },
    { a: w("H"), b: ru("G") },
    { a: t(4),   b: t(5) },
    { a: w("J"), b: ru("I") },
    { a: t(6),   b: t(7) },
    { a: w("L"), b: ru("K") },
  ];

  const withPreds = (matchups) =>
    matchups.map((m) => {
      const pr = predict(m.a, m.b);
      return { ...m, pA: pr.pA, pDraw: pr.pDraw, pB: pr.pB, winner: pr.pA >= pr.pB ? m.a : m.b };
    });

  const nextRound = (prev) => {
    const next = [];
    for (let i = 0; i < prev.length; i += 2)
      next.push({ a: prev[i].winner, b: prev[i + 1].winner });
    return withPreds(next);
  };

  const r32 = withPreds(r32Seeds);
  const r16 = nextRound(r32);
  const qf  = nextRound(r16);
  const sf  = nextRound(qf);
  const fin = nextRound(sf);

  return [
    { short: "R32", matches: r32 },
    { short: "R16", matches: r16 },
    { short: "QF",  matches: qf  },
    { short: "SF",  matches: sf  },
    { short: "F",   matches: fin },
  ];
}

// ---- live backend connection ----------------------------------------------
// Polls a running wc-prediction-api server (/live) and returns a map of
// "TeamA|TeamB" -> live prediction. Falls back silently to the static model
// when no URL is set or the server is unreachable.

const normName = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/türkiye|turkiye/, "turkey")
    .replace(/curaçao|curacao/, "curacao")
    .replace(/[^a-z]/g, "");

function matchKey(a, b) {
  // order-independent so home/away from the backend still matches our pairing
  return [normName(a), normName(b)].sort().join("|");
}

function useLiveData(url, intervalMs = 15000) {
  const [state, setState] = useState({ status: "off", byKey: {}, updated: 0 });
  const timer = useRef(null);

  useEffect(() => {
    if (!url) {
      setState({ status: "off", byKey: {}, updated: 0 });
      return;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${url.replace(/\/$/, "")}/live`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const byKey = {};
        (data.matches || []).forEach((m) => {
          byKey[matchKey(m.home, m.away)] = m;
        });
        setState({ status: "live", byKey, updated: data.updated || Date.now() / 1000 });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, status: "error" }));
      }
    };

    poll();
    timer.current = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer.current);
    };
  }, [url, intervalMs]);

  return state;
}

// merge a live backend prediction into the shape MatchCard expects
function mergeLive(staticPr, live, a, b) {
  if (!live) return { ...staticPr, isLive: false };
  // backend home may be either of our two teams; align orientation to (a,b)
  const flip = normName(live.home) !== normName(a);
  const pA = flip ? live.p_away : live.p_home;
  const pB = flip ? live.p_home : live.p_away;
  const lamA = flip ? live.exp_away_goals : live.exp_home_goals;
  const lamB = flip ? live.exp_home_goals : live.exp_away_goals;
  return {
    ...staticPr,
    pA,
    pDraw: live.p_draw,
    pB,
    lamA,
    lamB,
    expTotal: live.exp_total,
    pOver: live.p_over_2_5,
    pUnder: 1 - live.p_over_2_5,
    topScores: (live.top_scorelines || []).map((s) => {
      const [x, y] = s.score.split("-").map(Number);
      return flip ? { a: y, b: x, p: s.p } : { a: x, b: y, p: s.p };
    }),
    isLive: true,
    minute: live.minute,
  };
}

// ---- UI -------------------------------------------------------------------

const C = {
  bg: "#15181d",
  panel: "#1b1f26",
  panel2: "#21262f",
  line: "#2c333d",
  ink: "#e6e9ee",
  dim: "#7c8696",
  amber: "#e8b14c",
  win: "#4a8f6d",
  draw: "#586273",
  loss: "#a85a52",
};

function Bar({ pA, pDraw, pB }) {
  return (
    <div style={{ display: "flex", height: 22, borderRadius: 4, overflow: "hidden", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
      <div style={{ width: `${pA * 100}%`, background: C.win, display: "flex", alignItems: "center", justifyContent: "center", color: "#0c130f", fontWeight: 700 }}>
        {pA > 0.12 ? Math.round(pA * 100) : ""}
      </div>
      <div style={{ width: `${pDraw * 100}%`, background: C.draw, display: "flex", alignItems: "center", justifyContent: "center", color: "#d8dee8" }}>
        {pDraw > 0.12 ? Math.round(pDraw * 100) : ""}
      </div>
      <div style={{ width: `${pB * 100}%`, background: C.loss, display: "flex", alignItems: "center", justifyContent: "center", color: "#140d0c", fontWeight: 700 }}>
        {pB > 0.12 ? Math.round(pB * 100) : ""}
      </div>
    </div>
  );
}

function MatchCard({ m, open, onToggle, live }) {
  const staticPr = useMemo(() => predict(m.a, m.b), [m.a, m.b]);
  const pr = useMemo(() => mergeLive(staticPr, live, m.a, m.b), [staticPr, live, m.a, m.b]);
  const call =
    pr.pA > pr.pB && pr.pA > pr.pDraw
      ? `${m.a} win`
      : pr.pB > pr.pA && pr.pB > pr.pDraw
      ? `${m.b} win`
      : "Draw";
  const sA = scorers(m.a, pr.lamA);
  const sB = scorers(m.b, pr.lamB);

  return (
    <div style={{ borderBottom: `1px solid ${C.line}` }}>
      <div
        onClick={onToggle}
        style={{ display: "grid", gridTemplateColumns: "20px 1fr 200px", gap: 14, alignItems: "center", padding: "14px 4px", cursor: "pointer" }}
      >
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: C.dim }}>{m.group}</span>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6, letterSpacing: 0.2, alignItems: "center" }}>
            <span style={{ fontWeight: 600 }}>{m.a}</span>
            <span style={{ color: C.dim, fontSize: 12, fontFamily: "ui-monospace, monospace", display: "flex", alignItems: "center", gap: 8 }}>
              {pr.isLive && (
                <span style={{ color: "#15181d", background: "#d8504a", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>
                  ● LIVE {pr.minute}'
                </span>
              )}
              xG {pr.lamA.toFixed(1)}–{pr.lamB.toFixed(1)}
            </span>
            <span style={{ fontWeight: 600 }}>{m.b}</span>
          </div>
          <Bar pA={pr.pA} pDraw={pr.pDraw} pB={pr.pB} />
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 13 }}>{call}</div>
          <div style={{ color: C.dim, fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
            {pr.topScores[0].a}–{pr.topScores[0].b} likeliest · {pr.expTotal.toFixed(1)} gls
          </div>
        </div>
      </div>

      {open && (
        <div style={{ padding: "4px 4px 20px 34px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 22 }}>
          <Section title="Scorelines">
            {pr.topScores.map((s, i) => (
              <Row key={i} l={`${s.a}–${s.b}`} r={`${Math.round(s.p * 100)}%`} />
            ))}
          </Section>
          <Section title="Total goals">
            <Row l="Over 2.5" r={`${Math.round(pr.pOver * 100)}%`} />
            <Row l="Under 2.5" r={`${Math.round(pr.pUnder * 100)}%`} />
            <Row l="Expected" r={pr.expTotal.toFixed(2)} />
          </Section>
          <Section title="To score (anytime)">
            {[...sA.map((s) => ({ ...s, t: m.a })), ...sB.map((s) => ({ ...s, t: m.b }))]
              .sort((x, y) => y.p - x.p)
              .slice(0, 5)
              .map((s, i) => (
                <Row key={i} l={s.name} r={`${Math.round(s.p * 100)}%`} sub={s.t} />
              ))}
          </Section>
        </div>
      )}
    </div>
  );
}

const Section = ({ title, children }) => (
  <div>
    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: C.dim, marginBottom: 8 }}>{title}</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{children}</div>
  </div>
);
const Row = ({ l, r, sub }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontFamily: "ui-monospace, monospace" }}>
    <span style={{ color: C.ink }}>
      {l} {sub && <span style={{ color: C.dim, fontSize: 10 }}> {sub}</span>}
    </span>
    <span style={{ color: C.amber }}>{r}</span>
  </div>
);

// group strength table (model's projected order)
function GroupTable({ g, teams }) {
  const ranked = teams
    .map((t) => {
      // projected points across 3 group games
      let pts = 0;
      teams
        .filter((o) => o !== t)
        .forEach((o) => {
          const pr = predict(t, o);
          pts += pr.pA * 3 + pr.pDraw;
        });
      return { t, pts };
    })
    .sort((a, b) => b.pts - a.pts);
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: C.amber, marginBottom: 8 }}>GROUP {g}</div>
      {ranked.map((r, i) => (
        <div key={r.t} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13, color: i < 2 ? C.ink : C.dim }}>
          <span>
            <span style={{ fontFamily: "ui-monospace, monospace", color: C.dim, marginRight: 8 }}>{i + 1}</span>
            {r.t}
          </span>
          <span style={{ fontFamily: "ui-monospace, monospace", color: i < 2 ? C.win : C.dim }}>{r.pts.toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}

// ---- knockout UI ------------------------------------------------------------

const SLOT_H = 80; // px per R32 slot; doubles each round to align the bracket

function KnockoutCard({ m }) {
  const aWins = m.pA > m.pB;
  const nameStyle = (wins) => ({
    fontSize: 11,
    fontWeight: wins ? 700 : 400,
    color: wins ? C.ink : C.dim,
    maxWidth: 106,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 5, padding: "5px 8px", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={nameStyle(aWins)}>{aWins && "› "}{m.a}</span>
        <span style={{ fontFamily: "ui-monospace, monospace", color: aWins ? C.amber : C.dim, fontSize: 10.5, flexShrink: 0, marginLeft: 4 }}>{Math.round(m.pA * 100)}%</span>
      </div>
      <Bar pA={m.pA} pDraw={m.pDraw} pB={m.pB} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={nameStyle(!aWins)}>{!aWins && "› "}{m.b}</span>
        <span style={{ fontFamily: "ui-monospace, monospace", color: !aWins ? C.amber : C.dim, fontSize: 10.5, flexShrink: 0, marginLeft: 4 }}>{Math.round(m.pB * 100)}%</span>
      </div>
    </div>
  );
}

function KnockoutBracket() {
  const rounds = useMemo(buildKnockoutRounds, []);
  const champion = rounds[4].matches[0].winner;
  const totalH = 16 * SLOT_H;

  return (
    <div>
      <p style={{ color: C.dim, fontSize: 12, margin: "0 0 14px", lineHeight: 1.6 }}>
        Bracket seeded from model group projections. Top 2 per group advance; best 8 third-place teams fill the remaining 8 R32 slots.
        › marks the model's predicted winner at each step.
      </p>
      <div style={{ overflowX: "auto", paddingBottom: 8 }}>
        {/* Round headers */}
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          {rounds.map((round, ri) => (
            <div key={ri} style={{ width: 160, flexShrink: 0, fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: C.dim }}>{round.short}</div>
          ))}
          <div style={{ width: 130, flexShrink: 0, fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: C.amber }}>Champion</div>
        </div>
        {/* Bracket columns */}
        <div style={{ display: "flex", gap: 8, height: totalH }}>
          {rounds.map((round, ri) => {
            const slotH = totalH / round.matches.length;
            return (
              <div key={ri} style={{ width: 160, flexShrink: 0 }}>
                {round.matches.map((m, mi) => (
                  <div key={mi} style={{ height: slotH, display: "flex", alignItems: "center" }}>
                    <KnockoutCard m={m} />
                  </div>
                ))}
              </div>
            );
          })}
          {/* Champion */}
          <div style={{ width: 130, flexShrink: 0, display: "flex", alignItems: "center" }}>
            <div style={{ background: C.panel, border: `1px solid ${C.amber}`, borderRadius: 8, padding: "14px 12px", textAlign: "center", width: "100%" }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>🏆</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.amber }}>{champion}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Monte Carlo table ------------------------------------------------------

const MC_COLS = ["Advance", "R16", "QF", "SF", "Final", "Win"];

function pctFmt(v) {
  if (v === 0) return "—";
  if (v < 0.005) return "<1%";
  return `${Math.round(v * 100)}%`;
}

function pctColor(v) {
  if (v >= 0.25) return C.amber;
  if (v >= 0.10) return C.ink;
  if (v >= 0.02) return "#a0a8b4";
  return C.dim;
}

function MonteCarloTable() {
  const raw = useMemo(() => runMonteCarlo(10000), []);
  const N = 10000;

  const rows = Object.entries(raw)
    .map(([team, c]) => ({
      team,
      group: Object.entries(GROUPS).find(([, ts]) => ts.includes(team))?.[0] ?? "?",
      vals: [c.advance / N, c.r16 / N, c.qf / N, c.sf / N, c.final / N, c.champ / N],
    }))
    .sort((a, b) => b.vals[5] - a.vals[5]);

  const th = (label, right = true) => (
    <th style={{ padding: "6px 10px", fontWeight: 600, color: C.dim, textAlign: right ? "right" : "left", whiteSpace: "nowrap" }}>
      {label}
    </th>
  );

  return (
    <div>
      <p style={{ color: C.dim, fontSize: 12, margin: "0 0 16px", lineHeight: 1.6 }}>
        10,000 simulated tournaments. Each run samples Poisson scores for every match, resolves group standings,
        advances the top 2 per group + best 8 thirds, then plays out the bracket. Draws go to 50/50 penalties.
        Sorted by tournament win probability.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.line}` }}>
              {th("Team", false)}
              {th("Grp")}
              {MC_COLS.map((c) => <th key={c} style={{ padding: "6px 10px", fontWeight: 600, color: c === "Win" ? C.amber : C.dim, textAlign: "right" }}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.team} style={{ borderBottom: `1px solid ${C.line}` }}>
                <td style={{ padding: "5px 10px", color: C.ink, fontWeight: 600, whiteSpace: "nowrap" }}>{r.team}</td>
                <td style={{ padding: "5px 10px", color: C.dim, textAlign: "right" }}>{r.group}</td>
                {r.vals.map((v, i) => (
                  <td key={i} style={{ padding: "5px 10px", textAlign: "right", color: pctColor(v), fontWeight: i === 5 && v >= 0.05 ? 700 : 400 }}>
                    {pctFmt(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("matches");
  const [openIdx, setOpenIdx] = useState(0);
  const [filter, setFilter] = useState("ALL");
  // In production (non-localhost) the frontend and backend share the same
  // origin, so auto-connect without requiring the user to paste a URL.
  const defaultUrl =
    window.location.hostname !== "localhost" ? window.location.origin : "";
  const [urlInput, setUrlInput] = useState(defaultUrl);
  const [backendUrl, setBackendUrl] = useState(defaultUrl);
  const live = useLiveData(backendUrl);

  const matches = filter === "ALL" ? ALL_MATCHES : ALL_MATCHES.filter((m) => m.group === filter);
  const liveCount = Object.keys(live.byKey).length;

  return (
    <div style={{ background: C.bg, color: C.ink, minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif", padding: "28px 22px" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 4 }}>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, margin: 0 }}>
            World Cup 2026 <span style={{ color: C.amber }}>Prediction Desk</span>
          </h1>
        </div>
        <p style={{ color: C.dim, fontSize: 13, margin: "6px 0 16px", maxWidth: 620 }}>
          Poisson model over FIFA-points strength. Every group-stage match: win probabilities, expected goals,
          likeliest scorelines, and anytime-scorer odds. Numbers are model estimates, not certainties — treat scorer odds as probabilities, not picks.
        </p>

        {/* live connection bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, padding: "10px 14px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontFamily: "ui-monospace, monospace", color: C.dim }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: live.status === "live" ? "#4a8f6d" : live.status === "error" ? "#d8504a" : C.dim, boxShadow: live.status === "live" ? "0 0 6px #4a8f6d" : "none" }} />
            {live.status === "live" ? `LIVE · ${liveCount} match${liveCount === 1 ? "" : "es"} tracked` : live.status === "error" ? "BACKEND UNREACHABLE" : "STATIC MODEL"}
          </span>
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="http://localhost:8000"
            style={{ flex: 1, minWidth: 180, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 5, padding: "6px 10px", color: C.ink, fontSize: 12, fontFamily: "ui-monospace, monospace" }}
          />
          {backendUrl ? (
            <button onClick={() => { setBackendUrl(""); setUrlInput(""); }} style={btnStyle(false)}>Disconnect</button>
          ) : (
            <button onClick={() => setBackendUrl(urlInput.trim())} style={btnStyle(true)}>Connect</button>
          )}
        </div>

        {/* tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: `1px solid ${C.line}` }}>
          {[["matches", "Match predictions"], ["groups", "Group projections"], ["knockout", "Knockout bracket"], ["simulate", "Monte Carlo"]].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                background: "none", border: "none", color: tab === k ? C.amber : C.dim,
                borderBottom: tab === k ? `2px solid ${C.amber}` : "2px solid transparent",
                padding: "8px 14px", fontSize: 13, cursor: "pointer", fontWeight: 600, marginBottom: -1,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "matches" && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {["ALL", ...Object.keys(GROUPS)].map((g) => (
                <button
                  key={g}
                  onClick={() => setFilter(g)}
                  style={{
                    background: filter === g ? C.amber : C.panel2, color: filter === g ? "#15181d" : C.dim,
                    border: `1px solid ${C.line}`, borderRadius: 5, padding: "4px 10px", fontSize: 12,
                    cursor: "pointer", fontFamily: "ui-monospace, monospace", fontWeight: 600,
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 11, color: C.dim, marginBottom: 6, paddingLeft: 34 }}>
              <Legend c={C.win} t="left win" /><Legend c={C.draw} t="draw" /><Legend c={C.loss} t="right win" />
            </div>
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "2px 16px" }}>
              {matches.map((m, i) => (
                <MatchCard
                  key={`${m.a}-${m.b}`}
                  m={m}
                  open={openIdx === i}
                  onToggle={() => setOpenIdx(openIdx === i ? -1 : i)}
                  live={live.byKey[matchKey(m.a, m.b)]}
                />
              ))}
            </div>
          </>
        )}

        {tab === "groups" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {Object.entries(GROUPS).map(([g, teams]) => (
              <GroupTable key={g} g={g} teams={teams} />
            ))}
          </div>
        )}

        {tab === "knockout" && <KnockoutBracket />}

        {tab === "simulate" && <MonteCarloTable />}

        <p style={{ color: C.dim, fontSize: 11, marginTop: 24, lineHeight: 1.6 }}>
          Group projections show expected points across the three group games (3×win prob + draw prob); top two shaded as advancing.
          Strength ratings seeded from April 2026 FIFA points. The static model has no injury, form, or lineup awareness.
          Connect a running wc-prediction-api backend (paste its URL above, e.g. http://localhost:8000) to replace the static numbers
          with live in-play predictions for matches in progress — those cards show a LIVE badge and update every 15 seconds.
        </p>
      </div>
    </div>
  );
}

const Legend = ({ c, t }) => (
  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
    <span style={{ width: 10, height: 10, background: c, borderRadius: 2, display: "inline-block" }} /> {t}
  </span>
);

const btnStyle = (primary) => ({
  background: primary ? C.amber : C.panel2,
  color: primary ? "#15181d" : C.dim,
  border: `1px solid ${C.line}`,
  borderRadius: 5,
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "Inter, system-ui, sans-serif",
});
