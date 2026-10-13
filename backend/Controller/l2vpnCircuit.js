
const db = require("../Models");
const L2vpnInterface = db.l2vpninterfaces;
const L2vpnCircuit = db.l2vpncircuits;
const L2vpnVplsId = db.l2vpnvplsids;
const Sequelize = db.Sequelize;

// LTZ-ACC2-RAH and LTZ-ACC3-RAH each have one interface hardcoded out of
// step A's polling (see DEVICE_COMMAND_EXCLUDES in cron/updateL2VPN.js —
// ge-0/0/63 and ge-0/0/36 respectively), so a circuit that hairpins into
// one of those specific ports can never be discovered on that device's own
// side no matter how many times it's polled. A needs-review circuit whose
// every hop names one of these two as its neighbor, with no matching
// virtualCircuitId ever found on that device, is this known structural
// gap rather than a real problem — hidden entirely instead of shown as a
// false "needs review" flag.
const UNPOLLABLE_HUB_DEVICES = new Set(["LTZ-ACC2-RAH", "LTZ-ACC3-RAH"]);

// fetchCircuitDetails (cron/updateL2VPN.js) resolves the l2circuit neighbor
// IP against the devices table and falls back to the raw IP string when no
// device has it — e.g. an off-net peer like "2G PCCW - Icolo to Sala"
// pointing at 197.155.84.54. There's no device row that IP could ever match
// against, so a needs-review circuit stuck on an unresolved IP neighbor
// isn't "hasn't been polled yet" — it's genuinely never going to chain, and
// is hidden the same way the unpollable-hub case is.
const RAW_IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

// PE devices that terminate some customer L2 circuits into a VPLS
// mesh-group instead of a plain point-to-point l2circuit (see
// updateVplsMeshGroups in cron/updateL2VPN.js, which polls each of these
// for its configured vpls-id set) — kept in sync manually with that file's
// own copy of this same set, same pattern as Controller/upgrade.js vs
// utils/junosUpgrade.js.
const PE_VPLS_DEVICES = new Set(["LTZ-PE1-RAH", "LTZ-PE1-TIG"]);

// A disagreement across hops is resolved by majority rather than flagged as
// a separate "mixed" state: down when every hop is down or only one hop is
// up, up when at least two hops are up. All-up (including the trivial
// single-hop case) still falls out of this naturally — upCount equal to
// hops.length means every hop agreed "up".
const overallStatus = (hops) => {
  const upCount = hops.filter((h) => h.operationalStatus === "up").length;
  if (upCount === hops.length) return "up";
  if (upCount === 0) return "down";
  return upCount >= 2 ? "up" : "down";
};

// Shared by VPLS and off-net entries: both represent multiple LOCAL access
// points reaching one shared external/multipoint destination — a VPLS mesh
// or an off-net peer — rather than a single end-to-end path. That shared
// destination is only actually unreachable when EVERY local hop reaching it
// is down; one working hop still means it's reachable, unlike overallStatus'
// majority rule above (which assumes a break anywhere along a linear path is
// a real problem — the right assumption for a point-to-point chain, but
// wrong here, where the hops are redundant/parallel routes to the same far
// end rather than sequential links in one path). E.g. two access switches
// (LTZ-ACC1-VTL, LTZ-ACC2-VTL) both handing off the same off-net vlan to the
// same neighbor IP — one hop down while the other is up still means that
// off-net connectivity is up.
const anyUpStatus = (hops) => (hops.some((h) => h.operationalStatus === "up") ? "up" : "down");

// When customerName extraction falls back to the raw interface description
// (no Customer=/CNAME=/provider= key found — see parseL2VPNDescriptions in
// cron/updateL2VPN.js), that raw text is DIFFERENT on each end of the same
// circuit, because it embeds that device's own "nbr=" reference pointing at
// the *other* switch. Grouping by customerName alone therefore silently
// splits some real circuits into two "needs-review" orphans even when
// virtualCircuitId/neighbor prove they're the same circuit. Pick a
// representative name for display: prefer one that doesn't look like a raw
// dump (doesn't start with "{" / contain "cat=L2VPN"), and among those
// prefer the shortest — a raw fallback is always the whole original
// description, so it's reliably the longest string in the group.
const pickRepresentativeCustomerName = (rows) => {
  const names = rows.map((r) => r.customerName).filter(Boolean);
  if (names.length === 0) return null;
  const looksRaw = (n) => n.trim().startsWith("{") || /cat=L2VPN/i.test(n);
  const clean = names.filter((n) => !looksRaw(n));
  const candidates = clean.length > 0 ? clean : names;
  return candidates.reduce((best, n) => (n.length < best.length ? n : best), candidates[0]);
};

// Two rows cluster together only when they share BOTH virtualCircuitId AND
// vlanId — customerName plays no part in clustering. customerName is
// unreliable as a grouping key on its own: the same customer can have
// multiple genuinely separate point-to-point circuits (different vcid) that
// happen to land on the same vlan number through a shared hub switch (see
// the Airtel Bank of Baroda - Arusha case — AIR<->TIG and ARU<->TIG share a
// customerName and vlan 2052 but are unrelated circuits with different
// vcids), and grouping by customerName alone or customerName-OR-vcid can
// cross-wire rows that were never actually the same pseudowire. vcid+vlan
// is exactly what Junos itself requires to match on both ends of one real
// l2circuit, so it's the only reliable clustering signal.
//
// A row missing virtualCircuitId can't be matched to anything and stays its
// own single-row group (surfaces as its own needs-review entry below). A row
// with a vcid but NO vlanId (an untagged l2circuit, e.g. vcid 2554901272
// LTZ-ACC1-KWL <-> LTZ-ACC1-SSB) clusters on the vcid alone — requiring a
// vlan too left both ends as isolated single-row groups, which the
// single-hop filter at the end of computeAllL2VPNCircuits then dropped, so
// the circuit never showed up. This is safe because buildCircuits still
// only links rows that reciprocally name each other as neighbor, and
// edgeCompatible already treats a missing vlanId as "matches anything".
//
// Trade-off: a genuine multi-hop customer circuit spanning 3+ devices via
// separate per-segment vcids will show as multiple separate circuits
// rather than one combined end-to-end path, since each segment's vcid
// differs and nothing here re-links them by customerName any more.
const clusterRows = (rows) => {
  const groups = new Map();
  const singles = [];

  rows.forEach((row) => {
    if (!row.virtualCircuitId) {
      singles.push([row]);
      return;
    }
    const key = `${row.virtualCircuitId}::${row.vlanId ?? ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  return [...groups.values(), ...singles];
};

// Turns one cluster of rows into one or more circuits by walking
// switchName -> neighbor edges into a chain (A -> B -> C...). Ported from
// the ad-hoc script (l2vpn_path_chain.js) validated against real device data.
//
// Edges are built between ROW INDICES, not switchName strings — a customer
// group can legitimately contain two rows on the same switch (different
// interfaces), and collapsing them to one switchName node would let an edge
// meant for one interface get attributed to the wrong one.
//
// A neighbor pointer is only trusted as a real chain link when both the
// VLAN and the virtual-circuit-id carry through (whichever of the two a
// given hop actually has — either can be legitimately absent). Checking
// vlanId alone isn't enough: a hub switch commonly terminates several
// unrelated point-to-point pseudowires from DIFFERENT branches of the SAME
// customer, each getting its own virtual-circuit-id but landing on the same
// vlan number (e.g. "Airtel Bank of Baroda - Arusha" has one leg
// AIR<->TIG on vcid ...1704 and a completely separate leg ARU<->TIG on vcid
// ...1705, both vlan 2052) — matching vlan alone would wrongly cross-wire
// AIR's edge onto ARU's interface on TIG just because it's also vlan 2052.
// Junos protection circuits carry a backup-neighbor alongside the primary
// (see backupNeighbor on the l2vpncircuit model) — sometimes the ONLY
// working pointer to the true far end, when the primary neighbor names a
// device that isn't actually configured with this vcid at all (seen in
// production: LTZ-ACC1-AMV's primary neighbor resolves to LTZ-ACC1-HEA,
// which has zero config for this vcid, while AMV's backup-neighbor
// resolves to LTZ-ACC1-RAH, which does). Returns which field matched
// ("primary"/"backup") or null, so callers can both accept the match and
// flag when it only worked via backup.
const pointsAt = (row, targetSwitchName) => {
  if (row.neighbor && normalize(row.neighbor) === normalize(targetSwitchName)) return "primary";
  if (row.backupNeighbor && normalize(row.backupNeighbor) === normalize(targetSwitchName)) return "backup";
  return null;
};

// switchName/neighbor both trace back to the same devices.name column (see
// updateL2VPN.js: switchName = device.name at discovery time, neighbor =
// devices.name looked up by IP at circuit-detail time) so they should always
// be byte-identical for two ends of one real circuit — but a stray trailing
// space or a stale duplicate row in `devices` sharing an IP with a
// differently-cased/padded name is enough to break a strict `===` match
// while still rendering identically on screen. Same idea for vlanId/vcid:
// they're STRING columns parsed straight from CLI regex output, so
// whitespace is the only realistic drift, not type or case.
const normalize = (s) => (s || "").trim().toUpperCase();

const edgeCompatible = (a, b) => {
  const vlanOk = !a.vlanId || !b.vlanId || normalize(a.vlanId) === normalize(b.vlanId);
  const vcidOk =
    !a.virtualCircuitId || !b.virtualCircuitId || normalize(a.virtualCircuitId) === normalize(b.virtualCircuitId);
  return vlanOk && vcidOk;
};

const needsReviewEntry = (customerName, rows) => ({
  customerName,
  status: "needs-review",
  overallOperationalStatus: overallStatus(rows),
  path: rows.map((r) => r.switchName),
  hops: rows,
});

// A single-hop circuit whose neighbor is a raw, unresolved IP (see RAW_IP_RE
// above) isn't a broken/unconfirmed pairing the way a plain needs-review
// orphan is — it's a genuine off-net peer (e.g. a wholesale/backhaul circuit
// terminating outside our own fleet), so there's nothing else to ever chain
// it to. Surfaced under its own "off-net" status rather than lumped in with
// needs-review, so ops can tell "device not polled yet" apart from
// "correctly identified as leaving the network here".
const offNetEntry = (customerName, rows) => ({
  customerName,
  status: "off-net",
  overallOperationalStatus: anyUpStatus(rows),
  path: rows.map((r) => r.switchName),
  hops: rows,
});

// A single-hop circuit whose neighbor (or backup-neighbor) is a PE in
// PE_VPLS_DEVICES, AND whose own virtualCircuitId matches a vpls-id
// mesh-group actually configured on that PE, is a confirmed VPLS
// termination — not an unconfirmed orphan. A PE-pointing circuit whose vcid
// does NOT match any known vpls-id is instead a plain point-to-point
// l2circuit bound to a "ps" interface on that PE (never polled — see
// updateVplsMeshGroups' comment on why these PEs' l2vpn-tagged interface
// count is 0), which stays a needs-review orphan like before rather than
// being surfaced under a status this data can't actually confirm.
const vplsEntry = (customerName, rows) => ({
  customerName,
  status: "vpls",
  overallOperationalStatus: anyUpStatus(rows),
  path: rows.map((r) => r.switchName),
  hops: rows,
});

const findVplsMeshGroupMatch = (row, vplsIdsByDevice) => {
  if (!row.virtualCircuitId || !vplsIdsByDevice) return false;
  return [row.neighbor, row.backupNeighbor]
    .filter(Boolean)
    .some((peName) => PE_VPLS_DEVICES.has(peName) && vplsIdsByDevice.get(peName)?.has(row.virtualCircuitId));
};

const classifyOrphan = (customerName, rows, vplsIdsByDevice) => {
  if (rows.length === 1) {
    const row = rows[0];
    if (row.neighbor && RAW_IP_RE.test(row.neighbor)) {
      return offNetEntry(customerName, rows);
    }
    if (findVplsMeshGroupMatch(row, vplsIdsByDevice)) {
      return vplsEntry(customerName, rows);
    }
  }
  return needsReviewEntry(customerName, rows);
};

const buildCircuits = (group, customerName, vplsIdsByDevice) => {
  if (group.length < 2) {
    return [classifyOrphan(customerName, group, vplsIdsByDevice)];
  }

  // A device can legitimately reuse the same vcid+vlan across two of its OWN
  // separate local interfaces pointed at two different remote devices (seen
  // in production: LTZ-AGG1-TIG's et-0/0/14 -> LTZ-ACC1-TIG and et-0/0/15
  // -> LTZ-ACC1-HEA, both vcid 2554901465/vlan 901). The remote devices can
  // only report the neighbor at device granularity ("AGG1-TIG"), not which
  // of AGG1-TIG's interfaces, so matching on `other.switchName === r.neighbor`
  // alone can't tell AGG1-TIG's two interfaces apart and wrongly links every
  // remote row to both of them. Requiring the match to be RECIPROCAL — other
  // must point back at r's own switchName, not just share r's neighbor's
  // device name — resolves the ambiguity: only the true pair has both ends
  // naming each other specifically. Either side of the reciprocal check may
  // be satisfied via primary OR backup-neighbor (pointsAt checks both); an
  // edge that only closed via a backup-neighbor is tagged `via: "backup"` so
  // the resulting circuit can be flagged for display without being treated
  // as needs-review — it's a real, confirmed pairing, just riding the
  // protection path rather than the primary one.
  const edges = [];
  group.forEach((r, i) => {
    group.forEach((other, j) => {
      if (i === j) return;
      const rMatch = pointsAt(r, other.switchName);
      if (!rMatch) return;
      const otherMatch = pointsAt(other, r.switchName);
      if (!otherMatch) return;
      if (!edgeCompatible(r, other)) return;
      const via = rMatch === "backup" || otherMatch === "backup" ? "backup" : "primary";
      edges.push({ from: i, to: j, via });
    });
  });

  // Two rows on the SAME device, within one already vcid+vlan-matched
  // cluster, are that device locally bridging two legs of one end-to-end
  // path (e.g. LTZ-AGG1-TIG's et-0/0/14 -> ACC1-TIG and et-0/0/15 ->
  // ACC1-HEA, both vcid 2554901465/vlan 901: AGG1-TIG is the midpoint of
  // one continuous ACC1-TIG <-> AGG1-TIG <-> ACC1-HEA circuit, not two
  // unrelated ones). `group` is only ever the contents of one clusterRows
  // group, so both rows are already guaranteed to share the same vcid+vlan
  // — that's what makes this safe: it can never pull in a coincidental
  // same-vlan-different-vcid case like the Airtel Bank of Baroda one above,
  // since that lives in a different cluster entirely and never reaches this
  // function in the same `group` call.
  group.forEach((r, i) => {
    group.forEach((other, j) => {
      if (i >= j || normalize(r.switchName) !== normalize(other.switchName)) return;
      edges.push({ from: i, to: j, via: "bridge" }, { from: j, to: i, via: "bridge" });
    });
  });

  // No edges at all means nothing in this vcid+vlan-matched group actually
  // names another row in it as its neighbor — e.g. two unrelated interfaces
  // that both happen to point at the same off-net IP (see LTZ-ACC1-VTL
  // xe-0/0/10 and LTZ-ACC2-VTL xe-0/0/8, both vcid 2554800105/vlan 344,
  // both pointing at 197.155.86.194, neither naming the other). Classifying
  // the whole group as one bulk needs-review entry would bury a row that's
  // individually a genuine off-net circuit under a status this pipeline
  // later hides outright (every-hop-unresolved-IP needs-review entries get
  // dropped entirely below) — so each row is classified on its own instead.
  if (edges.length === 0) {
    return group.map((row) => classifyOrphan(customerName, [row], vplsIdsByDevice));
  }

  // A single vcid+vlan cluster can still contain multiple, entirely
  // disconnected circuit segments with no edges at all between them (a
  // coincidental collision with zero reciprocal/bridge match anywhere) —
  // treating the whole cluster as one graph would wrongly lump those
  // together, so connectivity is computed first and each disjoint
  // component is turned into its own circuit below.
  //
  // Every group index gets a slot here, not just ones touched by `edges` —
  // a row that never matched any reciprocal edge anywhere in this cluster
  // (e.g. LTZ-ACC1-ACA/LTZ-ACC1-UGA sharing vcid+vlan with an unrelated
  // LTZ-ACC1-420/HEA/UBU chain, but pointing at each other one-way only —
  // ACA's neighbor is HEA, not UGA) still needs its own singleton
  // component. Without a slot here it fell through to a single shared
  // `leftover` bucket alongside every OTHER edge-less row in the cluster,
  // wrongly merging unrelated orphans (ACA+UGA) into one combined
  // needs-review entry just because both failed to connect to anything.
  const adjacency = new Map();
  group.forEach((_, idx) => adjacency.set(idx, new Set()));
  edges.forEach(({ from, to }) => {
    adjacency.get(from).add(to);
    adjacency.get(to).add(from);
  });

  const visitedComponent = new Set();
  const components = [];
  for (const node of adjacency.keys()) {
    if (visitedComponent.has(node)) continue;
    const component = new Set();
    const stack = [node];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (component.has(cur)) continue;
      component.add(cur);
      visitedComponent.add(cur);
      for (const neighborIdx of adjacency.get(cur)) {
        if (!component.has(neighborIdx)) stack.push(neighborIdx);
      }
    }
    components.push(component);
  }

  // Every edge added above is bidirectional (a reciprocal match, or a
  // same-device bridge, always pushes both directions), so every node with
  // any edge at all appears in BOTH the "from" and "to" sets — there's no
  // way to tell a chain's true endpoint from a middle node that way. Picking
  // an arbitrary node as the walk's start and only extending in ONE
  // direction from it (the old approach) meant starting from a middle node
  // — like LTZ-ACC1-HEA sitting between a ZAN/ACC2-420 leg and a MAF leg,
  // both riding the same vcid+vlan — silently stranded whichever side
  // wasn't walked, surfacing it as a false "needs review" even though it's
  // part of the same real, connected circuit. Instead, do one full
  // traversal per component that visits every node in it: `components`
  // above already IS the true partition of what's actually connected, so
  // nothing is lost by trusting it completely rather than re-deriving a
  // single linear path through a subset of it. A degree<=1 node is
  // preferred as the traversal start purely for a natural-looking ordering
  // in the common non-branching case — it doesn't affect which nodes end
  // up included.
  const circuits = [];

  for (const component of components) {
    // A component with no internal edges is one isolated row that never
    // reciprocally matched anything else in the cluster — classify it on
    // its own (needs-review, or off-net/vpls if it individually qualifies)
    // rather than walking it as a 1-hop "complete" circuit.
    if (component.size === 1) {
      const [idx] = component;
      circuits.push(classifyOrphan(customerName, [group[idx]], vplsIdsByDevice));
      continue;
    }

    const componentEdges = edges.filter((e) => component.has(e.from) && component.has(e.to));
    const outDegree = new Map();
    componentEdges.forEach((e) => outDegree.set(e.from, (outDegree.get(e.from) || 0) + 1));
    const nodes = [...component];
    const endpoints = nodes.filter((n) => (outDegree.get(n) || 0) <= 1);
    const start = endpoints.length > 0 ? endpoints[0] : nodes[0];

    const path = [];
    const usedEdges = [];
    const visited = new Set([start]);
    const stack = [start];
    while (stack.length > 0) {
      const cur = stack.pop();
      path.push(cur);
      const outgoing = componentEdges.filter((e) => e.from === cur && !visited.has(e.to));
      for (const e of outgoing) {
        visited.add(e.to);
        usedEdges.push(e);
        stack.push(e.to);
      }
    }

    const hops = path.map((idx) => group[idx]);
    circuits.push({
      customerName,
      status: "complete",
      overallOperationalStatus: overallStatus(hops),
      path: hops.map((h) => h.switchName),
      // True when this path only chains together because a backup-neighbor
      // matched, not the primary — a real, confirmed pairing riding the
      // protection path, surfaced for display rather than hidden.
      viaBackupNeighbor: usedEdges.some((e) => e.via === "backup"),
      hops,
    });
  }

  return circuits;
};

// Shared by getAllL2VPNCircuits (the list/detail views) and status.js's
// dashboard counts — runs the full discover -> cluster -> chain-walk ->
// hide-known-unresolvable pipeline and returns every real circuit
// (unpaginated, unfiltered by search/status), so both call sites agree on
// exactly which circuits exist and what each one's status is.
exports.computeAllL2VPNCircuits = async () => {
  // Search can't be pushed into the WHERE clause — a row's own customerName
  // might be the raw-fallback text (see pickRepresentativeCustomerName
  // above) while its cluster-mate (matched via shared virtualCircuitId) is
  // the one carrying the clean, searchable name. Filtering rows out before
  // clustering could silently drop the other half of a real circuit.
  const rows = await L2vpnInterface.findAll({
    where: {
      customerName: { [Sequelize.Op.ne]: null },
    },
    include: [{ model: L2vpnCircuit, required: false }],
    order: [
      ["customerName", "ASC"],
      ["switchName", "ASC"],
    ],
  });

  const flatRows = rows.map((r) => {
    const row = r.toJSON();
    return {
      customerName: row.customerName,
      switchName: row.switchName,
      interface: row.interface,
      unit: row.unit,
      adminStatus: row.adminStatus,
      operationalStatus: row.operationalStatus,
      vlanId: row.l2vpncircuit?.vlanId ?? null,
      virtualCircuitId: row.l2vpncircuit?.virtualCircuitId ?? null,
      neighbor: row.l2vpncircuit?.neighbor ?? null,
      backupNeighbor: row.l2vpncircuit?.backupNeighbor ?? null,
      inputMbps: row.l2vpncircuit?.inputMbps ?? null,
      outputMbps: row.l2vpncircuit?.outputMbps ?? null,
    };
  });

  const vplsRows = await L2vpnVplsId.findAll({ raw: true });
  const vplsIdsByDevice = new Map();
  for (const row of vplsRows) {
    if (!vplsIdsByDevice.has(row.switchName)) vplsIdsByDevice.set(row.switchName, new Set());
    vplsIdsByDevice.get(row.switchName).add(row.vplsId);
  }

  const clusters = clusterRows(flatRows);

  let allCircuits = [];
  for (const cluster of clusters) {
    const representativeName = pickRepresentativeCustomerName(cluster);
    allCircuits = allCircuits.concat(buildCircuits(cluster, representativeName, vplsIdsByDevice));
  }

  // Each "vpls" entry above comes out of its own single-row group, because
  // clusterRows requires a shared vlanId to group rows together and these
  // access-side circuits typically carry none (e.g. "WIA - MOSHI":
  // LTZ-ACC1-KIM/LTZ-ACC1-MAF/LTZ-ACC2-420, all vcid 2554901598, vlanId
  // null — three separate entries pre-merge). VPLS is inherently multipoint
  // though: every site landing on the same vpls-id is genuinely one shared
  // circuit, not several unrelated ones — safe to merge purely by vcid,
  // unlike the point-to-point vcid+vlan collision cases elsewhere in this
  // file, because a vpls-id is Junos's own unique identifier for one VPLS
  // instance on that PE (two distinct instances can never share one).
  const vplsGroups = new Map();
  const nonVplsCircuits = [];
  for (const c of allCircuits) {
    const vcid = c.status === "vpls" ? c.hops[0]?.virtualCircuitId : null;
    if (!vcid) {
      nonVplsCircuits.push(c);
      continue;
    }
    if (!vplsGroups.has(vcid)) vplsGroups.set(vcid, []);
    vplsGroups.get(vcid).push(...c.hops);
  }
  const mergedVplsCircuits = [...vplsGroups.values()].map((hops) =>
    vplsEntry(pickRepresentativeCustomerName(hops), hops),
  );
  allCircuits = [...nonVplsCircuits, ...mergedVplsCircuits];

  // "off-net" entries (classifyOrphan above) are each generated per-row too
  // — there's no device on our side to reciprocally confirm two rows are
  // the same off-net link, so they're never edge-walked together even when
  // they share a vcid (see the LTZ-ACC1-VTL/LTZ-ACC2-VTL case). virtualCircuitId
  // is the strongest available signal on its own — Junos requires it to match
  // on both configured ends of one real l2circuit, same invariant clusterRows
  // relies on above — so two off-net rows sharing a vcid are merged on that
  // alone (e.g. "OBS-PDAR051-end ... note=S-V:787": LTZ-ACC6-HEA/LTZ-ACC1-MAF,
  // vcid 255787, vlanId N/A on both — a real off-net circuit with no VLAN tag
  // at all, so the old neighbor+vlan-only key could never reunite it, always
  // showing as two separate rows with mismatched status even though it's one
  // link). Falls back to neighbor+VLAN only when vcid is missing (e.g. "1G EPL
  // WIA DAR <> TELEHOUSE NORTH": LTZ-ACC1-MAF/LTZ-ACC2-420, same neighbor IP,
  // both vlan 2657, no vcid recorded) — that combination is still strong
  // enough evidence on its own that it's the same real link handed off across
  // more than one local access point, merged into one combined off-net entry,
  // same shape as the VPLS merge above.
  const offNetGroups = new Map();
  const nonOffNetCircuits = [];
  for (const c of allCircuits) {
    const hop = c.status === "off-net" ? c.hops[0] : null;
    const key = hop?.virtualCircuitId
      ? `vcid::${normalize(hop.virtualCircuitId)}`
      : hop?.neighbor && hop?.vlanId
        ? `nv::${normalize(hop.neighbor)}::${normalize(hop.vlanId)}`
        : null;
    if (!key) {
      nonOffNetCircuits.push(c);
      continue;
    }
    if (!offNetGroups.has(key)) offNetGroups.set(key, []);
    offNetGroups.get(key).push(...c.hops);
  }
  const mergedOffNetCircuits = [...offNetGroups.values()].map((hops) =>
    offNetEntry(pickRepresentativeCustomerName(hops), hops),
  );
  allCircuits = [...nonOffNetCircuits, ...mergedOffNetCircuits];

  // Drop the known-unresolvable-neighbor false positives — needs-review
  // circuits that can never chain no matter how many more polls run,
  // rather than ones that just haven't resolved yet:
  //   1. every hop points at LTZ-ACC2-RAH/LTZ-ACC3-RAH (UNPOLLABLE_HUB_DEVICES)
  //      with no matching virtualCircuitId ever found on that device, or
  //   2. every hop's neighbor is a raw, unresolved IP (RAW_IP_RE) — no
  //      device in the fleet has that IP, so it's an off-net peer.
  const vcidsByDevice = new Map();
  for (const row of flatRows) {
    if (!row.virtualCircuitId) continue;
    if (!vcidsByDevice.has(row.switchName)) vcidsByDevice.set(row.switchName, new Set());
    vcidsByDevice.get(row.switchName).add(row.virtualCircuitId);
  }
  allCircuits = allCircuits.filter((c) => {
    if (c.status !== "needs-review") return true;
    if (c.hops.length === 0) return true;

    const allHopsPointToHub = c.hops.every((h) => h.neighbor && UNPOLLABLE_HUB_DEVICES.has(h.neighbor));
    if (allHopsPointToHub) {
      const confirmedOnHub = c.hops.some((h) => vcidsByDevice.get(h.neighbor)?.has(h.virtualCircuitId));
      if (!confirmedOnHub) return false;
    }

    const allHopsUnresolvedIp = c.hops.every((h) => h.neighbor && RAW_IP_RE.test(h.neighbor));
    if (allHopsUnresolvedIp) return false;

    return true;
  });

  // A single-row "circuit" is just one device's own interface with nothing
  // on the other end to confirm it against — not something ops can act on
  // as a Layer 2 path, so it's dropped entirely. EXCEPT "off-net" and
  // "vpls" entries (classifyOrphan above): those are already confirmed as a
  // genuine single-ended circuit — leaving the network via an unresolved IP,
  // or terminating into a real PE VPLS mesh-group — not an unconfirmed
  // orphan, so they're kept and shown under their own status.
  allCircuits = allCircuits.filter(
    (c) => c.hops.length >= 2 || c.status === "off-net" || c.status === "vpls",
  );

  return allCircuits;
};

// Resolves ONE circuit by its virtualCircuitId — used by callers (churn
// analysis, watch-list SMS click-through) that only have a flattened record
// carrying the vcid, not the full computed circuit (hops/path) that
// ViewL2VPNCircuit.tsx needs in router state to render directly. A vcid can
// appear on more than one hop of the SAME circuit (that's the whole point of
// clustering), so the first match is the right one; a vcid cannot appear on
// two DIFFERENT circuits since clustering keys on vcid+vlan or on a
// reciprocal neighbor match, either of which would have merged them already.
exports.getL2VPNCircuitByVcid = async (req, res) => {
  try {
    const { vcid } = req.params;
    const allCircuits = await exports.computeAllL2VPNCircuits();
    const circuit = allCircuits.find((c) => c.hops.some((h) => h.virtualCircuitId === vcid));

    if (!circuit) {
      return res.status(404).json({ message: "Circuit not found" });
    }

    res.status(200).json({ circuit });
  } catch (error) {
    console.error("Error fetching L2VPN circuit by vcid:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getAllL2VPNCircuits = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;
  const searchQuery = req.query.search || "";
  const statusFilter = req.query.status || "";
  const operationalStatusFilter = req.query.operationalStatus || "";

  try {
    let allCircuits = await exports.computeAllL2VPNCircuits();

    if (statusFilter && statusFilter !== "all") {
      allCircuits = allCircuits.filter((c) => c.status === statusFilter);
    }

    if (operationalStatusFilter && operationalStatusFilter !== "all") {
      allCircuits = allCircuits.filter(
        (c) => c.overallOperationalStatus === operationalStatusFilter,
      );
    }

    if (searchQuery) {
      const needle = searchQuery.toLowerCase();
      allCircuits = allCircuits.filter(
        (c) =>
          c.customerName?.toLowerCase().includes(needle) ||
          c.hops.some(
            (h) =>
              h.customerName?.toLowerCase().includes(needle) ||
              h.vlanId?.toLowerCase().includes(needle) ||
              h.virtualCircuitId?.toLowerCase().includes(needle),
          ),
      );
    }

    allCircuits = allCircuits.map((c, index) => ({ id: `${c.customerName}::${index}`, ...c }));

    const totalItems = allCircuits.length;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const paginated = allCircuits.slice(offset, offset + pageSize);

    res.status(200).json({
      circuits: paginated,
      totalItems,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error("Error fetching L2VPN circuits:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
