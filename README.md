# gradia-a-plan-app

A browser-based vector plan-ideation tool for architects and urban designers, built on the premise that early-stage planning is better expressed as continuous gradient fields than as committed geometry. Each department is dropped as a pin that emits a soft scalar field, falling off by geodesic distance through the lot so its influence bends around corners and corridors instead of cutting along a straight sightline. Overlapping fields blend by relative concentration rather than overwriting one another, making the composite a quantitative preliminary approximation of where each program wants to sit before any wall exists.

That field is then resolved into a discrete plan: a structural grid is fit to the lot's dominant edge orientation, department cells are partitioned from it in proportion to field weight, and rooms are sliced within each cell. All of it is derived state — editing the boundary, a corridor, or a single pin re-flows the plan downstream.

https://gradia-a-plan-app.vercel.app/
