# Juniper knowledge base — what each file is for

Read all 23 files under `rag/knowledge/juniper/` to produce this. Purpose
of each below, then the real overlap clusters worth acting on. This is
analysis only — nothing has been changed.

Note: `dia-service-templates.xml`, `diagnosis-runbook.xml`, and
`gpon-over-enterprise-templates.xml` live at `rag/knowledge/` directly
(siblings of `juniper/`, not inside it) — they're service/customer-type
templates and the master DIA/L3VPN/IPT/FTTH diagnosis runbook, a
different category from the vendor/Junos technical topics below. Left out
of this audit since you asked specifically about `juniper/`, but
`show_interface_unit_syntax.xml` cross-references them directly (see
below), so they're not fully independent of this folder either.

## interface/ (7 files) — the most overlap in the whole tree

- **interface_down.xml** — the broad entry point: "an interface is down,"
  covers admin/link/logical state interpretation and a 6-step general
  workflow that name-drops nearly every other file in this folder
  (speed, FEC, optics, VLAN, MTU) as sub-causes to check.
- **interface_errors.xml** — how to read error *counters* (CRC/FCS,
  drops, framing, carrier transitions) and whether a non-zero counter
  means anything. Its root-cause list ("cable, optic, signal, speed,
  duplex, FEC") is a condensed summary of four other files below.
- **crc_fcs_errors.xml** — CRC/FCS specifically. Its `likelyCauses` list
  (dirty fiber, bad patch, bad optic, poor optical power, copper issue,
  speed/duplex mismatch, FEC mismatch, hardware failure) is close to a
  word-for-word repeat of interface_errors.xml's interpretation section.
- **optical_troubleshooting.xml** — optics/DOM diagnostics (Tx/Rx power,
  laser state, temperature) — the one hardware-adjacent file left in
  `interface/` after `hardware/optics.xml` was removed. Worth deciding:
  is this now the single authoritative optics doc, or does it need
  merging with what `hardware/optics.xml` used to cover?
- **fec.xml** — FEC mode mismatches specifically. Narrow and clean on its
  own, but its causes overlap with crc_fcs_errors.xml and
  interface_down.xml's root-cause list.
- **speed_duplex.xml** — speed/duplex/auto-negotiation mismatches. Same
  pattern: narrow and clean standalone, but its `commonProblems` overlaps
  the same shared cause-list as the three above.
- **interface_flapping.xml** — link flapping specifically. Has a good,
  genuinely distinct `quickFlapCheck` (one command: `show interfaces
  <if> | match flap`, explicitly told not to run the full checklist for
  a flap-only question) — but its `investigate` list is yet another
  near-repeat of the same shared cause list (errors, CRC/FCS, optical
  power, speed/FEC).
- **show_interface_unit_syntax.xml** — genuinely different from the rest:
  a pure CLI syntax reference (dot notation vs. the config-mode-only
  "unit" keyword), plus operational notes about `ps*` pseudo-interfaces
  and their candidate BNG/PE devices. No troubleshooting-cause content,
  so it doesn't compete with the others for retrieval — but it does
  reference `dia-service-templates.xml` and "the DIA diagnosis runbook"
  by name, coupling it to files outside this folder.

**The real problem here:** five files (interface_down, interface_errors,
crc_fcs_errors, fec, speed_duplex, interface_flapping — six, really) each
carry their own version of essentially the same physical-layer cause
list. A query about "why is this interface having errors" can easily
pull 4 of these into the top-K results (recall `TOP_K=4`) and burn the
entire retrieval budget on near-duplicate restatements of "check optics,
check speed/duplex, check FEC, check the cable" instead of surfacing one
clear answer plus whatever's actually specific to the question.

## hardware/ (2 files, after optics.xml was removed)

- **fpc_pic.xml** — card/slot-level hardware: is a whole FPC or PIC
  faulted, not just one port. Narrow, clean, minimal overlap with
  anything else.
- **alarms.xml** — system/chassis alarm taxonomy (Power, Temp/Fan, RE/
  Mastership, LOS, SFP-unrecognized, LOF/AIS, Rescue-config, License,
  BGP-peer-down alarms) with severity and matching patterns for each.
  This is the most detailed file in the whole tree (you enriched it by
  hand earlier) and is the only one with real alarm-type depth — several
  other files (`interface_down.xml`, `optical_troubleshooting.xml`) just
  say "check alarms" as one step, which is a reasonable cross-reference
  rather than true duplication.

## switching/ (4 files) — moderate, mostly-justified overlap

- **lacp.xml** — aggregated-Ethernet (`ae*`) bundling: LACP state,
  actor/partner, member mismatches.
- **vlan_troubleshooting.xml** — does a VLAN exist, is a port actually a
  member, access vs. trunk, tagging.
- **trunk_troubleshooting.xml** — a trunk port carrying multiple VLANs:
  allowed-VLAN list, native VLAN, tagged frames. Its `check` list
  (VLAN membership, tagged frames, native VLAN) substantially repeats
  vlan_troubleshooting.xml's territory from the "multiple VLANs on one
  port" angle rather than "does this VLAN exist" angle — a real but
  smaller overlap than the interface/ cluster above.
- **mac_learning.xml** — the switching (L2 forwarding) table: is a MAC
  learned where expected, MAC flapping between ports as a loop symptom.

## routing/ (4 files)

- **routing.xml** — the general troubleshooting order across the whole
  stack: interface → IP → ARP → IS-IS adjacency → IS-IS database → route
  installation → FIB → BGP → traffic. An overview/index, not a deep dive
  on any one protocol.
- **arp.xml** — ARP/ND resolution specifically (IPv4 and IPv6). Narrow,
  clean, little overlap.
- **bgp.xml** — BGP peering and route exchange. Explicitly cross-
  references isis.xml when peers use loopbacks — a genuine, useful
  cross-reference, not duplication.
- **isis.xml** — the full IS-IS deep dive: adjacency, LSP database, route
  installation, loopback reachability, failover sequence. This is a
  superset of routing.xml's IS-IS-related steps (steps 4-6 there). This
  overview-vs-deep-dive split (routing.xml summarizes, isis.xml goes
  deep) is a reasonable, deliberate pattern — unlike the interface/
  cluster, these two complement each other rather than restating the
  same list four different ways.

## circuits/ (3 files)

- **circuit_down.xml** — the master 6-step circuit-down workflow:
  physical → encapsulation/VLAN → transport core (LDP/RSVP/LSP) →
  pseudowire/EVPN signaling → L3/routing → OAM testing. Has its own full
  command list spanning every layer.
- **circuit_evidence.xml** — an incident evidence *template* (fields to
  fill in: incident ID, site, interface, then evidence sections mirroring
  circuit_down.xml's same layers, then a timeline and root-cause section).
  Structurally a form, not a workflow — but its evidence-section commands
  are the same command list as circuit_down.xml, just re-packaged as
  "what to record" instead of "what to check in order."
- **provider_escalation.xml** — what to collect before escalating to a
  provider, and what to ask the provider to check on their side. Its
  `beforeEscalating` list (circuit ID, site, interface, incident time,
  link state, optical dBm, error/framing counters, pseudowire state,
  IGP/BGP status) is very close to circuit_evidence.xml's evidence
  sections — **this is the closest true near-duplicate in the whole
  tree**, more so than circuit_down vs. circuit_evidence, since both
  files are fundamentally "here's the checklist of facts to have ready,"
  just under different headings.

## Summary — where to focus cleanup

1. **interface/ physical-layer cluster** (interface_down, interface_errors,
   crc_fcs_errors, fec, speed_duplex, interface_flapping): six files each
   restating a highly similar root-cause list. Biggest retrieval-dilution
   risk in the tree. Worth deciding: keep the narrow deep-dives
   (crc_fcs_errors, fec, speed_duplex) as the source of truth and trim
   the repeated cause-lists out of interface_down/interface_errors/
   interface_flapping down to just what's actually unique to each
   (state interpretation, counter-reading method, and the flap-specific
   quick check, respectively) — pointing to the deep-dive files instead
   of re-listing their content.
2. **circuit_evidence.xml vs. provider_escalation.xml**: closest true
   duplicate pair. Consider merging into one file, or clearly splitting
   by intent (e.g. circuit_evidence.xml = internal documentation template
   you fill in during any incident; provider_escalation.xml = specifically
   the subset + phrasing you hand to a provider) rather than both listing
   nearly the same fields independently.
3. **vlan_troubleshooting.xml vs. trunk_troubleshooting.xml**: smaller,
   more justifiable overlap (different symptom angle on the same
   mechanism) — lower priority, but worth a look if you're trimming.
4. **routing.xml vs. isis.xml**: this one's fine as-is — overview vs.
   deep-dive is a useful split, not redundant duplication.
5. **optical_troubleshooting.xml**: now that `hardware/optics.xml` is
   gone, confirm this is the file you want to be the single source of
   truth for optics — check it covers everything the deleted file used
   to, rather than assuming nothing was lost.
