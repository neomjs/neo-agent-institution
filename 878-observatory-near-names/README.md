# #878 · Observatory near look: BEFORE / AFTER frames

Captured headless through the Neural Link at the operator's display size, 1992×1290, on the dark skin.

- **Scene:** a synthetic fixture, not the plane's data. `wholeGraphEnvelope({communities: 48, nodes: 6000, routeLength: 6})` lays out 48 density wells, and 30,000 unlinked nodes form the halo around them: 36,000 nodes in all. Labels cycle through twelve shapes the plane carries (agents, concepts, issue and PR titles, a session summary), so the names have the plane's lengths.
- **Path:** Wells → the largest well, whose hub becomes the orbit target. Then the wheel turns in until the camera stops at `zoom.min`, 0.1× the fitted distance.
- **BEFORE:** the branch, with `Observatory.mjs` and `ObservatorySceneLayout.mjs` reset to Institution `dev` `5b7e8e6`. The engine is `9cd931c970`, where neomjs/neo#20312 is merged: it has the near look, but the Observatory gives it no floor and no names.
- **AFTER:** branch `vega/878-observatory-near-names`. Names cross the wire, and `nearStyle` sets a 7 px floor and a 200 px name width.
- **Unchanged above the band:** the fitted frame and the frame on the well are byte-identical BEFORE and AFTER (sha1 `dbd8a8cb24b1…` and `634887edf161…`). The well frame's flight distance is 0.5×, above the band's outer edge at 0.4375×.
- **Stats at the deepest zoom:**
  - AFTER: `near {floor: 7, share: 1}` and 30 labels drawn, the wells' and the names (`labelStyle.max`). The names' atlas holds 63 of its 63 cells.
  - BEFORE: floor 0 and two labels drawn, both the wells'.
