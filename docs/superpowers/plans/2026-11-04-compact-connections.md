# Compact connections correction

User-approved behavior: one visible line per unordered node pair, including reverse relationships, with all action directions and evidence available in connection details. Correct the excessive leaf-branch spacing regression without changing saved analysis data.

- [x] Add failing tests for forward/reverse action bundling, preserved relationship identities, bundle inspection and compact branch lengths.
- [x] Bundle edges in the UI projection for both Gameplay and Code. Retain canonical relation IDs, directions and source evidence. Inspect all members of a clicked bundle and disclose bounded/missing members. Keep self-relations out of the visible graph.
- [x] Replace the unbounded narrow-sector radius with bounded local branch placement, retaining minimum spacing, outward leaves and component separation. Exercise compactness alongside crossings.
- [x] Recheck actual Bangla and SaveHer overviews, full tests, build, browser interaction and portable package. Install UI changes and prepare the correction for the existing PR #5.

No reimport or canonical graph migration is needed. Existing node dragging and user-controlled pan/zoom remain covered. Detailed edge identities remain available to AI tools.

Review resolutions: preserve outgoing function-call direction through script ownership; allocate cycle room between actually occupied fans, retaining compact bare and sparse cycles. Bangla retained all six sampled action/evidence records; maximum edge length is about 505 units instead of 2,505, with 14 crossings and no under-22-unit node obstructions in the sampled overview.
