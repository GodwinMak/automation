# Agent regression checklist

Run this manually any time you edit a system prompt in `rag/agents/*.js`
(adding/changing a RULE) or touch caching logic in `rag/tools/agentTools.js`
or `rag/lib/*.js`. This is exactly the kind of change that has twice caused
the agent to refuse or fail at something it's actually fully capable of —
once from an over-broad RULE 9 refusal, once from a cache silently turning
one transient miss into a permanent "not found." Neither broke loudly;
both looked like normal, confident answers. This list exists to catch that
class of regression before you find it live, against a real device.

**General principle:** an empty/negative result from a tool is not proof a
capability doesn't exist — it might just be this one attempt. Any time you
add caching, ask: is a "not found" here a stable fact (safe to cache
forever) or could it be transient (never cache it, or expire it)? Any time
you add a refusal rule, ask: does this really require documentation, or
can it be answered directly from a live tool result?

## Test prompts and expected behavior

1. **Hardware/chassis status on a known-good device**
   "Check hardware on <device>" → delegates straight to run_live_diagnostics
   (`show chassis hardware` / `show chassis environment` / `show chassis
   alarms`) and reports what's actually flagged. Should NOT refuse for lack
   of knowledge-base documentation — this is live data, not a documentation
   question.

2. **Interface status**
   "Is <interface> up on <device>?" → uses a direct `show interfaces`
   check. Should NOT infer status from an l2circuit table, route table, or
   ARP hit.

3. **Device name → IP resolution**
   "Look up the IP for <a device you know is on file>." → resolves
   correctly. If it fails once, ask again in the same app session — if it
   still fails on the second try, that's a genuine miss; if it only fails
   once then works, something upstream (the Config API) blipped, which is
   fine as long as it self-corrects rather than sticking.

4. **A genuine knowledge gap (negative control)**
   Ask something with no knowledge-base entry AND not answerable from live
   device data (e.g. an internal policy question the knowledge base
   doesn't cover). → SHOULD refuse with the standard "I cannot execute
   this task — the knowledge base does not contain documentation for [X]."
   This confirms RULE 9 hasn't been accidentally weakened or removed while
   fixing an over-refusal elsewhere — the two failure modes are opposite
   and it's easy to overcorrect from one into the other.

5. **Customer lookup**
   "Find customer <name or CID>." → uses search_customers, not a guessed
   device/interface from memory or naming pattern.

6. **Runbook diagnosis**
   "Diagnose DIA circuit down for <ps interface>." → follows the
   documented runbook steps in order (interface → ARP → ping → neighbor
   check), no skipped or invented steps.

## After any fix

Re-run the specific case that broke, AND at least one case from a
different category above — a fix aimed at one symptom (like the hardware
refusal) can easily overcorrect and break something else (like the
negative-control refusal in #4). Both directions matter.
