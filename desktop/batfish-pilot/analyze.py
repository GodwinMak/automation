"""Batfish pilot: load the snapshot, sanity-check parsing, trace a path, then re-trace with a link failed.

Usage:
  python analyze.py check
  python analyze.py trace  <START_NODE> <DST_IP>
  python analyze.py fail   <START_NODE> <DST_IP> <FAIL_NODE> <FAIL_INTERFACE>

Always run `check` first: if configs don't parse cleanly, nothing else can be trusted.
"""
import sys
import pathlib
import pandas as pd
from pybatfish.client.session import Session
from pybatfish.datamodel import HeaderConstraints, Interface

pd.set_option("display.width", 250)
pd.set_option("display.max_colwidth", 80)
pd.set_option("display.max_rows", 200)

SNAP = str(pathlib.Path(__file__).parent / "snapshot")
bf = Session(host="localhost")
bf.set_network("pilot")
bf.init_snapshot(SNAP, name="base", overwrite=True)


SENSITIVE = ("password", "secret", "key", "encrypted", "community", "archive-sites", "://", "@", "auth")


def redact(text):
    """Hide any config line that could contain a credential before printing it."""
    t = str(text)
    return "<line hidden: may contain a secret>" if any(k in t.lower() for k in SENSITIVE) else t


def show_trace(snapshot, start, dst):
    ans = bf.q.traceroute(
        startLocation=start, headers=HeaderConstraints(dstIps=dst)
    ).answer(snapshot=snapshot).frame()
    for _, row in ans.iterrows():
        print(f"\nDisposition: {[t.disposition for t in row['Traces']]}")
        for t in row["Traces"]:
            print("  path:", " -> ".join(h.node for h in t.hops))


cmd = sys.argv[1]

if cmd == "check":
    print("== Files that failed to parse fully ==")
    ps = bf.q.fileParseStatus().answer().frame()
    print(ps[ps["Status"] != "PASSED"] if len(ps) else "none")
    print("\n== Init issues (undefined refs, unrecognized lines) ==")
    print(bf.q.initIssues().answer().frame().head(40))
    print("\n== Layer-3 edges inferred (are your links discovered?) ==")
    print(bf.q.edges(edgeType="layer3").answer().frame())
    print("\n== IS-IS edges ==")
    try:
        print(bf.q.edges(edgeType="isis").answer().frame())
    except Exception as e:
        print("isis edge query unavailable in this version:", e)

elif cmd == "issues":
    # Why did a device fail / which things are undefined or unsupported? Optional node-name filter.
    only = sys.argv[2].lower() if len(sys.argv) > 2 else ""
    st = bf.q.fileParseStatus().answer().frame()
    print("== Parse status ==")
    print((st[st["File_Name"].str.lower().str.contains(only)] if only else st[st["Status"] == "FAILED"]).to_string())
    iss = bf.q.initIssues().answer().frame()
    if only:
        iss = iss[iss["Nodes"].astype(str).str.lower().str.contains(only)]
    print(f"\n== {len(iss)} init issues" + (f" mentioning '{only}'" if only else "") + " ==")
    for _, r in iss.head(40).iterrows():
        print(f"- [{r.get('Type')}] {redact(r.get('Details'))[:200]}")
        if r.get("Line_Text"):
            print(f"    line: {redact(r.get('Line_Text'))[:160]}")

elif cmd == "warnings":
    # Which exact config lines Batfish could not parse? Optional: filter by file name substring.
    # Output is deliberately limited to line number + the line text, nothing else.
    only = sys.argv[2].lower() if len(sys.argv) > 2 else ""
    w = bf.q.parseWarning().answer().frame()
    if only:
        w = w[w["Filename"].str.lower().str.contains(only)]
    print(f"{len(w)} parse warnings" + (f" in files matching '{only}'" if only else ""))
    if len(w):
        print("\n== Most common unrecognized lines (pattern, count) ==")
        counts = w.groupby("Text").size().sort_values(ascending=False).head(25)
        for text, n in counts.items():
            print(f"{n:5}  {redact(text)[:140]}")
        print("\n== Per-file counts ==")
        print(w.groupby("Filename").size().sort_values(ascending=False).to_string())

elif cmd == "trace":
    show_trace("base", sys.argv[2], sys.argv[3])

elif cmd == "fail":
    start, dst, fnode, fiface = sys.argv[2:6]
    bf.fork_snapshot(
        "base", "failed", deactivate_interfaces=[Interface(hostname=fnode, interface=fiface)], overwrite=True
    )
    print("=== BEFORE ===")
    show_trace("base", start, dst)
    print(f"\n=== AFTER failing {fnode}:{fiface} ===")
    show_trace("failed", start, dst)
